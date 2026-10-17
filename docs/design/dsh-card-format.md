# DSH 人物卡格式（.dshcard）

2026-10-17 设计备忘，待确认后实施。相关：[从酒馆到 Galgame](tavern-to-galgame.md)、[角色演出](cast-presentation.md)、[插件接口](../plugin-api.md)。

## 为什么要专属格式

之前的结论是"沿用 CCv3/CHARX，不另起格式"。现在改为**专属格式，兼容 CHARX**，原因是新的人物卡可能带程序代码，以 DSH 插件的形式存在：

- **数据和软件要分开**：CHARX 是数据，导入只是读文件；带插件的卡是软件，DSH 插件在宿主侧能读写本机文件、联网，没有沙箱。用不同的后缀，用户、Tavern 和其他工具一眼就能区分"这张卡会运行代码"。
- **CHARX 放不下随卡分发需要的东西**：插件代码、需要的接口版本、权限说明、卡的唯一标识与版本（用于更新）、大体积素材与共用素材包。
- **不能冒充 CHARX**：卡里塞进代码还叫 `.charx`，RisuAI 等前端会默默忽略，用户以为导入的只是数据。

**兼容**：`.dshcard` 内部就是一个 CHARX。改后缀为 `.charx` 后，其他前端照样能当普通卡打开（文字设定、头像、表情、背景都在标准位置）。Tavern 也能把 `.dshcard` 降级导出为 CHARX（去掉代码和扩展素材）。

## 文件结构

ZIP 压缩包，后缀 `.dshcard`：

```
大肥鱼.dshcard
├─ card.json              Character Card V3，和 CHARX 完全相同（含 data.assets、酒馆助手脚本）
├─ assets/…               CCv3 标准素材：icon / emotion / background，路径同 CHARX
├─ dsh.json               DSH 清单（见下）
├─ plugins/<插件名>/      随卡 DSH 插件：package.json、index.mjs、client.js、assets/
├─ dsh/assets/<归属>/…    扩展素材：Live2D、分层立绘、多套服装、音乐、音效……
└─ dsh/packs/<包 id>.zip  （可选）随卡附带的共用素材包，也可以只在清单里写下载地址
```

规则：
- `card.json` 必须能单独成立：去掉其他所有文件，它仍是一张合法的 CCv3 卡。
- 文件路径只用 ASCII，大小写敏感，`/` 分隔（同 CHARX）。
- 支持 ZIP64，单个文件、整个包都可以超过 4 GB 的 ZIP32 限制；Tavern 边读边解压，不整包读进内存。

### `dsh.json`

```json
{
  "format": "dshcard",
  "formatVersion": 1,
  "card": { "id": "c0ffee00-…", "version": "1.2.0", "title": "大肥鱼" },
  "requires": { "tavernApi": 2 },
  "plugins": [
    { "name": "dafeiyu-director", "path": "plugins/dafeiyu-director", "version": "1.0.0",
      "sides": ["host", "browser"], "sha256": "…",
      "purpose": "每轮编排舞台：背景、音乐、立绘与镜头",
      "uses": ["runAgent", "network:api.example.com", "cardAssets"] }
  ],
  "assets": [
    { "owner": "tavern.cast", "path": "dsh/assets/tavern.cast/manifest.json" },
    { "owner": "plugin:dafeiyu-director", "path": "dsh/assets/plugin.dafeiyu-director/" }
  ],
  "packs": [
    { "id": "af7b2c46-…", "title": "中国通用背景", "sha256": "…", "bytes": 44360250,
      "path": "dsh/packs/af7b2c46.zip", "url": "https://…/china-backgrounds.zip" }
  ]
}
```

- `card.id`：卡的唯一标识，作者第一次导出时生成，之后不变。导入时同 id 视为**更新**。`version` 给人看，也用来判断新旧。
- `plugins[].sha256`：插件目录内容的摘要，权限确认记在"这个摘要"上，代码一变就要重新确认。
- `plugins[].purpose`、`uses`：给玩家看的用途和用到的能力。**这是声明，不是沙箱**：Tavern 能强制的只有插件接口层面（见下文作用范围），Node 层面的文件和网络访问挡不住，确认界面要如实说明。
- `packs`：共用素材包，多张卡可以共用同一份（例如通用背景、通用 BGM）。按 `sha256` 去重：已经装过的包不重复导入；包里没附带时按 `url` 下载（只接受公开 HTTPS），下载前要玩家确认。

