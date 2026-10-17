# DSH 人物卡格式（.dshcard）

2026-10-17 设计备忘，待确认后实施。相关：[从酒馆到 Galgame](tavern-to-galgame.md)、[角色演出](cast-presentation.md)、[插件接口](../plugin-api.md)。

## 为什么要专属格式

之前的结论是"沿用 CCv3/CHARX，不另起格式"。现在改为**专属格式，兼容 CHARX**，原因是新的人物卡可能带程序代码，以 DSH 插件的形式存在：

- **数据和软件要分开**：CHARX 是数据，导入只是读文件；带插件的卡是软件，DSH 插件在宿主侧能读写本机文件、联网，没有沙箱。用不同的后缀，用户、Tavern 和其他工具一眼就能区分"这张卡会运行代码"。
- **CHARX 放不下随卡分发需要的东西**：插件代码、需要的接口版本、权限说明、卡的唯一标识与版本（用于更新）、大体积素材与共用素材包。
- **不能冒充 CHARX**：卡里塞进代码还叫 `.charx`，RisuAI 等前端会默默忽略，用户以为导入的只是数据。

**兼容**：`.dshcard` 内部就是一个 CHARX。改后缀为 `.charx` 后，其他前端照样能当普通卡打开（文字设定、头像、表情、背景都在标准位置）。Tavern 也能把 `.dshcard` 降级导出为 CHARX（去掉代码和扩展素材）。

## 文件结构

ZIP 压缩包，后缀 `.dshcard`。分四块：卡本体（兼容 CHARX）、素材包（只放数据）、代码（脚本和插件）、清单。

```
大肥鱼.dshcard
├─ card.json              Character Card V3，和 CHARX 完全相同；酒馆助手脚本也在这里
├─ packs/<包 id>/         所有素材，结构沿用 Galgame 分支的 dsh-asset-pack（manifest.json、media/、credits/……）
├─ scripts/<名字>.js      DSH 卡脚本：沙箱里运行，可以用 DSH 能力（第 2 层）
├─ plugins/<插件名>/      随卡 DSH 插件：package.json、index.mjs、client.js、assets/（第 3 层）
└─ dsh.json               DSH 清单（见下）
```

**数据和代码分开放**，这是确认机制成立的前提：

| 放什么 | 放哪 | Tavern 怎么对待 |
|---|---|---|
| 卡的文字设定、酒馆助手脚本 | `card.json` | 和导入普通卡一样；脚本在沙箱运行 |
| 所有素材 | `packs/` | **不解读内容**，只存储、校验、按地址提供 |
| 其中供其他前端用的头像、表情、背景 | `card.json` 的 `data.assets` 指向 `packs/` 里的文件 | 导入为 Tavern 的角色素材（头像、28 种情绪立绘、背景） |
| DSH 卡脚本 | `scripts/` | 沙箱运行，不用确认 |
| DSH 插件 | `plugins/` | 确认后才加载，只在本卡生效 |

**素材只放一份**：CCv3 的 `data.assets` 直接指向素材包里的文件（`embeded://packs/<包 id>/media/<摘要>.png`），不另外复制到 `assets/`。CCv3 规范只是建议放在 `assets/{类型}/images/`（SHOULD，不是 MUST）；RisuAI 导入 CHARX 时会把包里每个文件按路径登记，任意路径都能解析（`src/ts/process/processzip.ts` 的 `CharXImporter`）。Tavern 自己的角色素材（玩家上传、ST 立绘包导入的）导出时也存成一个素材包，`format` 为 `dsh-cast`。只导出 CHARX（不带素材包）时，仍按规范的 `assets/` 路径写。

为什么 DSH 卡脚本单独放、不塞进 `card.json`：它用到的 `DSH` 对象在 ST、RisuAI 里不存在，放进 `card.json` 会让导出的 CHARX 在别处报错。单独放，导出 CHARX 时自然丢掉，`card.json` 始终是一张在哪都能跑的卡。

规则：
- `card.json` 必须能单独成立：去掉其他所有文件，它仍是一张合法的 CCv3 卡。
- **素材包只放数据**：Tavern 提供包内文件时，按扩展名白名单给类型（图片、音频、视频、字体、JSON、模型和纹理等），一律加 `nosniff`；HTML、SVG、JS 之类能在页面里执行的类型不在酒馆的同一来源下提供，只能作为下载或交给插件自己处理。要运行的东西必须放进 `scripts/` 或 `plugins/`，这样才在摘要和确认范围之内。
- 文件路径只用 ASCII，大小写敏感，`/` 分隔（同 CHARX）。
- 支持 ZIP64，单个文件、整个包都可以超过 4 GB 的 ZIP32 限制；Tavern 边读边解压，不整包读进内存。

### `dsh.json`

