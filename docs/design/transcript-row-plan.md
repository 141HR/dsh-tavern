# 对话页行计划：从「藏哪些」改成「画哪一行」

状态：设计稿，待确认。

## 问题

宿主的对话页把每条 append 来源的消息永久画出来，替换只对模型生效（`isAppendSurfaceEvent`）。Tavern 改写历史（重新生成、回退、撤销回退、编辑正文、修复模型上下文）后，只能事后把不该看到的行藏掉。现在藏行靠这些名单叠加：

| 名单 | 算在哪 | 管什么 |
| --- | --- | --- |
| `suppressedDshTurns` | 存档 + `foregroundSuppressedTurns` + `regenerationInputTurns` | 生成期回合、回退回合、中止的回合 |
| `replacingDshTurns` | 存档 | 重新生成进行中的旧正文 |
| `supersededDshTurns` | `supersededRegenerationTurns`（日志） | 正文已被替换、宿主仍会画的回合 |
| `regeneratedDshTurns` | 存档 + `projectedReplyTurns`（日志覆盖） | 剧情轮 → 画正文的原生轮；既用来显示，也用来藏 |
| 浏览器 localStorage 三份 | 前端 | 旧版本留下的隐藏轮、回退轮、生成期输入 |

前端 `turn-history.js` 按顺序执行 7 个 apply，后一个可以推翻前一个；`assistant-renderer.js` 里还有一处按 `replacingDshTurns`/`suppressedDshTurns` 提前返回。规则之间互相依赖，例如 `supersededRegenerationTurns` 要先拿到映射才能决定保留哪一轮，而映射又会被 `applyRegeneratedDshTurns` 拿去按剧情轮号去藏原生轮。

近一个月这一块有 81 条提交，最近 3 天修了 6 次「重新生成后空白或重复」（#283、#304、#307 及其前后）。每次都在某一张名单上加特例；消息顺序一变（工具提交的折叠副本、编辑轮、宿主插入的 developer 消息）就有新的组合漏掉。

## 决定

服务端从「存档 + 会话日志」一次算出**行计划**：每个剧情轮由哪个原生轮画输入、哪个原生轮画正文。前端只认这一份计划，**白名单**显示：属于计划的行显示，计划之外、已结束的原生轮一律藏。不再有多张名单互相覆盖。

写入侧（重新生成、回退、修复怎么写会话）不动；宿主不动。

## 行计划

```js
// domain/transcript-row-plan.js（纯函数）
planTranscriptRows({ chat, events, nodes }) → {
  version: 1,
  rounds: [{ story: 10, input: 10, reply: 13 }, ...], // 剧情轮 → 画输入/正文的原生轮
  open: 14 | null,   // 进行中或尚未入档的原生轮：原样显示，不藏
  // 失败轮另有错误控件，沿用现有 hiddenDshErrorTurns 等字段，不并入
}
```

推导规则，按顺序，每条只做一件事：

1. **剧情轮来自存档。** 存档的每条非开场 assistant 行是一个剧情轮，`story = message.turn`；开场轮固定。
2. **输入行 = 这一轮自己的原生轮。** 玩家输入永远画在原来的位置；重新生成不换输入。
3. **正文行 = 日志里这一轮正文可画的那条 append 所在的原生轮。** 先看当前生效的、带 `tavernStoryTurn` 的替换：区间末端是 assistant append 就取它；否则取区间之后的投影副本；再否则取区间内最后一条有文字的 assistant append。都没有就是 `story` 自己。这正是 `projectedReplyTurns` 和投影补副本现在各自的判断，合成一处。
4. **计划之外、已结束的原生轮都不画**：生成期输入、旧正文、编辑轮、回退掉的轮、中止的尝试，不再逐类判断。
5. **`open`**：最后一个原生轮还在跑，或已结束但存档还没有对应行（结算中、#196 待补记），原样显示，免得生成中整楼消失。

前端规则（替换 `turn-history.js` 的 7 个 apply 和 assistant-renderer 里的提前返回）：

