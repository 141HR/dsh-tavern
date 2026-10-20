import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createPluginMedia } from '../tavern-plugin/lib/domain/plugin-media.js'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

function memoryStore() {
  const files = new Map()
  return {
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, updater) {
      const next = await updater(files.has(path) ? structuredClone(files.get(path)) : undefined)
      if (next !== undefined) files.set(path, structuredClone(next))
      return next
    },
    async remove(path) { files.delete(path) }
  }
}

const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const str = value => value == null ? '' : String(value)

function productionGallery({ pluginMedia, pluginTurns, sessionSignals }) {
  const start = source.indexOf('  async function pluginGalleryItems(sessionId) {')
  const end = source.indexOf('  function enabledSceneIllustrations() {', start)
  assert.ok(start >= 0 && end > start, 'production gallery function boundaries exist')
  return new AsyncFunction('pluginMedia', 'pluginTurns', 'sessionSignals', 'str', `${source.slice(start, end)}\nreturn { pluginGalleryItems, removePluginGalleryItems }`)(pluginMedia, pluginTurns, sessionSignals, str)
}

function productionRemoveHistoryRpc({ illustrations, removePluginGalleryItems }) {
  const start = source.indexOf("      case 'removeSceneImageHistory': {")
  const end = source.indexOf("      case 'removeSceneImage':", start)
  assert.ok(start >= 0 && end > start, 'production remove history RPC branch boundaries exist')
  const branch = source.slice(start, end)
  return new Function('enabledSceneIllustrations', 'removePluginGalleryItems', `return async function(args) { switch ('removeSceneImageHistory') {\n${branch}\n} }`)(() => illustrations, removePluginGalleryItems)
}

test('production plugin gallery filters by game, current text version, ready image status, and removes only that game', async () => {
  const store = memoryStore(), media = createPluginMedia({ store })
  const current = new Map([['session-a:1', 'key-a-now'], ['session-a:2', 'key-a-2'], ['session-b:1', 'key-b-now']])
  const games = new Map([['session-a', { sessionId: 'session-a', chatId: 'chat-a' }], ['session-b', { sessionId: 'session-b', chatId: 'chat-b' }]])
  const notifications = []
  const pluginTurns = {
    async resolveGame(sessionId) { return games.get(sessionId) || null },
    async currentKey(sessionId, turn) { return current.get(`${sessionId}:${turn}`) || null }
  }
  const signals = { publish(...args) { notifications.push(args) } }
  const gallery = await productionGallery({ pluginMedia: media, pluginTurns, sessionSignals: signals })
  let serial = 0
  async function add({ chatId, sessionId, turn = 1, key, status = 'ready', mediaType = 'image/png' }) {
    if (key !== await pluginTurns.currentKey(sessionId, turn)) await media.issue(chatId, turn, key)
    const isImage = mediaType.startsWith('image/')
    return media.attach({ chatId, sessionId, owner: 'image-plugin', turn, key,
      currentKey: await pluginTurns.currentKey(sessionId, turn), item: {
        kind: isImage ? 'image' : 'audio', status, caption: `item-${++serial}`,
        ...(status === 'ready' ? { attachment: isImage
          ? { attachmentId: `attachment-${serial}`, mediaType, bytes: 1 }
          : { attachmentId: `attachment-${serial}`, name: 'sound.mp3', bytes: 1 } } : {})
      } })
  }
  const visible = await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now' })
  const otherGame = await add({ chatId: 'chat-b', sessionId: 'session-b', key: 'key-b-now' })
  await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now', status: 'pending' })
  await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now', status: 'failed' })
  await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now', mediaType: 'audio/mpeg' })
  const stale = await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-old' })
  const swipeOld = await add({ chatId: 'chat-a', sessionId: 'session-a', turn: 2, key: 'key-a-2' })
  current.set('session-a:2', 'key-a-swiped')

  const listed = await gallery.pluginGalleryItems('session-a')
  assert.deepEqual(listed.map(item => item.id), [visible.id])
  assert.deepEqual(await gallery.pluginGalleryItems('session-b').then(items => items.map(item => item.id)), [otherGame.id])
  assert.deepEqual(await gallery.pluginGalleryItems('missing'), [])

  const crossGame = await gallery.removePluginGalleryItems('session-a', [otherGame.id])
  assert.equal(crossGame[0].ok, false)
  assert.ok(await media.find('chat-b', otherGame.id), 'another session item remains intact')
  assert.equal(notifications.length, 0, 'failed cross-game removal does not notify')

  const results = await gallery.removePluginGalleryItems('session-a', ['missing-id', stale.id, swipeOld.id, visible.id])
  assert.deepEqual(results.map(item => item.ok), [false, true, true, true])
  assert.match(results[0].error, /不存在/)
  assert.equal(await media.find('chat-a', visible.id), null)
  assert.equal(await media.find('chat-a', stale.id), null)
  assert.equal(await media.find('chat-a', swipeOld.id), null)
  assert.equal(notifications.length, 1, 'successful removal batch publishes one gallery change')
  assert.deepEqual(notifications[0][0], 'session-a')
  assert.equal(notifications[0][1].kind, 'plugin-media')
})

