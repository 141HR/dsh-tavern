import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPolishReviewRequest, polishReviewContext, polishReviewGuidance } from '../tavern-plugin/lib/domain/polish-review.js'
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

test('无需精修时不填意见框', () => {
  assert.equal(polishReviewGuidance('无需精修。'), '')
  assert.equal(polishReviewGuidance('1.「原句」：套话'), '1.「原句」：套话')
})
