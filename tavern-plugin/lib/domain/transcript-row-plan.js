import { surfaceReplacementRange } from './session-events.js'
import { isScopedMessages } from './scoped-messages.js'

// The conversation page's row plan (docs/design/transcript-row-plan.md). The host draws
// every append-origin message forever; instead of listing what to hide, say for each
// saved round which native turn draws its input and which draws its reply. Every other
// finished native turn draws nothing. Pure: reads the save and the log only.

function textOf(message) {
  return (message?.content || []).filter(block => block?.type === 'text').map(block => block.text).join('')
}
const storyOf = event => Number(event?.data?.message?.source?.tavernStoryTurn)
const isAppendReply = event => event?.type === 'assistant/message' && event.surfaceOp === 'append'

/**
 * A save read as a window (recent rounds only) yields a partial plan: `from` is the first
 * round it judges, and rows of earlier turns are not its to decide.
 * @returns {{ version: 1, rounds: { story: number, input: number | null, reply: number }[], open: number | null, from: number | null }}
 */
export function planTranscriptRows({ chat, events = [], nodes = [], partial = false }) {
  const visible = new Set(nodes.map(Number))
  const bySeq = new Map(events.filter(event => Number.isSafeInteger(event?.seq)).map(event => [event.seq, event]))
  // Where each story round's reply is drawn, latest write wins. A rewrite of round N
  // (regeneration, repair, body edit) carries tavernStoryTurn = N.
  const drawn = new Map()
  // The host draws one row per step. A repair that rewrote many rounds put them all in
  // one step: that row is every round at once, so it stands for none of them.
  const replies = new Map()
  for (const event of events) {
    if (!isAppendReply(event) || textOf(event.data?.message) === '') continue
    const key = event.data?.turn + ':' + event.data?.step
    replies.set(key, (replies.get(key) || 0) + 1)
  }
  for (const event of events) {
    if (event?.type !== 'assistant/message' || !visible.has(Number(event.seq))) continue
    const story = storyOf(event)
    if (!Number.isSafeInteger(story) || story < 1) continue
    // A rewrite appended as its own row (a repaired round) draws itself.
    if (isAppendReply(event)) {
      if (textOf(event.data?.message) !== '' && replies.get(event.data?.turn + ':' + event.data?.step) === 1) drawn.set(story, Number(event.data?.turn))
      continue
    }
    if (event.surfaceOp?.op !== 'replace') continue
    // A replacement is model-only: the round shows at the drawable row it covers —
    // its tail when that is a reply append (the projection's copy, or the attempt's own
    // streamed reply), else the last reply append with text inside the range (an old
    // tool submission's fold copy). With none, the round keeps its own row.
    const range = surfaceReplacementRange(event.surfaceOp)
    const end = bySeq.get(range.end)
    if (isAppendReply(end)) { drawn.set(story, Number(end.data?.turn)); continue }
    const copy = events.findLast(source => isAppendReply(source) &&
      Number(source.seq) >= Number(range.start) && Number(source.seq) <= Number(range.end) &&
      textOf(source.data?.message) !== '' && Number(source.data?.turn) > 0)
    drawn.set(story, copy ? Number(copy.data.turn) : story)
  }
  const rounds = []
  // Rows without a turn (old saves) count the way the reply projection does
  // (projectReplyHistory): the opening is round 1, each player input starts the next.
  let inferred = 1
  // A scoped history must not be walked index by index: that reads every floor.
  const scoped = isScopedMessages(chat?.messages)
  const messages = scoped ? Object.keys(chat.messages).filter(key => key !== 'length').sort((left, right) => left - right).map(key => chat.messages[key]) : (Array.isArray(chat?.messages) ? chat.messages : [])
  for (const message of messages) {
    if (message?.role === 'user') { inferred += 1; continue }
    if (message?.role !== 'assistant') continue
    const story = Number(message.turn) || (message.greeting === true ? 1 : inferred)
    if (!Number.isSafeInteger(story) || story < 1) continue
    // The player's words stay where they were typed; a rewrite never moves them.
    rounds.push({ story, input: message.greeting === true ? null : story, reply: drawn.get(story) ?? story })
  }
  const window = partial || scoped
  return { version: 1, rounds, open: openTurn(events, rounds), from: window ? Math.min(Number.MAX_SAFE_INTEGER, ...rounds.map(round => round.story)) : null }
}

// The native turn the save does not hold yet but the page must keep: one still running,
// or the last one when it carries a player's input no round claims (settling, failed,
// or a round the save missed, #196). Earlier unclaimed turns are history rewritten away.
function openTurn(events, rounds) {
  let last = null, running = false, input = false
  for (const event of events) {
    if (event?.type === 'turn/start') { last = Number(event.data?.turn); running = true; input = false }
    else if (event?.type === 'turn/end') running = false
    else if (event?.type === 'user/message' && event.surfaceOp === 'append' && event.data?.source?.kind === 'user' && !event.data?.source?.repair) input = true
  }
  if (last === null) return null
  if (running) return last
  const claimed = new Set(rounds.flatMap(round => [round.input, round.reply]))
  const newest = Math.max(0, ...claimed)
  return input && !claimed.has(last) && last > newest ? last : null
}

const INPUT_ROWS = new Set(['user', 'turn-trigger'])

/**
 * Whether the page shows one host row under a plan. The client applies the same rule
 * (step 3); the replay and the comparison log use this copy.
 * @param {{ turn: number | null, kind: string }} row
 */
export function planShowsRow(plan, row) {
  if (!plan || row.turn === null || row.turn === undefined) return true
  const turn = Number(row.turn)
  // Before a partial plan's first round: not judged.
  if (plan.from !== null && plan.from !== undefined && turn < plan.from) return null
  if (plan.open !== null && turn === Number(plan.open)) return true
  const asInput = plan.rounds.some(round => round.input === turn)
  const asReply = plan.rounds.some(round => round.reply === turn)
  if (INPUT_ROWS.has(row.kind)) return asInput
  // Replies, tails, context and errors belong to the turn that draws the round's reply;
  // a turn that only holds the input keeps the input and nothing else.
  return asReply
}

/** The story round a native turn's reply row is drawn as, or the turn itself. */
export function planStoryTurn(plan, turn) {
  const round = plan?.rounds.findLast(item => item.reply === Number(turn))
  return round ? round.story : Number(turn)
}