```json
{
  "format": "dshcard",
  "formatVersion": 1,
  "card": { "id": "c0ffee00-…", "version": "1.2.0", "title": "大肥鱼", "author": "…" },
  "requires": { "tavernApi": 2 },
  "scripts": [
    { "name": "stage-voice", "path": "scripts/stage-voice.js", "purpose": "翻到台词时朗读并切换立绘" }
  ],
  "plugins": [
    { "name": "dafeiyu-director", "path": "plugins/dafeiyu-director", "version": "1.0.0",
      "sides": ["host", "browser"], "sha256": "…",
      "purpose": "每轮编排舞台：背景、音乐、立绘与镜头",
      "uses": ["runAgent", "network:api.example.com", "cardAssets"] }
  ],
  "packs": [
    { "id": "af7b2c46-…", "title": "中国通用背景", "format": "dsh-asset-pack", "contentHash": "…",
      "bytes": 44360250, "path": "packs/af7b2c46-…/", "credits": ["packs/af7b2c46-…/credits/CREDITS.md"],
      "url": "https://…/china-backgrounds.zip" }
  ]
}
```

- `card.id`：卡的唯一标识，作者第一次导出时生成，之后不变。导入时同 id 视为**更新**。`version` 给人看，也用来判断新旧。
- `scripts`：DSH 卡脚本，和酒馆助手脚本跑在同一个沙箱里，多一个 `DSH` 对象。不用确认，但列在导入界面上。
- `plugins[].sha256`：插件目录内容的摘要，确认记在"这个摘要"上，代码一变就要重新确认。
- `plugins[].purpose`、`uses`：给玩家看的用途和用到的能力。**这是声明，不是沙箱**：Tavern 能强制的只有插件接口层面（见下文作用范围），Node 层面的文件和网络访问挡不住，确认界面要如实说明。
- `packs`：素材包。`format` 说明由谁解读（例如 `dsh-asset-pack` 由 Galgame 插件解读），Tavern 只认 `format`、文件与摘要、署名许可、包 id。多张卡共用同一个包时按 `contentHash` 去重；包没附带时按 `url` 下载（只接受公开 HTTPS），下载前要玩家确认。插件给这张卡写的素材也存成一个包，归属是这个插件。

## 三层脚本

一张卡里的代码分三层，越往上能力越强，也越需要信任：

| 层 | 是什么 | 跑在哪 | 导入时 |
|---|---|---|---|
| 1. 酒馆助手脚本 | SillyTavern 生态的现成写法，在 `card.json` 里 | 浏览器沙箱 iframe（现有机制） | 不用确认 |
| 2. DSH 卡脚本 | `scripts/` 下的脚本，或第 1 层脚本里用到的 `DSH` 对象：读台词标注和舞台数据、朗读、读本卡素材 | 同上 | 不用确认 |
| 3. 随卡 DSH 插件 | `plugins/` 下的完整插件 | 宿主 Node + 浏览器 | **必须确认** |

给卡作者的分工建议：界面和每条消息的逻辑写在第 1、2 层；需要宿主能力的（后台推演、生图、联网、存大文件、结算任务）写在第 3 层。很多卡只想"念台词、换立绘"，第 2 层就够，玩家不用面对确认弹窗。

**沙箱与本卡插件之间的通道**：第 1、2 层脚本用 `DSH.callCardPlugin(名字, 参数)` 调用本卡插件以 `tavern.handle` 注册的处理函数；插件用 `tavern.emitToCard({ gameId, name, data })` 往这张卡的沙箱推事件，脚本用 `DSH.onCardPlugin(名字, 处理函数)` 接收。通道只连本卡自己的插件，别的插件调不到，也收不到。这样一张卡可以是"沙箱里画界面、插件在后台干活"。

导出成 CHARX 时只保留第 1 层（它在 `card.json` 里），在 ST、RisuAI 里照样能跑。`scripts/` 和 `plugins/` 不进 CHARX。第 1 层脚本里如果顺手用了 `DSH` 对象，要自己判断 `typeof DSH`，否则在别处会报错；更推荐把这部分写进 `scripts/`。

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

Galgame 分支的示例卡「大肥鱼」（`dafeiyu.card-bundle.zip`，274.7 MB，SHA-256 与发行清单一致）已下载拆解，并用脚本试改成 `.dshcard`。

### 它原来的结构

分支已经有一套自己的卡包格式 `dsh-tavern-card-bundle`，和本文的设计很接近：

```
card/card.json                CCv3，extensions.dsh_tavern 里有素材包绑定、开场画面、舞台皮肤
card/cover.png
dsh-tavern-card-bundle.json   format、schemaVersion、cover、dependencies（每个素材包的 id + contentHash）、files
packs/<包 id>/manifest.json   format: "dsh-asset-pack"
packs/<包 id>/media/<sha256>.<ext>   按内容寻址的文件
packs/<包 id>/figures/  sprites/  bundles/  credits/
```

