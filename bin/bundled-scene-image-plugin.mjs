import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * 首装时把 Tavern 自带的那份「固定版本」剧情生图插件装进用户插件目录。
 *
 * 设计约束（逐条对应需求）：
 *  - 固定版本：只读 `packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json`，全程不联网、不拉 latest。
 *  - 只首装：目标目录一旦存在就跳过，不判断版本、不覆盖、不碰用户数据。
 *  - 原子安装：先复制并校验到同级临时目录，再将完整目录改名到目标位置。
 *  - 不重复加载：profile 里已经有同名包时跳过（Tavern 的 user-plugins 本来也会跳过
 *    plugins/ 下的副本以免同一包两个来源，这里提前让位，省得留一份永远不会被加载的副本）。
 *
 * 失败一律不阻断 Tavern 安装：返回 `action: 'unavailable'` 并附带原因，由调用方决定要不要提示。
 */

export const BUNDLED_SCENE_IMAGE_FOLDER = 'dsh-tavern-image'
export const BUNDLED_SCENE_IMAGE_DIR = ['tavern-plugin', 'packages', 'dsh-tavern-image-bundled']
/** profile 侧那个包名（插件真正的 npm 包名，与目录名不同） */
export const SCENE_IMAGE_PACKAGE_NAME = 'dsh-tavern-image'
/** 旧版 profile 包名：识别既有来源，避免新旧包并存。 */
export const LEGACY_SCENE_IMAGE_PACKAGE_NAME = 'dsh-tavern-comfy'

/** 内置副本必须齐备的文件；缺一个就当"这份发行版没内置插件"，不去猜。 */
const REQUIRED = ['package.json', 'lib/index.js', 'client.js', 'cordis.patch.yml']

/** 依赖入口判断（与 Tavern 加载器一致：exports["."] 优先，其次 main） */
function hostEntry(pkg) {
  return typeof pkg?.exports === 'string' ? pkg.exports
    : typeof pkg?.exports?.['.'] === 'string' ? pkg.exports['.']
      : typeof pkg?.exports?.['.']?.import === 'string' ? pkg.exports['.'].import
        : typeof pkg?.exports?.['.']?.default === 'string' ? pkg.exports['.'].default
          : typeof pkg?.main === 'string' ? pkg.main
            : ''
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

function existsNoFollow(file) {
  try { lstatSync(file); return true } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/**
 * 比较点分版本号。非数字段按 0 处理，缺失段也按 0 —— 这里的版本号来自我们自己发布的
 * package.json，不需要完整的 semver（预发布标签按出现顺序比较字符串即可）。
 * @returns {number} a>b 返回 1，a<b 返回 -1，相等返回 0
 */
export function comparePluginVersions(a, b) {
  const split = value => String(value ?? '').trim().split(/[.+-]/).map(part => (/^\d+$/.test(part) ? Number(part) : part))
  const left = split(a), right = split(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] ?? 0, y = right[i] ?? 0
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x > y ? 1 : -1
      continue
    }
    const sx = String(x), sy = String(y)
    if (sx !== sy) return sx > sy ? 1 : -1
  }
  return 0
}

/** 读内置副本的版本与完整性；不完整时返回 { ok: false, reason }。 */
export function readBundledSceneImage(sourceRoot) {
  const directory = path.join(sourceRoot, ...BUNDLED_SCENE_IMAGE_DIR)
  let directoryStat
  try { directoryStat = lstatSync(directory) } catch {
    return { ok: false, directory, reason: '内置插件副本目录不存在' }
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return { ok: false, directory, reason: '内置插件副本目录不是普通目录' }
  }
  for (const file of REQUIRED) {
    try {
      if (!lstatSync(path.join(directory, file)).isFile()) throw new Error()
    } catch {
      return { ok: false, directory, reason: '内置插件副本不完整，缺少 ' + file }
    }
  }
  const marker = readJson(path.join(directory, 'BUNDLED-VERSION.json'))
  if (!marker) return { ok: false, directory, reason: '内置插件副本缺少有效的 BUNDLED-VERSION.json' }
  const pkg = readJson(path.join(directory, 'package.json'))
  const version = String(pkg?.version ?? '').trim()
  if (!version) return { ok: false, directory, reason: '内置插件副本的 package.json 没有版本号' }
  if (pkg?.name !== SCENE_IMAGE_PACKAGE_NAME || marker.name !== SCENE_IMAGE_PACKAGE_NAME || String(marker.version ?? '').trim() !== version) {
    return { ok: false, directory, reason: '内置版本标记与 package.json 的名称或版本不一致' }
  }
  if (!hostEntry(pkg)) return { ok: false, directory, reason: '内置插件副本的 package.json 没有宿主入口' }
  if (pkg?.dsh?.tavern?.sceneImages !== 'delegate') return { ok: false, directory, reason: '内置插件缺少 dsh.tavern.sceneImages=delegate 契约' }
  return { ok: true, directory, version, packageName: pkg.name, contract: pkg.dsh.tavern.sceneImages }
}

