# 插件开发：发布与一键安装

## 一句话

把插件文件夹放到 GitHub 上，做成一个**公开仓库**，就算发布了。别人在酒馆的 **设置 → DSH Tavern → 插件** 里粘贴你的仓库地址，点「安装」，刷新页面就能用。

## 仓库长这样

仓库首页直接就是插件的文件，不要再套一层文件夹：

```text
dsh-tavern-hello/          ← GitHub 仓库
├─ package.json            ← 必须有
├─ index.mjs               ← 插件的后台部分（必须有，只做界面也放一个空的）
├─ client.js               ← 插件的界面部分（可选）
├─ assets/                 ← 图片、音效等（可选）
└─ README.md
```

`package.json` 照这个写，改掉名字、版本和说明即可：

```json
{
  "name": "dsh-tavern-hello",
  "version": "1.0.0",
  "description": "一句话说明这个插件做什么",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.mjs", "./client": "./client.js" },
  "dsh": { "client": { "platform": "web", "inject": ["dsh-tavern-plugin"] } }
}
```

用户在插件列表里看到的名字、版本和说明，就是这里的 `name`、`version`、`description`。`"platform": "web"` 照写，不用分平台：桌面版、安卓 DSHA、命令行版的界面都是同一套网页，一份 `client.js` 三处通用。没有 `client.js` 时，去掉 `"./client"` 和整个 `dsh` 字段。每个文件里写什么，见[接口参考](plugin-api.md)的「快速开始」。

## 发布前查三件事

1. **`package.json` 里没有 `dependencies`。** 一键安装不会帮用户下载 npm 包。用到了第三方库，就把库的代码直接放进仓库（或者连同 `node_modules` 一起提交）；否则用户安装时会看到「依赖 npm 包，暂不支持一键安装」。
2. **用户的设置不存在插件文件夹里。** 用户点「更新」时，整个插件文件夹会被换成新版（旧版移到 `plugin-backups`），存在里面的设置就丢了。设置存到浏览器本地（`localStorage`），或用 Tavern 的存档数据接口。
3. **仓库是公开的。** 私有仓库别人下载不了。

## 发新版本

- **不发 Release 也行**：别人装到的是仓库的最新代码，点「更新」也是拉最新代码。
- **想让别人只装稳定版**：先把 `package.json` 的 `version` 改大并提交，再到 GitHub 仓库页面 → Releases → Draft a new release，新建一个 tag（比如 `v1.1.0`），点 Publish。之后安装和「更新」都只取最新的 Release，平时在默认分支上改代码不影响用户。

## README 的「安装」一节

照抄下面这段即可，不用再教用户找数据目录：

```markdown
## 安装

需要 DSH Tavern 最新版。打开酒馆 → 设置 → DSH Tavern → 插件，粘贴本仓库地址，点「安装」，刷新页面。
连不上 GitHub 时，在本页下载 ZIP（Code → Download ZIP），在同一处点「上传 ZIP」。
```

## 发出去之前，自己先装一次

在自己的酒馆里，按上面 README 的步骤，粘贴你的仓库地址装一遍。插件列表里显示「已加载」，并且一局游戏里功能正常，别人也就能装。显示「加载失败」时，列表会写出原因；装不上时，安装框下面会提示缺了什么。
