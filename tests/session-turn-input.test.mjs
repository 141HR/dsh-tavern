import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { synchronizeTemplateHistory } from '../tavern-plugin/lib/domain/template-history.js'
import { userMessageForTurn, requestIdForTurn } from '../tavern-plugin/lib/domain/session-turn-input.js'

const input = (id, text, rpcId) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId } })
const reply = (id, turn, text) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'test', model: 'test' } } })

// #196: a prompt template rewrote an earlier saved input; the native copy is
// synchronised in the next turn's pre-step, i.e. after that turn has started.
test('上一轮输入的模板改写同步写在新一轮开始之后，新一轮仍取到本轮玩家输入（#196）', async () => {
  const session = Session.create('turn-input')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'user/message', input('in-1', '原始输入', 'rpc-1'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', reply('out-1', 1, '第一轮正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const chat = { messages: [{ role: 'user', text: '模板改写后的输入', templateInputSource: '原始输入' }, { role: 'assistant', text: '第一轮正文' }] }
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  await synchronizeTemplateHistory(session, chat, async () => {})
  appendSessionEvent(session, 'user/message', input('in-2', '第二轮输入', 'rpc-2'), { surfaceOp: 'append' })
  assert.equal(userMessageForTurn(session, 2).content[0].text, '第二轮输入')
  assert.equal(requestIdForTurn(session, 2), 'rpc-2')
})

test('重新生成时模板改写同步落在本次尝试中，不会被当成新的玩家输入而截断尝试或阻止撤销（#196）', async () => {
  const { planRegenerationSurface } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const { sessionEvents } = await import('../tavern-plugin/lib/domain/session-events.js')
  const session = Session.create('regen-template-edit')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'user/message', input('in-1', '原始输入', 'rpc-1'), { surfaceOp: 'append' })
  const old = appendSessionEvent(session, 'assistant/message', reply('out-1', 1, '第一轮正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  await synchronizeTemplateHistory(session, { messages: [{ role: 'user', text: '模板改写后的输入', templateInputSource: '原始输入' }, { role: 'assistant', text: '第一轮正文' }] }, async () => {})
  appendSessionEvent(session, 'user/message', { id: 'regen', role: 'user', content: [{ type: 'text', text: '原始输入' }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, { surfaceOp: 'append' })
  const fresh = appendSessionEvent(session, 'assistant/message', reply('new', 2, '新正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  const plan = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, oldAssistantSeq: old.seq, eventStart })
  assert.equal(plan.finalAssistantSeq, fresh.seq)
})
