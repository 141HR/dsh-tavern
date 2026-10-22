import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compareVersions, createPackageManagedUpdater, packageUpdateSpec } from '../tavern-plugin/lib/domain/package-managed-update.js'

async function profile(dependency, bundles = ['@deepseek-ai/dsh-base', 'dsh-profile-tavern']) {
  const dir = await mkdtemp(join(tmpdir(), 'tavern-package-update-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-profile-tavern': dependency }, dsh: { profile: { bundles } } }))
  return dir
}

function fakeManager(dir, runs = []) {
  const calls = []
  return {
    calls,
    profile: { dir },
    async registries() { return { registry: null, fallbackRegistries: ['https://registry.npmmirror.com/'], resolved: 'https://registry.npmjs.org/' } },
    async runPnpm(args) { calls.push(args); return runs.shift() || { exitCode: 0 } },
    async change(operation) {
      const result = { application: 'applied' }
      try { const outcome = await operation(result); if (outcome !== undefined) result.application = outcome }
      catch (error) { result.application = 'failed'; result.error = { message: error.message } }
      return result
    },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('只把 npm 与 git 安装视为可在线更新，本地路径交回终端说明', () => {
  assert.deepEqual(packageUpdateSpec('^3.2.0'), { kind: 'registry', spec: 'dsh-profile-tavern' })
  assert.deepEqual(packageUpdateSpec('latest'), { kind: 'registry', spec: 'dsh-profile-tavern' })
  assert.deepEqual(packageUpdateSpec('github:flizzywine/dsh-tavern'), { kind: 'git', spec: 'github:flizzywine/dsh-tavern' })
  assert.equal(packageUpdateSpec('file:/tmp/dsh-profile-tavern-3.2.0.tgz'), null)
  assert.equal(packageUpdateSpec('link:../dsh-tavern'), null)
  assert.equal(packageUpdateSpec(''), null)
})

test('版本比较按数字段', () => {
  assert.equal(compareVersions('3.2.0', '3.10.0'), -1)
  assert.equal(compareVersions('3.2.0', '3.2.0'), 0)
  assert.equal(compareVersions('3.2.1', '3.2.0'), 1)
})

test('没有插件管理器或不是插件安装时不接管', async () => {
  assert.equal(await createPackageManagedUpdater({ pluginManager: () => undefined, currentVersion: async () => '3.2.0' }).status(), null)
  const dir = await profile('^3.2.0', ['@deepseek-ai/dsh-base'])
  assert.equal(await createPackageManagedUpdater({ pluginManager: fakeManager(dir), currentVersion: async () => '3.2.0' }).status(), null)
})

test('检查更新：问遍所有源取最高版本，某个源失败不影响', async () => {
  const dir = await profile('^3.2.0')
  const asked = []
  const updater = createPackageManagedUpdater({
    pluginManager: fakeManager(dir), currentVersion: async () => '3.2.0', host: 'desktop',
    fetch: async url => { asked.push(url); return url.includes('npmmirror') ? { ok: true, json: async () => ({ version: '3.2.0' }) } : { ok: true, json: async () => ({ version: '3.3.0' }) } },
  })
  const checked = await updater.check()
  assert.deepEqual(asked.sort(), ['https://registry.npmjs.org/dsh-profile-tavern/latest', 'https://registry.npmmirror.com/dsh-profile-tavern/latest'])
  assert.equal(checked.phase, 'update-available')
  assert.equal(checked.latestVersion, '3.3.0')
  assert.equal(checked.packageManaged, true)
})

const latest = version => async () => ({ ok: true, json: async () => ({ version }) })

test('进行更新：按检查到的确切版本安装，镜像缺版本时换源，成功后要求重启', async () => {
  const dir = await profile('^3.2.0')
  const manager = fakeManager(dir, [{ exitCode: 1, output: 'ERR_PNPM_NO_MATCHING_VERSION' }, { exitCode: 0 }])
  const updater = createPackageManagedUpdater({ pluginManager: manager, currentVersion: async () => '3.2.0', host: 'desktop', fetch: latest('3.3.0') })
  assert.equal((await updater.start()).phase, 'running')
  await settle(); await settle()
  assert.deepEqual(manager.calls, [
    ['add', 'dsh-profile-tavern@3.3.0', '--config.minimumReleaseAgeExclude=dsh-profile-tavern', '--registry=https://registry.npmmirror.com/'],
    ['add', 'dsh-profile-tavern@3.3.0', '--config.minimumReleaseAgeExclude=dsh-profile-tavern'],
  ])
  assert.equal((await updater.status()).phase, 'restart-required')
})

test('pnpm 全部失败时报告原因，不要求重启', async () => {
  const dir = await profile('github:flizzywine/dsh-tavern')
  const manager = fakeManager(dir, [{ exitCode: 1, output: 'line\nERR_PNPM_GIT_UNKNOWN unreachable' }])
  const updater = createPackageManagedUpdater({ pluginManager: manager, currentVersion: async () => '3.2.0' })
  await updater.start()
  await settle(); await settle()
  assert.deepEqual(manager.calls, [['add', 'github:flizzywine/dsh-tavern', '--config.minimumReleaseAgeExclude=dsh-profile-tavern']])
  const status = await updater.status()
  assert.equal(status.phase, 'failed')
  assert.match(status.error, /ERR_PNPM_GIT_UNKNOWN/)
})

test('更新进行中再次点击会被拒绝', async () => {
  const dir = await profile('^3.2.0')
  let release
  const manager = fakeManager(dir)
  manager.runPnpm = () => new Promise(resolve => { release = () => resolve({ exitCode: 0 }) })
  const updater = createPackageManagedUpdater({ pluginManager: manager, currentVersion: async () => '3.2.0', fetch: latest('3.3.0') })
  await updater.start()
  await assert.rejects(updater.start(), /更新正在进行/)
  assert.equal((await updater.status()).phase, 'running')
  release()
  await settle(); await settle()
  assert.equal((await updater.status()).phase, 'restart-required')
})

test('所有源都失败时报告检查失败', async () => {
  const dir = await profile('^3.2.0')
  const updater = createPackageManagedUpdater({ pluginManager: fakeManager(dir), currentVersion: async () => '3.2.0', fetch: async () => { throw new Error('offline') } })
  const checked = await updater.check()
  assert.equal(checked.phase, 'check-failed')
  assert.match(checked.error, /registry\.npmmirror\.com：offline/)
})

test('已是最新时点更新不调用 pnpm', async () => {
  const dir = await profile('^3.2.0')
  const manager = fakeManager(dir)
  const updater = createPackageManagedUpdater({ pluginManager: manager, currentVersion: async () => '3.3.0', fetch: latest('3.3.0') })
  assert.equal((await updater.start()).phase, 'up-to-date')
  assert.deepEqual(manager.calls, [])
})
