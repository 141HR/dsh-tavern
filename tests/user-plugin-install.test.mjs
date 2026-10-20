// 应用内安装插件：GitHub 地址 / ZIP → plugins/<文件夹>，列出加载情况，更新与删除都留备份。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createUserPluginInstaller, parseGithubSource, readPluginArchive } from '../tavern-plugin/lib/domain/user-plugin-install.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const pluginZip = (files, root = 'author-dsh-tavern-hello-abc123/') => writeZipEntries(Object.entries(files).map(([name, content]) => ({ path: root + name, content: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) })))
const hello = (version = '1.0.0', extra = {}) => pluginZip({
  'package.json': { name: 'dsh-tavern-hello', version, description: '打招呼', type: 'module', exports: { '.': './index.mjs' }, ...extra },
  'index.mjs': 'export function apply() {}',
  'README.md': '# hello',
  '.github/workflows/ci.yml': 'x',
})

async function setup(t, fetchImpl) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'profile-data', 'tavern', 'data')
  await mkdir(dataRoot, { recursive: true })
  let syncs = 0
  const installer = createUserPluginInstaller({ dataRoot, fetchImpl, sync: async () => { syncs++ } })
  return { root, dataRoot, installer, plugins: path.join(dataRoot, 'plugins'), syncs: () => syncs }
}

test('GitHub 地址：仓库、.git、tree/分支 都认；其他网站拒绝', () => {
  assert.deepEqual(parseGithubSource('https://github.com/a/b'), { owner: 'a', repo: 'b', ref: null })
  assert.deepEqual(parseGithubSource('https://github.com/a/b.git/'), { owner: 'a', repo: 'b', ref: null })
  assert.deepEqual(parseGithubSource('a/b'), { owner: 'a', repo: 'b', ref: null })
  assert.deepEqual(parseGithubSource('https://github.com/a/b/tree/dev/x'), { owner: 'a', repo: 'b', ref: 'dev/x' })
  assert.throws(() => parseGithubSource('https://gitee.com/a/b'), /github\.com/)
  assert.throws(() => parseGithubSource('http://github.com/a/b'), /github\.com/)
  assert.throws(() => parseGithubSource('随便写'), /GitHub 仓库地址/)
})

test('压缩包检查：找插件根，去掉 .github；缺入口、依赖 npm 包都说清楚', () => {
  const { pkg, files } = readPluginArchive(hello())
  assert.equal(pkg.name, 'dsh-tavern-hello')
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'index.mjs', 'package.json'])
  assert.throws(() => readPluginArchive(pluginZip({ 'README.md': 'x' })), /没有 package\.json/)
  assert.throws(() => readPluginArchive(pluginZip({ 'package.json': { name: 'x' } })), /宿主入口/)
  assert.throws(() => readPluginArchive(pluginZip({ 'package.json': { name: 'x', main: 'index.mjs' } })), /找不到宿主入口/)
  assert.throws(() => readPluginArchive(hello('1.0.0', { dependencies: { sharp: '1' } })), /依赖 npm 包（sharp）/)
  // 自带 node_modules 的插件可以装。
  const bundled = pluginZip({ 'package.json': { name: 'x', main: 'index.mjs', dependencies: { y: '1' } }, 'index.mjs': '', 'node_modules/y/index.js': '' })
  assert.ok(readPluginArchive(bundled).files.has('node_modules/y/index.js'))
})

