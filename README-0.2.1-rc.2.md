# DSH 0.2.1-rc.2 适配分支

本分支基于 [PR #216](https://github.com/flizzywine/dsh-tavern/pull/216)，目标宿主为 **DSH 0.2.1-rc.2**。这不是 Tavern 的正式版本发布。

- 预设迁移为宿主的 agent-preset 声明，客户端使用新的会话选择与保留 API。
- 会话消息采用 v4 来源格式，开局和正文替换按回合、步骤写入。
- Desktop 安装器支持 app.asar 布局；Windows 使用 Electron Node 启动宿主 CLI。
- 会话与子进程补丁按 0.2.1-rc.2 校验，补丁只作用于内存，宿主文件保持原样。
- 标准插件包内置侧栏及 Web 配置同步到目标宿主。
- 保留原项目的 Android、macOS、Linux 测试；旧版 DSHA 0.1.5-rc2 不满足本分支的宿主要求，请继续使用原版 Tavern。

## 本地验证

在本分支工作区安装依赖：

```sh
pnpm install --frozen-lockfile
pnpm --dir tavern-plugin install --frozen-lockfile
npm ci --prefix config/cli-runtime --no-audit --no-fund
```

指定独立测试宿主运行相关测试，不接触现有 Desktop 数据：

```sh
DSH_BOOT_MODULE="$PWD/config/cli-runtime/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js" \
TAVERN_DSH_RUNTIME="$PWD/config/cli-runtime" \
node bin/test-tavern.mjs tests/host-session-patch.test.mjs tests/plugin-package.test.mjs tests/session-compat.test.mjs tests/session-log-repair.test.mjs
```

本分支尚未发布；主分支安装命令不会安装本分支代码。Desktop 侧栏启动器用法见 [desktop-launcher/README.md](desktop-launcher/README.md)。
