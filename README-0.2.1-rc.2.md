# DSH Tavern 测试版安装

测试版适配 DSH 0.2.x，不提供一键安装包，直接装在你自己的 DSH 上。稳定版见 [README 快速开始](README.md#快速开始)。

| 系统 | 安装方式 |
| --- | --- |
| [Windows](#windows) | 官方桌面版，或命令行版（浏览器使用） |
| [安卓](#安卓dsha) | DSHA |
| [macOS](#macos) | 官方桌面版，或命令行版（浏览器使用） |
| [Linux](#linux) | 命令行版（浏览器使用） |

## 开始之前

- 先备份 `.dsh` 目录，并完整退出桌面版和旧酒馆。
- 允许的宿主版本：官方 DeepSeek Harness **0.2.1-rc.2**（[官网下载](https://deepseek.com/harness/)）、DSHA **v0.2.0-rc2**（内置 DSH 0.2.0-rc.2）。其他版本安装器会停止。命令行版自带 DSH，不受此限。

## Windows

### 方式一：官方桌面版

1. 安装 DeepSeek Harness 0.2.1-rc.2，启动一次后从托盘退出。
2. 打开 PowerShell（支持 Windows PowerShell 5.1），粘贴执行：

   ```powershell
   $env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.ps1')); Invoke-Expression $tavernInstaller
   ```

3. 安装成功后重新打开 DeepSeek Harness，即进入酒馆。

无需另装 Node.js。切回原版 DSH 见 [桌面版：在酒馆与原版之间切换](#桌面版在酒馆与原版之间切换)。

### 方式二：命令行版（浏览器使用）

需要 Node.js 22.19+ 和 pnpm，不需要官方桌面。打开 PowerShell，粘贴执行：

```powershell
$env:DSH_TAVERN_HOST='cli'
$env:DSH_TAVERN_CLI_HOME=Join-Path $HOME '.dsh-tavern-testing'
$tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.ps1'))
Invoke-Expression $tavernInstaller
```

用法见 [命令行版：启动与管理](#命令行版启动与管理)。

## 安卓（DSHA）

1. 安装 [DSHA v0.2.0-rc2](https://github.com/DSH-APP/DSHA/releases/tag/v0.2.0-rc2)，启动一次。
2. 打开底部 **终端**，粘贴执行：

   ```sh
   curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/android/setup.sh' -o /tmp/dsh-tavern-testing-setup.sh && bash /tmp/dsh-tavern-testing-setup.sh
   ```

3. 看到 **全部完成** 后重启 DSHA，点击 **启动** → **进入** → **酒馆工作台**。

## macOS

### 方式一：官方桌面版

1. 安装 DeepSeek Harness 0.2.1-rc.2，启动一次后退出（⌘Q）。
2. 打开「终端」，粘贴执行：

   ```sh
   curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.sh' -o /tmp/dsh-tavern-testing-install.sh && DSH_TAVERN_HOST=desktop sh /tmp/dsh-tavern-testing-install.sh
   ```

3. 安装成功后重新打开 DeepSeek Harness，即进入酒馆。

无需另装 Node.js。切回原版 DSH 见 [桌面版：在酒馆与原版之间切换](#桌面版在酒馆与原版之间切换)。

### 方式二：命令行版（浏览器使用）

需要 Node.js 22.19+ 和 pnpm，不需要官方桌面。打开「终端」，粘贴执行：

```sh
curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.sh' -o /tmp/dsh-tavern-testing-install.sh && DSH_TAVERN_HOST=cli DSH_TAVERN_CLI_HOME="$HOME/.dsh-tavern-testing" sh /tmp/dsh-tavern-testing-install.sh
```

用法见 [命令行版：启动与管理](#命令行版启动与管理)。

## Linux

官方桌面没有 Linux 版，使用命令行版。需要 Node.js 22.19+ 和 pnpm：

```sh
curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.sh' -o /tmp/dsh-tavern-testing-install.sh && DSH_TAVERN_HOST=cli DSH_TAVERN_CLI_HOME="$HOME/.dsh-tavern-testing" sh /tmp/dsh-tavern-testing-install.sh
```

用法见 [命令行版：启动与管理](#命令行版启动与管理)。

---

## 命令行版：启动与管理

| 命令 | 作用 |
| --- | --- |
| `dsh-tavern start` | 启动，按输出的地址在浏览器打开 |
| `dsh-tavern stop` | 停止 |
| `dsh-tavern status` | 查看状态 |
| `dsh-tavern update` | 更新 |

如果提示找不到 `dsh-tavern` 命令，进入安装目录下的 `apps/dsh-tavern`，改用 `node bin/dsh-tavern.mjs start`。

- 命令行版自带锁定的 DSH 0.2.1-rc.2，不修改全局 DSH。
- 数据放在专用目录 `.dsh-tavern-testing`，与官方桌面的 `.dsh` 分开。
- 首次安装会复制默认 `.dsh` 里的旧命令行酒馆数据（只识别标记为命令行版的配置），源数据保留；之后两套数据各自变化，不会自动同步。旧数据在自定义目录时，设置 `DSH_TAVERN_LEGACY_DSH_HOME` 指向它，复制前先停止旧酒馆。
- 已有稳定版命令行酒馆时，`dsh-tavern` 命令会被测试版替换（原入口有备份）。两版都要用时，分别进入各自安装目录运行 `node bin/dsh-tavern.mjs`。

## 桌面版：切回原版

设置 → Profile 切换 → 选「原版 DSH」→ 立即重启。不要删除 `.dsh/backups` 和 `profiles/desktop.fresh-*`，切回原版要用到。细节见 [桥接插件说明](tavern-plugin/packages/dsh-profile-bridge/README.md)。

## 从旧酒馆继承数据

桌面版共用 `.dsh`，命令行版首次安装会自动复制默认位置的旧数据，一般不用管。旧酒馆在**自定义目录**时，先停止旧酒馆，把下面命令里的 `.dsh-tavern` 换成旧的 DSH 主目录（含 `profiles`、`profile-data` 的那一层）：

macOS：

```sh
curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.sh' -o /tmp/dsh-tavern-testing-install.sh && DSH_TAVERN_IMPORT_HOME="$HOME/.dsh-tavern" DSH_TAVERN_HOST=desktop sh /tmp/dsh-tavern-testing-install.sh
```

Windows PowerShell：

```powershell
$env:DSH_TAVERN_IMPORT_HOME=Join-Path $HOME '.dsh-tavern'
$env:DSH_TAVERN_HOST='desktop'
try {
  $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.ps1'))
  Invoke-Expression $tavernInstaller
} finally { Remove-Item Env:DSH_TAVERN_IMPORT_HOME -ErrorAction SilentlyContinue }
```

迁移前会备份双方数据，遇到冲突即停止。详见 [数据继承说明](docs/data-import.md)。

## 更新与存档迁移

- 测试版的「检查更新」只跟随 `0.2.1版本` 分支，也可以重新运行本页的安装命令。稳定版仍跟随 `main`，不会自动切到测试版。
- 打开旧存档，在「酒馆状态」里点击「迁移存档」并等待完成。正文、变量、分支和历史版本都会保留，完成后迁移入口自动隐藏。
- 回到稳定版时，使用测试前的备份或导出的存档，并安装稳定版对应的宿主。不要让旧宿主直接读取迁移后的数据目录。

## 测试反馈

请在 [Issues](https://github.com/flizzywine/dsh-tavern/issues) 提交，标题注明「0.2.1 测试版」，附上系统、宿主（官方桌面 / DSHA / 命令行）及其版本、酒馆提交号、复现步骤和错误截图。优先验证：安装与更新、旧存档迁移、正文及历史版本、MVU 状态栏、候选项和后台结算。

适配工作基于 [PR #216](https://github.com/flizzywine/dsh-tavern/pull/216)。测试分支与 `main` 独立推进，暂未包含主线的全部新功能。
