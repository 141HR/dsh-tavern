import assert from 'node:assert/strict'
import test from 'node:test'

import { createStyleReferenceRecall, latestStyleReference, readStyleReference, rememberStyleReference, styleReferenceFor } from '../tavern-plugin/lib/domain/style-reference.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { normalizeBackgroundTasks } from '../tavern-plugin/lib/domain/tavern-settings.js'

const ref = (afterTurn, book = '边城') => ({ book, author: '沈从文', quote: '小溪流下去，绕山岨流。', afterTurn })

test('文风参考默认关闭，只有手动开启才生效', () => {
  assert.equal(normalizeBackgroundTasks({}).styleReference, false)
  assert.equal(normalizeBackgroundTasks({ styleReference: true }).styleReference, true)
  assert.equal(styleReferenceFor({ styleReferences: [ref(1)] }, 2), null)
  assert.equal(latestStyleReference({ styleReferences: [ref(1)] }), null)
})

test('每轮取上一条回复后摘的参考；重新生成本轮仍用同一条', () => {
  const chat = { backgroundTasks: { styleReference: true }, styleReferences: [ref(1, '边城'), ref(2, '呼兰河传')] }
  assert.equal(styleReferenceFor(chat, 3).book, '呼兰河传')
  assert.equal(styleReferenceFor(chat, 2).book, '边城', '第 2 轮回复之后摘的参考不会用于重生成第 2 轮')
  assert.equal(styleReferenceFor(chat, 1), null)
})

test('同一轮重摘会替换旧条目，并丢掉回滚后失效的后续条目', () => {
  const list = rememberStyleReference([ref(1), ref(2), ref(3)], { book: '围城', author: '钱锺书', quote: '婚姻是一座围城。' }, 2)
  assert.deepEqual(list.map(item => [item.afterTurn, item.book]), [[1, '边城'], [2, '围城']])
  assert.equal(rememberStyleReference(Array.from({ length: 12 }, (_, i) => ref(i)), ref(20), 20).length, 8)
})

test('提交内容要有书名、作者和不超过 150 字的摘句', () => {
  assert.deepEqual(readStyleReference({ book: '《边城》', author: '沈从文', quote: ' 小溪流下去。 ' }), { book: '边城', author: '沈从文', quote: '小溪流下去。' })
  assert.throws(() => readStyleReference({ book: '边城', author: '', quote: '句子' }))
  assert.throws(() => readStyleReference({ book: '边城', author: '沈从文', quote: '长'.repeat(151) }))
})

test('后台回忆提交后写入本局，供下一轮使用', async () => {
  let saved
  const taskRun = {
    participantRequest: { sessionId: 'bg', rewindTo: null, formatVersion: 1 },
    bindSession() {}, participant: run => run,
    async commit({ apply }) { saved = {}; apply(saved); return { status: 'committed' } },
    async fail() { throw new Error('不应失败') }
  }
  let request
  const recall = createStyleReferenceRecall({
    selection: () => ({ provider: 'p', model: 'm' }),
    beginTask: async () => taskRun,
    runAgent: async input => {
      request = input
      input.onToolCall({ name: 'style_reference_submit', arguments: JSON.stringify({ book: '边城', author: '沈从文', quote: '小溪流下去，绕山岨流。' }) })
      return { traceSessionId: 'bg' }
    }
  })
  const chat = { sessionId: 's', messages: [{ role: 'user', text: '走吧' }, { role: 'assistant', turn: 4, sourceText: '雨落在河面上。' }] }
  const result = await recall({ chat, signal: new AbortController().signal })
  assert.equal(result.book, '边城')
  assert.equal(request.task, 'style-reference')
  assert.match(request.messages[0].content[0].text, /雨落在河面上/)
  assert.deepEqual(saved.styleReferences, [{ book: '边城', author: '沈从文', quote: '小溪流下去，绕山岨流。', afterTurn: 4 }])
})

test('正文上下文带上文风参考与借鉴规则', async () => {
  const planner = createContextPlanner({ prompt: name => '〈' + name + '〉' })
  const plan = await planner.plan({ purpose: 'body', card: { name: '阿青' }, chat: {}, worldBookContext: '',
    styleReference: { book: '边城', author: '沈从文', quote: '小溪流下去。' } })
  const style = plan.sections.filter(section => section.kind === 'style-reference').map(section => section.text)
  assert.deepEqual(style, ['【文风参考 · 《边城》沈从文】\n小溪流下去。', '〈style-reference〉'])
  const without = await planner.plan({ purpose: 'body', card: { name: '阿青' }, chat: {}, worldBookContext: '', styleReference: null })
  assert.equal(without.sections.some(section => section.kind === 'style-reference'), false)
})
