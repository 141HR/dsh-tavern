import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * 首装时把 Tavern 自带的那份「固定版本」剧情生图插件装进用户插件目录。
 *
 * 设计约束（逐条对应需求）：
 *  - 固定版本：只读 `packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json`，全程不联网、不拉 latest。
 *  - 不覆盖、不降级：目标已存在且版本 >= 内置版本时直接跳过；用户自己更新到更高版本后，
 *    下次安装不会把它按回内置版本。
 *  - 不丢数据：复制是**逐文件覆盖**，只写内置清单里的文件；目标目录里用户自己的
 *    config.json / worldbook.json / definitions.json / jobs-store.json 等一律不碰，
 *    也绝不会先删目录再拷。
 *  - 不重复加载：profile 里已经有同名包时跳过（Tavern 的 user-plugins 本来也会跳过
 *    plugins/ 下的副本以免同一包两个来源，这里提前让位，省得留一份永远不会被加载的副本）。
 *
 * 失败一律不阻断 Tavern 安装：返回 `action: 'unavailable'` 并附带原因，由调用方决定要不要提示。
 */

export const BUNDLED_SCENE_IMAGE_FOLDER = 'dsh-tavern-image'
export const BUNDLED_SCENE_IMAGE_DIR = ['tavern-plugin', 'packages', 'dsh-tavern-image-bundled']
/** profile 侧那个包名（插件真正的 npm 包名，与目录名不同） */
export const SCENE_IMAGE_PACKAGE_NAME = 'dsh-tavern-comfy'

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
  for (const file of REQUIRED) {
    if (!existsSync(path.join(directory, file))) {
      return { ok: false, directory, reason: '内置插件副本不完整，缺少 ' + file }
    }
  }
  const pkg = readJson(path.join(directory, 'package.json'))
  const version = String(pkg?.version ?? '').trim()
  if (!version) return { ok: false, directory, reason: '内置插件副本的 package.json 没有版本号' }
  if (!hostEntry(pkg)) return { ok: false, directory, reason: '内置插件副本的 package.json 没有宿主入口' }
  return { ok: true, directory, version, packageName: String(pkg?.name ?? ''), contract: pkg?.dsh?.tavern?.sceneImages ?? null }
}

/** 逐文件覆盖：只写内置副本里存在的文件，目标目录里多出来的（用户数据）不动。 */
function overlay(from, to, copied) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'BUNDLED-VERSION.json') continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) { mkdirSync(target, { recursive: true }); overlay(source, target, copied); continue }
    if (!statSync(source).isFile()) continue
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
  const installed = readJson(path.join(target, 'package.json'))
  const installedVersion = installed ? String(installed.version ?? '').trim() || null : null

  // profile 侧已装同名包：让它做唯一来源，别再放一份永不加载的副本
  if (profileDir && existsSync(path.join(profileDir, 'node_modules', SCENE_IMAGE_PACKAGE_NAME, 'package.json'))) {
    return {
      action: 'skipped', reason: 'profile 已安装同名插件包，保持单一来源',
      version: bundled.version, installedVersion, target,
    }
  }

  if (installedVersion && comparePluginVersions(installedVersion, bundled.version) >= 0) {
    return {
      action: 'skipped', reason: '已安装版本不低于内置版本，不覆盖也不降级',
      version: bundled.version, installedVersion, target,
    }
  }

  const copied = []
  overlay(bundled.directory, target, copied)

  // 复制完再确认一次：核心文件到位、契约仍在（契约丢了委派判定就会失效）
  for (const file of REQUIRED) {
    if (!existsSync(path.join(target, file))) {
      throw new Error('内置插件复制后缺少 ' + file + '：' + target)
    }
  }
  const after = readJson(path.join(target, 'package.json'))
  if (after?.dsh?.tavern?.sceneImages !== 'delegate') {
    throw new Error('内置插件缺少 dsh.tavern.sceneImages=delegate 契约：' + target)
  }

  return {
    action: installedVersion ? 'upgraded' : 'installed',
    reason: installedVersion ? '已安装版本低于内置版本，已就地升级（保留用户数据）' : '首次安装',
    version: bundled.version,
    installedVersion,
    target,
    files: copied.length,
  }
}
