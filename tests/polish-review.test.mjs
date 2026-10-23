import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPolishEdits, buildPolishReviewRequest, parsePolishReview, polishNotesGuidance, polishReviewContext } from '../tavern-plugin/lib/domain/polish-review.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

test('审稿读本轮玩家输入和上一轮正文', () => {
  const messages = [
    { role: 'assistant', greeting: true, text: '开场' },
    { role: 'user', text: '第一句' },
    { role: 'assistant', text: '上一轮', projectionText: '上一轮原文' },
    { role: 'user', text: '本轮输入' },
    { role: 'assistant', text: '本轮正文' }
  ]
  assert.deepEqual(polishReviewContext(messages), { input: '本轮输入', previous: '上一轮原文' })
  assert.deepEqual(polishReviewContext(messages.slice(0, 3)), { input: '第一句', previous: '开场' })
})

test('原则作 system，人物卡、前文与正文作审稿材料', () => {
  const request = buildPolishReviewRequest({ principles: prompt('polish'), card: { name: '罗峰', description: '少年武者' },
    playerName: '阿杰', input: '继续', previous: '上一轮', reply: '本轮正文' })
  assert.match(request.system, /修改意见/)
  const text = request.messages[0].content[0].text
  for (const part of ['【人物卡：罗峰】\n少年武者', '【玩家角色】阿杰', '【上一轮正文】\n上一轮', '【本轮玩家输入】\n继续', '【本轮正文】\n本轮正文']) assert.ok(text.includes(part), part)
  assert.throws(() => buildPolishReviewRequest({ principles: ' ', reply: 'x', input: '', previous: '' }), /精修原则为空/)
})

test('修改清单逐条定位原句，读不懂的输出退回整段意见', () => {
  const texts = ['他笑了。他笑了。', '指节泛白。']
  const review = parsePolishReview('```json\n{"edits":[{"find":"指节泛白。","replace":"他攥住杯子。","reason":"套话"},{"find":"他笑了。","replace":""},{"find":"没有这句","replace":"x"}],"notes":["节奏拖"]}\n```', texts)
  assert.deepEqual(review.edits.map(edit => edit.status), ['ok', 'ambiguous', 'missing'])
  assert.deepEqual(review.notes, ['节奏拖'])
  assert.deepEqual(parsePolishReview('1. 这里写得拖', texts), { edits: [], notes: ['1. 这里写得拖'] })
  assert.match(polishNotesGuidance(['节奏拖']), /^1\. 节奏拖\n\n其余部分保持原文/)
  assert.equal(polishNotesGuidance([]), '')
})

test('应用修改只替换选中的原句，原句不唯一或已不在就拒绝', () => {
  assert.deepEqual(applyPolishEdits(['甲。乙。', '丙。'], [{ find: '乙。', replace: '乙改。' }, { find: '丙。', replace: '' }]), ['甲。乙改。', ''])
  assert.throws(() => applyPolishEdits(['甲。甲。'], [{ find: '甲。', replace: 'x' }]), /找不到要改的原句/)
  assert.throws(() => applyPolishEdits(['甲。'], [{ find: '丁', replace: 'x' }]), /找不到要改的原句/)
})
