import test from 'node:test'
import assert from 'node:assert/strict'
import { planTranscriptRows, planShowsRow, planStoryTurn } from '../tavern-plugin/lib/domain/transcript-row-plan.js'
import { createSessionStateView } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { createScopedMessages } from '../tavern-plugin/lib/domain/scoped-messages.js'

const model = { kind: 'model', provider: 'test', model: 'test' }
const reply = (seq, turn, text, extra = {}) => ({ seq, type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }], source: model, ...extra } } })
const input = (seq, source = { kind: 'user' }) => ({ seq, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: '输入' }], source } })
const turn = (seq, type, number) => ({ seq, type, data: { turn: number, reason: { kind: 'completed' } } })
const chat = turns => ({ messages: turns.flatMap(number => [{ role: 'user', text: '输入' }, { role: 'assistant', turn: number, text: '正文' }]) })

test('普通回合：输入和正文都在自己的原生轮', () => {
  const events = [turn(0, 'turn/start', 1), input(1), reply(2, 1, '正文'), turn(3, 'turn/end', 1)]
  const plan = planTranscriptRows({ chat: chat([1]), events, nodes: [1, 2] })
  assert.deepEqual(plan.rounds, [{ story: 1, input: 1, reply: 1 }])
  assert.equal(plan.open, null)
  assert.equal(planShowsRow(plan, { turn: 1, kind: 'user' }), true)
  assert.equal(planShowsRow(plan, { turn: 1, kind: 'assistant-step' }), true)
})

test('修复把一轮重写进自己的一步：正文画在那一轮；多轮挤在同一步时各轮仍用原来的行', () => {
  const story = n => ({ source: { ...model, tavernStoryTurn: n } })
  const one = [turn(0, 'turn/start', 1), input(1), reply(2, 1, '旧'), turn(3, 'turn/end', 1),
    turn(4, 'turn/start', 2), reply(5, 2, '新', story(1)), turn(6, 'turn/end', 2)]
  assert.deepEqual(planTranscriptRows({ chat: chat([1]), events: one, nodes: [1, 5] }).rounds, [{ story: 1, input: 1, reply: 2 }])
  const many = [turn(0, 'turn/start', 1), input(1), reply(2, 1, 'a'), turn(3, 'turn/end', 1),
    turn(4, 'turn/start', 2), input(5), reply(6, 2, 'b'), turn(7, 'turn/end', 2),
    turn(8, 'turn/start', 3), reply(9, 3, 'a', story(1)), reply(10, 3, 'b', story(2)), turn(11, 'turn/end', 3)]
  const plan = planTranscriptRows({ chat: chat([1, 2]), events: many, nodes: [1, 9, 5, 10] })
  assert.deepEqual(plan.rounds.map(round => round.reply), [1, 2])
  assert.equal(planShowsRow(plan, { turn: 3, kind: 'assistant-step' }), false)
})

test('最后一轮还在跑、或已结束但存档还没收下玩家输入：这一轮原样显示', () => {
  const running = [turn(0, 'turn/start', 1), input(1), reply(2, 1, '正文'), turn(3, 'turn/end', 1), turn(4, 'turn/start', 2), input(5)]
  assert.equal(planTranscriptRows({ chat: chat([1]), events: running, nodes: [1, 2, 5] }).open, 2)
  const settling = [...running, reply(6, 2, '还没入档'), turn(7, 'turn/end', 2)]
  assert.equal(planTranscriptRows({ chat: chat([1]), events: settling, nodes: [1, 2, 5, 6] }).open, 2)
  // An unclaimed turn woken by Tavern itself (an abandoned attempt) is not the player's.
  const attempt = [...running.slice(0, 4), turn(4, 'turn/start', 2), input(5, { kind: 'plugin', plugin: 'dsh-tavern-regen' }), reply(6, 2, '作废'), turn(7, 'turn/end', 2)]
  assert.equal(planTranscriptRows({ chat: chat([1]), events: attempt, nodes: [1, 2] }).open, null)
})

test('旧存档的行没有轮次号：开场算第 1 轮，每条玩家输入往后推一轮', () => {
  const plan = planTranscriptRows({ chat: { messages: [{ role: 'assistant', greeting: true, text: '开场' }, { role: 'user', text: '你好' }, { role: 'assistant', text: '回复' }] }, events: [], nodes: [] })
  assert.deepEqual(plan.rounds, [{ story: 1, input: null, reply: 1 }, { story: 2, input: 2, reply: 2 }])
  assert.equal(planStoryTurn(plan, 2), 2)
})

test('只读到最近几轮的存档：更早的轮次不由计划判断', () => {
  const messages = createScopedMessages(6, [[4, { role: 'user', text: '输入' }], [5, { role: 'assistant', turn: 9, text: '正文' }]])
  const plan = planTranscriptRows({ chat: { messages }, events: [], nodes: [] })
  assert.equal(plan.from, 9)
  assert.equal(planShowsRow(plan, { turn: 3, kind: 'assistant-step' }), null)
  assert.equal(planShowsRow(plan, { turn: 9, kind: 'assistant-step' }), true)
})

test('视图随隐藏名单一起下发行计划；非剧情会话不下发', () => {
  const events = [turn(0, 'turn/start', 1), input(1), reply(2, 1, '正文'), turn(3, 'turn/end', 1)]
  const session = { id: 's', events, surface: { nodes: [1, 2] } }
  const fields = createSessionStateView({ activity: () => ({ busy: false }), evidence: () => ({ session, events }) })
  const story = fields.rollback({ id: 'c', sessionId: 's', mode: 'story', ...chat([1]) }, { session, events })
  assert.deepEqual(story.transcriptRows.rounds, [{ story: 1, input: 1, reply: 1 }])
  assert.equal(fields.rollback({ id: 'd', sessionId: 's', mode: 'card', messages: [] }, { session, events }).transcriptRows, null)
})
