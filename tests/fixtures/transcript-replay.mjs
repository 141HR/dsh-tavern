// Replay a session log against what the player's conversation page shows.
//
// The host draws every append-origin message forever; Tavern then hides rows by native
// turn (docs/design/transcript-row-plan.md). This replays both halves outside the app:
// the host's rows are modelled from the log, the server view comes from the real
// createSessionStateView, and the hiding runs the real client bundle in a browser page.
// The check is the invariant the page must keep: every story round in the save shows one
// input and one reply, and no reply shows for a round the save does not have.
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createSessionStateView } from '../../tavern-plugin/lib/domain/chat-session-state.js'
import { sessionEvents } from '../../tavern-plugin/lib/domain/session-events.js'

const SEED_REPLY = /^tavern-seed-trajectory:v1:.+:2$/

function textOf(message) {
  return (message?.content || []).filter(block => block?.type === 'text').map(block => block.text).join('')
}

/**
 * The rows the host's chat view builds from a log: one assistant-step per step (append
 * messages only; replacements stay model-only), the player's input, the trigger card of
 * a turn a plugin message woke, plugin context, and one tail per finished turn.
 */
export function hostRows(events) {
  const rows = []
  const steps = new Map()
  let turn = null, woke = false
  // A message queued before its turn starts (the inbox splices it in) opens that turn.
  let queued = []
  for (const event of events) {
    if (!event) continue
    if (event.type === 'turn/start') {
      turn = Number(event.data?.turn)
      woke = queued.some(row => row.kind === 'user')
      for (const row of queued) row.turn = turn
      queued = []
      continue
    }
    if (event.type === 'turn/end') {
      rows.push({ seq: event.seq, turn: Number(event.data?.turn), kind: 'turn-tail', text: '' })
      turn = null
      continue
    }
    if (event.surfaceOp !== 'append') continue
    if (event.type === 'user/message') {
      const source = event.data?.source
      const kind = source?.kind === 'user' ? 'user' : woke || turn === null ? 'context' : 'turn-trigger'
      if (kind !== 'context') woke = true
      const row = { seq: event.seq, turn, kind, text: textOf(event.data), source: source?.plugin || source?.kind || '' }
      rows.push(row)
      if (turn === null) queued.push(row)
      continue
    }
    if (event.type !== 'assistant/message') continue
    const owner = Number(event.data?.turn), step = Number(event.data?.step) || 1
    const key = owner + ':' + step
    let row = steps.get(key)
    if (!row) {
      row = { seq: event.seq, turn: owner, step, kind: 'assistant-step', text: '', tools: 0, ids: [] }
      steps.set(key, row)
      rows.push(row)
    }
    row.text += textOf(event.data?.message)
    row.tools += (event.data?.message?.content || []).filter(block => block?.type === 'tool-call').length
    row.ids.push(String(event.data?.message?.id || ''))
  }
  // A step with nothing visible is never drawn; Tavern hides its own seed reply.
  return rows.filter(row => row.kind !== 'assistant-step' || ((row.text.trim() !== '' || row.tools > 0) && !row.ids.some(id => SEED_REPLY.test(id))))
}

/** The server's visibility fields for this save and log, from the production view. */
export function serverView(chat, session) {
  const events = sessionEvents(session)
  const fields = createSessionStateView({ activity: () => ({ busy: false }), evidence: () => ({ session, events }) })
  return fields.rollback({ id: chat.id || 'chat', sessionId: session.id, mode: 'story', ...chat }, { session, events })
}

let browserPromise = null
async function page() {
  browserPromise ??= chromium.launch({ headless: true })
  const browser = await browserPromise
  const tab = await browser.newPage()
  const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  await tab.setContent('<main></main>')
  await tab.evaluate(source => {
    window.__ModuleLoader__ = { load(definition) { window.client = definition.factory(() => ({})) } }
    window.eval(source)
  }, source)
  return tab
}
export async function closeReplay() {
  if (browserPromise) await (await browserPromise).close()
  browserPromise = null
}