四个素材包：大肥鱼本体（171 MB）、中国通用背景（43 MB，197 个背景）、通用 BGM（55 MB）、通用音效（4.7 MB）。

素材包里的数据模型比 Tavern 的角色素材丰富得多：
- **人物 × 服装 × 情绪**：3 套服装，每套 14 种情绪；情绪是开放集合（`eating`、`singing`、`crashed`、`drooling` 不在 ST 的 28 种里）。
- **分层立绘**：带嘴型帧（a/e/i/o/u/闭）和眨眼图层，供口型同步。
- **Live2D 模型**：每套服装一个，情绪对应表情和动作。
- **背景**：有日夜变体。
- **给模型看的说明**：背景、人物都带检索关键词、`directorNote`（给导演的用法说明）、`generationGuidance`（生图用的情绪描述）。
- **署名与许可**：每个包有 `credits/`（CREDITS、LICENSE、图片来源）。

### 试改结果

脚本（不进仓库）把它改成了：
- `card.json` 放到根目录，补上 CCv3 `assets`：封面作为 `icon`，默认服装（女仆装）的 14 张情绪头像作为 `emotion`；
- `dsh.json` 写卡的标识、版本和 4 个素材包（id、format、contentHash、署名文件）；
- `packs/` 原样放入。

得到 `dafeiyu.dshcard`（288 MB）和去掉素材包的 `dafeiyu.charx`（16 MB）。试改时把头像和情绪图复制进了 `assets/`；按"素材只放一份"的结论，应直接指向 `packs/` 里的原文件，能省下这 16 MB 的重复。用现在的导入代码试：
- **CHARX 版能导入**：14 种情绪认出 9 种当立绘，Tavern 自带的舞台和对话头像直接可用；`crashed`、`drooling`、`eating`、`singing` 没有对应，原样保留。试的过程中发现 `crying` 抢在 `sad` 前面占了"难过"，已修复：按名字贴近程度排序。
- **`.dshcard` 导入失败**：现在的 zip 读取有 50 MB 上限，并且要整包读进内存。这印证了实施步骤 1、3 必须先做。

### 对格式的结论

1. **素材包直接采用分支的 `dsh-asset-pack` 结构**，不另造：按内容寻址、清单带每个文件的摘要，正是存储层要的。`.dshcard` 的 `packs/<id>/` 原样放它。
2. **Tavern 不解读素材包的内容**，只认四样：`format`、文件与摘要、署名许可、包 id。服装、分层立绘、Live2D、日夜变体、导演说明属于声明这个 `format` 的插件（这里是 Galgame 插件）。Tavern 自己的角色素材保持简单（头像、28 种情绪立绘、背景、声音），保证不装插件时也能用。
3. **同一张卡分三级可用**：
   - 在 ST、RisuAI 里是一张普通卡（CHARX 部分）；
   - 在 Tavern 里不装插件，有头像、立绘、舞台；
   - 装上 Galgame 插件，有服装、Live2D、导演、音乐。
4. **署名许可是格式的一部分**：`dsh.json` 的每个包列出署名文件，导入确认界面显示，导出时必须带上。
5. **服装暂不进 Tavern 自己的角色素材模型**：Tavern 的角色素材是"每个人物一个头像 + 每种情绪一张立绘"，没有"服装"这一层。不装插件时，内置舞台和对话头像只用一套（默认服装）；换装由插件读素材包自己处理。要让内置舞台也会换装，后台结算还得每轮判断"穿哪套"，多一份提示词和费用，等第二个需要服装的插件出现再说。
6. 分支的 `dsh-tavern-card-bundle.json` 可以直接转换成 `dsh.json`（`dependencies` 对应 `packs`），导入时两种都认，这样分支已经发出去的卡包不用重做。

## 实施步骤

每一步单独提交，相关测试和 e2e 通过。

1. **存储层**：全局内容寻址仓库、按卡清单、Range 读取、流式上传、容量与清理；`cast-assets` 迁移进来。行为不变。
2. **插件写素材的接口**：`putCardAsset` 等；文档与示例。
3. **`.dshcard` 读写**：ZIP64、流式解压；`dsh.json` 校验；导入（不含插件）与三种导出；共用素材包去重与下载确认；兼容读取分支的 `dsh-tavern-card-bundle.json`。
4. **随卡插件**：加载、按卡限制、确认流程、更新与卸载。
5. **三层脚本的通道与沙箱 DSH 能力**。
6. **大肥鱼改造**：作为验收用例和给卡作者的示范。

## 待定

- 后缀名：`.dshcard` 暂定。
- 签名：是否支持作者签名，让"同一作者的更新"免于重复确认。第一版不做。
- 随卡插件能否依赖全局插件，或依赖 npm 包（第一版：只能用宿主已有的模块，和用户插件规则相同）。
- 素材包的独立分发与更新（脱离卡单独升级），第一版只做"随卡带入、按摘要去重"。
