# 大肥鱼 · DSH 人物卡示例

把 [DSH Tavern Galgame](https://github.com/jerryzmtz/dsh-tavern-galgame) 分支的示例卡「大肥鱼」改成 DSH 人物卡（`.dshcard`，见[格式设计](../../docs/design/dsh-card-format.md)）：一个文件里有人物卡、4 个素材包和一个卡内插件，导入后不用装别的插件就能玩到 Galgame 式的舞台。

- `plugin/`：卡内插件。宿主侧（`index.mjs`）在每轮后台结算里顺带"导演"，按正文选场景、时段、服装和背景音乐；浏览器侧（`client.js`）用 `registerStageView` 画舞台：背景图、当前服装的情绪立绘、背景音乐。只用公开的[插件接口](../../docs/plugin-api.md)。
- `build.mjs`：把分支发布的卡包转成 `.dshcard`。

```sh
curl -LO https://github.com/jerryzmtz/dsh-tavern-galgame/releases/latest/download/dafeiyu.card-bundle.zip
node examples/dafeiyu-card/build.mjs dafeiyu.card-bundle.zip 大肥鱼.dshcard
```

在 Tavern 的人物卡库导入 `大肥鱼.dshcard`，确认启用卡内插件，刷新页面；在设置里打开「对话头像」，开一局，打开顶栏「舞台」。

这是最小可行版：没有 Live2D（运行库的许可要先确认）、分层立绘、口型、镜头和模组。素材的版权与许可归原作者，见各素材包的 `credits/`；本仓库不收录素材，只收录插件和转换脚本。