- 原生轮 T 的输入类行（`user`、`turn-trigger`）：T 是某轮的 `input`，或 T 是 `open`，才显示。
- 原生轮 T 的正文类行（`assistant-step`、`turn-process`、`turn-tail`）：T 是某轮的 `reply`，或 T 是 `open`，才显示；剧情轮号由 `rounds` 反查（替换 `tavernStoryTurnForDshTurn`）。
- `context` 类行、错误行照旧由现有逻辑处理。
- localStorage 三份名单停用，只读一次做迁移后清掉。

非剧情会话（卡片工作台、后台会话）不下发计划，前端什么都不藏，和现在一样。

## 兼容

- 视图字段：新增 `transcriptRows`；`regeneratedDshTurns` 保留一个版本给插件和旧前端，值由计划生成；`suppressedDshTurns` 等不再用于显示，保留到下一版再删。
- 旧存档：计划只读日志和存档，旧档也按同一规则算，不需要迁移。
- 插件接口：插件读到的剧情轮号不变。

## 重放工具（先做，不改任何行为）

`bin/replay-transcript.mjs`：

- 输入：真实会话日志（`session.v4.jsonl.zstd`）加存档，或像 #304 附件那样的结构化事件导出。
- 输出：现在这套名单算出的可见行，以及新计划算出的可见行，两边对照。
- 夹具：每个相关 issue 截一份脱敏结构（seq / type / turn / surfaceOp / 来源 / 文本长度与哈希）放进 `tests/fixtures/transcript/`，测试断言「每个剧情轮恰好一行正文、一行输入，内容是存档里那一版」。

先用它把 #283、#304、#306、#307 和现有的重新生成、回退测试都跑一遍现行逻辑，确认能复现当时的错误；新计划要在同一批夹具上全过，才切换前端。

## 第 2 步结论（本机 214 局剧情存档对照）

- 按「每轮一份输入、一份正文」检查：现行隐藏名单有 21 局出问题，行计划只有 2 局（同一局及其备份）。后者是很旧的存档，第 8 轮正文只写成了替换、没有可画的行，两套逻辑结果相同。
- 前端规则与 `planShowsRow` 在全部存档上给出的差异逐行一致。
- 推导规则在对照中补了三条：开场和旧存档没记轮次号的行，按展示投影的推算（开场第 1 轮、每条玩家输入加 1）；修复把多轮挤进同一步时，那一行不代表任何一轮，各轮仍用原来的行；种子消息只按一步的最后一条判断。

## 第 3 步之前必须解决

视图可能只拿到最近一段历史（打开对话时的窗口）。此时行计划带 `from`：更早的轮次不由它判断。白名单切换后，窗口之前的行不能因为「计划里没有」就被藏掉。候选做法：存档头里维护一份轻量的轮次索引（每轮的剧情轮号），让计划总能看全；或窗口之前的行一律按宿主原样显示。需要先确认窗口之前是否会出现重新生成过、需要隐藏旧正文的轮次。

## 实施顺序

1. 重放工具与夹具（只加测试工具）。
2. `planTranscriptRows` 与单测；视图里并行下发 `transcriptRows`，前端暂不使用，开发版对照日志里两套结果的差异。
3. 前端切到行计划，删掉 `turn-history.js` 的名单逻辑和 assistant-renderer 的提前返回；`replacingDshTurns` 在重新生成期间的「只留生成中占位」改由 `open` 加 `regenInProgress` 表达。
4. 下一版删掉旧名单字段与 `supersededRegenerationTurns`、`regenerationInputTurns` 的显示用途。

每步单独提交；第 3 步前在真实宿主（桌面和手机）上手动验收：普通回合、工具提交回合、连续重新生成 3 次、回退再撤销、编辑正文、生成中刷新。

## 风险

- **白名单藏多了**：计划漏算的行会被藏，症状是「整楼不见」，正是现在要消除的那类。用 `open` 兜住进行中的轮；第 2 步对照期间凡是两套结果不同都记日志。
- **宿主行结构变化**：前端只依赖 `data-chat-turn` 与 `data-chat-flow-kind`，和现在相同，不增加新依赖。
- **工作量**：第 1、2 步各约 1 天，第 3 步约 1～2 天，主要花在真实宿主验收。
