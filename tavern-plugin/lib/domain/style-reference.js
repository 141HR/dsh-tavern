// 文风联想：正文提交后，后台模型凭记忆找一部笔调接近当前场景的经典小说，
// 摘一段原文；下一轮前台像剧本参考一样带上它，借人类作者的笔致压住 AI 腔。

export const STYLE_REFERENCE_SUBMIT_TOOL = {
  name: 'style_reference_submit',
  description: '提交文风联想：一部经典小说的书名、作者，以及从中摘抄的一段原文。提交后任务完成。',
  parameters: { type: 'object', properties: {
    book: { type: 'string', description: '书名，不带书名号' },
    author: { type: 'string' },
    quote: { type: 'string', description: '一段原文，约 100～300 字，不超过 400 字' }
  }, required: ['book', 'author', 'quote'], additionalProperties: false }
}

const KEPT = 8
const MAX_QUOTE = 400

const SYSTEM = `你是文风联想员，不续写剧情，不修改变量。
阅读刚写完的正文，判断它的场景、情绪和笔调；凭你的阅读记忆，找一部与之风格相近的经典小说，从中摘抄一段与当前场景气质相近的原文，约 100～300 字。
要求：
- 摘叙事或描写段落：人物的动作、神态、对话，环境与细节。不要名言警句、议论抒情或格言式的句子。
- 只摘中文白话：中文小说或外国小说的通行中译本，不要外文原文，不要文言。
- 必须是原作文字，不要仿写、改写或拼接；整段记不准就换一部你记得准的作品。
最后调用 style_reference_submit 提交书名、作者和这段原文。`

function str(value) {
  return typeof value === 'string' ? value : ''
}

export function readStyleReference(args) {
  const book = str(args?.book).trim().replace(/^《|》$/g, '')
  const author = str(args?.author).trim()
  const quote = str(args?.quote).trim()
  if (!book || !author || !quote) throw new Error('书名、作者和摘句都不能为空')
  if (quote.length > MAX_QUOTE) throw new Error('摘录不超过 ' + MAX_QUOTE + ' 字，只摘一段')
  return { book, author, quote }
}

function replyTurn(message) {
  return Number(message?.turn) || 0
}

/**
 * The reference recalled from the reply this turn follows. Keyed by that reply, not by turn
 * numbers: a regenerated turn gets a new native turn, but once its old reply is rolled back
 * the reply before it is again the latest, so it finds its own reference.
 */
export function styleReferenceFor(chat) {
  if (chat?.backgroundTasks?.styleReference !== true) return null
  const previous = (chat.messages || []).findLast(message => message?.role === 'assistant')
  if (!previous) return null
  const list = Array.isArray(chat.styleReferences) ? chat.styleReferences : []
  return list.findLast(item => item && Number(item.afterTurn) === replyTurn(previous)) || null
}

export function latestStyleReference(chat) {
  if (chat?.backgroundTasks?.styleReference !== true) return null
  const list = Array.isArray(chat.styleReferences) ? chat.styleReferences : []
  const item = list.at(-1)
  return item ? { book: item.book, author: item.author, quote: item.quote, afterTurn: item.afterTurn } : null
}

export function rememberStyleReference(list, reference, afterTurn) {
  const kept = (Array.isArray(list) ? list : []).filter(item => item && Number(item.afterTurn) < afterTurn)
  return [...kept, { ...reference, afterTurn }].slice(-KEPT)
}

// The guidance a player gives when asking for another passage; the passage it replaces is named
// so the model does not pick it again.
function retryText(guidance, replaced) {
  const lines = []
  if (replaced) lines.push(`【上一次选的是《${replaced.book}》${replaced.author}，这次换一段】`)
  if (str(guidance).trim()) lines.push('【玩家对选段的要求，优先遵循】\n' + str(guidance).trim())
  return lines.length ? '\n\n' + lines.join('\n') : ''
}

/**
 * Recall a reference from a reply. `base: 'latest'` (after each reply) serves the next turn;
 * `base: 'previous'` re-recalls for the latest turn before it is regenerated.
 */
export function createStyleReferenceRecall({ runAgent, selection, beginTask }) {
  return async ({ chat, signal, base = 'latest', guidance = '', retry = false }) => {
    const replies = (chat.messages || []).filter(message => message?.role === 'assistant')
    const latest = base === 'previous' ? replies.at(-2) : replies.at(-1)
    if (!latest) {
      if (base === 'previous') throw new Error('这一轮之前没有可依据的回复')
      return null
    }
    if (!retry && latest.greeting === true) return null
    const afterTurn = replyTurn(latest)
    const replaced = retry ? (chat.styleReferences || []).findLast(item => item && Number(item.afterTurn) === afterTurn) : null
    let submitted
    const taskRun = await beginTask(chat)
    let run
    try {
      run = await runAgent({
        task: 'style-reference', persistent: true, sessionId: chat.sessionId,
        persistentSessionId: taskRun.participantRequest.sessionId,
        rewindTo: taskRun.participantRequest.rewindTo,
        rewindFormatVersion: taskRun.participantRequest.formatVersion,
        onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
        turn: afterTurn + 1,
        selection: selection(chat), webSearchEnabled: false, signal,
        backgroundTasks: { variables: false, posture: false, characterDesign: false },
        system: SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: '【刚写完的正文】\n' + str(latest.sourceText || latest.text).slice(-2400) + retryText(guidance, replaced) }] }],
        tools: [STYLE_REFERENCE_SUBMIT_TOOL],
        maxToolCalls: 3,
        stopToolsWhen: () => submitted !== undefined,
        acceptWithoutText: () => submitted !== undefined,
        onToolCall(call) {
          if (call.name !== STYLE_REFERENCE_SUBMIT_TOOL.name) throw new Error('本任务只允许调用 style_reference_submit')
          submitted = readStyleReference(typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments)
          return JSON.stringify({ ok: true })
        }
      })
      if (!submitted) throw new Error('文风联想 Agent 未提交结果')
      const completed = await taskRun.commit({ participant: taskRun.participant(run), stateChanged: false, headerFields: ['styleReferences'],
        apply(draft) { draft.styleReferences = rememberStyleReference(draft.styleReferences, submitted, afterTurn) } })
      if (completed.status !== 'committed') throw new Error('剧情已变化，本次文风联想已过期')
    } catch (error) {
      await taskRun.fail(run || error)
      throw error
    }
    return submitted
  }
}
