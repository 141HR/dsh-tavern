// 文风参考（测试功能）：正文提交后，后台模型凭记忆找一部笔调接近当前场景的经典小说，
// 摘一段原文；下一轮前台像剧本参考一样带上它，借人类作者的笔致压住 AI 腔。

export const STYLE_REFERENCE_SUBMIT_TOOL = {
  name: 'style_reference_submit',
  description: '提交文风参考：一部经典小说的书名、作者，以及从中摘抄的一段原文。提交后任务完成。',
  parameters: { type: 'object', properties: {
    book: { type: 'string', description: '书名，不带书名号' },
    author: { type: 'string' },
    quote: { type: 'string', description: '一段原文，约 100～300 字，不超过 400 字' }
  }, required: ['book', 'author', 'quote'], additionalProperties: false }
}

const KEPT = 8
const MAX_QUOTE = 400

const SYSTEM = `你是文风参考员，不续写剧情，不修改变量。
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

/** The reference recalled from the latest reply before `turn`; a regenerated turn keeps its own. */
export function styleReferenceFor(chat, turn) {
  if (chat?.backgroundTasks?.styleReference !== true) return null
  const list = Array.isArray(chat.styleReferences) ? chat.styleReferences : []
  let found = null
  for (const item of list) if (item && Number(item.afterTurn) < turn && (!found || Number(item.afterTurn) > Number(found.afterTurn))) found = item
  return found
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

export function createStyleReferenceRecall({ runAgent, selection, beginTask }) {
  return async ({ chat, signal }) => {
    const latest = (chat.messages || []).findLast(message => message.role === 'assistant')
    if (!latest || latest.greeting === true) return null
    const afterTurn = Number(latest.turn) || 0
    let submitted
    const taskRun = await beginTask(chat)
    let run
    try {
      run = await runAgent({
        task: 'style-reference', persistent: true, sessionId: chat.sessionId,
        persistentSessionId: taskRun.participantRequest.sessionId,
        rewindTo: taskRun.participantRequest.rewindTo,
        rewindFormatVersion: taskRun.participantRequest.formatVersion,
        onPersistentSessionReady: id => taskRun.bindSession(id),
        turn: afterTurn + 1,
        selection: selection(chat), webSearchEnabled: false, signal,
        backgroundTasks: { variables: false, posture: false, characterDesign: false },
        system: SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: '【刚写完的正文】\n' + str(latest.sourceText || latest.text).slice(-2400) }] }],
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
      if (!submitted) throw new Error('文风参考 Agent 未提交结果')
      const completed = await taskRun.commit({ participant: taskRun.participant(run), stateChanged: false,
        apply(draft) { draft.styleReferences = rememberStyleReference(draft.styleReferences, submitted, afterTurn) } })
      if (completed.status !== 'committed') throw new Error('剧情已变化，本次文风参考已过期')
    } catch (error) {
      await taskRun.fail(run || error)
      throw error
    }
    return submitted
  }
}