/** 将不含符号链接的内置副本复制到新建的临时目录。 */
function copyTree(from, to, copied) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'BUNDLED-VERSION.json') continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isSymbolicLink()) throw new Error('内置插件副本包含不支持的符号链接：' + source)
    if (entry.isDirectory()) { mkdirSync(target); copyTree(source, target, copied); continue }
    if (!entry.isFile()) continue
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(source, target)
    copied.push(path.relative(to, target).split(path.sep).join('/'))
  }
}

/**
 * @param {object} options
 * @param {string} options.sourceRoot Tavern 安装源根目录（含 tavern-plugin/packages/...）
 * @param {string} options.dataRoot Tavern 数据根（插件装到 `<dataRoot>/plugins/dsh-tavern-image`）
 * @param {string} [options.profileDir] profile 目录；给了就检查里面是否已装同名包
 */
export function installBundledSceneImagePlugin({ sourceRoot, dataRoot, profileDir, logger = console } = {}) {
  const bundled = readBundledSceneImage(sourceRoot)
  if (!bundled.ok) {
    logger.warn?.('[Tavern 插件] 跳过内置生图插件：' + bundled.reason)
    return { action: 'unavailable', reason: bundled.reason, version: null, target: null, installedVersion: null }
  }

  const target = path.join(dataRoot, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const installedVersion = readJson(path.join(target, 'package.json'))?.version ?? null

  // Any existing entry is user-owned: this includes broken directories and symlinks.
  if (existsNoFollow(target)) return {
    action: 'skipped', reason: '目标插件目录已存在，保留现有内容',
    version: bundled.version, installedVersion, target,
  }

  // profile 侧已装同名包：让它做唯一来源，别再放一份永不加载的副本
  const profileHasSceneImagePackage = profileDir && [SCENE_IMAGE_PACKAGE_NAME, LEGACY_SCENE_IMAGE_PACKAGE_NAME]
    .some(name => existsSync(path.join(profileDir, 'node_modules', name, 'package.json')))
  if (profileHasSceneImagePackage) {
    return {
      action: 'skipped', reason: 'profile 已安装同名插件包，保持单一来源',
      version: bundled.version, installedVersion, target,
    }
  }

  const copied = []
  const pluginsDir = path.dirname(target)
  mkdirSync(pluginsDir, { recursive: true })
  const staging = mkdtempSync(path.join(pluginsDir, '.dsh-tavern-image-'))
  try {
    copyTree(bundled.directory, staging, copied)
    const copiedPkg = readJson(path.join(staging, 'package.json'))
    if (copiedPkg?.name !== SCENE_IMAGE_PACKAGE_NAME || String(copiedPkg?.version ?? '').trim() !== bundled.version || copiedPkg?.dsh?.tavern?.sceneImages !== 'delegate') {
      throw new Error('内置插件复制后的包名、版本或委派契约校验失败')
    }
    for (const file of REQUIRED) {
      if (!existsSync(path.join(staging, file))) throw new Error('内置插件复制后缺少 ' + file)
    }
    if (existsNoFollow(target)) {
      rmSync(staging, { recursive: true, force: true })
      return {
        action: 'skipped', reason: '目标插件目录已存在，保留现有内容',
        version: bundled.version, installedVersion: readJson(path.join(target, 'package.json'))?.version ?? null, target,
      }
    }
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }

  return {
    action: 'installed',
    reason: '首次安装',
    version: bundled.version,
    installedVersion,
    target,
    files: copied.length,
  }
}
