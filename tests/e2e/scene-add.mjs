import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'

// A small valid RGB PNG; the host's attachment service rejects degenerate images.
function solidPng(size, rgb) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, () => Buffer.from(rgb)))])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
// A local OpenAI-compatible image endpoint: the only substituted image boundary.
const png = solidPng(64, [200, 150, 60])
export async function startSceneImageServer() {
  const prompts = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      try { prompts.push(JSON.parse(body).prompt) } catch { prompts.push('') }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ b64_json: png }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { baseURL: 'http://127.0.0.1:' + server.address().port + '/v1', prompts, close: () => new Promise(resolve => server.close(resolve)) }
}

export async function sceneAddChecks({ page, step, output, report, images }) {
  async function rpc(method, args) {
    return page.evaluate(async ({ method, args }) => {
      const response = await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })
      const value = await response.json()
      if (value && value.ok === false) throw new Error(value.error || method + ' failed')
      return value
    }, { method, args })
  }
  const pictures = page.locator('.dsh-tavern-illustration img')
  await step('玩一轮后开启场景生图', async () => {
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('领取任务奖励')
    await composer.press('Enter')
    await page.getByText('你获得了十枚金币。', { exact: false }).filter({ visible: true }).first().waitFor()
    await rpc('saveSceneImageSettings', { provider: 'openai', baseURL: images.baseURL, model: 'e2e-image', size: '1024x1024', apiKey: 'e2e-image-key' })
    await rpc('saveSceneImageSettings', { provider: 'openai', enabled: true })
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-image-settings-changed')))
  })
  await step('生成本轮第一张插图', async () => {
    await page.getByRole('button', { name: '为这一轮生成插图' }).last().click()
    await pictures.first().waitFor()
    assert.equal(await pictures.count(), 1)
  })
  await step('新增插图：填写描述，另选场景，两张并存', async () => {
    await page.getByRole('button', { name: '新增插图', exact: true }).last().click()
    await page.getByRole('textbox', { name: '新插图想画什么（选填）' }).fill('画柜台上的金币')
    await page.getByRole('region', { name: '新增插图' }).getByRole('button', { name: '新增插图' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.dsh-tavern-illustration img').length === 2, null, { timeout: 60000 })
    const audit = (await readFile(join(output, 'scene-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.deepEqual(audit, [{ addition: false, request: false }, { addition: true, request: true }], '新增插图的规划请求带上已有插图与用户描述')
    assert.equal(images.prompts.length, 2)
    assert.match(images.prompts[1], /gold coins on a wooden counter/)
    await page.screenshot({ path: join(output, 'scene-add.png'), fullPage: true })
  })
  await step('刷新后两张插图保留，删除新增的一张不影响第一张', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelectorAll('.dsh-tavern-illustration img').length === 2, null, { timeout: 60000 })
    page.once('dialog', dialog => dialog.accept())
    await page.locator('.dsh-tavern-illustration').nth(1).getByRole('button', { name: '删除图片' }).click()
    const confirm = page.getByRole('button', { name: /^(确定|确认|删除)$/ }).filter({ visible: true })
    if (await confirm.count()) await confirm.first().click()
    await page.waitForFunction(() => document.querySelectorAll('.dsh-tavern-illustration img').length === 1, null, { timeout: 30000 })
    assert.equal(images.prompts.length, 2, '删除不会请求图片')
    report.sceneAdd = { prompts: images.prompts.length }
  })
}
