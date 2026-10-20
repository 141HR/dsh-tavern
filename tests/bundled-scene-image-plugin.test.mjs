import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync, symlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  BUNDLED_SCENE_IMAGE_FOLDER,
  comparePluginVersions,
  installBundledSceneImagePlugin,
  readBundledSceneImage,
  SCENE_IMAGE_PACKAGE_NAME,
} from '../bin/bundled-scene-image-plugin.mjs'

// 只依赖 node 内置模块，可在没有 node_modules 的浅克隆里单独跑：
//   node --test tests/bundled-scene-image-plugin.test.mjs

const CONTRACT = { tavern: { sceneImages: 'delegate' } }

function makeSource(t, version = '2.8.0') {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-bundled-src-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'tavern-plugin', 'packages', 'dsh-tavern-image-bundled')
  mkdirSync(path.join(dir, 'lib'), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-tavern-comfy', version, main: './lib/index.js', dsh: CONTRACT,
  }))
  writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const bundled = true\n')
  writeFileSync(path.join(dir, 'client.js'), '// client\n')
  writeFileSync(path.join(dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: 'dsh-tavern-comfy', version }))
  return { root, dir }
}

function makeData(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-bundled-data-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'plugins'), { recursive: true })
  return root
}

const quiet = { warn() {}, log() {} }

test('comparePluginVersions 按段比较，忽略多余段', () => {
  assert.equal(comparePluginVersions('2.8.0', '2.8.0'), 0)
  assert.equal(comparePluginVersions('2.8.1', '2.8.0'), 1)
  assert.equal(comparePluginVersions('2.8.0', '2.8.1'), -1)
  assert.equal(comparePluginVersions('2.10.0', '2.9.9'), 1)
  assert.equal(comparePluginVersions('3.0', '2.99.99'), 1)
  assert.equal(comparePluginVersions('2.8.0', '2.8'), 0)
})

test('内置副本不完整时报 unavailable，且不去碰数据目录', t => {
  const source = makeSource(t)
  rmSync(path.join(source.dir, 'client.js'))
  const data = makeData(t)
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'unavailable')
  assert.match(r.reason, /client\.js/)
  assert.equal(existsSync(path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)), false)
})

test('全新安装：装进 plugins/<目录名>，核心文件齐全，契约仍在', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'installed')
  assert.equal(r.version, '2.8.0')
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'client.js']) {
    assert.ok(existsSync(path.join(target, file)), 'missing ' + file)
  }
  const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.tavern.sceneImages, 'delegate')
  // BUNDLED-VERSION.json 是仓库侧标记，不装给用户
  assert.equal(existsSync(path.join(target, 'BUNDLED-VERSION.json')), false)
})

test('重复安装同版本：跳过，不重写文件', t => {
  const source = makeSource(t)
  const data = makeData(t)
  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }).action, 'installed')
  const marker = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER, 'lib', 'index.js')
  writeFileSync(marker, 'export const handwritten = true\n')  // 模拟用户/插件自己更新过
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.match(readFileSync(marker, 'utf8'), /handwritten/)
})

test('已存在的较新插件目录：完整保留', t => {
  const source = makeSource(t, '2.8.0')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-tavern-comfy', version: '9.0.0', main: './lib/index.js', dsh: CONTRACT }))
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.equal(r.installedVersion, '9.0.0')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '9.0.0')
})

test('已存在的旧版插件目录：不升级、不覆盖用户数据', t => {
  const source = makeSource(t, '2.8.0')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-tavern-comfy', version: '2.7.0', main: './lib/index.js', dsh: CONTRACT }))
  // 用户的私人数据：升级必须保留
  const userFiles = {
    'config.json': '{"apiKey":"user-own"}',
    'worldbook.json': '{"entries":[]}',
    'definitions.json': '{"characters":[]}',
    'jobs-store.json': '{"jobs":[]}',
  }
  for (const [name, body] of Object.entries(userFiles)) writeFileSync(path.join(target, name), body)

  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '2.7.0')
  for (const [name, body] of Object.entries(userFiles)) {
    assert.equal(readFileSync(path.join(target, name), 'utf8'), body, 'user data changed: ' + name)
  }
})

test('profile 已装同名包：跳过，避免同一包两个来源', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const profile = path.join(data, 'profile')
  const installed = path.join(profile, 'node_modules', SCENE_IMAGE_PACKAGE_NAME)
  mkdirSync(installed, { recursive: true })
  writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '2.8.0' }))

  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, profileDir: profile, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.match(r.reason, /单一来源/)
  assert.equal(existsSync(path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)), false)
})

