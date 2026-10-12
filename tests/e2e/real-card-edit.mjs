import assert from 'node:assert/strict'
import { readFile, writeFile, copyFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/legacy-session-migration.js'

// Measures what one real card-workbench edit costs: steps and provider usage.
// TAVERN_E2E_CARD_EDIT_SOURCE names a local card file to copy (never committed).
export async function setupRealCardEdit({ root, profile, data, runtimeHome }) {
  const settings = parse(await readFile(join(runtimeHome, 'settings.yaml'), 'utf8'))
  const base = settings['agent-default-model']
  assert.ok(base?.provider && base?.model, '需要已配置的真实模型')
  const selection = { ...base, ...(process.env.TAVERN_E2E_CARD_EDIT_MODEL ? { model: process.env.TAVERN_E2E_CARD_EDIT_MODEL } : {}), reasoningEffort: process.env.TAVERN_E2E_CARD_EDIT_EFFORT || base.reasoningEffort || 'high' }
  await writeFile(join(root, 'settings.yaml'), stringify({ 'agent-default-model': selection, 'llm-pi-ai': settings['llm-pi-ai'] }), { mode: 0o600 })
  await copyFile(join(runtimeHome, '.credentials.yaml'), join(root, '.credentials.yaml'))
  await writeFile(join(profile, 'cordis.patch.yml'), stringify([{ id: 'agent-default-model', config: selection }]))
  await writeFile(join(data, 'tavern-settings.json'), JSON.stringify({ defaultForegroundModel: selection, defaultBackgroundModel: selection,
    backgroundModel: selection, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false } }))
  const sourceCard = process.env.TAVERN_E2E_CARD_EDIT_SOURCE
  assert.ok(sourceCard, '需要 TAVERN_E2E_CARD_EDIT_SOURCE 指向一张本地人物卡')
  await copyFile(sourceCard, join(data, 'resources/cards/edit-target.json'))
  return selection
}

export async function realCardEditChecks({ page, step, root, data, output, report }) {
  const task = process.env.TAVERN_E2E_CARD_EDIT_TASK || '把世界书「⚙️货币规则」里的物价锚点改一下：普通住宿一天改成约 2 基准，其他不变。'
  const store = createChatJournalStore({ dataRoot: data })
  async function cardChat() {
    const chats = await Promise.all((await readdir(join(data, 'chats'))).filter(id => !id.includes('.')).map(id => store.read(id)))
    return chats.find(chat => chat?.mode === 'card')
  }
  async function events(sessionId) {
    const dir = join(root, 'profile-data/tavern/sessions')
    for (const file of await readdir(dir, { recursive: true })) if (file.endsWith('session.v3.jsonl.zstd')) {
      const parsed = parseSessionLog(await readFile(join(dir, file)))
      if (parsed.header.id === sessionId) return parsed.events
    }
    return []
  }
  await step('真实模型完成一次改卡任务并记录消耗', async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-adjust-card-style', { detail: { card: { path: 'cards/edit-target.json', name: 'edit-target' } } })))
    let chat
    for (const deadline = Date.now() + 60000; !(chat = await cardChat()) && Date.now() < deadline;) await page.waitForTimeout(500)
    assert.ok(chat, '卡片工作台对话未创建')
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.waitFor()
    await composer.fill('【卡片任务：修改人物卡】\n\n【目标人物卡】\n@"cards/edit-target.json"\n\n' + task)
    await composer.press('Enter')
    const started = Date.now()
    let list = [], tick = Date.now()
    while (Date.now() - started < 900000) {
      list = await events(chat.sessionId)
      if (list.some(event => event.type === 'turn/end')) break
      if (Date.now() - tick > 30000) { console.log('等待真实模型改卡… 已 ' + list.filter(event => event.type === 'step/end').length + ' 步'); tick = Date.now() }
      await page.waitForTimeout(2000)
    }
    assert.ok(list.some(event => event.type === 'turn/end'), '真实模型未在时限内完成改卡')
    const steps = list.filter(event => event.type === 'assistant/message' && event.data?.usage).map(event => ({ step: event.data.step, ...event.data.usage }))
    const sum = key => steps.reduce((total, item) => total + (Number(item[key]) || 0), 0)
    const tools = list.filter(event => event.type === 'tool/call').map(event => event.data.name)
    const finalText = list.filter(event => event.type === 'assistant/message').at(-1)?.data?.message?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n')
    report.cardEdit = {
      task, seconds: Math.round((Date.now() - started) / 1000), steps: steps.length,
      firstStepPromptTokens: steps[0] ? (steps[0].inputTokens || 0) + (steps[0].cacheReadTokens || 0) : 0,
      inputTokens: sum('inputTokens'), cacheReadTokens: sum('cacheReadTokens'), outputTokens: sum('outputTokens'), reasoningTokens: sum('reasoningTokens'), totalTokens: sum('totalTokens'),
      tools, finalText, perStep: steps
    }
    await writeFile(join(output, 'card-edit-usage.json'), JSON.stringify(report.cardEdit, null, 2))
    console.log(JSON.stringify({ ...report.cardEdit, perStep: undefined, finalText: String(finalText).slice(0, 300) }, null, 2))
  })
}
