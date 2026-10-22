import { readFile, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

function workflowPath(file, workflowsDir) {
  let value = String(file ?? '').replace(/\\/g, '/')
  if (!value) return null
  if (!isAbsolute(value) && value.startsWith('workflows/')) value = value.slice('workflows/'.length)
  if (!isAbsolute(value) && (value.includes('/') || value === '.' || value === '..')) return null
  if (!/\.json$/i.test(value) || value.includes('\0')) return null
  const directory = resolve(workflowsDir)
  const path = resolve(directory, value)
  const rel = relative(directory, path)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return path
}

function sameFile(left, right, workflowsDir) {
  const a = workflowPath(left, workflowsDir)
  const b = workflowPath(right, workflowsDir)
  if (!a || !b) return false
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Delete one configured workflow file and persist its removal as one operation. */
export async function deleteWorkflow({ config, id, workflowsDir, saveConfig, reload }) {
  const workflowId = String(id ?? '')
  const target = config.workflows.find(item => String(item?.id) === workflowId)
  if (!target) return { status: 404, error: '没有这个工作流条目' }

  const path = workflowPath(target.file, workflowsDir)
  if (!path) return { status: 400, error: '工作流文件名不正确' }

  let previousFile
  try {
    previousFile = await readFile(path)
    await unlink(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') return { status: 500, error: error?.message ?? String(error) }
  }

  const previousWorkflows = config.workflows
  const previousDefault = config.defaultWorkflow
  // One physical JSON file is one workflow. Remove every alias that references
  // it so the remaining config cannot point at a file deleted by this request.
  config.workflows = previousWorkflows.filter(item =>
    String(item?.id) !== workflowId && !sameFile(item?.file, target.file, workflowsDir))
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
