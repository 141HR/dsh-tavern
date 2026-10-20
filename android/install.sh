#!/usr/bin/env bash
set -euo pipefail
export DSH_TAVERN_RUNTIME_HOST=android
export DSH_TAVERN_START_TIMEOUT="${DSH_TAVERN_START_TIMEOUT:-120}"

export npm_config_registry="${DSH_TAVERN_NPM_REGISTRY:-https://registry.npmmirror.com}"
# pnpm 11 reads pnpm_config_* instead of npm_config_*.
export pnpm_config_registry="$npm_config_registry"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
TAVERN_PROFILE_DIR="${DSH_ROOT}/profiles/tavern"
TAVERN_PORT=3088
PNPM_VERSION=11.25.0

fail() {
  printf '安装失败：%s\n' "$1" >&2
  exit 1
}

# 分步日志：APK 的安装日志框只追加新行，用步骤头能把「慢」和「卡死」区分开。
START_TIME=$(date +%s)
STEP=0
stage() {
  STEP=$((STEP + 1))
  printf '\n== [步骤 %s] %s（已用 %ss）==\n' "${STEP}" "$*" "$(( $(date +%s) - START_TIME ))"
}
info() { printf '   %s\n' "$*"; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1。请先在 DSHA 中安装对应依赖。"
}

find_web_profile() {
  if [ -n "${DSH_ANDROID_WEB_PROFILE:-}" ]; then
    printf '%s\n' "${DSH_ANDROID_WEB_PROFILE}"
  elif [ -f "${DSH_ROOT}/profiles/web/package.json" ]; then
    printf '%s\n' web
  elif [ -f "${DSH_ROOT}/profiles/user/package.json" ]; then
    printf '%s\n' user
  else
    fail "找不到 DSHA 的 web 或 user Profile。请先启动一次 DSHA，或设置 DSH_ANDROID_WEB_PROFILE。"
  fi
}

probe_port() {
  node - "$1" <<'NODE'
const net = require('node:net')
const port = Number(process.argv[2])
const socket = net.createConnection({ host: '127.0.0.1', port })
const done = (ok) => {
  socket.destroy()
  process.exit(ok ? 0 : 1)
}
socket.setTimeout(1500)
socket.once('connect', () => done(true))
socket.once('timeout', () => done(false))
socket.once('error', () => done(false))
NODE
}

require_command node
require_command dsh
# APK 首装会先把内置依赖包解到 DSH_TAVERN_OFFLINE_DIR（源码 + pnpm store + pnpm 运行时）。
OFFLINE_DIR="${DSH_TAVERN_OFFLINE_DIR:-}"
if [ -n "${OFFLINE_DIR}" ] && [ -d "${OFFLINE_DIR}/store" ]; then
  export DSH_TAVERN_PNPM_STORE="${OFFLINE_DIR}/store"
  info "使用内置依赖包：${DSH_TAVERN_PNPM_STORE}（$(du -sh "${DSH_TAVERN_PNPM_STORE}" 2>/dev/null | cut -f1)）"
else
  OFFLINE_DIR=""
  info '无内置依赖包，按需联网下载依赖。'
