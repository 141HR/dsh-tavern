#!/usr/bin/env node
// 文风参考 A/B：同一存档导入两局，逐轮发送相同输入；A 局关闭、B 局开启文风参考。对局保留不删。
//   node bin/ab-style-reference.mjs --import 吞噬星空-前60轮.jsonl --card 吞噬星空 --inputs 输入.json --out 输出目录 [--home ~/.dsh-tavern]
// 输入文件是字符串数组。每轮等两局正文与后台结算都结束（B 局还要等文风参考提交）后再发下一轮，
// 结果写入 <输出目录>/ab.json 与 ab.md：每轮两局正文，以及 B 局本轮实际注入的文风参考。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf('--' + name); return at >= 0 ? args[at + 1] : undefined }
const importFile = option('import'), cardName = option('card'), inputsFile = option('inputs'), outDir = option('out')
if (!importFile || !cardName || !inputsFile || !outDir) {
  console.error('用法：node bin/ab-style-reference.mjs --import 聊天记录.jsonl --card <人物卡名> --inputs 输入.json --out 输出目录 [--home DSH 主目录]')
  process.exit(1)
}
const home = path.resolve((option('home') || process.env.DSH_HOME || path.join(os.homedir(), '.dsh-tavern')).replace(/^~(?=$|\/)/, os.homedir()))
const tavern = path.join(home, 'profile-data', 'tavern')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const inputs = json(inputsFile)
const chatText = readFileSync(importFile, 'utf8')
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

const card = (await rpc('listCards', {})).cards.find(item => item.name === cardName || item.path === cardName)
if (!card) throw new Error('找不到人物卡：' + cardName)

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

const games = [await newGame('A', false), await newGame('B', true)]
console.log('A 局（关）：' + games[0].sessionId + '\nB 局（开）：' + games[1].sessionId)
const rows = []
const save = () => {
  writeFileSync(path.join(outDir, 'ab.json'), JSON.stringify({ card: card.name, import: importFile, games, rows }, null, 2))
  const md = ['# 文风参考 A/B · ' + card.name, '', `A 局（关）：${games[0].sessionId}  B 局（开）：${games[1].sessionId}`, '']
  for (const row of rows) {
    md.push(`## 第 ${row.index} 轮`, '', '**输入**：' + row.input, '')
    md.push('**B 局注入的文风参考**：' + (row.B.injected ? `${row.B.injected.source}「${row.B.injected.quote}」` : '无'), '')
    md.push('### A（关）', '', row.A.reply, '', '### B（开）', '', row.B.reply, '')
  }
  writeFileSync(path.join(outDir, 'ab.md'), md.join('\n'))
}
for (const [index, input] of inputs.entries()) {
  const [A, B] = await Promise.all(games.map(game => playTurn(game, input).catch(error => ({ error: error.message, reply: '（出错：' + error.message + '）' }))))
  rows.push({ index: index + 1, input, A, B })
  save()
  console.log(`第 ${index + 1} 轮  A ${A.seconds ?? '-'}s  B ${B.seconds ?? '-'}s  B 参考：${B.injected ? B.injected.source + '「' + B.injected.quote.slice(0, 40) + '」' : '无'}  B 回忆状态：${B.styleStatus ?? '-'}`)
}
console.log('结果：' + path.join(outDir, 'ab.md'))
