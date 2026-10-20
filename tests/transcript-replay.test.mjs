// What the conversation page shows after rewriting history, replayed from the log
// (tests/fixtures/transcript-replay.mjs). Each scenario keeps the shape of a reported
// bug; the invariant is the same for all: one input and one reply per saved round.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { foldStorySubmission } from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { planRegenerationSurface, regenerationProjection, applyRegenerationProjection, reshadowRolledBackRounds } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { repairNativeSurface } from '../tavern-plugin/lib/domain/native-surface-repair.js'
import { replayTranscript, closeReplay } from './fixtures/transcript-replay.mjs'

after(closeReplay)

const model = { kind: 'model', provider: 'test', model: 'test' }
const message = (id, role, text, source) => ({ id, role, content: [{ type: 'text', text }], ...(source ? { source } : {}) })

function game(id) {
  const session = Session.create(id)
  const chat = { id, messages: [], suppressedDshTurns: [], regeneratedDshTurns: {} }
  const put = (type, data, op = { surfaceOp: 'append' }) => appendSessionEvent(session, type, data, op || undefined)
  // One player round, as a story turn writes it: input, the foreground frame, the reply
  // (streamed, or submitted through submit_story and folded into a plain reply).
  function round(turn, input, body, { tool = false } = {}) {
    put('turn/start', { turn }, null)
    put('user/message', message('input-' + turn, 'user', input, { kind: 'user' }))
    put('user/message', message('frame-' + turn, 'user', '上下文', { kind: 'plugin', plugin: 'dsh-tavern' }))
    const reply = reply_(turn, body, tool)
    put('turn/end', { turn, reason: { kind: 'completed' } }, null)
    chat.messages.push({ role: 'user', text: input }, { role: 'assistant', turn, text: body, native: true })
    return reply
  }
  function reply_(turn, body, tool) {
    if (!tool) return put('assistant/message', { turn, step: 1, message: message('reply-' + turn, 'assistant', body, model) })
    const call = put('assistant/message', { turn, step: 1, message: { id: 'call-' + turn, role: 'assistant', source: model,
      content: [{ type: 'text', text: '好的。' }, { type: 'tool-call', id: 'c' + turn, name: 'submit_story', arguments: JSON.stringify({ content: body }) }] } })
    put('tool/call', { turn, step: 1, callId: 'c' + turn, name: 'submit_story', arguments: '{}' }, null)
    const receipt = put('tool/result', { turn, step: 1, message: { id: 'receipt-' + turn, role: 'user', source: { kind: 'tool', callId: 'c' + turn },
      content: [{ type: 'tool-result', toolCallId: 'c' + turn, isError: false, content: [{ type: 'text', text: body }] }] } }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    foldStorySubmission(session, { event: call, index: 0, receiptIndex: receipt.seq }, body)
    return sessionEvents(session).filter(event => event.type === 'assistant/message').at(-1)
  }
  // The regeneration flow as round-history.js runs it: an attempt turn woken by the
  // regeneration input, then the committed body projected over the old reply.
  function regenerate(story, oldSeq, body, { tool = false, hostNote = false } = {}) {
    const attempt = Math.max(...sessionEvents(session).filter(event => event.type === 'turn/start').map(event => Number(event.data.turn))) + 1
    const eventStart = put('turn/start', { turn: attempt }, null).seq
    put('user/message', message('regen-' + attempt, 'user', '重新生成', { kind: 'plugin', plugin: 'dsh-tavern-regen' }))
    put('user/message', message('frame-' + attempt, 'user', '上下文', { kind: 'plugin', plugin: 'dsh-tavern' }))
    if (hostNote) put('developer/message', { turn: attempt, step: 1, message: message('note-' + attempt, 'developer', '宿主提示') })
    reply_(attempt, body, tool)
    put('turn/end', { turn: attempt, reason: { kind: 'completed' } }, null)
    const plan = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, oldAssistantSeq: oldSeq, eventStart })
    applyRegenerationProjection(session, regenerationProjection(plan, { turn: story, step: 1,
      message: message('tavern-regen:' + attempt, 'assistant', body, { ...model, tavernStoryTurn: story }) }, 'op-' + attempt))
    chat.messages.findLast(row => row.role === 'assistant').text = body
    chat.suppressedDshTurns.push(attempt)
    chat.regeneratedDshTurns[String(story)] = attempt
    return sessionEvents(session).filter(event => event.type === 'assistant/message' && event.surfaceOp?.op === 'replace').at(-1).seq
  }
  return { session, chat, round, regenerate }
}

async function problemsOf({ chat, session }) {
  return (await replayTranscript(chat, session)).problems
}

test('普通回合：每轮一份输入一份正文', async () => {
  const g = game('plain')
  g.round(1, '你好', '她点了点头。')
  g.round(2, '去花店', '花店的门开着。')
  assert.deepEqual(await problemsOf(g), [])
})

test('同一轮连续重新生成三次：只剩最新一版', async () => {
  const g = game('regen-three')
  g.round(1, '你好', '她点了点头。')
  let seq = sessionEvents(g.session).filter(event => event.type === 'assistant/message').at(-1).seq
  g.round(2, '去花店', '第一版')
  seq = sessionEvents(g.session).filter(event => event.type === 'assistant/message').at(-1).seq
  for (const body of ['第二版', '第三版', '第四版']) seq = g.regenerate(2, seq, body)
  assert.deepEqual(await problemsOf(g), [])
})

// #283：工具提交的旧回合，折叠副本落在生成期回合里。
test('工具提交的回合重新生成后仍有正文（#283）', async () => {
  const g = game('regen-tool')
  const old = g.round(1, '你好', '旧正文', { tool: true })
  g.regenerate(1, old.seq, '新正文', { tool: true })
  assert.deepEqual(await problemsOf(g), [])
})

// #304：第二次重新生成时宿主在生成期写了一条 developer 消息。
test('连续重新生成、生成期夹着宿主 developer 消息，这一楼不空白（#304）', async () => {
  const g = game('regen-host-note')
  const old = g.round(1, '你好', '旧正文', { tool: true })
  const first = g.regenerate(1, old.seq, '第二版', { tool: true })
  g.regenerate(1, first, '第三版', { hostNote: true })
  assert.deepEqual(await problemsOf(g), [])
})

test('回退最后一轮：页面回到上一轮', async () => {
  const g = game('rollback')
  g.round(1, '你好', '她点了点头。')
  g.round(2, '去花店', '花店的门开着。')
  reshadowRolledBackRounds(g.session, new Set([2]))
  g.chat.messages.splice(-2)
  assert.deepEqual(await problemsOf(g), [])
})

// #306：存档正文与模型上下文不一致时，修复把整轮重写进一个新的编辑轮。宿主照样把
// 这一轮画出来，现有的隐藏名单都不认它，页面上就多出一份原文直出的副本。
test('修复模型上下文写入的整轮不出现在页面上（#306）', { todo: '现行隐藏名单不认修复轮；行计划（第 2、3 步）解决' }, async () => {
  const g = game('repair')
  g.round(1, '你好', '她点了点头。')
  g.round(2, '去花店', '花店的门开着。')
  g.chat.messages.at(-1).text = '花店的门开着。<StatusBar>{}</StatusBar>'
  const repaired = repairNativeSurface(g.session, g.chat, { repairId: 'r1' })
  assert.equal(repaired.applied, true)
  assert.deepEqual(await problemsOf(g), [])
})
