import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function SystemPromptSidebarTab()')
const body = source.slice(start, source.indexOf('\n\t\tfunction ', start + 20))
const flush = () => new Promise(resolve => setImmediate(resolve))
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return []
  return (predicate(tree) ? [tree] : []).concat((tree.children || []).flatMap(node => find(node, predicate)))
}

for (const action of ['保存此项', '恢复默认']) test(action + '只清除目标项草稿，保留其他项未保存内容', async () => {
  let state, initial = true
  const effects = []
  const persisted = [{ name: 'a', label: 'A', text: 'old A', customized: true }, { name: 'b', label: 'B', text: 'old B' }]
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
    useState(init) { state ??= init; return [state, value => { state = typeof value === 'function' ? value(state) : value }] },
    useRef() { return {} },
    useEffect(fn) { if (initial) effects.push(fn) }
  }
  const Component = vm.runInNewContext(body + '; SystemPromptSidebarTab', {
    React, useTavernConfirm: () => async () => true,
    rpc: async (method, args) => {
      if (method === 'updateSystemPrompt') persisted.find(row => row.name === args.name).text = args.text ?? 'default A'
      return { systemPrompts: { prompts: persisted.map(row => ({ ...row })) } }
    }
  })
  const render = () => { const tree = Component(); initial = false; return tree }
  const textareas = () => find(render(), node => node.type === 'textarea')
  render()
  await effects[0]()
  await flush()
  textareas()[0].props.onChange({ target: { value: 'NEW A' } })
  textareas()[1].props.onChange({ target: { value: 'NEW B' } })
  find(render(), node => node.type === 'button' && node.children[0] === action)[0].props.onClick()
  await flush()
  assert.equal(textareas()[1].props.value, 'NEW B')
  assert.equal(persisted[0].text, action === '保存此项' ? 'NEW A' : 'default A')
  assert.equal(persisted[1].text, 'old B')
  assert.equal(state.drafts.a, undefined)
  assert.equal(state.drafts.b, 'NEW B')
})

test('卡片 Agent 系统指令可从内置性格填入编辑框，保存后才写入设置', async () => {
  let state, initial = true
  const effects = []
  const saved = []
  const presets = [{ id: 'cat', label: '猫', text: '喵设定' }, { id: 'pro', label: '编辑', text: '编辑设定' }]
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
    useState(init) { state ??= init; return [state, value => { state = typeof value === 'function' ? value(state) : value }] },
    useRef() { return {} },
    useEffect(fn) { if (initial) effects.push(fn) }
  }
  const Component = vm.runInNewContext(body + '; SystemPromptSidebarTab', {
    React, useTavernConfirm: () => async () => true,
    rpc: async (method, args) => {
      if (method === 'updateSystemPrompt') saved.push(args)
      return { systemPrompts: { prompts: [{ name: 'card-system', label: '卡片 Agent 系统指令', text: '', presets }] } }
    }
  })
  const render = () => { const tree = Component(); initial = false; return tree }
  const picker = () => find(render(), node => node.type === 'select' && node.props['aria-label'] === '内置性格')[0]
  render()
  await effects[0]()
  await flush()
  assert.equal(picker().props.value, '')
  await picker().props.onChange({ target: { value: 'cat' } })
  assert.equal(find(render(), node => node.type === 'textarea')[0].props.value, '喵设定')
  assert.equal(picker().props.value, 'cat')
  assert.deepEqual(saved, [])
  find(render(), node => node.type === 'button' && node.children[0] === '保存此项')[0].props.onClick()
  await flush()
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ name: 'card-system', text: '喵设定' }])
})
