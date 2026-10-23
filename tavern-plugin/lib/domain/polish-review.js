// 精修: an editor reads the latest reply against the principles and returns edits (exact
// sentence replacements the player applies through the body editor) and notes (larger
// problems the player can send through the ordinary guided regeneration).

const CARD_LIMIT = 6000, PREVIOUS_LIMIT = 3000, INPUT_LIMIT = 2000
const NOTES_TAIL = '其余部分保持原文，情节、事件顺序和对白原意不变，篇幅与原文相近。'

function str(value) { return typeof value === 'string' ? value : value == null ? '' : String(value) }
function head(text, limit) { const value = str(text).trim(); return value.length > limit ? value.slice(0, limit) + '……' : value }
function tail(text, limit) { const value = str(text).trim(); return value.length > limit ? '……' + value.slice(-limit) : value }
function replyText(message) { return str(message && (message.projectionText ?? message.sourceText ?? message.text)) }

/** The player input and the reply before the latest one, read from the Chat tail. */
export function polishReviewContext(messages) {
  const rows = messages || []
  let input = '', previous = ''
  for (let index = rows.length - 2, seenUser = false; index >= 0; index -= 1) {
    const message = rows[index]
    if (!message) continue
    if (!seenUser && message.role === 'user') { input = str(message.text); seenUser = true; continue }
    if (seenUser && message.role === 'assistant') { previous = replyText(message); break }
  }
  return { input, previous }
}

export function buildPolishReviewRequest({ principles, card, playerName, input, previous, reply }) {
  const rules = str(principles).trim()
  if (rules === '') throw new Error('正文精修原则为空，请在系统提示词里填写')
  const body = str(reply).trim()
  if (body === '') throw new Error('这轮没有可精修的正文')
  const setting = ['description', 'personality', 'scenario'].map(key => str(card?.[key]).trim()).filter(Boolean).join('\n\n')
  const sections = [
    '【人物卡：' + (str(card?.name).trim() || '未命名') + '】\n' + (head(setting, CARD_LIMIT) || '（无）'),
    '【玩家角色】' + (str(playerName).trim() || '你'),
    previous.trim() ? '【上一轮正文】\n' + tail(previous, PREVIOUS_LIMIT) : '',
    input.trim() ? '【本轮玩家输入】\n' + head(input, INPUT_LIMIT) : '',
    '【本轮正文】\n' + body,
    '请按审稿标准写出修改意见。'
  ].filter(Boolean)
  return { system: rules, messages: [{ role: 'user', content: [{ type: 'text', text: sections.join('\n\n') }] }] }
}

function occurrences(texts, find) {
  const hits = []
  texts.forEach((text, part) => { for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + 1)) hits.push({ part, at }) })
  return hits
}

/** The editor's JSON; anything unreadable becomes one note so the old guided path still works. */
export function parsePolishReview(output, texts) {
  const raw = str(output).trim()
  const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value
  try { value = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) } catch { value = undefined }
  if (!value || typeof value !== 'object') return { edits: [], notes: raw ? [raw] : [] }
  const edits = (Array.isArray(value.edits) ? value.edits : []).flatMap(edit => {
    const find = str(edit?.find)
    if (!find.trim()) return []
    const hits = occurrences(texts, find).length
    return [{ find, replace: str(edit?.replace), reason: str(edit?.reason).trim(), status: hits === 1 ? 'ok' : hits === 0 ? 'missing' : 'ambiguous' }]
  })
  const notes = (Array.isArray(value.notes) ? value.notes : []).map(note => str(note).trim()).filter(Boolean)
  return { edits, notes }
}

/** Notes for the guidance box; empty when there are none. */
export function polishNotesGuidance(notes) {
  return notes.length ? notes.map((note, index) => (index + 1) + '. ' + note).join('\n') + '\n\n' + NOTES_TAIL : ''
}

/** Apply chosen edits to the reply's text parts; each must still match exactly once. */
export function applyPolishEdits(texts, edits) {
  const next = texts.slice()
  for (const edit of edits) {
    const find = str(edit?.find)
    const hits = find ? occurrences(next, find) : []
    if (hits.length !== 1) throw new Error('正文里找不到要改的原句，可能已经改过，请重新审稿：' + find.slice(0, 30))
    const { part, at } = hits[0]
    next[part] = next[part].slice(0, at) + str(edit.replace) + next[part].slice(at + find.length)
  }
  return next
}
