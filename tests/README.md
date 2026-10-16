# 测试与验证工具

| 位置 | 用途 |
| --- | --- |
| 顶层 `*.test.mjs` | 自动化回归测试，按功能名称查找 |
| `fixtures/` | 共享宿主、测试数据、加载器，以及尚未单独分类的诊断探针 |
| `browser/` | 独立浏览器 smoke 和页面验证工具 |
| `performance/` | 独立性能基准工具 |
| [`e2e/`](e2e/README.md) | 完整游戏流程验证 |
| [`../testsets/`](../testsets/) | 卡片试玩与对应测试 |

日常只运行与改动相关的测试，例如：

```sh
node bin/test-tavern.mjs tests/frame-viewport-height.test.mjs
```


不带参数的测试入口仅用于发布时的全量回归，目前发现 `tests/` 与 `testsets/tests/` 顶层的 `*.test.mjs`。不要把自动测试移入子目录而不修改发现逻辑和 CI。

日常全量验证改用 `--fast`：所有无浏览器、无子进程依赖的用例在**一个进程**里跑完（`--test-isolation=none`），省掉每个文件一次的进程启动，从分钟级降到几十秒。

```sh
node bin/test-tavern.mjs --fast
```

排除清单在 `tests/fast-exclude.txt`：直接或（经 fixtures）间接使用 playwright、常驻 http server 或子进程的测试不进 fast 模式（单进程下会互相污染或挂起）。新增这类测试后请把文件名加进清单；若某文件在 fast 模式下表现异常，先检查是否该进排除清单。

`browser/` 和 `performance/` 中的工具按文件顶部说明单独运行；部分工具需要本地 DSH，或会启动等待浏览器访问的服务器。它们不会因为目录整理而自动加入全量测试。

```sh
node tests/browser/frame-viewport-height-browser-smoke.mjs
node tests/performance/variable-write-benchmark.mjs output/variable-write-check --compact --count=20
```

临时产物写入被 Git 忽略的 `output/`。该目录可能被清理，正式验收结论放入 `docs/verification/`。