test('readBundledSceneImage 校验版本标记、包名和委派契约', t => {
  const source = makeSource(t, '2.8.3')
  const info = readBundledSceneImage(source.root)
  assert.equal(info.ok, true)
  assert.equal(info.version, '2.8.3')
  assert.equal(info.contract, 'delegate')
  writeFileSync(path.join(source.dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: 'dsh-tavern-comfy', version: '9.0.0' }))
  assert.equal(readBundledSceneImage(source.root).ok, false)
  writeFileSync(path.join(source.dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: 'wrong-name', version: '2.8.3' }))
  assert.equal(readBundledSceneImage(source.root).ok, false)
  writeFileSync(path.join(source.dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: 'dsh-tavern-comfy', version: '2.8.3' }))
  writeFileSync(path.join(source.dir, 'package.json'), JSON.stringify({ name: 'dsh-tavern-comfy', version: '2.8.3', main: './lib/index.js' }))
  assert.equal(readBundledSceneImage(source.root).ok, false)
})

test('已存在残缺目录或符号链接：跳过且不触碰目标', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target)
  writeFileSync(path.join(target, 'keep.txt'), 'user data')
  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }).action, 'skipped')
  assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'user data')

  const other = makeData(t)
  const linkedTarget = path.join(other, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const outside = path.join(other, 'outside')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'keep.txt'), 'linked data')
  symlinkSync(outside, linkedTarget, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: other, logger: quiet }).action, 'skipped')
  assert.equal(readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'linked data')
})

test('已存在版本未知的插件目录：不尝试修复或覆盖', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target)
  writeFileSync(path.join(target, 'package.json'), '{ invalid json')
  writeFileSync(path.join(target, 'config.json'), '{"apiKey":"keep"}')
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.equal(readFileSync(path.join(target, 'package.json'), 'utf8'), '{ invalid json')
  assert.equal(readFileSync(path.join(target, 'config.json'), 'utf8'), '{"apiKey":"keep"}')
})

test('复制遇到内置符号链接失败时清理临时目录且目标仍不存在', t => {
  const source = makeSource(t)
  const linkedDirectory = path.join(source.root, 'linked-source')
  mkdirSync(linkedDirectory)
  symlinkSync(linkedDirectory, path.join(source.dir, 'linked-directory'), process.platform === 'win32' ? 'junction' : 'dir')
  const data = makeData(t)
  assert.throws(() => installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }), /符号链接/)
  assert.equal(existsSync(path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)), false)
  assert.deepEqual(readdirSync(path.join(data, 'plugins')), [])
})

test('真实发行副本：完整安装、入口可加载且默认不创建私有配置', async t => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const bundled = path.join(sourceRoot, 'tavern-plugin', 'packages', 'dsh-tavern-image-bundled')
  const marker = JSON.parse(readFileSync(path.join(bundled, 'BUNDLED-VERSION.json'), 'utf8'))
  const info = readBundledSceneImage(sourceRoot)
  assert.equal(info.ok, true, info.reason)
  assert.equal(info.packageName, marker.name)
  assert.equal(info.version, marker.version)

  const data = makeData(t)
  const result = installBundledSceneImagePlugin({ sourceRoot, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'installed')
  assert.equal(result.version, marker.version)
  const installed = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const pkg = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  assert.equal(pkg.name, marker.name)
  assert.equal(pkg.version, marker.version)
  assert.equal(pkg.dsh.tavern.sceneImages, 'delegate')
  assert.equal(existsSync(path.join(installed, 'config.json')), false)
  assert.equal(existsSync(path.join(installed, 'BUNDLED-VERSION.json')), false)

  function countInstalledFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
      if (entry.name === 'node_modules') return count
      const entryPath = path.join(directory, entry.name)
      return count + (entry.isDirectory() ? countInstalledFiles(entryPath) : 1)
    }, 0)
  }
  assert.equal(result.files, countInstalledFiles(installed))
  const entry = await import(pathToFileURL(path.join(installed, 'lib', 'index.js')).href)
  assert.equal(entry.name, 'dsh-tavern-image')
  assert.equal(typeof entry.apply, 'function')

  const configPath = path.join(installed, 'config.json')
  const userConfig = '{"imageChannels":[],"private":"preserve-me"}\n'
  writeFileSync(configPath, userConfig)
  const repeated = installBundledSceneImagePlugin({ sourceRoot, dataRoot: data, logger: quiet })
  assert.equal(repeated.action, 'skipped')
  assert.equal(readFileSync(configPath, 'utf8'), userConfig)
})
