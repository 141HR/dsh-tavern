import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { deleteWorkflow } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/workflow-delete.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-image-workflow-delete-'))
  const workflowsDir = path.join(root, 'workflows')
  await mkdir(workflowsDir)
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = {
    defaultWorkflow: 'remove-me',
    workflows: [
      { id: 'remove-me', file: 'workflows/remove-me.json' },
      { id: 'fallback', file: 'workflows/fallback.json' },
    ],
  }
  await writeFile(path.join(workflowsDir, 'remove-me.json'), '{"workflow":true}')
  await writeFile(path.join(workflowsDir, 'fallback.json'), '{"workflow":true}')
  const persisted = []
  let reloads = 0
  const deps = {
    config,
    workflowsDir,
    saveConfig: async value => persisted.push(structuredClone(value)),
    reload: async () => { reloads++ },
  }
  return { ...deps, persisted, reloadCount: () => reloads }
}

test('删除工作流文件和配置；再次扫描目录不会重新发现该文件', async t => {
  const f = await fixture(t)
  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 200)
  assert.deepEqual(f.config.workflows.map(item => item.id), ['fallback'])
  assert.equal(f.config.defaultWorkflow, 'fallback')
  assert.deepEqual(await readdir(f.workflowsDir), ['fallback.json'])
  assert.deepEqual(f.persisted.at(-1).workflows.map(item => item.id), ['fallback'])
  assert.equal(f.reloadCount(), 1)
})

test('配置条目指向的文件已缺失时仍可删除，且重启状态中不保留它', async t => {
  const f = await fixture(t)
  await rm(path.join(f.workflowsDir, 'remove-me.json'))
  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 200)
  assert.deepEqual(f.config.workflows.map(item => item.id), ['fallback'])
  assert.deepEqual(f.persisted.at(-1).workflows.map(item => item.id), ['fallback'])
})

test('拒绝工作流目录外路径并保留配置', async t => {
  const f = await fixture(t)
  const outside = path.join(path.dirname(f.workflowsDir), 'outside.json')
  await writeFile(outside, 'keep')
  f.config.workflows[0].file = '../outside.json'
  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 400)
  assert.equal(await readFile(outside, 'utf8'), 'keep')
  assert.deepEqual(f.config.workflows.map(item => item.id), ['remove-me', 'fallback'])
  assert.equal(f.persisted.length, 0)
})

test('文件删除失败时不丢配置条目', async t => {
  const f = await fixture(t)
  await rm(path.join(f.workflowsDir, 'remove-me.json'))
  await mkdir(path.join(f.workflowsDir, 'remove-me.json'))
  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 500)
  assert.deepEqual(f.config.workflows.map(item => item.id), ['remove-me', 'fallback'])
  assert.equal(f.persisted.length, 0)
})

test('配置保存失败时恢复工作流文件及内存、持久配置', async t => {
  const f = await fixture(t)
  f.saveConfig = async () => { throw new Error('config-write-failed') }
  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 500)
  assert.equal(result.error, 'config-write-failed')
  assert.deepEqual(f.config.workflows.map(item => item.id), ['remove-me', 'fallback'])
  assert.equal(await readFile(path.join(f.workflowsDir, 'remove-me.json'), 'utf8'), '{"workflow":true}')
})

test('删除非默认工作流不更改当前默认项；不存在的 id 不写入配置', async t => {
  const f = await fixture(t)
  f.config.defaultWorkflow = 'fallback'
  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 200)
  assert.equal(f.config.defaultWorkflow, 'fallback')
  const missing = await deleteWorkflow({ ...f, id: 'unknown' })
  assert.equal(missing.status, 404)
  assert.equal(f.persisted.length, 1)
})
