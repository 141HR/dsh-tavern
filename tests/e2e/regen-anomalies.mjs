import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Probes regeneration after anomalous turns (failures, truncation, stops, reloads)
// and records whether the surface-ownership guard rejects it and whether the game
// can still continue. Every case runs; the report lists each outcome.
export async function regenAnomalyChecks({ page, step, savedChat, output, report, serverLog }) {
  const composer = () => page.getByRole('textbox', { name: /发消息|Message/ })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const results = []
  report.regenAnomalies = results
  // Every Tavern RPC failure the page sees, in order: the guard surfaces here, not in the server log.
  const rpcErrors = []
  page.on('response', async response => {
    if (!response.url().includes('/api/dsh-tavern/')) return
    try {
      const body = await response.json()
      if (body && body.ok === false) rpcErrors.push(new URL(response.url()).pathname.split('/').pop() + ': ' + String(body.error || '').slice(0, 200))
    } catch { /* non-JSON responses are not RPC results */ }
  })
  const guardPattern = /归属不一致[^\n]*|UNSAFE_SURFACE[^\n]*|重新生成尚未完成[^\n]*|已有新的消息，无法安全清理[^\n]*/
  const state = async () => {
    const chat = await savedChat()
    const assistants = chat.messages.filter(m => m.role === 'assistant')
    return { regen: Boolean(chat.regenInProgress), count: assistants.length, last: String(assistants.at(-1)?.sourceText ?? assistants.at(-1)?.text ?? '').slice(0, 40), error: chat.foregroundError || '' }
  }
  const errorsSince = start => {
    const match = guardPattern.exec(serverLog().slice(start))
    return match ? match[0] : ''
  }
  async function stopGeneration() {
    const labels = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.getAttribute('aria-label') || b.title || b.innerText).filter(Boolean))
    report.stopLabels ??= labels
    const stop = page.locator('button[aria-label*="Stop" i], button[aria-label*="停止"], button[aria-label*="Interrupt" i], button[aria-label*="中断"], button[title*="停止"]').filter({ visible: true }).last()
    if (await stop.count()) { await stop.click(); return true }
    return false
  }
  async function send(text, wait = true) {
    const before = await state()
    await composer().fill(text); await composer().press('Enter')
    if (!wait) return
    for (let i = 0; i < 120; i++) { await pause(500); const now = await state(); if (now.count > before.count || now.last !== before.last) break }
    await page.getByText('后台结算已完成').last().waitFor({ timeout: 30000 }).catch(() => {})
  }
  async function regen(guidance, { stopAfter } = {}) {
    const button = page.getByRole('button', { name: '重新生成正文', exact: true }).filter({ visible: true }).last()
    if (!await button.isVisible().catch(() => false)) return 'no regenerate button'
    const before = await state(), logStart = serverLog().length
    await button.click()
    await page.getByPlaceholder('指导意见（可选）：例如“写得更长，侧重心理描写”').fill(guidance)
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
    if (stopAfter) { await pause(stopAfter); if (!await stopGeneration()) return 'stop button not found' }
    for (let i = 0; i < 90; i++) {
      await pause(500)
      const guard = errorsSince(logStart)
      if (guard) return 'GUARD: ' + guard
      const now = await state()
      if (!now.regen && i > 4) return now.last !== before.last ? 'replaced' : 'unchanged'
    }
    return 'timeout (regenInProgress=' + (await state()).regen + ')'
  }
  // After each case: can the player still send a message and get a reply?
  async function canContinue(n) {
    const before = await state(), logStart = serverLog().length
    await composer().fill('继续第' + n + '次'); await composer().press('Enter')
    for (let i = 0; i < 90; i++) {
      await pause(500)
      const now = await state()
      if (now.count > before.count) { await page.getByText('后台结算已完成').last().waitFor({ timeout: 30000 }).catch(() => {}); return 'ok' }
    }
    return 'stuck' + (errorsSince(logStart) ? ': ' + errorsSince(logStart) : '') + ' | ' + (await page.locator('[data-chat-flow-kind="turn-error"], .dsh-tavern-error-controls').filter({ visible: true }).last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
  }
  async function probe(name, setup) {
    await step('重新生成探测：' + name, async () => {
      const entry = { name }, errorStart = rpcErrors.length
      try {
        entry.setup = (await setup()) || ''
        entry.regen = await regen('雨夜重写')
      } catch (error) { entry.error = error.message.split('\n')[0] }
      await page.screenshot({ path: join(output, 'regen-' + results.length + '.png'), fullPage: true })
      entry.next = await canContinue(results.length).catch(error => 'check failed: ' + error.message.split('\n')[0])
      entry.rpcErrors = rpcErrors.slice(errorStart)
      results.push(entry)
      console.log('   ' + name + ' → ' + JSON.stringify(entry))
    })
  }
  await step('正常玩一轮', async () => { await send('领取任务奖励') })
  await probe('基线：正常一轮后', async () => {})
  await probe('内容审核拦截一轮后（不处理）', async () => { await send('E2E_CONTENT_FILTER 继续', false); await pause(6000) })
  await probe('撤回被拦截的输入后', async () => {
    await send('E2E_CONTENT_FILTER 再试', false); await pause(6000)
    const withdraw = page.locator('.dsh-tavern-error-withdraw').filter({ visible: true }).last()
    if (!await withdraw.isVisible().catch(() => false)) return 'no withdraw button'
    await withdraw.click(); await pause(3000); await composer().fill('')
  })
  await probe('正文写到一半被掐断后', async () => { await send('E2E_FILTER_MIDSTREAM 继续', false); await pause(8000) })
  await probe('回复因长度上限截断后', async () => { await send('E2E_TRUNCATE_TEXT 继续'); await pause(3000) })
  await probe('手动停止正文生成后', async () => {
    await send('E2E_SLOW 继续', false); await pause(3000)
    const stopped = await stopGeneration(); await pause(4000)
    return stopped ? 'stopped' : 'stop button not found'
  })
  await probe('重新生成时被拦截后', async () => 'blocked regen → ' + await regen('E2E_CONTENT_FILTER'))
  await probe('重新生成中途手动停止后', async () => 'stopped regen → ' + await regen('E2E_SLOW', { stopAfter: 3000 }))
  await probe('重新加载人物卡和世界书后', async () => {
    await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
    const reload = page.getByText('重新加载人物卡和世界书', { exact: false }).filter({ visible: true }).first()
    if (!await reload.count()) return 'no reload entry'
    await reload.click(); await pause(2000)
    const confirm = page.getByRole('button', { name: /^(确定|确认|重新加载|更新|应用)$/ }).filter({ visible: true })
    if (await confirm.count()) await confirm.first().click()
    await pause(3000)
  })
  await probe('连续两次重新生成', async () => 'first → ' + await regen('雨夜重写'))
  await writeFile(join(output, 'regen-anomalies.json'), JSON.stringify({ results, stopLabels: report.stopLabels }, null, 2))
}