test('production removeSceneImageHistory validates combined count and parameter types before deleting native images', async () => {
  let nativeDeleteCalls = 0
  const illustrations = { async removeStoredImages(items) { nativeDeleteCalls++; return items.map(item => ({ versionId: item.id, ok: true })) } }
  const rpc = productionRemoveHistoryRpc({ illustrations, removePluginGalleryItems: async () => [] })
  await assert.rejects(rpc({ items: [{ id: 'native-valid' }], pluginItems: Array(500).fill('plugin-id') }), /最多删除 500/)
  await assert.rejects(rpc({ items: [{ id: 'native-valid' }], pluginItems: 'plugin-id' }), /最多删除 500/)
  await assert.rejects(rpc({ items: 'native-id', pluginItems: [] }), /最多删除 500/)
  assert.equal(nativeDeleteCalls, 0, 'invalid combined input is rejected before any native deletion')
  assert.deepEqual(await rpc({ items: [{ id: 'native-valid' }], pluginItems: [] }), { results: [{ versionId: 'native-valid', ok: true }] })
  assert.equal(nativeDeleteCalls, 1)
})

test('real HTTP routes serve legacy images with sceneImages disabled, reject hostile origins, and dispatch gallery RPCs', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
  const calls = [], registered = new Map()
  let handler
  const webServer = { register(route) { registered.set(route.path, route.handler); return () => registered.delete(route.path) } }
  const ctx = { get: name => name === 'webServer' ? webServer : undefined, effect(callback) { callback() } }
  const sceneIllustrations = {
    async readImage(...args) { calls.push(['readImage', ...args]); return { data: png, ref: { mediaType: 'image/png' } } },
    async readStoredImage(...args) { calls.push(['readStoredImage', ...args]); return { data: png, ref: { mediaType: 'image/webp' } } }
  }
  const dispatch = async (method, args) => { calls.push(['rpc', method, args]); return method === 'listSceneImageHistory' ? { items: [], pluginItems: [] } : { results: [] } }
  registerTavernHttpRoutes({ ctx, dispatch, sceneIllustrations,
    readPluginMediaFile: async (sessionId, id) => { calls.push(['plugin-media', sessionId, id]); return { data: png, length: png.byteLength, mediaType: 'image/png' } },
    performanceDiagnostics: { http() {} }, runtimeGeneration: 'test', runtimeReadiness: Promise.resolve({ ok: true }), str })
  handler = registered.get('/api/dsh-tavern')
  assert.equal(typeof handler, 'function')

  async function request(url, { method = 'GET', origin, body } = {}) {
    const response = {}
    const req = { url, method, headers: { host: 'localhost:3081', ...(origin ? { origin } : {}) },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(body) } }
    await handler(req, { writeHead(status, headers = {}) { response.status = status; response.headers = headers }, end(value) { response.body = value } })
    return response
  }

  const oldImage = await request('/api/dsh-tavern/scene-image?sessionId=s&turn=2&key=k&versionId=v')
  assert.equal(oldImage.status, 200)
  assert.equal(oldImage.headers['Content-Type'], 'image/png')
  assert.deepEqual(oldImage.body, png)
  const storedImage = await request('/api/dsh-tavern/scene-image-stored?chatId=c&key=k&versionId=v')
  assert.equal(storedImage.status, 200)
  assert.equal(storedImage.headers['Content-Type'], 'image/webp')
  assert.deepEqual(storedImage.body, png)

  const denied = await request('/api/dsh-tavern/scene-image?sessionId=s&turn=2&key=k&versionId=v', { origin: 'https://evil.example' })
  assert.equal(denied.status, 403)
  const pluginImage = await request('/api/dsh-tavern/plugin-media?sessionId=s&id=image-id')
  assert.equal(pluginImage.status, 200)
  assert.equal(pluginImage.headers['Content-Type'], 'image/png')
  assert.deepEqual(pluginImage.body, png)

  for (const method of ['listSceneImageHistory', 'removeSceneImageHistory']) {
    const response = await request('/api/dsh-tavern/' + method, { method: 'POST', body: JSON.stringify({ sessionId: 's', items: [], pluginItems: [] }) })
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(response.body).ok, true)
  }
  assert.deepEqual(calls.filter(call => call[0] === 'rpc').map(call => call[1]), ['listSceneImageHistory', 'removeSceneImageHistory'])
  assert.equal(calls.filter(call => call[0] === 'readImage').length, 1, 'hostile-origin read never reaches image storage')
  assert.ok(calls.some(call => call[0] === 'plugin-media' && call[1] === 's' && call[2] === 'image-id'))
})
