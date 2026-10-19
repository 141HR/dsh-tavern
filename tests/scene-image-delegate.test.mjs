import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  SCENE_IMAGE_DELEGATE_FOLDER,
  resolveSceneImageDelegate,
} from '../tavern-plugin/lib/domain/scene-image-delegate.js'

// 说明：本文件刻意只依赖 node 内置模块。dev 克隆没有 node_modules 时也能单独跑：
//   node --test tests/scene-image-delegate.test.mjs
// 这样委派判定的正确性不依赖整仓依赖安装。

const fixed = pkg => () => pkg

test('没有 pluginsDir 或插件目录不存在时，不接管', () => {
  assert.deepEqual(resolveSceneImageDelegate({}), {
    delegated: false, plugin: null, version: null, reason: 'plugin-missing',
  })
  const r = resolveSceneImageDelegate({ pluginsDir: '/nowhere', readPackage: () => null })
  assert.equal(r.delegated, false)
  assert.equal(r.reason, 'plugin-missing')
})

test('发行版能力关闭时直接短路，连插件都不看', () => {
  const r = resolveSceneImageDelegate({ pluginsDir: '/nowhere', enabled: false, readPackage: () => ({ version: '9.9.9' }) })
  assert.deepEqual(r, { delegated: false, plugin: null, version: null, reason: 'disabled-by-release' })
})

test('有 package.json 但没有宿主入口时不算可加载插件，不能接管', () => {
  const r = resolveSceneImageDelegate({
    pluginsDir: '/plugins',
    readPackage: fixed({ name: 'dsh-tavern-image', version: '2.8.0', dsh: { tavern: { sceneImages: 'delegate' } } }),
  })
  assert.equal(r.delegated, false)
  assert.equal(r.reason, 'not-a-plugin')
  assert.equal(r.version, '2.8.0')
})

test('缺少契约字段时不接管（老版本插件不会意外夺权）', () => {
  const r = resolveSceneImageDelegate({
    pluginsDir: '/plugins',
    readPackage: fixed({ name: 'dsh-tavern-image', version: '2.7.0', main: './lib/index.js' }),
  })
  assert.equal(r.delegated, false)
  assert.equal(r.reason, 'contract-missing')
})

test('契约写了别的值时不接管', () => {
  const r = resolveSceneImageDelegate({
    pluginsDir: '/plugins',
    readPackage: fixed({ version: '2.8.0', main: './lib/index.js', dsh: { tavern: { sceneImages: 'observe' } } }),
  })
  assert.equal(r.delegated, false)
  assert.equal(r.reason, 'contract-missing')
})

test('契约成立时接管，并回报插件名与版本', () => {
  const r = resolveSceneImageDelegate({
    pluginsDir: '/plugins',
    readPackage: fixed({
      name: 'dsh-tavern-image', version: '2.8.1', main: './lib/index.js',
      dsh: { tavern: { sceneImages: 'delegate' } },
    }),
  })
  assert.deepEqual(r, { delegated: true, plugin: SCENE_IMAGE_DELEGATE_FOLDER, version: '2.8.1', reason: 'delegated' })
})

test('契约值大小写与空白宽松；exports["."] 也算宿主入口', () => {
  const r = resolveSceneImageDelegate({
    pluginsDir: '/plugins',
    readPackage: fixed({ version: '3.0.0', exports: { '.': { import: './lib/index.js' } }, dsh: { tavern: { sceneImages: '  DeLeGaTe  ' } } }),
  })
  assert.equal(r.delegated, true)
  assert.equal(r.version, '3.0.0')
})

test('真实目录：写入插件文件后判定接管，删掉后回退', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-delegate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  // 空目录 → 不接管
  assert.equal(resolveSceneImageDelegate({ pluginsDir: root }).reason, 'plugin-missing')

  // 放入合法插件 → 接管
  const dir = path.join(root, SCENE_IMAGE_DELEGATE_FOLDER)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-tavern-image', version: '2.8.0', main: './lib/index.js',
    dsh: { tavern: { sceneImages: 'delegate' } },
  }))
  const on = resolveSceneImageDelegate({ pluginsDir: root })
  assert.equal(on.delegated, true)
  assert.equal(on.version, '2.8.0')

  // 回滚：删掉目录 → 立刻回到不接管（不需要改 Tavern 代码）
  rmSync(dir, { recursive: true, force: true })
  assert.equal(resolveSceneImageDelegate({ pluginsDir: root }).delegated, false)
})