fi
# Keep Tavern's package manager independent of DSHA's bundled pnpm and PATH.
PNPM_ROOT="${DSH_ROOT}/runtime/tavern-pnpm/${PNPM_VERSION}"
PNPM_COMMAND="${PNPM_ROOT}/bin/pnpm"
INSTALLED_PNPM_VERSION=$("${PNPM_COMMAND}" --version 2>/dev/null || :)
if [ "${INSTALLED_PNPM_VERSION}" != "${PNPM_VERSION}" ]; then
  if [ -n "${OFFLINE_DIR}" ] && [ -x "${OFFLINE_DIR}/pnpm-runtime/bin/pnpm" ]; then
    stage "安装 Tavern 专用 pnpm ${PNPM_VERSION}（来自内置包，免联网）"
    mkdir -p "$(dirname -- "${PNPM_ROOT}")"
    rm -rf -- "${PNPM_ROOT}.copying" 2>/dev/null || true
    cp -R "${OFFLINE_DIR}/pnpm-runtime" "${PNPM_ROOT}.copying" || fail "复制内置 pnpm 运行时失败。"
    rm -rf -- "${PNPM_ROOT}" 2>/dev/null || true
    mv -- "${PNPM_ROOT}.copying" "${PNPM_ROOT}"
    info "pnpm 运行时已就位：${PNPM_ROOT}"
  else
    require_command npm
    stage "安装 Tavern 专用 pnpm ${PNPM_VERSION}（联网）"
    # Restored backups can contain ordinary bin files without node_modules.
    # Build and verify a fresh prefix before replacing the version-owned runtime.
    (
      mkdir -p "$(dirname -- "${PNPM_ROOT}")"
      pnpm_stage=$(mktemp -d "${PNPM_ROOT}.install.XXXXXX")
      pnpm_backup="${pnpm_stage}.previous"
      pnpm_committed=0
      cleanup_pnpm_install() {
        rm -rf -- "${pnpm_stage}"
        if [ -e "${pnpm_backup}" ] || [ -L "${pnpm_backup}" ]; then
          if [ "${pnpm_committed}" = 1 ]; then
            rm -rf -- "${pnpm_backup}"
          elif [ ! -e "${PNPM_ROOT}" ] && [ ! -L "${PNPM_ROOT}" ]; then
            mv -- "${pnpm_backup}" "${PNPM_ROOT}"
          fi
        fi
      }
      trap cleanup_pnpm_install EXIT
      npm install --global --prefix "${pnpm_stage}" "pnpm@${PNPM_VERSION}"
      staged_version=$("${pnpm_stage}/bin/pnpm" --version 2>/dev/null || :)
      [ "${staged_version}" = "${PNPM_VERSION}" ] || fail "新 pnpm 安装后校验失败，原目录未修改。"
      if [ -e "${PNPM_ROOT}" ] || [ -L "${PNPM_ROOT}" ]; then
        mv -- "${PNPM_ROOT}" "${pnpm_backup}"
      fi
      mv -- "${pnpm_stage}" "${PNPM_ROOT}"
      pnpm_committed=1
    )
  fi
fi
INSTALLED_PNPM_VERSION=$("${PNPM_COMMAND}" --version 2>/dev/null || :)
[ "${INSTALLED_PNPM_VERSION}" = "${PNPM_VERSION}" ] || fail "Tavern 专用 pnpm ${PNPM_VERSION} 安装后校验失败（当前：${INSTALLED_PNPM_VERSION:-不可用}）。"
# Node/DSH child processes also invoke pnpm by name. Scope their resolution and
# version-check policy to this installer; do not alter the user's system PATH.
export PATH="${PNPM_ROOT}/bin:${PATH}"
export pnpm_config_update_notifier=false
# All dependency and Profile installs below use this exact executable.
PNPM_EXTRA=()
if [ -n "${DSH_TAVERN_PNPM_STORE:-}" ]; then
  PNPM_EXTRA+=("--store-dir=${DSH_TAVERN_PNPM_STORE}")
fi
# 进度逐行追加：APK 日志框只追加新行，pnpm 默认的回车原地刷新在那里看起来像卡死。
# 用配置项而不是命令行参数，避免污染包装函数传参顺序。
export pnpm_config_reporter=append-only
pnpm() {
  # 慢速移动网络下载大包会撞上 pnpm 单请求 60 秒默认超时（日志 error (23)）；
  # 提高到 10 分钟，避免一次超时就丢掉整轮安装。可用同名环境变量覆盖。
  "${PNPM_COMMAND}" --config.update-notifier=false \
    --config.fetchTimeout="${pnpm_config_fetch_timeout:-600000}" "${PNPM_EXTRA[@]}" "$@"
}
# 内置依赖包完整时先走 --offline（秒级完成）；缺包再联网补齐，而不是直接放弃。
pnpm_install() {
  if [ -n "${DSH_TAVERN_PNPM_STORE:-}" ]; then
    if pnpm "$@" --offline; then return 0; fi
    info '内置依赖缺少部分包，改为联网补齐（只下载缺失项）……'
  fi
  pnpm "$@"
}
# Android 的 proot 会把硬链接模拟成符号链接，pnpm 默认导入方式可能因此
# 生成无法进行相对 require 的包目录。DSHA 中的所有后续安装也必须沿用复制模式。
pnpm config set package-import-method copy --location=user
pnpm config set side-effects-cache false --location=user

