# 官方桌面 Profile 桥接（Tavern 兼容版）

基于 [2NF/dsh-profile-bridge](https://github.com/2NF/dsh-profile-bridge) 的 MIT 版本 0.2.0，来源提交 `6917177806fcff7d9def83a881c47f8936a70278`；保留原作者 LICENSE。

官方桌面仍从 `profiles/desktop` 启动，通过目录链接使用 `profiles/tavern`。这不是官方原生 profile 选择器；配置是独立目录，会话、凭据等仍遵循 DSH 的共享数据规则。

两边都安装此插件后，在设置 → 配置档案选择目标，然后在两分钟内正常退出应用。助手等待 GUI 和宿主全部退出再切换；重新打开应用即可。原版 desktop 保存为 `desktop.fresh-*`，可从此设置页还原。

兼容修正：不再修改目标 YAML；不强杀进程；无备份不删除入口；失败恢复原入口；并发请求被 pending 锁拒绝。异常终止遗留的 `profile-bridge/pending` 需先确认助手已退出，再人工检查记录，避免自动抢占未完成操作。

macOS 实机验证结果记录在任务报告；Windows 目录 junction 逻辑暂未实机验证。
