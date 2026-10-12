import { sessionEvents } from './session-events.js'

function str(value) { return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value)) }

export function isTurnInput(message) {
  const source = message && message.source
  return Boolean(source && (source.kind === 'user' || (source.kind === 'plugin' && (source.plugin === 'dsh-tavern-regen' || source.plugin === 'dsh-tavern-replay'))))
}

/** A message the player (or a regenerate/replay) sent. Replacements rewrite an
 * earlier message in place — a template edit keeps the original source and
 * request id — and are never the input of the turn they happen to land in. */
export function isNewTurnInput(event) {
  return Boolean(event && event.type === 'user/message' && isTurnInput(event.data) && !(event.surfaceOp && typeof event.surfaceOp === 'object'))
}

/** A new message typed by the player, which ends any earlier regenerate attempt. */
export function isNewPlayerInput(event) {
  return isNewTurnInput(event) && event.data?.source?.kind === 'user'
}

function turnStartIndex(events, turn) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event && event.type === 'turn/start' && Number(event.data && event.data.turn) === Number(turn)) return index
  }
  return -1
}

/** The player input that started this turn. */
export function userMessageForTurn(session, turn) {
  const events = sessionEvents(session)
  const start = turnStartIndex(events, turn)
  if (start < 0) return ''
  for (let index = start + 1; index < events.length; index++) {
    const event = events[index]
    if (isNewTurnInput(event)) return event.data
  }
  return ''
}

export function requestIdForTurn(session, turn) {
  const message = userMessageForTurn(session, turn)
  const source = message && message.source
  return source && source.kind === 'user' ? str(source.rpcId).trim() : ''
}
