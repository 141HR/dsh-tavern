# DSH Tavern 0.2.0-rc.2 适配版（Fork）

这是 [DSH Tavern](https://github.com/flizzywine/dsh-tavern) 的一个 fork，把宿主适配从 **DSH 0.1.5-rc.2 / DSH Desktop 2.0.13** 迁移到 **DSH 0.2.0-rc.2**，并针对 0.2.0 的会话 API、preset 声明模型、asar 宿主布局等变化做了一轮适配。

> 上游仓库与社区资产保持原样：视频、文档站、Discussions、Discord、徽章图片等仍指向 [flizzywine/dsh-tavern](https://github.com/flizzywine/dsh-tavern)。本文件只说明 **如何从本 fork 安装** 以及 **与上游的差异**。

## 宿主版本要求

| 宿主 | 要求版本 | 说明 |
| --- | --- | --- |
| DSH Desktop（Windows / macOS） | **0.2.0-rc.2** | 内置 DSH 必须完全匹配，否则安装器停止安装。不要先升级 Desktop。 |
| DSH CLI（命令行版） | **0.2.0-rc.2** | 安装器下载固定版本的独立 DSH 运行时，不复用或修改全局 DSH。 |
| DSHA（Android） | **0.1.5-rc2**（内置 DSH 0.1.5-rc.2） | Android 侧沿用上游适配的 DSHA 版本。 |

DSH 下载页面：<https://www.deepseek.com/harness/>；DSHA 历史版本：<https://github.com/DSH-APP/DSHA/releases>。

## 从本 Fork 安装

### Windows：DSH Desktop

1. 安装 [DSH Desktop 0.2.0-rc.2](https://www.deepseek.com/harness/)。
2. 进入 **设置 → 通用设置 → 打开 DSH 终端**，运行：

```powershell
$env:DSH_TAVERN_HOST='desktop'; $env:DSH_TAVERN_REPOSITORY='moyutegong/dsh-tavern'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/moyutegong/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

3. 重启 Desktop，在 **设置 → 桌面设置 → Profile** 选择 **tavern**。

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

> ⚠️ 注意：安装器与内置更新检查的默认仓库地址已随本 fork 的上游回滚改回 `flizzywine/dsh-tavern`，酒馆界面里的「更新到最新版」按默认地址会拉到上游 0.1.5 代码。fork 用户请始终通过上面的安装命令（携带 `DSH_TAVERN_REPOSITORY` 等变量）更新。

## 桌面侧边栏启动（dsh-tavern-launcher）

可以把「启动 Tavern」直接放进桌面版侧边栏，在 DSH 终端执行：

```bash
dsh plugin --profile desktop add link:<本仓库路径>/desktop-launcher
```

侧边栏「+」菜单出现 **Tavern** 后，可一键启动 / 停止服务，或在新窗口打开酒馆。实现说明见 [desktop-launcher/README.md](desktop-launcher/README.md)。

## 与上游的差异

- **宿主版本**：适配 DSH **0.2.0-rc.2**（上游 README 主线为 0.1.5-rc.2 / DSH Desktop 2.0.13）。
- **依赖与补丁**：依赖清单、pnpm-lock、cordis patch、preset 声明模型按 0.2.0-rc.2 重建（better-sidebar 0.26.0 / pocket 2.11.0 / web-mobile 3.1.0 等）。
- **会话层适配**：0.2.0 会话 API 兼容垫层、新建会话就绪判据、Session 列表基线同步、消息源 producer-owned kind 迁移。
- **存档兼容**：MVU 初始变量重跑、开局回合并预留与闭合、回合外 surface 替换专用回合、回退存档的 v4 损坏修复。
- **asar 宿主布局**：安装器与 CLI start 路径按 0.2.0 桌面 asar 布局解析宿主依赖；脱离态系统 Node 下用 dsh shim 定位宿主根。
- **Windows 专属**：本 fork 只维护 Windows / macOS / Linux / Android 的安装入口，已删除 Android 专属与 Linux/mac 打开器的冗余测试。
- **仓库地址**：默认安装与更新入口已回滚为上游 `flizzywine/dsh-tavern`（与上游保持一致）；fork 安装需显式指定 `DSH_TAVERN_REPOSITORY=moyutegong/dsh-tavern`（见上文命令）。上游社区资产（视频、文档站、Discussions）保持 flizzywine 原样。

其余产品功能、使用文档、人物卡兼容性与上游一致，完整说明见[上游 README](README.md) 与[上游文档站](https://flizzywine.github.io/dsh-tavern/)。

## 许可

本 fork 继承上游项目许可，见 [LICENSE](LICENSE)。