import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, symlinkSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDesktopNext, readNextProfile, selectNextProfile, usesDesktopNext } from '../tavern-plugin/packages/dsh-profile-bridge/lib/next.mjs'
import { beginDesktopProfileInstallation } from '../bin/desktop-profile-installation.mjs'
import { removeTreeSync } from '../bin/portable-fs.mjs'

const temp = (t, prefix) => { const dir = mkdtempSync(path.join(tmpdir(), prefix)); t.after(() => removeTreeSync(dir)); return dir }
const selection = home => JSON.parse(readFileSync(path.join(home, 'desktop-next.json'), 'utf8'))

test('识别 DSH NEXT：按 resources/app/package.json 包名，macOS 支持 .app 内任意路径', t => {
  const root = temp(t, 'next-detect-')
  const mac = path.join(root, 'DSH NEXT.app'), win = path.join(root, 'win')
  mkdirSync(path.join(mac, 'Contents/Resources/app'), { recursive: true })
  writeFileSync(path.join(mac, 'Contents/Resources/app/package.json'), '{"name":"dsh-desktop-next"}')
  mkdirSync(path.join(win, 'resources/app'), { recursive: true })
  writeFileSync(path.join(win, 'resources/app/package.json'), '{"name":"dsh-plugin-desktop"}')
  assert.equal(isDesktopNext(mac), true)
  assert.equal(isDesktopNext(path.join(mac, 'Contents/MacOS/DSH NEXT')), true)
  assert.equal(isDesktopNext(path.join(win, 'DSH NEXT.exe')), false)
  assert.equal(isDesktopNext(undefined), false)
})

test('识别 Windows 版 DSH NEXT：没有 resources/app，包名只在 app.asar 里', t => {
  const root = temp(t, 'next-detect-win-')
  mkdirSync(path.join(root, 'resources'))
  const json = Buffer.from(JSON.stringify({ name: 'dsh-desktop-next' }))
  const tree = Buffer.from(JSON.stringify({ files: { 'package.json': { size: json.length, offset: '0' } } }))
  const padded = Buffer.concat([tree, Buffer.alloc((4 - tree.length % 4) % 4)])
  const header = Buffer.alloc(8); header.writeUInt32LE(4 + padded.length, 0); header.writeUInt32LE(tree.length, 4)
  const sizes = Buffer.alloc(8); sizes.writeUInt32LE(4, 0); sizes.writeUInt32LE(header.length + padded.length, 4)
  writeFileSync(path.join(root, 'resources/app.asar'), Buffer.concat([sizes, header, padded, json]))
  assert.equal(isDesktopNext(path.join(root, 'DSH NEXT.exe')), true)
  writeFileSync(path.join(root, 'resources/app.asar'), 'not an archive')
  assert.equal(isDesktopNext(path.join(root, 'DSH NEXT.exe')), false)
})

test('选择文件按 NEXT 格式读写，缺省为 desktop，拒绝带路径的名称', t => {
  const home = temp(t, 'next-select-')
  assert.equal(readNextProfile(home), 'desktop')
  selectNextProfile(home, 'tavern')
  assert.deepEqual(selection(home), { version: 1, active: 'tavern' })
  assert.equal(readNextProfile(home), 'tavern')
  assert.throws(() => selectNextProfile(home, '../x'), /无效/)
  assert.deepEqual(readdirSync(home), ['desktop-next.json'])
})

function profilesHome(t) {
  const home = temp(t, 'next-home-中文 '), profiles = path.join(home, 'profiles')
  const write = (name, doc) => { mkdirSync(path.join(profiles, name), { recursive: true }); writeFileSync(path.join(profiles, name, 'package.json'), JSON.stringify(doc)) }
  return { home, profiles, write }
}

test('认不出 NEXT 程序时，DSH 目录里有 NEXT 的选择文件也按 NEXT 处理', t => {
  const { home } = profilesHome(t)
  assert.equal(usesDesktopNext(home, undefined), false)
  selectNextProfile(home, 'desktop')
  assert.equal(usesDesktopNext(home, undefined), true)
  assert.equal(usesDesktopNext('', undefined), false)
})

test('NEXT 下安装：desktop 保持真实目录并带桥接，选中 tavern；再次安装不要求退出', t => {
  const { home, profiles, write } = profilesHome(t)
  write('desktop', { name: 'dsh-profile-desktop', dsh: { profile: { bundles: ['official'] } } })
  writeFileSync(path.join(profiles, 'desktop/cordis.patch.yml'), '# original\n[]\n')
  const r = { home, sourceRoot: path.resolve('.'), checkStopped() {}, next: true }
  const tx = beginDesktopProfileInstallation(r)
  writeFileSync(path.join(profiles, 'tavern/package.json'), JSON.stringify({ name: 'dsh-profile-tavern', dsh: { profile: { bundles: ['dsh-tavern-plugin'] } }, dshTavern: { profileBridge: true } }))
  tx.finish(); tx.commit()
  const desktop = path.join(profiles, 'desktop')
  assert.equal(lstatSync(desktop).isSymbolicLink(), false)
  assert.equal(readFileSync(path.join(desktop, 'cordis.patch.yml'), 'utf8'), '# original\n[]\n')
  assert.ok(JSON.parse(readFileSync(path.join(desktop, 'package.json'))).dsh.profile.bundles.includes('dsh-profile-bridge'))
  assert.ok(existsSync(path.join(desktop, 'node_modules/dsh-profile-bridge/index.js')))
  assert.equal(readNextProfile(home), 'tavern')
  assert.equal(readdirSync(profiles).some(n => n.startsWith('desktop.fresh-')), false)
  selectNextProfile(home, 'desktop')
  const update = beginDesktopProfileInstallation({ ...r, checkStopped() { throw Error('不应要求退出桌面') } })
  assert.equal(update, null)
  assert.equal(readNextProfile(home), 'tavern')
})

test('NEXT 2.0.18 留下的链接：更新时撤掉链接、刷新原版里的旧切换器并选中 tavern', t => {
  const { home, profiles, write } = profilesHome(t)
  write('tavern', { name: 'dsh-profile-tavern', dsh: { profile: { bundles: ['dsh-tavern-plugin', 'dsh-profile-bridge'] } } })
  write('desktop.fresh-1', { name: 'dsh-profile-desktop', dsh: { profile: { bundles: ['official', 'dsh-profile-bridge'] } } })
  const old = path.join(profiles, 'desktop.fresh-1/node_modules/dsh-profile-bridge')
  mkdirSync(old, { recursive: true }); writeFileSync(path.join(old, 'index.js'), '// 旧切换器')
  symlinkSync(path.join(profiles, 'tavern'), path.join(profiles, 'desktop'))
  const r = { home, sourceRoot: path.resolve('.'), checkStopped() { throw Error('不应要求退出桌面') }, next: true }
  assert.equal(beginDesktopProfileInstallation(r), null)
  const desktop = path.join(profiles, 'desktop')
  assert.equal(lstatSync(desktop).isSymbolicLink(), false)
  assert.ok(existsSync(path.join(desktop, 'node_modules/dsh-profile-bridge/lib/next.mjs')))
  assert.deepEqual(readdirSync(path.join(desktop, 'node_modules')), ['dsh-profile-bridge'])
  assert.equal(readNextProfile(home), 'tavern')
  // Up to date: nothing is rewritten.
  const before = readdirSync(path.join(desktop, 'vendor'))
  assert.equal(beginDesktopProfileInstallation(r), null)
  assert.deepEqual(readdirSync(path.join(desktop, 'vendor')), before)
})
