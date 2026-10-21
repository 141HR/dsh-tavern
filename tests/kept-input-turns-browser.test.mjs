import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

test('重试采用失败轮的输入时，只留玩家那一行，错误与触发卡照常收起', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<main></main>')
    const result = await page.evaluate(source => {
      window.__ModuleLoader__ = { load(definition) { window.client = definition.factory(() => ({})) } }
      window.eval(source)
      const root = document.querySelector('main')
      const projection = client.createTurnHistoryProjection({ root: () => root, storage: () => ({ getItem: () => '{}', setItem() {} }) })
      function row(turn, kind, text) {
        const node = document.createElement('div')
        node.setAttribute('data-chat-flow-kind', kind)
        if (turn !== null) node.setAttribute('data-chat-turn', String(turn))
        node.textContent = text
        root.append(node)
        return node
      }
      // 22 的旧正文、23 失败轮里的玩家输入及清理残留、31 的可见正文、34 的生成期触发卡。
      const old = row(22, 'assistant-step', '旧正文')
      const input = row(23, 'user', '这是我发的话')
      const context = row(23, 'context', '失败清理')
      const strayTrigger = row(23, 'turn-trigger', '收到执行请求')
      const tail = row(23, 'turn-tail', '')
      const body = row(31, 'assistant-step', 'Pass')
      const trigger = row(34, 'turn-trigger', '收到执行请求')
      const hidden = node => getComputedStyle(node).display === 'none'
      const view = (keepInput) => projection.apply('s', [22, 23, 34], { 22: 31 }, [22], [], { keepInput })
      view([23])
      const kept = { old: hidden(old), input: hidden(input), context: hidden(context), strayTrigger: hidden(strayTrigger), tail: hidden(tail), body: hidden(body), trigger: hidden(trigger) }
      view([])
      const without = { input: hidden(input), context: hidden(context), strayTrigger: hidden(strayTrigger), tail: hidden(tail), body: hidden(body) }
      return { kept, without }
    }, source)
    assert.deepEqual(result.kept, { old: true, input: false, context: true, strayTrigger: true, tail: true, body: false, trigger: true }, '玩家输入留下，其余作废残留和触发卡仍然藏')
    assert.deepEqual(result.without, { input: true, context: true, strayTrigger: true, tail: true, body: false }, '没有保留名单时维持原行为')
  } finally { await browser.close() }
})
