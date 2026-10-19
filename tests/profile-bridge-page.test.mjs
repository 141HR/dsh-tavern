// 原版 DSH / DSH 酒馆切换页：两边各一个名字、一句说明、一个按钮。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/packages/dsh-profile-bridge/client.js', import.meta.url), 'utf8')

async function mount(status, calls = []) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const rpc = async (_channel, endpoint, payload) => {
    calls.push([endpoint, payload])
    return endpoint === 'status' ? { ok: true, value: status } : { ok: true, value: { closesApp: true } }
  }
  let module
  dom.window.__ModuleLoader__ = { load: ({ factory }) => { module = factory(name => name === 'react' ? React : undefined) } }
  new Function('window', source)(dom.window)
  let registered, page
  const dictionaries = {}
  const ctx = {
    locale: { bind: () => key => dictionaries.zh[key] ?? key, register: (_ns, value) => Object.assign(dictionaries, value) },
    connection: { rpc: { call: rpc } },
    effect: run => run(),
    slots: { inject: (_name, run) => run(), register: (meta, component) => { registered = meta; page = component; return () => {} } }
  }
  await act(async () => { module.apply(ctx) })
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => { root.render(React.createElement(page, registered.inject())) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { dom, act, label: () => registered.label(), text: () => dom.window.document.body.textContent, button: () => dom.window.document.querySelector('.pb-btn'), calls, dispose: () => root.unmount() }
}

const tavernProfile = { name: 'tavern', bundles: ['dsh-tavern-plugin', 'dsh-profile-bridge'], hasNodeModules: true }

test('在酒馆里叫「切回原版 DSH」，按钮切回原版', async () => {
  const page = await mount({ appKind: 'desktop', activeIsLink: true, linkTargetName: 'tavern', backups: ['desktop.fresh-1'], profiles: [tavernProfile] })
  assert.equal(page.label(), '切回原版 DSH')
  assert.match(page.text(), /同一个应用里的两套环境/)
  assert.equal(page.button().textContent, '切到原版 DSH 并重启')
  await page.act(async () => { page.button().click() })
  assert.deepEqual(page.calls.at(-1), ['unlink', {}])
  assert.match(page.text(), /正在重启/)
  page.dispose()
})

test('在原版 DSH 里叫「进入 DSH 酒馆」，按钮切到酒馆；没装好酒馆时说明原因', async () => {
  const page = await mount({ appKind: 'desktop', activeIsLink: false, backups: [], profiles: [tavernProfile] })
  assert.equal(page.label(), '进入 DSH 酒馆')
  assert.equal(page.button().textContent, '切到 DSH 酒馆并重启')
  await page.act(async () => { page.button().click() })
  assert.deepEqual(page.calls.at(-1), ['link', { target: 'tavern' }])
  page.dispose()

  const missing = await mount({ appKind: 'desktop', activeIsLink: false, backups: [], profiles: [] })
  assert.equal(missing.button(), null)
  assert.match(missing.text(), /还没有装好 DSH 酒馆/)
  missing.dispose()
})

test('原版备份丢了时不给按钮，并说明原因', async () => {
  const page = await mount({ appKind: 'desktop', activeIsLink: true, linkTargetName: 'tavern', backups: [], profiles: [tavernProfile] })
  assert.equal(page.button(), null)
  assert.match(page.text(), /找不到原版 DSH 的备份/)
  page.dispose()
})