run_dsh() {
  node --expose-internals "$(command -v dsh)" "$@"
}
[ -f "${REPO_ROOT}/package.json" ] || fail "脚本必须位于完整的 dsh-tavern 仓库中。"
[ -f "${SCRIPT_DIR}/dsh-tavern-entry/package.json" ] || fail "缺少 dsh-tavern-entry。"

WEB_PROFILE_NAME="$(find_web_profile)"
WEB_PROFILE_DIR="${DSH_ROOT}/profiles/${WEB_PROFILE_NAME}"

stage "安装酒馆核心依赖（287 包；离线包命中时通常 10-40s，联网补齐则取决于网速）"
info "依赖目录：${REPO_ROOT}/node_modules"
pnpm_install --dir "${REPO_ROOT}" install --frozen-lockfile
info "核心依赖完成，node_modules：$(du -sh "${REPO_ROOT}/node_modules" 2>/dev/null | cut -f1)"

if [ "${DSH_TAVERN_ANDROID_STANDALONE:-0}" != 1 ] && [ -f "${TAVERN_PROFILE_DIR}/package.json" ]; then
  stage "停止旧版酒馆服务"
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" \
    node "${REPO_ROOT}/bin/dsh-tavern.mjs" stop
fi

stage "写入 tavern Profile 配置"
DSH_HOME="${DSH_ROOT}" node "${REPO_ROOT}/bin/dsh-tavern.mjs" install --host android

stage "把安卓插件加入 tavern 与 ${WEB_PROFILE_NAME} Profile"
node "${SCRIPT_DIR}/configure-profiles.mjs" "${REPO_ROOT}" "${TAVERN_PROFILE_DIR}" "${WEB_PROFILE_DIR}"

stage "安装 Profile 依赖（tavern / ${WEB_PROFILE_NAME}）"
info "tavern：${TAVERN_PROFILE_DIR}"
pnpm_install --dir "${TAVERN_PROFILE_DIR}" install
info "tavern Profile 完成"
info "${WEB_PROFILE_NAME}：${WEB_PROFILE_DIR}"
pnpm_install --dir "${WEB_PROFILE_DIR}" install
info "${WEB_PROFILE_NAME} Profile 完成"
# pnpm 处理 link: 依赖时可能重新生成绝对链接。最后再规范化一次，确保
# DSHA 从 Android 宿主 rootfs 检查 bundle 时也能解析酒馆入口。
node "${SCRIPT_DIR}/configure-profiles.mjs" "${REPO_ROOT}" "${TAVERN_PROFILE_DIR}" "${WEB_PROFILE_DIR}"
stage "校验 Profile 配置与运行时依赖"
run_dsh --profile tavern --dump-config >/dev/null
info 'tavern Profile 配置可解析'
run_dsh --profile "${WEB_PROFILE_NAME}" --dump-config >/dev/null
info "${WEB_PROFILE_NAME} Profile 配置可解析"
# --dump-config never imports the plugin. Fail (and let setup.sh roll back) when the
# Profile installs above left the plugin without one of its runtime packages.
node "${REPO_ROOT}/bin/runtime-dependencies.mjs" "${REPO_ROOT}"
info '运行时依赖完整'

if [ "${DSH_TAVERN_ANDROID_STANDALONE:-0}" = 1 ]; then
  printf '\n安装完成（总耗时 %ss）。请返回 DSH Tavern 应用并重新启动酒馆。\n' "$(( $(date +%s) - START_TIME ))"
  exit 0
fi

stage "启动 3088 酒馆服务"
DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" \
  DSH_TAVERN_RUNTIME_HOST="android" \
  node "${REPO_ROOT}/bin/dsh-tavern.mjs" start

probe_port "${TAVERN_PORT}" || fail "3088 端口未能启动，请查看 ${DSH_ROOT}/logs/tavern.log。"

printf '\n安装完成（总耗时 %ss）。\n' "$(( $(date +%s) - START_TIME ))"
printf '酒馆地址：http://127.0.0.1:%s\n' "${TAVERN_PORT}"
if probe_port 3080; then
  printf 'DSHA Web：http://127.0.0.1:3080（当前可访问）\n'
else
  printf '提示：3080 当前未监听；重启 DSHA 后再检查。\n'
fi
printf '请重启一次 DSHA，使自动拉起和移动端界面正式加载。\n'
