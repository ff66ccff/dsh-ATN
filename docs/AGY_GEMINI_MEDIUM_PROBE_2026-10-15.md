# 2026-10-15：dsh-agy Gemini 3.8 Flash medium 真实实验

按用户指定，使用本机已安装的 **dsh-agy@0.4.4**、provider **agy**、模型 **gemini-3.8-flash-tiered**、推理档位 **medium** 进行真实分布式证据探针。计划 5 个 seed，实际完成 5 个，通过 0 个。没有替换失败 seed，也没有切换模型。[汇总及原始文件哈希](execution-evidence/agy-model-20261015/summary.json)。

## 真实调用与 medium 证据

- 使用已安装插件的原始入口，在真实 Harness 0.2.1-alpha.2 Context 中注册 agy adapter。OAuth/账号存储由插件自行读取，不导出或复制凭据。
- 独立装载时，Desktop 插件的可选 peer 无法直接解析到 dsh-llm。进程内 Node resolve hook 将 llm/cordis 指向本工作区的真实 Harness peer，保持模块身份一致；没有修改用户安装的插件、账号文件或 profile 配置。
- 模型公开标识及 medium 能力由已安装插件解析，[发现记录](execution-evidence/agy-model-20261015/discovery.json)。该步骤本身不是成功推理证明，实际推理证据在下面的调用记录。
- 每个节点在官方 agent/request 配置阶段设置 medium；预算入口再次拒绝不匹配的档位。向真实插件派发前逐次核对 provider、模型、档位和输出上限。[逐次派发/结束记录](execution-evidence/agy-model-20261015/provider-calls.jsonl)。
- 还调用了已安装插件的真实请求翻译函数，离线断言请求体含 thinkingLevel=medium、includeThoughts=true、maxOutputTokens=4096。本机未设置 medium 的自定义 thinkingBudget 覆盖。[请求体检查](execution-evidence/agy-model-20261015/medium-wire-check.json)。这一步没有额外发起上游推理。

这不是 OpenCode Go 别名路由、脚本模型、Desktop UI 自动化或直接 HTTP 模拟。实际插件代码哈希随汇总留档；实验驱动见[原始驱动](execution-evidence/agy-model-20261015/probe-driver.ts.txt)，不含账号秘密。

## 冻结条件

| 条件 | 值 |
| --- | --- |
| 模式/用途 | adaptive / adaptive-probe，非 topology-binding 专项 |
| seed | 17、31、45、59、73 |
| 节点/两阶段链长 | 8 / 2 |
| 每节点步数 | 12，两阶段共用 |
| 每次运行模型调用上限 | 96 |
| 每次调用输出上限 | 4096 token |
| 已观测总 token 准入阈值 | 400000，不是精确消耗硬上限 |
| 每次运行期限 | 120 秒 |
| provider 派发并发 | 1；其余节点请求排队，取消后不再派发 |
| 阶段推进 | 仅 phase-1 checkpoint，不自动推进 |

全部 seed 在调用模型前通过同配置的真实运行时确定性参考，参考模型调用数为 0。[参考](execution-evidence/agy-model-20261015/references.json)、[计划及源码哈希](execution-evidence/agy-model-20261015/plan.json)。参考可行不等于真实模型已经完成任务。

每个 seed 开始前核对源码哈希，运行过程中没有更改源码。失败样本保留，认证、限流或额度标准错误码也会停止后续调用，不能只依赖 HTTP status 字段。

## 逐 seed 结果

| seed | phase 1 | phase 2 | runner 调用 | 插件实际派发 | 秒 | 停止原因 | 清理 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| 17 | 未提交 | 未提交 | 23 | 19 | 120.1 | timeout | released |
| 31 | 未提交 | 未提交 | 17 | 14 | 120.1 | timeout | released |
| 45 | 未提交 | 未提交 | 18 | 15 | 120.0 | timeout | released |
| 59 | 未提交 | 未提交 | 18 | 14 | 120.1 | timeout | released |
| 73 | 未提交 | 未提交 | 17 | 14 | 120.0 | timeout | released |

