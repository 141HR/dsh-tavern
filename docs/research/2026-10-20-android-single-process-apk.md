# Android 单进程 APK：构建与待验收记录

日期：2026-10-20
范围：`main` 的独立 APK（DSHA v0.2.0-rc2 + DSH 0.2.0-rc.2）

## 结论

独立 APK 把原生层固定为 `tavern` Profile（端口 3080），不再启动 DSHA 的 `web` / `user`
Profile，因此手机上只有一个 DSH 常驻进程。构建、签名和静态检查已完成；**真机/模拟器上的
内存对比与首次安装验收尚未执行**，本文不声称已通过运行验收。

## 构建身份

| 项 | 值 |
| --- | --- |
| DSHA 源码 | `8362bba747fcf84c19e436c3dbb594a0fc388a67`（v0.2.0-rc2） |
| 官方 APK SHA-256 | `1fedf883d431af658d89c28b86d85974cc1d11b74e0c5d46ef3d3cf8650b1961`（与 release 校验文件一致） |
| 酒馆版本 | 3.0.0（`versionCode` 30000） |
| 包名 | `io.github.flizzywine.dshtavern.standalone` |
| 构建产物 | `output/android-apk-020/dsh-tavern-android-release.apk` |
| 产物 SHA-256 | `e417e953586aebf24635377604b3453a0241da67db985cb2b6758bad52dc8d8b` |
| 签名证书 SHA-256 | `D6:B8:B0:C7:25:BE:51:41:58:AF:97:4B:04:27:92:26:2E:CD:6E:97:47:06:89:95:24:2F:EE:30:55:59:E4:8D` |

产物由 `TAVERN_APK_MODE=Release TAVERN_APK_SKIP_TESTS=1 bash android/apk/build.sh` 生成。
`TAVERN_APK_SKIP_TESTS=1` 只用于本次沙箱：上游两个单测依赖可写符号链接和自由端口，在本机
必然失败（`AdbWheelPathsTest`、`WebPortPolicyTest`），与本方案改动无关；Debug 构建的其余
1330 个单测通过。

## 已做的验证

- APK 清单：包名、`versionCode 30000`、`versionName 3.0.0`、minSdk 30 正确。
- `apksigner verify`：v1/v2/v3 签名有效，证书为酒馆长期密钥（非 DSHA 的 E7E3）。
- 资产：`assets/tavern-apk-setup.sh`、`offline-rootfs.bin`、`dsh-runtime.bin`、
  `runtime-descriptor.json`、`recovery-*`、`es-compat.js` 均在包内；setup 脚本来自
  `main`，末尾追加“停掉安装器临时 3088 服务”。
- 单测：`StartupPipelineTest`、`TavernWebProcessTest` 通过；新增的启动 shell 识别断言覆盖
  `exec dsh --profile 'tavern'` 与 `node /usr/local/bin/dsh --profile tavern`。
- 文档测试与新客户端提示测试通过。

## 待验收（需要设备）

1. MuMu Android 12 与至少一台中端 ARM64 真机：全新安装 → 引导解压 → 自动安装酒馆 → 导入
   人物卡 → 游玩一轮（含 MVU 结算）。
2. `ps -ef | grep -E "dsh|node"`：仅一个 `dsh --profile tavern`，无 3088 常驻；模板/卡脚本
   fork 只在使用时出现。
3. 记录主进程与子进程 RSS，与“DSHA v0.2.0-rc2 + 安装脚本”跑同样操作对比。
4. 应用内更新一次后仍可启动、仍是单进程。
5. 旧数据迁移：从 v2.1 APK（DSH 0.1.5）导出存档/人物卡，在新包导入；两包签名不同，不能
   覆盖升级。
6. 签名密钥离线备份确认后再发布。
