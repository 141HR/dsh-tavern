// Drives DeepSeek Harness over CDP for the Windows UI Verify workflow.
//   node ui-verify.mjs welcome <out>  click "Add API Key", dump the form, fill DEEPSEEK_API_KEY and submit
//   node ui-verify.mjs shot <out> <tag>  screenshot and dump every page except the welcome page
//   node ui-verify.mjs tavern            fail unless the Tavern backend answers inside the Harness page
// Never screenshot a page that may show the key: artifacts of a public repo are downloadable.
import { writeFileSync, mkdirSync } from 'node:fs'
const [mode, out = 'shots', tag = 'run'] = process.argv.slice(2)
const PORT = 9222
mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const timeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`timeout: ${what}`) })])

async function pages() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  console.log('targets', JSON.stringify(list.map(t => ({ type: t.type, url: t.url }))))
  return list.filter(t => t.type === 'page')
}
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await timeout(new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail }), 10000, 'connect')
  let id = 0; const wait = new Map()
  ws.onmessage = e => { const m = JSON.parse(e.data); wait.get(m.id)?.(m); wait.delete(m.id) }
  const call = (method, params = {}, ms = 15000) => timeout(new Promise(ok => { const n = ++id; wait.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })) }), ms, method)
  const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
  return { call, evaluate, close: () => ws.close() }
}
async function shot(page, name) {
  try {
    const r = await page.call('Page.captureScreenshot', { format: 'png' })
    if (r.result) { writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('saved', name) }
  } catch (e) { console.log('screenshot failed', name, e.message) }
}
const TEXT = 'document.title + "\\n" + location.href + "\\n" + (document.body?.innerText || "").slice(0, 2000)'
const FORM = `JSON.stringify([...document.querySelectorAll('input,textarea,select,button,a,[role=button]')].map(e => ({ tag: e.tagName, type: e.type, name: e.name, placeholder: e.placeholder, text: (e.innerText || '').trim().slice(0, 60), aria: e.getAttribute('aria-label') })))`

if (mode === 'welcome') {
  const target = (await pages()).find(t => t.url.includes('welcome.html'))
  if (!target) { console.log('no welcome page'); process.exit(0) }
  const page = await connect(target)
  await shot(page, `${tag}-welcome`)
  console.log('click', await page.evaluate(`(() => { const b = [...document.querySelectorAll('button,a,[role=button]')].find(e => /add api key/i.test(e.innerText)); b?.click(); return !!b })()`))
  await sleep(3000)
  console.log('text', await page.evaluate(TEXT))
  console.log('form', await page.evaluate(FORM))
  await shot(page, `${tag}-apikey-empty`)
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) { console.log('DEEPSEEK_API_KEY not set; stop before filling'); process.exit(0) }
  // React-controlled inputs need the native setter plus an input event.
  console.log('fill', await page.evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find(e => e.type !== 'checkbox' && e.type !== 'radio' && e.offsetParent !== null)
    if (!input) return 'no input'
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(key)})
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
    return 'filled ' + input.type
  })()`))
  await sleep(1000)
  console.log('submit', await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter(e => !e.disabled && e.offsetParent !== null).find(e => /save|confirm|continue|submit|add|done|保存|确定|继续|添加/i.test(e.innerText)); b?.click(); return b ? b.innerText : 'no button: ' + [...document.querySelectorAll('button')].map(e => e.innerText).join('|') })()`))
  await sleep(10000)
  // Report what happened, but without any screenshot of the welcome window.
  try { console.log('after submit', (await page.evaluate(TEXT)).replaceAll(key, '***')) } catch (e) { console.log('welcome gone', e.message) }
  page.close()
  process.exit(0)
}

if (mode === 'tavern') {
  // The plugin package once rendered its client while every /api/dsh-tavern route was 404:
  // a screenshot alone cannot tell, so ask the backend from inside the page.
  for (let attempt = 0; attempt < 12; attempt++) {
    for (const target of await pages()) {
      // Desktop serves its window as dsh-app://app/; a browser tab would be http://127.0.0.1:<port>/.
      if (!/^(dsh-app:\/\/app\/|https?:\/\/127\.0\.0\.1:)/.test(target.url)) continue
      const page = await connect(target)
      const report = await page.evaluate(`(async () => {
        const response = await fetch('/api/dsh-tavern/runtime-generation', { cache: 'no-store' })
        return { status: response.status, update: document.querySelector('.dsh-tavern-update')?.innerText || '' }
      })()`).catch(error => ({ error: error.message }))
      page.close()
      console.log('tavern', JSON.stringify(report))
      if (report?.status === 200) process.exit(0)
    }
    await sleep(5000)
  }
  console.log('Tavern backend did not answer')
  process.exit(1)
}

if (mode === 'shot') {
  let i = 0
  for (const target of await pages()) {
    if (target.url.includes('welcome.html')) { console.log('skip welcome page'); continue }
    try {
      const page = await connect(target)
      await page.call('Page.bringToFront').catch(() => {})
      console.log(`--- ${tag}-page${i}`, await page.evaluate(TEXT))
      await shot(page, `${tag}-page${i}`)
      page.close()
    } catch (e) { console.log('page failed', target.url, e.message) }
    i++
  }
  process.exit(0)
}