累计记录 **93 次 runner 模型调用**，其中 **76 次实际派发给 AGY 插件**。差异来自并发上限为 1 时排队的节点调用：它们已经进入实验内核，但可能在派发前因期限取消。两者都不是底层 HTTP 请求精确计数，插件内部重试/路由行为不可由此穷尽。[执行日志](execution-evidence/agy-model-20261015/execution.txt)。

逐次报告和遥测分别为 [seed 17 report](execution-evidence/agy-model-20261015/seed-17-report.json) / [events](execution-evidence/agy-model-20261015/seed-17-events.jsonl)、[seed 31 report](execution-evidence/agy-model-20261015/seed-31-report.json) / [events](execution-evidence/agy-model-20261015/seed-31-events.jsonl)、[seed 45 report](execution-evidence/agy-model-20261015/seed-45-report.json) / [events](execution-evidence/agy-model-20261015/seed-45-events.jsonl)、[seed 59 report](execution-evidence/agy-model-20261015/seed-59-report.json) / [events](execution-evidence/agy-model-20261015/seed-59-events.jsonl)、[seed 73 report](execution-evidence/agy-model-20261015/seed-73-report.json) / [events](execution-evidence/agy-model-20261015/seed-73-events.jsonl)。

## usage 与解释边界

已知输入 token 合计 356776，已知输出 token 合计 2540，已知缓存读 token 合计 0。部分调用因取消而缺失 usage，推理 token 与 totalTokens 也没有完整上报。**总消耗未知，不能把 totalTokens.known=0 写成实际消耗 0。** 未将输入与输出简单相加冒充包含推理的完整总量。

当前插件解析器只填入 inputTokens/outputTokens/cacheReadTokens；因此已观测 totalTokens 阈值在本批无法根据完整总量触发。实际保留调用次数、每次输出上限和期限约束，不能宣称本批实现了精确 token 预算匹配。费用/订阅额度消耗没有测量，参考费率保持未知，不套用 OpenCode 的免费价格。

本批和此前 Step 5 探针共享任务族、seed 和表中主要上限，但 provider、medium 设置、派发并发和实验入口源码不同；全量回归测试还与首个 seed 并行完成。**这不是受控的跨模型效率比较**，耗时、调用数或失败数不能用于模型强弱、拓扑收益或速度优势声明。原始 runner report 中通用的“五 arms”解释文本只是模板，本批实际只执行 adaptive。

## 实验入口变更与回归

原入口只允许 OpenCode 路由。此次仅在 experiments/shifting-evidence-run.ts 增加明确的 installed-agy 挂载分支，限定用户指定的 Gemini 模型和 medium，采用真实 agy 路由做预算核对；缺少显式挂载时拒绝执行。没有扩大旧 OpenCode allowlist，没有修改 src 运行时代码或正式依赖图，未知费率以 null 表示。

新增两条零网络回归：8 节点均收到正确路由/medium/输出上限且价格未知；未挂载的 Gemini 路由在凭据读取前拒绝。保留[修改前失败](execution-evidence/agy-model-20261015/pre-fix-mount-tests.txt)与[定向通过](execution-evidence/agy-model-20261015/mount-tests.txt)。fixture 需要显式声明 medium 能力，与真实插件的模型元数据一致。

- npm test：**553 runtime/集成 + 14 UI，零失败、零跳过**，[输出](execution-evidence/agy-model-20261015/test.txt)。
- npm run typecheck：退出 0，[输出](execution-evidence/agy-model-20261015/typecheck.txt)。
- 额外零网络故障注入确认 RATE_LIMIT 即使 status=null 也会立即结束运行且释放资源，[结果](execution-evidence/agy-model-20261015/rate-limit-guard.json)。该 fixture 的外部模型调用为 0，未并入 5 个真实 seed 或全套测试用例数。

没有把测试 fixture 的脚本求解当作真实模型成功，没有重写旧归档实验哈希。该任务未重新发布插件或推送代码。

结论仅为：指定 AGY/Gemini/medium 调用链已实际运行，5 个 seed 的两阶段验收通过 0 个；完整结果按上述期限、排队和 usage 限制解释。完整本地产物位于 .artifacts/agy-validation/20261015/。
