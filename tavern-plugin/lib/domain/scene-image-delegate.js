import path from 'node:path'
import { readFileSync } from 'node:fs'

/**
 * 剧情生图的接管控件。
 *
 * 背景：Tavern 原生生图由 `TAVERN_RELEASE_CAPABILITIES.sceneImages` 在**创建期**决定是否实例化
 * （见 lib/index.js 的 sceneWorldbooks / sceneDiagnostics / sceneIllustrations）。
 * 因此"接管"只需要让这三个创建条件在外部插件就位时变成 false —— 不需要删除
 * `packages/dsh-image-gen/`，也不会碰到任何已落盘的插图数据。
 *
 * 约定（只认这两样，不认仓库地址与作者）：
 *   1. 插件落在两处之一都算：`data/plugins/dsh-tavern-image`（Tavern 自己维护的插件目录），
 *      或 profile 的 `node_modules/dsh-tavern-comfy`（用户用 pnpm link / 安装得到的依赖）
 *   2. 它的 package.json 里写着 `dsh.tavern.sceneImages === 'delegate'`
 *
 * 两处都认的原因：profile 侧已安装同名包时，Tavern 的 user-plugins 会主动跳过 plugins/ 下的副本
 * （避免同一个包有两个来源破坏浏览器模块组合）。既然插件通常先以依赖形式装进 profile，
 * 判定就必须认这一侧，否则要接管就得先摘依赖 —— 那会让插件在重启后彻底不加载。
 *
 * 本模块刻意写成同步 + 依赖注入：调用点（lib/index.js:390 附近）是模块顶层的同步常量初始化，
 * 而测试需要能在不碰真实磁盘的情况下覆盖各种目录状态，所以读盘函数可替换。
 */

/** 接管的插件目录名（Tavern 的 data/plugins 下）。改这里等于改变契约。 */
export const SCENE_IMAGE_DELEGATE_FOLDER = 'dsh-tavern-image'

/** profile 侧的包名。这是插件真正的 npm 包名，与目录名不同，两者都写在插件自己的 package.json 里。 */
export const SCENE_IMAGE_DELEGATE_PACKAGE = 'dsh-tavern-comfy'

/** 契约字段取值；只接受字符串 'delegate'（大小写与空白宽松处理）。 */
function contractOf(pkg) {
  const value = pkg?.dsh?.tavern?.sceneImages
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function versionOf(pkg) {
  return typeof pkg?.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null
}

/**
 * 宿主入口。与 domain/user-plugins.js 的 hostEntry 同义，但那里没有导出，
 * 这里保留一份最小实现，避免为了复用而改动对方的导出面。
 */
function hostEntry(pkg) {
  return typeof pkg?.exports === 'string' ? pkg.exports
    : typeof pkg?.exports?.['.'] === 'string' ? pkg.exports['.']
      : typeof pkg?.exports?.['.']?.import === 'string' ? pkg.exports['.'].import
        : typeof pkg?.exports?.['.']?.default === 'string' ? pkg.exports['.'].default
          : typeof pkg?.main === 'string' ? pkg.main
            : ''
}

function defaultReadPackage(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 判断剧情生图是否已被外部插件接管。
 *
 * @param {object} options
 * @param {string} [options.pluginsDir] 用户插件根目录（通常是 `userPluginPaths(dataRoot).plugins`）
 * @param {boolean} [options.enabled] 发行版能力开关；false 时直接短路，不再看插件
 * @param {(dir: string) => object|null} [options.readPackage] 读插件 package.json，测试注入用
 * @returns {{ delegated: boolean, plugin: string|null, version: string|null, reason: string }}
 *   reason: 'disabled-by-release' | 'plugin-missing' | 'not-a-plugin' | 'contract-missing' | 'delegated'
 */
export function resolveSceneImageDelegate({
  pluginsDir,
  profileDir,
  enabled = true,
  readPackage = defaultReadPackage,
} = {}) {
  const none = (reason, plugin = null, version = null) => ({ delegated: false, plugin, version, reason })
  if (!enabled) return none('disabled-by-release')

  // 候选按「Tavern 自己维护的插件目录」优先，其次 profile 的 node_modules。
  // 每一处都要过同一套校验：有宿主入口、契约写成 delegate。
  const candidates = [
    pluginsDir ? path.join(pluginsDir, SCENE_IMAGE_DELEGATE_FOLDER) : null,
    profileDir ? path.join(profileDir, 'node_modules', SCENE_IMAGE_DELEGATE_PACKAGE) : null,
  ].filter(Boolean)
  if (!candidates.length) return none('plugin-missing')

  let sawPackageJson = false
  let sawPluginWithoutEntry = null
  for (const dir of candidates) {
    const pkg = readPackage(dir)
    if (!pkg || typeof pkg !== 'object') continue
    sawPackageJson = true
    const version = versionOf(pkg)
    if (!hostEntry(pkg)) { sawPluginWithoutEntry = version; continue }
    if (contractOf(pkg) !== 'delegate') continue
    return { delegated: true, plugin: SCENE_IMAGE_DELEGATE_FOLDER, version, reason: 'delegated' }
  }
  if (!sawPackageJson) return none('plugin-missing')
  if (sawPluginWithoutEntry !== null) return none('not-a-plugin', SCENE_IMAGE_DELEGATE_FOLDER, sawPluginWithoutEntry)
  return none('contract-missing', SCENE_IMAGE_DELEGATE_FOLDER, null)
}
