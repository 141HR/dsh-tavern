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
- 允许的宿主版本：官方 DeepSeek Harness **0.2.1-rc.2**（[官网下载](https://deepseek.com/harness/)）、DSHA 内置的 DSH **0.2.0**。其他版本安装器会停止。命令行版自带 DSH，不受此限。

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

1. 安装 [DSHA](https://github.com/DSH-APP/DSHA/releases)，启动一次。
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

## 桌面版：在酒馆与原版之间切换

安装后，官方桌面默认进入酒馆。酒馆和原版 DSH 里都有 **设置 → Profile 切换**：选择「原版 DSH」或「DSH Tavern」，点「立即重启」。

- macOS：桌面版正常退出（有任务时会先请你确认），切换完成后自动重新打开。
- Windows：点「确定」后从托盘退出桌面版，切换完成后自动重新打开。
- 插件不会强制结束进程；两分钟内没有退出，切换自动取消。

需要知道的细节：

- 酒馆装在独立的 `profiles/tavern`，官方桌面的 `profiles/desktop` 入口链接到它。这不是官方原生的 profile 选择器。
- 每次安装都会完整备份配置目录到 `.dsh/backups/profile-bridge-install-*`，原版配置另存为 `profiles/desktop.fresh-*`，供切换回原版时还原。**不要删除这些目录。**
- 存档正文、历史和附件不随切换搬动；配置独立不代表账号或全部宿主数据隔离。
- 旧测试版占用了 `desktop` 时，安装器会把酒馆配置复制到 `tavern`，并寻找原版配置的备份；找不到时停止安装，不覆盖现有配置，需要先恢复原版 desktop 备份再重试。
- 安装失败会恢复之前的入口和目录，失败现场和备份都会保留；中断的安装在下次运行时自动恢复。
- 重新运行安装命令即可更新。实现细节见 [桥接插件说明](tavern-plugin/packages/dsh-profile-bridge/README.md)。

## 从旧酒馆继承数据

稳定版桌面和官方桌面默认共用同一个 `.dsh` 目录，这种情况不需要迁移。

需要迁移的情况：旧的**命令行版**（通常在 `~/.dsh-tavern`），或装在**自定义目录**的旧酒馆。旧目录要选**包含 `profiles` 和 `profile-data` 的 DSH 主目录**，不是 `apps/dsh-tavern` 程序目录，也不是单独的 `data` 子目录。

先运行旧酒馆的 `dsh-tavern stop`，并完整退出官方桌面，再按系统执行下面的命令（把示例里的旧目录换成实际路径）。测试版已经装好也可以执行，用来补做迁移。

macOS：

```sh
curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.sh' -o /tmp/dsh-tavern-testing-install.sh && DSH_TAVERN_IMPORT_HOME="$HOME/.dsh-tavern" DSH_TAVERN_HOST=desktop sh /tmp/dsh-tavern-testing-install.sh
```

自定义目录示例：把 `"$HOME/.dsh-tavern"` 改成 `"/Volumes/Games/旧酒馆"`。

Windows PowerShell：

```powershell
$env:DSH_TAVERN_IMPORT_HOME=Join-Path $HOME '.dsh-tavern'
$env:DSH_TAVERN_HOST='desktop'
try {
  $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.ps1'))
  Invoke-Expression $tavernInstaller
} finally { Remove-Item Env:DSH_TAVERN_IMPORT_HOME -ErrorAction SilentlyContinue }
```

自定义目录示例：把第一行改成 `$env:DSH_TAVERN_IMPORT_HOME='D:\Games\旧酒馆'`。`DSH_TAVERN_IMPORT_HOME` 指向旧目录；**不要把 `DSH_HOME` 改成旧目录**，迁移目标始终是官方桌面的 `.dsh`。

迁移会做什么：

- **复制的内容**：酒馆数据、原生会话日志、人物卡、正文和历史版本、变量、附件、用户工具和 Skill、预设，以及旧的模型和账号配置。旧版放在程序旁 `data` 目录或配置里 `dataRoot` 指定位置的数据也会一并收集。
- **不复制的内容**：旧 Node.js、宿主运行时和 `node_modules`。旧目录只读保留。第三方插件引用的外部绝对路径需要保持可访问，换机器时要单独重装。
- **先备份再写入**：写入前备份双方数据，并逐个文件校验 SHA-256。备份在目标 `.dsh/backups/tavern-home-import/`（安装日志会显示具体路径），里面有 `source`、`target` 和迁移记录。备份含账号配置，请妥善保管。
- **冲突时停止**：模型和账号配置以旧目录为准，目标原有配置存进 `target` 备份。目标里不冲突的存档继续保留；同名但内容不同的存档、附件或预设会让迁移停止，不会自动混合故事历史。遇到冲突，请对照日志和双方备份决定保留哪份，或在原酒馆导出后用酒馆的导入功能处理，不要直接覆盖文件。符号链接和特殊文件也会让迁移停止，需先整理成普通文件。
- **失败可恢复**：迁移失败会回滚已替换的数据；中途中断后再次执行同一命令，会先恢复中断现场。同一旧目录迁移成功后再执行，不会覆盖测试版里的新进度。
- **之后还要迁移存档格式**：目录迁移完成后打开旧存档，在「酒馆状态」里执行格式迁移，见下一节。

## 更新与存档迁移

- 测试版的「检查更新」只跟随 `0.2.1版本` 分支，也可以重新运行本页的安装命令。稳定版仍跟随 `main`，不会自动切到测试版。
- 打开旧存档，在「酒馆状态」里点击「迁移存档」并等待完成。正文、变量、分支和历史版本都会保留，完成后迁移入口自动隐藏。
- 回到稳定版时，使用测试前的备份或导出的存档，并安装稳定版对应的宿主。不要让旧宿主直接读取迁移后的数据目录。

## 测试反馈

请在 [Issues](https://github.com/flizzywine/dsh-tavern/issues) 提交，标题注明「0.2.1 测试版」，附上系统、宿主（官方桌面 / DSHA / 命令行）及其版本、酒馆提交号、复现步骤和错误截图。优先验证：安装与更新、旧存档迁移、正文及历史版本、MVU 状态栏、候选项和后台结算。

适配工作基于 [PR #216](https://github.com/flizzywine/dsh-tavern/pull/216)。测试分支与 `main` 独立推进，暂未包含主线的全部新功能。
