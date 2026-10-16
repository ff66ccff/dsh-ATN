# 真实模型探针可行性门：前提核验与停止报告（2026-10-15）

**状态：按 [实施说明](LIVE_PROBE_FEASIBILITY_BRIEF.md) 第 7.2 条停止，未完成可行性门，未执行真实重跑。** 已实测确认 `actions=60 / maxNodeActions=8` 是某个确定性策略的计数，不能直接作为真实模型所需调用数／步数的严格下界。没有另造下界来绕过停止条件。

用户指定保持为 **dsh-agy / agy / gemini-3.8-flash-tiered / medium**。本轮新增真实模型调用 **0**，没有读取账号凭据或安装、切换 provider；历史失败 seed 全部保留。

## 1. 停在哪一条，为什么

第 7.2 条要求：“参考下界的 `actions` **不能**作为真实模型所需动作数的下界……此时必须报告，**不得**另造一个代理指标顶上。”第 10.4 条也把这一性质列为必须自行确认的未验证项。

核验首先发现，原 `runShiftingReference` 的解释本来就是 `not a proven optimum`。其非 topology-binding 分支在两阶段分别遍历全部 8 个节点，并为 7 段回复各提交一次 requester feedback。60 次计数包括 14 次反馈，不是必要操作最少数的证明。

随后执行零模型的构造性对照：保持 `topology='adaptive'`，保持 `requesterFeedback=true / sharedBoard=false`，保持 8 节点环、证据 ACL、实际 task/result 传递、checkpoint 提交和答案验证，仅让确定性策略选择不提交 requester ratings。没有卸载反馈机制，没有修改运行时，没有改 oracle。

| seed | 原策略动作 / 单节点最多 | 对照动作 / 单节点最多 | 原 / 对照反馈数 | 两阶段答案验收 | 两种策略模型调用 |
| --- | ---: | ---: | ---: | --- | ---: |
| 17 | 60 / 8 | 46 / 6 | 14 / 0 | 均通过 | 0 / 0 |
| 31 | 60 / 8 | 46 / 6 | 14 / 0 | 均通过 | 0 / 0 |
| 45 | 60 / 8 | 46 / 6 | 14 / 0 | 均通过 | 0 / 0 |
| 59 | 60 / 8 | 46 / 6 | 14 / 0 | 均通过 | 0 / 0 |
| 73 | 60 / 8 | 46 / 6 | 14 / 0 | 均通过 | 0 / 0 |

命令（退出 0，意为核验断言成功，**不代表可行性门通过**）：

```text
node --import tsx/esm scripts/audit-live-probe-reference.ts
```

输出包含 `status: stopped`、`stopCondition: LIVE_PROBE_FEASIBILITY_BRIEF.md section 7.2`、`newLiveModelCalls: 0`、上述逐 seed 结果、`sourceHashesUnchangedDuringAudit: true`、`archiveMismatches: []`。完整结果见 [reference-audit.json](execution-evidence/live-probe-feasibility-20261015/reference-audit.json)，可复跑入口见 [核验脚本](../scripts/audit-live-probe-reference.ts)。

**对照的边界：**46/6 只反驳“60/8 是所有运行时合法且答案正确路径的严格下界”。对照没有证明完整 live prompt／协议合规，也没有证明真实模型能以 46 次调用完成；不能用它替换 60 作为新下界。原策略也是零模型宿主策略，未证明工具动作与模型调用一一对应。真实 agent loop 支持单个模型响应包含多个 tool-call，因此还需要独立证明动作计数到调用数的换算。

这意味着“12 ≥ 8、96 ≥ 60”目前只能证明预算覆盖该参考策略的记账，不能证明真实模型步数、调用上限一定充足；同样不能由 `60 × 单次延迟` 严格证明 120 秒期限是唯一不足维度。历史实际超时是事实，“唯一原因已被算术证明”则证据不足。

## 2. 已尝试的方案与哈希影响

- 先直接复跑原参考，再在临时策略副本中跳过两处 feedback 条件分支；保留其他源文逐字不变。实际运行选中的是非 topology-binding 的 gather 分支。
- 策略副本临时放在 `experiments/` 内，使相对导入继续指向原运行时；执行后在 `finally` 删除。副本源码与 SHA-256 单独留档于 [reference-without-ratings.ts.txt](execution-evidence/live-probe-feasibility-20261015/reference-without-ratings.ts.txt) 和核验 JSON，不覆盖原参考文件。
- 实测比较当前 `shiftingSourceHashes()` 的 **37 个文件**与上一批 AGY `plan.json`：**全部一致**。核验前后也全部一致。历史 `sourceHashes` 和设计参数没有重写，`src/` 没有改动。
- `telemetry.ts` 确实在这 37 个固定哈希文件内。直接新增度量字段会改变文件哈希；本轮未修改它，因此没有产生这种变化。后续可在新模块中补充度量，或为新批次登记新源码哈希并保留历史原件，不能改写旧 plan。

## 3. 未完成项与真实运行决定

