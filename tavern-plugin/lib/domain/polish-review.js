// 精修 step one: an editor reads the latest reply against the principles and writes
// revision notes. Step two is the ordinary guided regeneration with those notes.

const CARD_LIMIT = 6000, PREVIOUS_LIMIT = 3000, INPUT_LIMIT = 2000
const NOTHING = '无需精修'

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

/** Notes to put in the guidance box; empty when the editor found nothing to change. */
export function polishReviewGuidance(text) {
  const notes = str(text).trim()
  return notes === '' || notes.replace(/[。.!！\s]/g, '') === NOTHING ? '' : notes
}