/** Run the client's own hiding over the modelled rows; returns the rows with `visible`. */
export async function visibleRows(rows, view) {
  const tab = await page()
  try {
    const shown = await tab.evaluate(({ rows, view }) => {
      const root = document.querySelector('main')
      for (const row of rows) {
        const node = document.createElement('div')
        node.setAttribute('data-chat-flow-kind', row.kind)
        if (row.turn !== null) node.setAttribute('data-chat-turn', String(row.turn))
        root.append(node)
      }
      const projection = client.createTurnHistoryProjection({ root: () => root, storage: () => ({ getItem: () => '{}', setItem() {} }) })
      projection.apply('replay', view.suppressedDshTurns, view.regeneratedDshTurns, view.replacingDshTurns, view.supersededDshTurns)
      return Array.from(root.children, node => getComputedStyle(node).display !== 'none')
    }, { rows, view })
    return rows.map((row, index) => ({ ...row, visible: shown[index] }))
  } finally { await tab.close() }
}

/** The story turn the assistant renderer draws a native turn's reply as (tavernStoryTurnForDshTurn). */
export function storyTurnOf(view, turn) {
  for (const [story, native] of Object.entries(view.regeneratedDshTurns || {})) if (Number(native) === Number(turn)) return Number(story)
  return Number(turn)
}

/**
 * What the player sees per story round, and every way it breaks the page's invariant.
 * Only a turn's closing step draws the round's story; earlier steps show their own text.
 */
export function transcriptReport(chat, rows, view) {
  const rounds = new Map()
  for (const message of chat.messages || []) {
    if (message?.role !== 'assistant') continue
    const story = Number(message.turn)
    if (!(story > 0)) continue
    rounds.set(story, { story, greeting: message.greeting === true, saved: String(message.text ?? ''), inputs: [], replies: [] })
  }
  const closing = new Map()
  for (const row of rows) if (row.kind === 'assistant-step') closing.set(row.turn, row)
  const orphans = []
  for (const row of rows) {
    if (!row.visible) continue
    if (row.kind === 'user' || row.kind === 'turn-trigger') {
      const round = rounds.get(Number(row.turn))
      if (round) round.inputs.push(row)
      else orphans.push({ kind: 'input', row })
    }
    if (row.kind === 'assistant-step' && closing.get(row.turn) === row) {
      const story = storyTurnOf(view, row.turn)
      const round = rounds.get(story)
      if (round) round.replies.push(row)
      else orphans.push({ kind: 'reply', story, row })
    }
  }
  const problems = []
  // A round still being written (regenerating, settling) is not judged yet.
  const live = view.replacingDshTurns?.length || chat.regenInProgress === true
  for (const round of rounds.values()) {
    if (live) break
    if (round.replies.length === 0) problems.push(`第 ${round.story} 轮没有可见正文`)
    if (round.replies.length > 1) problems.push(`第 ${round.story} 轮有 ${round.replies.length} 份正文：原生轮 ${round.replies.map(row => row.turn).join('、')}`)
    if (!round.greeting && round.inputs.filter(row => row.kind === 'user').length > 1) problems.push(`第 ${round.story} 轮的玩家输入出现了 ${round.inputs.length} 次`)
  }
  for (const orphan of orphans) {
    if (orphan.kind === 'reply') problems.push(`原生轮 ${orphan.row.turn} 的正文可见，但存档没有第 ${orphan.story} 轮`)
    else if (orphan.row.kind === 'user') problems.push(`原生轮 ${orphan.row.turn} 的玩家输入可见，但存档没有这一轮`)
    else problems.push(`原生轮 ${orphan.row.turn} 的触发卡（${orphan.row.source}）可见`)
  }
  return { rounds: [...rounds.values()], orphans, problems }
}

/** Everything at once: rows, server view, client hiding, invariant report. */
export async function replayTranscript(chat, session) {
  const events = sessionEvents(session)
  const view = serverView(chat, session)
  const rows = await visibleRows(hostRows(events), view)
  return { view, rows, ...transcriptReport(chat, rows, view) }
}
