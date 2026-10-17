# DSH Tavern 0.2.1-rc.2 适配版（Fork）

这是 [DSH Tavern](https://github.com/flizzywine/dsh-tavern) 的一个 fork。宿主适配先后走过 **DSH 0.1.5-rc.2 / DSH Desktop 2.0.13 → DSH 0.2.0-rc.2 → DSH 0.2.1-rc.2** 三代，本文件只说明当前这一版（0.2.1-rc.2）怎么装、改了什么、和上游差在哪。

> 上游仓库与社区资产保持原样：视频、文档站、Discussions、Discord、徽章图片等仍指向 [flizzywine/dsh-tavern](https://github.com/flizzywine/dsh-tavern)，完整产品说明见[上游 README](README.md) 与[上游文档站](https://flizzywine.github.io/dsh-tavern/)。

## 宿主版本要求

| 宿主 | 要求版本 | 说明 |
| --- | --- | --- |
| DSH Desktop（Windows / macOS） | **0.2.1-rc.2** | 内置 DSH 必须与 `config/dsh-compatibility.json` 的 `adaptedDshVersion` 完全一致，否则安装器停止安装。 |
| DSH CLI（命令行版） | **0.2.1-rc.2** | 安装器按 `config/cli-runtime/package-lock.json` 下载固定版本的独立 DSH 运行时，其中每个 `@deepseek-ai/*` 包都锁在 0.2.1-rc.2。 |
| DSHA（Android） | **0.1.5-rc2**（内置 DSH 0.1.5-rc.2） | Android 侧沿用上游适配的 DSHA 版本。 |

DSH 下载页面：<https://www.deepseek.com/harness/>；DSHA 历史版本：<https://github.com/DSH-APP/DSHA/releases>。

## 从本 Fork 安装

### Windows：DSH Desktop

1. 安装 [DSH Desktop 0.2.1-rc.2](https://www.deepseek.com/harness/)。
2. 进入 **设置 → 通用设置 → 打开 DSH 终端**，运行：

```powershell
$env:DSH_TAVERN_HOST='desktop'; $env:DSH_TAVERN_REPOSITORY='moyutegong/dsh-tavern'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/moyutegong/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

3. 启动酒馆。0.2.1 桌面版**没有 Profile 切换器**（`app.asar/lib/main.js:79-84` 固定启动 `profiles/desktop`），安装器装好的 `profiles/tavern` 需要显式启动，二选一：
   - **侧边栏（推荐）**：按下面[「桌面侧边栏启动」](#桌面侧边栏启动dsh-tavern-launcher)装好 `dsh-tavern-launcher`，在侧边栏点 **Tavern → 启动**，页面会自动打开。
   - **终端**：在工作区目录运行 `node bin\dsh-tavern.mjs start`。桌面版若用了非默认 home，先设 `$env:DSH_HOME`（本机为 `F:\dsh-home`）。

### Windows：命令行版

需要 **Node.js 22.19+**，在 PowerShell 中运行：

```powershell
$env:DSH_TAVERN_HOST='cli'; $env:DSH_TAVERN_REPOSITORY='moyutegong/dsh-tavern'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/moyutegong/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

### macOS / Linux：命令行版

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/moyutegong/dsh-tavern@main/install.sh | DSH_TAVERN_REPOSITORY=moyutegong/dsh-tavern DSH_TAVERN_HOST=cli sh
```

### Android（DSHA）

在 DSHA 终端运行：

```bash
DSH_TAVERN_REPOSITORY='https://github.com/moyutegong/dsh-tavern.git' DSH_TAVERN_TARBALL_URL='https://codeload.github.com/moyutegong/dsh-tavern/tar.gz/refs/heads/main' node -e "fetch('https://cdn.jsdelivr.net/gh/moyutegong/dsh-tavern@main/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

安装失败时重跑同一命令即可：已安装时覆盖更新程序文件，人物卡、聊天和设置都会保留。

## 更新

推荐 **重新运行上面的安装命令**：它会从本 fork 覆盖更新程序文件，人物卡、聊天和设置全部保留。

> ⚠️ 安装器与内置更新检查的默认仓库地址随上游回滚指向 `flizzywine/dsh-tavern`，酒馆界面里的「更新到最新版」按默认地址会拉到上游 0.1.5 代码。fork 用户请始终通过上面的安装命令（携带 `DSH_TAVERN_REPOSITORY` 等变量）更新。

## 桌面侧边栏启动（dsh-tavern-launcher）

把「启动 Tavern」放进桌面版侧边栏，在 DSH 终端执行：

```bash
dsh plugin --profile desktop add link:<本仓库路径>/desktop-launcher --registry https://registry.npmjs.org
```

装好后侧边栏「+」菜单出现 **Tavern**，可一键启动 / 停止服务，或在新窗口打开酒馆。实现说明见 [desktop-launcher/README.md](desktop-launcher/README.md)。

- 只硬依赖 `webServer`；信任主机列表按 `webRuntime → connection → webStartup` 顺序软取，所以 0.2.0 与 0.2.1 宿主都能用。
- 默认监听 `127.0.0.1:3081`，启动后给出带 token 的地址；token 每次重启都会变。

## 0.2.1-rc.2 适配了什么

1. **版本闸**：`config/dsh-compatibility.json` 的 `adaptedDshVersion` / `recommendedDesktopVersion` 升到 `0.2.1-rc.2`，安装器按宿主实际版本放行。
2. **CLI 运行时锁**：`config/cli-runtime` 的 manifest 与锁重建到 0.2.1-rc.2（`npm install --package-lock-only` 从空目录生成，每个 `@deepseek-ai/*` 覆盖都跟随同一版本）。
3. **dsh-better-sidebar 0.26.0 → 0.28.0**：0.26 的宿主半边 `inject` 里含 `webRuntime`，而 0.2.1 宿主已没有这个服务，插件会停在 `pending (waiting for service: webRuntime)`；0.28 改用 `connection`，能在 0.2.1 正常挂载。同时删除 `patches/dsh-better-sidebar@0.26.0.patch`（0.28 已内含 `session/end-seed` 线程边界修复，补丁不再适用）。
4. **webRuntime 服务消失**：0.2.1 的 `@deepseek-ai/dsh-web-app` 只 provide `webApp`，可信主机列表挪到 `connection.trustedHosts` 与 `webStartup.trustedHosts`。本仓库的 `dsh-dream-skin` 因此只硬依赖 `webServer`，运行时按 `webRuntime → connection → webStartup` 顺序取 `trustedHosts`（取不到时按空列表处理，仅收紧非回环访问）。
5. **沿用 0.2.0 那轮的适配**：会话 API 兼容垫层、preset 声明模型、v4 存档回合边界（开局回合预留 / 回合外 surface 替换专用回合 / 回退修复）、MVU 初始变量重跑、asar 宿主布局解析。

自检（本机）：`node bin\dsh-tavern.mjs status` 应显示运行中；日志 `F:\dsh-home\logs\tavern.log` 里不应再出现 `did not activate`。

## 与上游的差异（累计）

- **宿主版本**：适配 DSH **0.2.1-rc.2**（上游 README 主线仍是 0.1.5-rc.2 / DSH Desktop 2.0.13）。
- **依赖与补丁**：依赖清单、pnpm-lock、cordis patch、preset 声明模型按 0.2.1 重建（better-sidebar 0.28.0 / pocket 2.11.0 / web-mobile 3.1.0，仅保留 pocket 与 web-mobile 的补丁）。
- **webRuntime 兼容层**：`dsh-dream-skin` 去掉对 `webRuntime` 的硬依赖，改为软取可信主机列表（见上节第 4 点）。
- **会话层适配**：0.2.0 会话 API 兼容垫层、新建会话就绪判据、Session 列表基线同步、消息源 producer-owned kind 迁移。
- **存档兼容**：MVU 初始变量重跑、开局回合并预留与闭合、回合外 surface 替换专用回合、回退存档的 v4 损坏修复。
- **asar 宿主布局**：安装器与 CLI start 路径按桌面 asar 布局解析宿主依赖；脱离态系统 Node 下用 dsh shim 定位宿主根。asar 内只读归档无法打字号上限补丁，安装器会跳过。
- **Windows 专属**：本 fork 只维护 Windows / macOS / Linux / Android 的安装入口，已删除 Android 专属与 Linux/mac 打开器的冗余测试。
- **仓库地址**：默认安装与更新入口与上游一致（`flizzywine/dsh-tavern`）；fork 安装需显式指定 `DSH_TAVERN_REPOSITORY=moyutegong/dsh-tavern`。

## 已知限制

- **桌面版没有 Profile 切换器**：`app.asar/lib/main.js` 把 profile 固定为 `profiles/desktop`，桌面宿主只启动这一个 profile。酒馆以独立 `profiles/tavern` 安装，需要用 `dsh-tavern-launcher` 或 `dsh-tavern start` 显式启动。
- **宿主不再提供 `webRuntime`**：仍硬依赖它的旧版插件会停在 pending，需升级到用 `connection` 的版本（如 better-sidebar ≥ 0.28），或使用本仓库改动过的 `dsh-dream-skin`。
- **严格版本闸**：宿主每一次升级都要同步改 `config/dsh-compatibility.json` 与 `config/cli-runtime` 锁，否则安装器会拒绝安装。

## 许可

本 fork 继承上游项目许可，见 [LICENSE](LICENSE)。
