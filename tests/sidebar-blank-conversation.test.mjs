import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function blankFixture(options = {}) {
  const calls = []
  const errors = []
  const ctx = vm.createContext({
    workspaceId: options.workspaceId ?? 'workspace-play',
    playWorkspaceIdRef: { current: options.prewarmWorkspaceId ?? '' },
    props: {
      conversationHost: {
        connectWorkspace: options.create
          ? id => options.create(id, calls)
          : async id => { calls.push(['connect', id]); return 'blank-session' },
      },
      sessions: { clear() { calls.push(['clear']) } },
    },
    openSessionWhenReady: async id => { calls.push(['open', id]) },
    setError: message => { errors.push(message) },
  })
  vm.runInContext(source.slice(source.indexOf('async function openBlankConversation()'), source.indexOf('// A turn the live Agent')), ctx)
  return { ctx, calls, errors }
}

test('删除最后一个对话后创建并打开空白会话，底部面板入口才有会话可挂载', async () => {
  const { ctx, calls, errors } = blankFixture()
  await ctx.openBlankConversation()
  assert.deepEqual(calls, [['connect', 'workspace-play'], ['open', 'blank-session']])
  assert.deepEqual(errors, [])
})

test('工作区还没解析时用预热工作区', async () => {
  const { ctx, calls } = blankFixture({ workspaceId: '', prewarmWorkspaceId: 'workspace-prewarm' })
  await ctx.openBlankConversation()
  assert.deepEqual(calls, [['connect', 'workspace-prewarm'], ['open', 'blank-session']])
})

test('创建空白会话失败时清空主视图并提示', async () => {
  const { ctx, calls, errors } = blankFixture({ create: async () => { throw new Error('create failed') } })
  await ctx.openBlankConversation()
  assert.deepEqual(calls, [['clear']])
  assert.deepEqual(errors, ['创建新对话失败：create failed'])
})

test('没有可用工作区时不创建会话，退化为清空主视图', async () => {
  const { ctx, calls, errors } = blankFixture({ workspaceId: '', prewarmWorkspaceId: '' })
  await ctx.openBlankConversation()
  assert.deepEqual(calls, [['clear']])
  assert.deepEqual(errors, ['创建新对话失败：找不到可用的工作区'])
})

function deleteFixture() {
  const calls = []
  const ctx = vm.createContext({
    current: 'session-open',
    uiMode: 'play',
    requestMode: 'dsh',
    history: [],
    groupOfMode: () => 'play',
    setMenuSession() {}, setBusy() {}, setError() {},
    askConfirm: async () => true,
    call: async method => {
      calls.push([method])
      return method === 'prepareDeleteChats' ? { results: [{ ok: true }] } : {}
    },
    props: {
      archiveSession: async id => { calls.push(['archive', id]) },
      sessions: { clear() { calls.push(['clear']) } },
    },
    isMissingSessionArchiveError: () => false,
    openSessionWhenReady: async id => { calls.push(['open', id]) },
    openBlankConversation: async () => { calls.push(['blank']) },
    openPicker: () => { calls.push(['picker']) },
    refresh: async () => {},
  })
  vm.runInContext(source.slice(source.indexOf('async function deleteConversation'), source.indexOf('async function forkConversation')), ctx)
  return { ctx, calls }
}

test('删掉当前仅剩的对话时回到空白会话，而不是只清空主视图', async () => {
  const { ctx, calls } = deleteFixture()
  await ctx.deleteConversation({ sessionId: 'session-open', chatId: 'chat-1', cardName: '测试卡' }, '测试对话')
  assert.deepEqual(calls, [['prepareDeleteChats'], ['archive', 'session-open'], ['deleteChat'], ['blank'], ['picker']])
})

// 游玩 ↔ 卡片来回切换时，切到没有历史的一侧曾经直接 clearMain()：主视图再没有 Session，
// better-sidebar 的底部面板与右上角「展开底部面板」按钮都挂在已挂载的会话上，于是整套消失且不会自己回来。
function modeSwitchFixture(options = {}) {
  const calls = []
  const errors = []
  const ctx = vm.createContext({
    workspaceId: 'workspace-play',
    playWorkspaceIdRef: { current: '' },
    current: options.current ?? 'session-blank',
    history: options.history ?? [],
    requestMode: 'dsh',
    compatibilityAvailable: false,
    openingPicker: null,
    isPlayMode: mode => mode !== 'card',
    groupOfMode: mode => (mode === 'card' ? 'card' : 'play'),
    playPrewarmRef: { current: { cancel() {} } },
    setUiMode: mode => { calls.push(['uiMode', mode]) },
    setRequestMode: mode => { calls.push(['requestMode', mode]) },
    setPicking: value => { calls.push(['picking', value]) },
    setMenuSession: () => {},
    setBusy: value => { calls.push(['busy', value]) },
    setError: message => { errors.push(message) },
    window: { localStorage: { getItem: () => null, setItem: (key, value) => { calls.push(['store', key, value]) } } },
    props: {
      conversationHost: { connectWorkspace: async id => { calls.push(['connect', id]); return 'blank-session' } },
      sessions: { clear() { calls.push(['clear']) } },
    },
    openSessionWhenReady: async id => { calls.push(['open', id]) },
    openPicker: () => { calls.push(['picker']) },
  })
  vm.runInContext(source.slice(source.indexOf('async function ensureLandingSession()'), source.indexOf('// A turn the live Agent')), ctx)
  vm.runInContext(source.slice(source.indexOf('async function switchMode('), source.indexOf('async function rescueConversation(item)')), ctx)
  return { ctx, calls, errors }
}

test('切回游玩但没有游玩历史时保留当前会话，不再 clearMain', async () => {
  const { ctx, calls, errors } = modeSwitchFixture()
  await ctx.switchPlayRequestMode('dsh')
  assert.deepEqual(calls.filter(call => ['clear', 'connect', 'open'].includes(call[0])), [])
  assert.deepEqual(calls.filter(call => call[0] === 'picker'), [['picker']])
  assert.deepEqual(errors.filter(Boolean), [])
})

test('台面已经空着时切模式补一个空白会话，底部面板入口才有会话可挂载', async () => {
  const { ctx, calls, errors } = modeSwitchFixture({ current: '' })
  await ctx.switchPlayRequestMode('dsh')
  assert.deepEqual(calls.filter(call => ['clear', 'connect', 'open'].includes(call[0])), [['connect', 'workspace-play'], ['open', 'blank-session']])
  assert.deepEqual(errors.filter(Boolean), [])
})

test('切到没有历史的卡片模式同样保留当前会话', async () => {
  const { ctx, calls } = modeSwitchFixture()
  await ctx.switchMode('card')
  assert.deepEqual(calls.filter(call => ['clear', 'connect', 'open'].includes(call[0])), [])
  assert.deepEqual(calls.filter(call => call[0] === 'picker'), [['picker']])
})