test('上传 ZIP 安装、列表、删除进备份', async t => {
  const { installer, plugins, dataRoot, syncs } = await setup(t)
  const installed = await installer.installFromZip(hello(), 'dsh-tavern-hello.zip')
  assert.deepEqual(installed, { folder: 'dsh-tavern-hello', name: 'dsh-tavern-hello', version: '1.0.0', replaced: false })
  assert.equal(syncs(), 1)
  assert.equal(await readFile(path.join(plugins, 'dsh-tavern-hello', 'index.mjs'), 'utf8'), 'export function apply() {}')
  assert.deepEqual((await readdir(plugins)).filter(name => name.startsWith('.')), [], '不留临时目录')

  let [listed] = await installer.list()
  assert.equal(listed.state, 'pending')
  assert.equal(listed.source.kind, 'zip')
  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-status.json'), JSON.stringify({ ok: false, stage: '启动', message: 'boom' }))
  ;[listed] = await installer.list()
  assert.equal(listed.state, 'failed')
  assert.match(listed.reason, /启动失败：boom/)

  await mkdir(path.join(plugins, 'broken'))
  const broken = (await installer.list()).find(item => item.folder === 'broken')
  assert.equal(broken.state, 'skipped')
  assert.match(broken.reason, /package\.json/)

  const removed = await installer.remove('dsh-tavern-hello')
  assert.ok(removed.backup.startsWith(path.join(dataRoot, 'plugin-backups')))
  assert.ok((await readdir(removed.backup)).includes('index.mjs'))
  await assert.rejects(installer.remove('../x'), /不存在/)
})

test('GitHub 安装用最新 Release；更新重新下载，旧版进备份；人物卡自带的插件不能覆盖', async t => {
  const calls = []
  let version = '1.0.0'
  const fetchImpl = async url => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) return { ok: true, status: 200, json: async () => ({ tag_name: 'v' + version }) }
    if (url.includes('/zipball/')) { const zip = hello(version); return { ok: true, status: 200, arrayBuffer: async () => zip } }
    return { ok: false, status: 404 }
  }
  const { installer, plugins, dataRoot } = await setup(t, fetchImpl)
  const first = await installer.installFromGithub('https://github.com/author/dsh-tavern-hello')
  assert.equal(first.version, '1.0.0')
  assert.equal(calls.at(-1), 'https://api.github.com/repos/author/dsh-tavern-hello/zipball/v1.0.0')
  const source = JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), 'utf8'))
  assert.equal(source.repo, 'author/dsh-tavern-hello')
  assert.equal(source.resolved, 'Release v1.0.0')

  version = '1.1.0'
  const updated = await installer.update('dsh-tavern-hello')
  assert.equal(updated.replaced, true)
  assert.equal(JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', 'package.json'), 'utf8')).version, '1.1.0')
  assert.equal((await readdir(path.join(dataRoot, 'plugin-backups'))).length, 1)

  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.dsh-card.json'), '{}')
  await assert.rejects(installer.installFromZip(hello(), 'x.zip'), /人物卡自带的插件/)
  await assert.rejects(installer.remove('dsh-tavern-hello'), /人物卡库/)
})

test('没有 Release 用默认分支；仓库不存在、连不上都给出办法', async t => {
  const calls = []
  const { installer } = await setup(t, async url => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) return { ok: false, status: 404 }
    if (url.endsWith('/zipball')) { const zip = hello(); return { ok: true, status: 200, arrayBuffer: async () => zip } }
    return { ok: false, status: 404 }
  })
  await installer.installFromGithub('author/dsh-tavern-hello')
  assert.equal(calls.at(-1), 'https://api.github.com/repos/author/dsh-tavern-hello/zipball')
  await assert.rejects(installer.installFromGithub('https://github.com/author/missing/tree/dev'), /找不到仓库/)

  const offline = await setup(t, async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }) })
  await assert.rejects(offline.installer.installFromGithub('a/b'), /连不上 GitHub（ECONNRESET）.*下载 ZIP 后上传/)
})

test('删除插件时，插件数据随文件夹一起进备份；更新不动插件数据', async t => {
  const { createPluginDataStore } = await import('../tavern-plugin/lib/domain/plugin-data-store.js')
  const { installer, dataRoot } = await setup(t)
  const store = createPluginDataStore({ dataRoot })
  await installer.installFromZip(hello(), 'hello.zip')
  await store.save('dsh-tavern-hello', { style: 'anime' })
  await installer.installFromZip(hello('1.1.0'), 'hello.zip')
  assert.deepEqual(await store.read('dsh-tavern-hello'), { style: 'anime' }, '更新后设置还在')
  const removed = await installer.remove('dsh-tavern-hello')
  assert.equal(await store.read('dsh-tavern-hello'), null)
  assert.deepEqual(JSON.parse(await readFile(path.join(removed.backup, '.plugin-data.json'), 'utf8')), { style: 'anime' })
})
