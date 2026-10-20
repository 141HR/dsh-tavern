#!/usr/bin/env node
// 文风参考 A/B：同一存档导入两局，逐轮发送相同输入；A 局关闭、B 局开启文风参考。对局保留不删。
//   node bin/ab-style-reference.mjs --import 吞噬星空-前60轮.jsonl --card 吞噬星空 --inputs 输入.json --out 输出目录 [--home ~/.dsh-tavern]
// 输入文件是字符串数组。每轮等两局正文与后台结算都结束（B 局还要等文风参考提交）后再发下一轮，
// 结果写入 <输出目录>/ab.json 与 ab.html（两局并排）：每轮两局正文，以及 B 局本轮实际注入的文风参考。
// 只按 ab.json 重新生成网页：node bin/ab-style-reference.mjs --render-only --out 输出目录
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf('--' + name); return at >= 0 ? args[at + 1] : undefined }
const importFile = option('import'), cardName = option('card'), inputsFile = option('inputs'), outDir = option('out')
const renderOnly = args.includes('--render-only')
if (!outDir || !renderOnly && (!importFile || !cardName || !inputsFile)) {
  console.error('用法：node bin/ab-style-reference.mjs --import 聊天记录.jsonl --card <人物卡名> --inputs 输入.json --out 输出目录 [--home DSH 主目录]')
  process.exit(1)
}
const home = path.resolve((option('home') || process.env.DSH_HOME || path.join(os.homedir(), '.dsh-tavern')).replace(/^~(?=$|\/)/, os.homedir()))
const tavern = path.join(home, 'profile-data', 'tavern')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
mkdirSync(outDir, { recursive: true })

