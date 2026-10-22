import { readFile, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** Delete one configured workflow file and persist its removal as one operation. */
export async function deleteWorkflow({ config, id, workflowsDir, saveConfig, reload }) {
  const workflowId = String(id ?? '')
  const target = config.workflows.find(item => String(item?.id) === workflowId)
  if (!target) return { status: 404, error: '没有这个工作流条目' }

  const file = String(target.file ?? '').replace(/\\/g, '/')
  const name = file.startsWith('workflows/') ? file.slice('workflows/'.length) : file
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0') || isAbsolute(name) || !/\.json$/i.test(name)) {
    return { status: 400, error: '工作流文件名不正确' }
  }
  const directory = resolve(workflowsDir)
  const path = resolve(directory, name)
  const rel = relative(directory, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { status: 400, error: '工作流文件名不正确' }

  let previousFile
  try {
    previousFile = await readFile(path)
    await unlink(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') return { status: 500, error: error?.message ?? String(error) }
  }

  const previousWorkflows = config.workflows
  const previousDefault = config.defaultWorkflow
  config.workflows = previousWorkflows.filter(item => String(item?.id) !== workflowId)
  if (String(config.defaultWorkflow) === workflowId) {
    config.defaultWorkflow = config.workflows.find(item => item?.enabled !== false)?.id
      ?? config.workflows[0]?.id
      ?? ''
  }
  try {
    await saveConfig(config)
    await reload()
    return { status: 200 }
  } catch (error) {
    config.workflows = previousWorkflows
    config.defaultWorkflow = previousDefault
    if (previousFile !== undefined) {
      try { await writeFile(path, previousFile, { flag: 'wx' }) } catch { /* Keep the config entry if restoration is blocked. */ }
    }
    try { await saveConfig(config) } catch { /* Keep the in-memory entry even if persistence is unavailable. */ }
    try { await reload() } catch { /* Preserve the original error. */ }
    return { status: 500, error: error?.message ?? String(error) }
  }
}