| 项目 | 状态及原因 |
| --- | --- |
| 4.1 延迟三时刻分解及确定性排队用例 | 未实施／未实测；前提核验已触发停止条件。不能仅凭阅读 telemetry 源码宣称口径已确定。 |
| 4.2 纯计算门及 G3/G4 三组输出 | 未实施；严格下界及动作到调用的换算不成立或未经证明，不能硬编码预期结论。 |
| 4.3 历史延迟外推或有界标定 | 未实施；没有把 120 秒 ÷ 派发数当作干净服务延迟，没有启动标定调用。 |
| 4.4 Gemini medium 真实重跑 | **未执行**；4.1–4.3 未完成，门未通过，且已触发第 7.2 条。 |
| 4.5 历史报告完整性 | 逐 seed usage、共同紧预算失败、正向记录及模板边界补充如下。 |

没有新冻结条件表，没有放宽期限或并发，没有所谓“门判可行”的输出。`modelDurationMs=876033 ms` 超过墙钟的现象仍保留为未解决的口径问题；本轮没有测出其排队／服务分解，也没有把它作为单次模型服务时长。

## 4. 上一批逐 seed usage 与正向记录

以下均直接提取自旧 AGY 各 seed report 的 `metrics.totals.tokens`，并由核验 JSON 保存对应完整 totals。`known` 为已知部分，括号为 `unknownCalls`，不是完整总消耗。

| seed | input known（未知调用） | output known（未知调用） | cacheRead known（未知调用） | cacheWrite / reasoning / total |
| --- | ---: | ---: | ---: | --- |
| 17 | 92022（5） | 479（5） | 0（5） | 三项各 23 次未知 |
| 31 | 64212（4） | 536（4） | 0（4） | 三项各 17 次未知 |
| 45 | 69520（4） | 497（4） | 0（4） | 三项各 18 次未知 |
| 59 | 65330（5） | 472（5） | 0（5） | 三项各 18 次未知 |
| 73 | 65692（4） | 556（4） | 0（4） | 三项各 17 次未知 |
| 合计 | 356776（22） | 2540（22） | 0（22） | 三项各 93 次未知 |

所有 seed 的 `totalTokens.known=0` 都伴随全部调用未知，**实际总 token 未知，不能写成零**；推理、缓存写 token 同理。输入与输出的已知部分不冒充完整总量。

明确保留以下四项声明：

1. **两个不同 provider／模型在同一紧预算下都失败。**Step 5 / dsh-opencode-go 与 Gemini / agy 均使用每节点 12、调用上限 96、输出 4096、已观测 token 阈值 400000、期限 120000 ms；节点数、链长、checkpoint-only 也一致。冻结条件可对照旧 [Step 5 plan](execution-evidence/free-model-20261015/plan.json) 与 [AGY plan](execution-evidence/agy-model-20261015/plan.json)。这支持“不能简单归咎于选择了某个弱模型”，但 provider、档位、并发和入口不同，且 Step 5 有限流，不能据此证明预算是唯一原因或作受控跨模型比较。
2. **AGY 正向记录：**5 个 seed 全部 `errors=0`、`toolErrors=0`、`failures=[]`、`cleanup=released`，未记录到限流。Step 5 则记录过 `RATE_LIMIT`，包括 seed 31 中断；旧 Step 5 报告还指出 seed 17 有该错误码，不能把它抹去。AGY 的资源释放和无工具错误是有效结果，不能因 0/5 而省略。
3. **runner 模板边界：**旧报告中的通用“五 arms”解释只是模板，本批实际仅跑 adaptive，不能当作已执行五臂比较。
4. **解释边界：**未知 usage 不填零、参考策略动作数不当作严格需求、0/N 不写成模型能力、拓扑收益或速度结论。

历史五臂为 48 步／节点、384 次调用、600 秒；两批紧预算探针与它不是同一条件，本轮没有混入历史比较。

## 5. 工程验证

执行并保存简报要求的四条工程命令，结果以同目录原始日志为准：

- `npm test`：553 runtime／集成 + 14 UI，全部通过，零跳过。没有删除测试或调整既有断言。见 [test.txt](execution-evidence/live-probe-feasibility-20261015/test.txt)。
- `npm run typecheck`：退出 0。见 [typecheck.txt](execution-evidence/live-probe-feasibility-20261015/typecheck.txt)。
- `npm run build`：退出 0。见 [build.txt](execution-evidence/live-probe-feasibility-20261015/build.txt)。
- `npm run pack:tarball`：退出 0，生成 `.artifacts/dsh-atn-0.5.0.tgz`。见 [pack-tarball.txt](execution-evidence/live-probe-feasibility-20261015/pack-tarball.txt)。

本轮没有新增 G1/G2 功能测试，不把核验脚本或工程回归当作可行性门验收。

## 6. 建议的下一步

先修订 brief 的前提：要么把 60/8 明确改称“已知参考策略计数”，把门定位为带明确动作余量和实测延迟假设的工程规划门，其通过不保证成功、拒绝不代表数学不可行；要么先证明在同一工具、协议、ACL、批量 tool-call 及调度语义下成立的必要调用数、关键路径和单节点步数下界。46/6 不作为替代下界。

前提明确后，再独立实测三时刻口径、选取有来源的服务延迟并实现 G3/G4。若仍要求“上一批只能判期限不足”，必须有独立证据支持；不能通过迎合断言把这个结论写死。指定 Gemini medium 与原失败 seed 保持不变。
