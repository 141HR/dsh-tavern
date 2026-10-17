import assert from 'node:assert/strict'
import test from 'node:test'
import { CAST_DATA_OWNER, CAST_SUBMIT_TOOL, castSettlementText, dialogueQuotes, normalizeCastSubmission, recentSpeakers } from '../tavern-plugin/lib/domain/cast-annotation.js'
import { createCastPresentation } from '../tavern-plugin/lib/domain/cast-presentation.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'

test('按阅读顺序取出同一行内成对引号里的台词，不跨行', () => {
  const text = '林曦笑着说：“你好。”他点头「嗯」。\n“没有结尾\n『第三句』和 "fourth" 以及 ＂第五＂'
  assert.deepEqual(dialogueQuotes(text), ['你好。', '嗯', '第三句', 'fourth', '第五'])
  assert.deepEqual(dialogueQuotes('只有旁白。'), [])
})

test('结算说明给台词编号并列出已出现人物；没有台词时不加说明', () => {
  const text = castSettlementText(['你好。', '这是一句'+'很长'.repeat(30)+'的台词'], { speakers: ['林曦', '老周'] })
  assert.match(text, /^【本轮台词】/)
  assert.match(text, /已出现的人物：林曦、老周/)
  assert.match(text, /\n1\. 你好。\n2\. 这是一句.+…$/)
  assert.equal(castSettlementText([]), '')
  assert.equal(CAST_SUBMIT_TOOL.parameters.properties.lines.items.properties.emotion.enum.length, 28)
})

test('提交按编号映射回原文；无效编号、空名字跳过，未知情绪按平静', () => {
  const quotes = ['你好。', '嗯', '走吧']
  const lines = normalizeCastSubmission({ lines: [
    { n: 3, speaker: ' 老周 ', emotion: 'joy' }, { n: 1, speaker: '林曦', emotion: 'blush' },
    { n: 9, speaker: '谁', emotion: 'joy' }, { n: 2, speaker: '  ', emotion: 'joy' }, { n: 1, speaker: '重复', emotion: 'joy' }
  ] }, quotes)
  assert.deepEqual(lines, [
    { n: 1, quote: '你好。', speaker: '林曦', emotion: 'neutral' },
    { n: 3, quote: '走吧', speaker: '老周', emotion: 'joy' }
  ])
  assert.deepEqual(normalizeCastSubmission({ lines: [] }, quotes), [])
  assert.throws(() => normalizeCastSubmission({}, quotes), /lines/)
  assert.throws(() => normalizeCastSubmission({ lines: [{ n: 7, speaker: 'x', emotion: 'joy' }] }, quotes), /重新提交/)
})

test('最近出现的人物去重，新的在前', () => {
  const records = [{ data: { lines: [{ speaker: '甲' }, { speaker: '乙' }] } }, { data: { lines: [{ speaker: '甲' }, { speaker: '丙' }] } }]
  assert.deepEqual(recentSpeakers(records), ['乙', '甲', '丙'])
})

function harness({ enabled = true, text = '她说：“你好。”\n他答：「嗯」', key = 'v1' } = {}) {
  const files = new Map()
  const store = {
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, change) { const next = change(files.has(path) ? structuredClone(files.get(path)) : undefined); files.set(path, next); return next }
  }
  const state = { enabled, key, published: 0 }
  const data = createPluginData({ store })
  const turns = {
    async resolveGame(sessionId) { return sessionId === 'game' ? { chatId: 'chat', sessionId } : null },
    async currentKey(_sessionId, turn) { return turn === 2 ? state.key : null },
    async readPendingTurn() { return { chatId: 'chat', turn: 2, key: state.key, text, greeting: false } }
  }
  const cast = createCastPresentation({ enabled: async () => state.enabled, turns, data, publish: () => state.published++ })
  return { cast, data, state }
}

test('结算时列出本轮台词，提交后按正文版本保存，换了版本就读不到', async () => {
  const { cast, data, state } = harness()
  const note = await cast.settlement.section({ gameId: 'game', turn: 2 })
  assert.match(note, /1\. 你好。\n2\. 嗯$/)
  const result = JSON.parse(await cast.settlement.call('cast_submit', { lines: [{ n: 1, speaker: '林曦', emotion: 'joy' }, { n: 2, speaker: '老周', emotion: 'neutral' }] }, { gameId: 'game', turn: 2 }))
  assert.deepEqual(result, { ok: true, annotated: 2 })
  assert.equal(state.published, 1)
  assert.equal((await data.turnsUpTo({ chatId: 'chat', owner: CAST_DATA_OWNER, turn: 2 })).length, 1)
  const read = await cast.forTurns('game', [2, 3])
  assert.deepEqual(read, { enabled: true, turns: { 2: [{ n: 1, quote: '你好。', speaker: '林曦', emotion: 'joy' }, { n: 2, quote: '嗯', speaker: '老周', emotion: 'neutral' }] } })
  state.key = 'v2'
  assert.deepEqual(await cast.forTurns('game', [2]), { enabled: true, turns: {} })
})

test('关闭时不加说明、不返回标注；没有说明时调用被拒绝', async () => {
  const { cast, state } = harness({ enabled: false })
  assert.equal(await cast.settlement.section({ gameId: 'game', turn: 2 }), '')
  assert.equal(await cast.settlement.wanted(), false)
  assert.equal(JSON.parse(await cast.settlement.call('cast_submit', { lines: [] }, { gameId: 'game', turn: 2 })).ok, false)
  assert.deepEqual(await cast.forTurns('game', [2]), { enabled: false, turns: {} })
  state.enabled = true
  assert.equal(await cast.settlement.wanted(), true)
})

test('本轮没有台词时不加说明；提交出错时让模型重提', async () => {
  assert.equal(await harness({ text: '只有旁白。' }).cast.settlement.section({ gameId: 'game', turn: 2 }), '')
  const { cast } = harness()
  await cast.settlement.section({ gameId: 'game', turn: 2 })
  const failed = JSON.parse(await cast.settlement.call('cast_submit', { lines: [{ n: 5, speaker: '谁', emotion: 'joy' }] }, { gameId: 'game', turn: 2 }))
  assert.equal(failed.ok, false)
  assert.equal(failed.retryable, true)
})