## 三层脚本

一张卡里的代码分三层，越往上能力越强，也越需要信任：

| 层 | 是什么 | 跑在哪 | 导入时 |
|---|---|---|---|
| 1. 酒馆助手脚本 | SillyTavern 生态的现成写法，在 `card.json` 里 | 浏览器沙箱 iframe（现有机制） | 不用确认 |
| 2. 沙箱里的 DSH 能力 | 第 1 层脚本里多出的 `DSH` 对象：读台词标注和舞台数据、朗读、读本卡素材 | 同上 | 不用确认 |
| 3. 随卡 DSH 插件 | `plugins/` 下的完整插件 | 宿主 Node + 浏览器 | **必须确认** |

给卡作者的分工建议：界面和每条消息的逻辑写在第 1、2 层；需要宿主能力的（后台推演、生图、联网、存大文件、结算任务）写在第 3 层。很多卡只想"念台词、换立绘"，第 2 层就够，玩家不用面对确认弹窗。

**沙箱与本卡插件之间的通道**：第 1、2 层脚本用 `DSH.callCardPlugin(名字, 参数)` 调用本卡插件以 `tavern.handle` 注册的处理函数；插件用 `tavern.emitToCard({ gameId, name, data })` 往这张卡的沙箱推事件，脚本用 `DSH.onCardPlugin(名字, 处理函数)` 接收。通道只连本卡自己的插件，别的插件调不到，也收不到。这样一张卡可以是"沙箱里画界面、插件在后台干活"。

导出成 CHARX 时只保留第 1 层（它在 `card.json` 里），在 ST、RisuAI 里照样能跑；第 2 层的调用在那里不存在，脚本要自己判断 `typeof DSH`。

## 随卡插件

### 作用范围：只在这张卡的局里生效

- 随卡插件和用户全局安装的插件是两种来源。全局插件不变。
- 随卡插件照常注册（`settlementTask`、`registerStageView`……），但 Tavern 在插件接口层按卡限制：
  - 回调（`onTurnSettled`、结算任务、提示词段落等）只对这张卡的局触发；
  - 主动调用（`getTurn`、`saveTurnData`、`runTask`……）带别的局的 `gameId` 一律拒绝；
  - 浏览器侧注册的界面（面板、舞台画面、正文标记）只在打开这张卡的局时出现；
  - 人物卡库接口（`listCards`、`updateCardRaw`）只能读写本卡。
- 插件名在 Tavern 内部加上卡的前缀（例如 `card:<card.id>/dafeiyu-director`），避免和全局插件、其他卡的插件重名。
- 同一张卡被导入两份（不同 id）时，各自的插件互不相干。

### 确认流程

1. 导入 `.dshcard`：先解包、校验，列出卡名、版本、作者、插件（名称、用途、用到的能力、宿主侧还是浏览器侧、代码大小）、素材大小、要下载的素材包。
2. 玩家三选一：**导入并启用插件** / **只导入卡和素材**（插件保存但不启用，之后可在人物卡详情里启用）/ 取消。
3. 确认结果记在本机，按 `card.id + 插件名 + sha256`。
4. 没有插件的 `.dshcard` 不弹确认，和导入 CHARX 一样。

### 更新

- 导入同 `card.id` 的卡：提示"更新 大肥鱼 1.1.0 → 1.2.0"。
- 存档保留；卡文本、素材、插件替换为新版。
- 插件摘要变了要重新确认；确认前新版插件不启用，旧版也不再运行（不混用版本）。
- 导入较旧版本时提示降级，由玩家决定。

### 卸载

删除人物卡时，随卡插件一并卸载，素材按引用计数清理（共用素材包还有别的卡在用就保留）。

## 存储层

不论格式怎么定，"插件写素材、存大文件"都要靠这一层。

