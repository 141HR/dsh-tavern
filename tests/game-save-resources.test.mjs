import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createGameSaveResources } from '../tavern-plugin/lib/domain/game-save-resources.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'

async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'save-resources-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const resources = createFileResourceStore({ dataRoot: root })
  const cardPreparation = createCardPreparation()
  const prepare = createGameSaveResources({ resources, cardPreparation })
  return { resources, prepare }
}
const payload = description => ({ kind: 'text', name: 'hero.json', text: JSON.stringify({ name: 'Hero', description }) })
const saveOf = payload => ({ chat: { cardPath: 'cards/hero.json', mode: 'story' }, card: { payload } })

test('同名不同内容的存档人物卡另存，重复及并发导入不覆盖已有卡', async t => {
  const { resources, prepare } = await harness(t)
  const local = await prepare(saveOf(payload('local')))
  const imported = await Promise.all([prepare(saveOf(payload('packaged'))), prepare(saveOf(payload('packaged')))])
  assert.equal(new Set([local.cardPath, ...imported.map(item => item.cardPath)]).size, 3)
  assert.equal((await resources.originalCardPayload(local.cardPath)).text, payload('local').text)
  for (const item of imported) assert.equal((await resources.originalCardPayload(item.cardPath)).text, payload('packaged').text)
  assert.equal((await prepare(saveOf(payload('local')))).importedCard, '')
})

test('PNG 人物卡改名导入仍保留原始图片字节', async t => {
  const { resources, prepare } = await harness(t)
  await prepare(saveOf(payload('local')))
  const raw = { name: 'PNG Hero' }
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const text = Buffer.from('chara\0' + Buffer.from(JSON.stringify(raw)).toString('base64'))
  const chunk = Buffer.alloc(12 + text.length)
  chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8)
  const bytes = Buffer.concat([header, chunk])
  const png = { kind: 'png', name: 'hero.png', b64: Buffer.from(JSON.stringify(raw)).toString('base64'), fileB64: bytes.toString('base64') }
  const result = await prepare(saveOf(png))
  assert.notEqual(result.cardPath, 'cards/hero.json')
  assert.deepEqual(await resources.readCardImage(result.cardPath), bytes)
})
