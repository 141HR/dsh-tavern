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
 *   1. 插件目录名固定为 `dsh-tavern-image`
 *   2. 它的 package.json 里写着 `dsh.tavern.sceneImages === 'delegate'`
 *
 * 本模块刻意写成同步 + 依赖注入：调用点（lib/index.js:390 附近）是模块顶层的同步常量初始化，
 * 而测试需要能在不碰真实磁盘的情况下覆盖各种目录状态，所以读盘函数可替换。
 */

/** 接管的插件目录名。改这里等于改变契约，需要同步更新插件自己的 package.json。 */
export const SCENE_IMAGE_DELEGATE_FOLDER = 'dsh-tavern-image'

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
export function resolveSceneImageDelegate({ pluginsDir, enabled = true, readPackage = defaultReadPackage } = {}) {
  const none = (reason, plugin = null, version = null) => ({ delegated: false, plugin, version, reason })
  if (!enabled) return none('disabled-by-release')
  if (!pluginsDir) return none('plugin-missing')

  const pkg = readPackage(path.join(pluginsDir, SCENE_IMAGE_DELEGATE_FOLDER))
  if (!pkg || typeof pkg !== 'object') return none('plugin-missing')

  // 有 package.json 但没有宿主入口 → 不是一个能被 Tavern 加载的插件，不能让它接管
  if (!hostEntry(pkg)) return none('not-a-plugin', SCENE_IMAGE_DELEGATE_FOLDER, versionOf(pkg))

  if (contractOf(pkg) !== 'delegate') {
    return none('contract-missing', SCENE_IMAGE_DELEGATE_FOLDER, versionOf(pkg))
  }

  return { delegated: true, plugin: SCENE_IMAGE_DELEGATE_FOLDER, version: versionOf(pkg), reason: 'delegated' }
}
