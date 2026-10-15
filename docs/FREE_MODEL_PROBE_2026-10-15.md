# 2026-10-15：OpenCode Go 订阅免费模型真实探针

按用户本次授权，通过已有 `dsh-opencode-go@0.1.20` 插件和当前 Harness `0.2.1-alpha.2` 实际调用订阅。选中模型为 **`step-5-preview-free`**，每次运行前都用实时目录确认输入、输出、缓存读写四项参考费率全部为 0。没有调用付费模型，没有切换路由绕过限流。

本批计划 5 个 seed，实际启动 2 个：seed 17 超时、未通过；seed 31 因发现限流而人工终止，结果未知；其余 3 个未启动。累计记录到 **44 次 `llm/stream` 模型调用**。这是受限流影响、未完成的探针，不能写成五 seed 实验已完成或 ATN 拓扑收益已通过。[汇总与原始文件哈希](execution-evidence/free-model-20261015/summary.json)。

## 实验入口与授权范围

最初计划用 Step 5/Cat Jam 各跑账目核对和边界诊断。现有 `runPilot` 在 ATN 模式下要求确定性分布式参考，短任务在此门被拒绝，**模型调用为 0**。[原始预检失败](execution-evidence/free-model-20261015/initial-short-task-preflight.txt)。没有放松该门、修改正式 runner 或重放旧归档实验。

随后使用现有 `runShiftingEvidence` 导出的分布式证据探针，模式为 `adaptive`、用途为 `adaptive-probe`。驱动先为所有 5 个 seed 运行同预算、真实运行时的零模型参考，全部通过；然后运行真实 provider。所有源码哈希在计划中固定，每个 seed 前检查未发生变化。[计划](execution-evidence/free-model-20261015/plan.json)、[五 seed 参考](execution-evidence/free-model-20261015/references.json)、[原始驱动](execution-evidence/free-model-20261015/probe-driver.ts.txt)。

实时目录还列出免费的 `longcat-2.5-preview-free`、`cat-jam-free`。两者仅完成目录查询，本批没有向它们发起推理。[目录](execution-evidence/free-model-20261015/catalog.json)。没有调用历史 allowlist 中的付费 DeepSeek 路由。

凭据由本机当前用户的既有 DPAPI 文件读取，只通过子进程的 `OPENCODE_API_KEY` 临时传入，未写入仓库或命令参数。真正的 provider 装载路径是实验内核中的 `ctx.plugin(OpenCodeGo, ...)`，不是脚本直接发送 HTTP 推理请求。manifest 的 `providerProvenance` 为 `dsh-opencode-go` / `standalone-harness`；这是订阅插件内核实验，不是 Desktop profile 导入或侧栏 host/browser 联合测试。

## 冻结条件

| 条件 | 值 |
| --- | --- |
| 模型 | `step-5-preview-free` |
| 计划 seed | 17、31、45、59、73 |
| 节点数 | 8 |
| 两阶段证据链长度 | 2 |
| 每节点总步数 | 12，两阶段共用 |
| 每次运行调用上限 | 96 |
| 每次调用输出上限 | 4096 token |
| 已观测 token 准入阈值 | 400000，每次运行；不是精确消耗硬上限 |
| 每次运行期限 | 120000 ms |
| 阶段推进 | phase-1 checkpoint；不自动推进 |
| 模式/任务版本 | 仅 adaptive，非 topology-binding 专项 |

这是当前源码下的新批次，没有改写旧设计的 `sourceHashes`。模型只接触合成实验材料和实验工具，不向它暴露 shell、凭据或 oracle 文件。

## 真实结果

| seed | 状态 | 已记录调用 | 已知总 token | usage 未知调用 | 验收及清理 |
| --- | --- | ---: | ---: | ---: | --- |
| 17 | 正常落盘的超时失败 | 23 | 144979 | 1 | 两阶段都没有提交；120062 ms；cleanup=released |
| 31 | 限流发现后的进程中断 | 21 | 70590 | 5 | 没有最终 report；最后持久化时 5 次调用未结束；结果及清理未知 |
| 45、59、73 | 未启动 | 0 | 不适用 | 不适用 | 不计作完成或成功样本 |

合计已知 token 为 **215569**，另有 6 次调用缺少完整 usage，因此不是精确总消耗。44 是可观察的内核调用次数，不保证等于 HTTP 请求数量，adapter 内部不可见重试数未知。目录零价是模型选择依据，未读取实际订阅账单；也不把缺失 usage 或未知结算写成零。

seed 17 创建了 8 个节点，执行 20 次工具调用、工具错误为 0；没有成功重连、没有 requester review、没有任何阶段 checkpoint。停止时还有 4 个 open task。最大单节点用了 4/12 步，未触及每节点步数上限。最终超时与一次 `RATE_LIMIT` 同时存在，不能据此判定模型一般求解能力或推断具体订阅配额原因。

完整 seed 17 [report](execution-evidence/free-model-20261015/step-5-preview-free-adaptive-seed-17.json)、[遥测](execution-evidence/free-model-20261015/step-5-preview-free-adaptive-seed-17-events.jsonl)。seed 31 的[显式中断记录](execution-evidence/free-model-20261015/step-5-preview-free-adaptive-seed-31-interrupted.json)、[原始 manifest](execution-evidence/free-model-20261015/step-5-preview-free-adaptive-seed-31-manifest.json)、[持久化遥测](execution-evidence/free-model-20261015/step-5-preview-free-adaptive-seed-31-events.jsonl) 均保留，没有重跑来替换它。[执行日志](execution-evidence/free-model-20261015/execution.txt)。

## 限流后的停止与记录边界

seed 17 的原始 `failures` 为 `[{"code":"RATE_LIMIT","status":null}]`。驱动原先只检查 HTTP 401/403/429；由于插件没有透传状态码，guard 未识别该标准错误码，seed 31 已启动。发现后仅终止本轮驱动 Node 进程，不继续推理、重跑 seed 或更换免费路由。

[协调停止记录](execution-evidence/free-model-20261015/coordinator-stop.json) 明确记录此 guard 缺口、进程退出 -1、未启动 seed 和未知清理状态。原始 `batch.json` 只来得及记录 seed 17，`stopped` 仍为 null；没有篡改该历史文件，整体停止原因由单独协调记录及派生汇总补充。进程终止不能证明远端在途请求也同步取消，故 seed 31 的 usage 与最终状态保留未知。

后续若另行重启批次，应同时识别标准错误码 `RATE_LIMIT` 和 HTTP 429，并降低初始并发；本批没有实施或验证这种新实验条件，也没有修改正式运行时代码。原始 report 中通用的“五 arms”解释文本只是 runner 模板，本批实际仅执行 adaptive；不得据此宣称比较臂或五 seed 已完成。

结论限于：订阅凭据与真实插件调用链可用，免费 Step 5 路由实际返回过模型响应并执行工具；本批受限流/超时及中断影响，没有两阶段成功样本，没有完整五 seed 结果，也没有性能或拓扑优势证据。完整本地产物仍在 `.artifacts/free-model-validation/20261015/`。