function rpc(method, payload) {
  const { port } = json(path.join(home, 'logs', 'tavern.pid.json'))
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/dsh-tavern/' + method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk }).on('end', () => {
        let value
        try { value = JSON.parse(text) } catch { return reject(new Error(method + ' 返回：' + text.slice(0, 300))) }
        value.ok === false ? reject(new Error(method + ' 失败：' + (value.error || text.slice(0, 300)))) : resolve(value)
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

function sessionEvents(id) {
  for (const project of readdirSync(path.join(tavern, 'sessions'))) {
    const directory = path.join(tavern, 'sessions', project, id)
    if (!existsSync(directory)) continue
    const generations = readdirSync(directory).filter(name => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(name)).sort()
    if (generations.length) return parseSessionLog(readFileSync(path.join(directory, generations.at(-1)))).events
  }
  return []
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const textOf = content => (Array.isArray(content) ? content : []).map(block => block?.type === 'text' ? block.text || '' : '').join('\n')
const activity = async sessionId => (await rpc('getSessionActivity', { sessionId })).activity || {}


async function newGame(label, styleReference) {
  const imported = await rpc('importChatHistoryText', { cardPath: card.path, text: chatText, fileName: `AB-${label}-` + path.basename(importFile) })
  const config = await rpc('setConversationBackgroundConfig', { sessionId: imported.sessionId, backgroundTasks: { styleReference } })
  if (config.backgroundTasks.styleReference !== styleReference) throw new Error(label + ' 局开关未生效')
  return { label, styleReference, sessionId: imported.sessionId }
}

async function playTurn(game, input) {
  const start = sessionEvents(game.sessionId).length
  const began = Date.now()
  await rpc('sendPlayerInput', { sessionId: game.sessionId, text: input })
  let turn
  while (!turn) {
    if (Date.now() - began > 900000) throw new Error(game.label + ' 等待正文超时')
    await sleep(3000)
    const all = sessionEvents(game.sessionId)
    const end = all.findIndex((event, index) => index >= start && event.type === 'turn/end')
    if (end >= 0) turn = all.slice(start, end + 1)
  }
  const reply = turn.filter(event => event.type === 'assistant/message').map(event => textOf(event.data.message?.content)).join('\n').trim()
  const injected = JSON.stringify(turn).match(/【文风参考 · ([^】]*)】\\n(.*?)\\n\\n/)
  const seconds = Math.round((Date.now() - began) / 1000)
  // Settlement runs first, then next-turn preparation; B also waits for its style reference.
  let sawOther = false, styleStatus = null
  const settleStart = Date.now()
  for (let idle = 0; Date.now() - settleStart < 600000;) {
    await sleep(2000)
    const now = await activity(game.sessionId)
    if (now.role && now.role !== 'style-reference') sawOther = true
    if (game.styleReference) {
      if (sawOther && now.role === 'style-reference' && !now.busy) { styleStatus = now.phase; break }
    } else if (!now.busy && ++idle >= 3) break
    else if (now.busy) idle = 0
  }
  return { reply, seconds, injected: injected ? { source: injected[1], quote: JSON.parse('"' + injected[2] + '"') } : null, styleStatus }
}

const escape = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const paragraphs = text => String(text ?? '').split(/\n+/).filter(line => line.trim()).map(line => '<p>' + escape(line) + '</p>').join('')
function renderHtml({ card: name, games, rows }) {
  const reference = row => row.B.injected
    ? `<div class="ref"><span class="src">${escape(row.B.injected.source)}</span><blockquote>${escape(row.B.injected.quote)}</blockquote></div>`
    : '<div class="ref none">B 局本轮无参考（参考在上一轮回复后摘取，第 1 轮没有）</div>'
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>文风参考 A/B</title><style>
:root{--bg:#faf8f4;--fg:#222;--muted:#777;--card:#fff;--line:#e4dfd6;--accent:#8a5a2b;--refbg:#f3ece1}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#e6e2da;--muted:#9a948a;--card:#242320;--line:#3a3732;--accent:#d7a46c;--refbg:#2d2a25}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.85 "Songti SC","Noto Serif SC",serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}.meta{color:var(--muted);font:12px/1.6 ui-monospace,monospace;margin-bottom:20px;word-break:break-all}
nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px;font-family:system-ui,sans-serif;font-size:13px}
nav a{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:2px 10px}
section{margin-bottom:40px}h2{font:600 18px/1.4 system-ui,sans-serif;margin:0 0 8px}
.input{font-family:system-ui,sans-serif;font-size:14px;margin-bottom:10px}.input b{color:var(--accent)}
.ref{background:var(--refbg);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:15px}.ref.none{color:var(--muted);font:13px system-ui,sans-serif}
.ref .src{font:600 13px system-ui,sans-serif;color:var(--accent)}.ref blockquote{margin:4px 0 0;padding:0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.col{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;min-width:0}
.col h3{font:600 14px system-ui,sans-serif;margin:0 0 6px;color:var(--muted)}.col p{margin:0 0 .8em;text-indent:2em}
@media (max-width:760px){.cols{grid-template-columns:1fr}}
</style></head><body><main>
<h1>文风参考 A/B · ${escape(name)}</h1>
<div class="meta">A 局（关）${escape(games[0].sessionId)}<br>B 局（开）${escape(games[1].sessionId)}</div>
<nav>${rows.map(row => `<a href="#t${row.index}">第 ${row.index} 轮</a>`).join('')}</nav>
${rows.map(row => `<section id="t${row.index}"><h2>第 ${row.index} 轮</h2>
<div class="input"><b>输入</b>　${escape(row.input)}</div>${reference(row)}
<div class="cols"><div class="col"><h3>A · 关闭（${row.A.reply.length} 字）</h3>${paragraphs(row.A.reply)}</div>
<div class="col"><h3>B · 开启（${row.B.reply.length} 字）</h3>${paragraphs(row.B.reply)}</div></div></section>`).join('\n')}
</main></body></html>`
}

if (renderOnly) {
  writeFileSync(path.join(outDir, 'ab.html'), renderHtml(json(path.join(outDir, 'ab.json'))))
  console.log('结果：' + path.join(outDir, 'ab.html'))
  process.exit(0)
}

const card = (await rpc('listCards', {})).cards.find(item => item.name === cardName || item.path === cardName)
if (!card) throw new Error('找不到人物卡：' + cardName)
const inputs = json(inputsFile)
const chatText = readFileSync(importFile, 'utf8')
const games = [await newGame('A', false), await newGame('B', true)]
console.log('A 局（关）：' + games[0].sessionId + '\nB 局（开）：' + games[1].sessionId)
const rows = []
const save = () => {
  const result = { card: card.name, import: importFile, games, rows }
  writeFileSync(path.join(outDir, 'ab.json'), JSON.stringify(result, null, 2))
  writeFileSync(path.join(outDir, 'ab.html'), renderHtml(result))
}
for (const [index, input] of inputs.entries()) {
  const [A, B] = await Promise.all(games.map(game => playTurn(game, input).catch(error => ({ error: error.message, reply: '（出错：' + error.message + '）' }))))
  rows.push({ index: index + 1, input, A, B })
  save()
  console.log(`第 ${index + 1} 轮  A ${A.seconds ?? '-'}s  B ${B.seconds ?? '-'}s  B 参考：${B.injected ? B.injected.source + '「' + B.injected.quote.slice(0, 40) + '」' : '无'}  B 回忆状态：${B.styleStatus ?? '-'}`)
}
console.log('结果：' + path.join(outDir, 'ab.html'))