- **全局内容寻址仓库**：所有素材文件按 SHA-256 存一份（`blobs/ab/cd…`），多张卡、多个插件引用同一文件不重复占空间。
- **按卡、按归属的清单**：每张卡一个清单，记录"归属 → 路径 → 文件摘要 + 类型 + 元数据"。归属有 `tavern.cast`（现在的角色素材）、`plugin:<名字>`、`pack:<id>`。现有的 `cast-assets/<卡>/` 迁移到这里。
- **共用素材包**：作为独立对象存在，卡在清单里引用包 id。
- **读取**：`/api/dsh-tavern/card-blob?…` 支持 Range，可缓存，音频、视频、Live2D 能边下边播。
- **写入**：大文件走流式上传，不再整个转成 base64 放进请求。
- **容量**：每张卡（不含共用包）先定 1 GB 上限；共用包单独计。超出时拒绝并说明。
- **清理**：删卡、更新后，没有引用的文件进入待清理，延迟删除（避免误删正在导入的文件）。

### 插件接口（宿主侧）

```js
await ctx.tavern.putCardAsset({ gameId /* 或 card */, path: 'live2d/maid/model.json', data /* Buffer 或流 */, mediaType, meta })
await ctx.tavern.listCardAssets({ gameId, prefix: 'live2d/' })   // [{ path, size, mediaType, meta, url }]
await ctx.tavern.removeCardAsset({ gameId, path })
await ctx.tavern.saveCastImage({ gameId, name, slot /* 'avatar' | 情绪名 */, data })  // 写角色素材，和玩家上传同一条路
await ctx.tavern.saveCastBackground({ gameId, name, data, main })
await ctx.tavern.setCastVoice({ gameId, name, provider, voice })
```

- 插件只能读写自己的归属；角色素材（`tavern.cast`）可以写，但走 Tavern 的校验（图片格式、大小）。
- 随卡插件只能写本卡；全局插件写哪张卡由 `gameId` 决定，玩家在本局关闭了插件时拒绝。
- 浏览器侧拿 `url` 直接用。

## 和现有格式、Galgame 分支的兼容

- PNG、JSON、CHARX 照常导入；CHARX 的处理不变（见 tavern-to-galgame.md）。
- `extensions.dsh_tavern`：Tavern 已经在用 `cast`；Galgame 分支用了 `schemaVersion`、`assetBindings`（绑定素材包）、`openings`（开场画面）、`stage`（皮肤等）。导入时原样保留不认识的键，导出时不覆盖。`assetBindings.boundPackIds` 和 `dsh.json` 的 `packs` 表达的是同一件事，以后可以互相转换。
- 导出：人物卡库「导出」提供三种：JSON、CHARX（无代码、只带 CCv3 能放的素材）、DSH 人物卡（全部）。

## 验证用例：大肥鱼

Galgame 分支的示例卡「大肥鱼」（卡包约 262 MB：三套服装、情绪差分、分层立绘、三个 Live2D 模型、两套舞台皮肤，绑定中国通用背景、通用 BGM、通用音效三个素材包）。改造成 `.dshcard` 用来检验格式是否够用：

- 卡文本 → `card.json`；封面 → `assets/icon`；主服装的情绪差分 → `assets/emotion`。
- 多套服装、分层立绘、Live2D、皮肤 → `dsh/assets/plugin.<galgame 插件>/`。
- 三个通用素材包 → `packs`（附带或给下载地址）。
- 导演、舞台、音频 → 一个随卡插件（或一个全局的 Galgame 插件 + 卡里只放素材和配置，这两种组织方式都应该能表达）。

改造时发现格式放不下的东西，回来补这份文档。

## 实施步骤

每一步单独提交，相关测试和 e2e 通过。

1. **存储层**：全局内容寻址仓库、按卡清单、Range 读取、流式上传、容量与清理；`cast-assets` 迁移进来。行为不变。
2. **插件写素材的接口**：`putCardAsset` 等；文档与示例。
3. **`.dshcard` 读写**：ZIP64、流式解压；`dsh.json` 校验；导入（不含插件）与三种导出；共用素材包去重与下载确认。
4. **随卡插件**：加载、按卡限制、确认流程、更新与卸载。
5. **三层脚本的通道与沙箱 DSH 能力**。
6. **大肥鱼改造**：作为验收用例和给卡作者的示范。

## 待定

- 后缀名：`.dshcard` 暂定。
- 签名：是否支持作者签名，让"同一作者的更新"免于重复确认。第一版不做。
- 随卡插件能否依赖全局插件，或依赖 npm 包（第一版：只能用宿主已有的模块，和用户插件规则相同）。
- 素材包的独立分发与更新（脱离卡单独升级），第一版只做"随卡带入、按摘要去重"。
