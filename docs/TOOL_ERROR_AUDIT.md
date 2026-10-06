# 工具错误审计（2026-10-05）

本次读取两轮全部 24 次运行的 192 份持久 Session，按事件逐条回查实验报告。**35 次 finish error 全部分到明确错误码；另有 224 次工具执行错误，不能混入这 35 次。** 每臂的两种计数分别与原报告 `failures`、`modelMetrics.toolErrors` 一致。没有丢弃失败，也没有把同一失败的 `turn/end` 重复计算。

结构化分类及全部事件位置见 [tool-error-audit-20261005.json](../experiments/results/tool-error-audit-20261005.json)。每行含原始文件、行号、事件序号和文件 SHA-256。原始数据保持不变；审计碰到新错误码或无法识别的工具错误会直接失败，不使用 `other` 隐藏新问题。“未分类为零”仅指错误现象已分类，不表示每个根因已确证。

## 35 次模型／适配器 finish error

| errorCode | 次数 | 可核查触发场景 | 是否可由本仓库修复 |
|---|---:|---|---|
| `TRANSPORT` | 26 | `terminated` 5 次；`Connection error.` 11 次；`Stream ended without finish_reason` 10 次 | 未发现 ATN 工具注册或 schema 导致的证据。原日志不足以区分网络、网关及取消竞态；不能声称已修复 |
| `RATE_LIMIT` | 4 | 首轮 LongCat / no-board，响应文本为 HTTP 429，包含上游 endpoint unavailable | 不能通过 ATN schema 修复；保留提供商故障统计。429 不足以独立证明账户配额用尽 |
| `SERVER` | 4 | 第二轮 LongCat：no-feedback 2、no-board 1、adaptive 1；HTTP 500，endpoint unavailable | 未发现本仓库修复点；保留上游失败 |
| `EMPTY_RESPONSE` | 1 | 第二轮 Space Bunny / fixed 的 node-21：已完成响应无内容；在缺 `id` 的 `read_evidence` 调用后的一次独立模型调用 | 适配器明确识别空响应。不能用空内容冒充工具成功，未声称已修复模型输出 |
| **合计** | **35** | 每次原始 finish 事件与报告错误码数量一致 | **无遗漏** |

缺参数与含 NUL 的工具调用，原始 finish reason 是 `tool-calls`；随后在工具分派／校验时失败。因此实施说明所列的这些现象属于下一张表，而不是这 35 次的子集。

## 224 次工具执行错误

多数业务拒绝没有 `error.code`，分类器依据保留的错误文本确定细类，并保留原始 `errorCode: null`。下面的 category 是审计标签，不伪装成原运行错误码。

| category / 原始 errorCode | 次数 | 触发场景 | 修复或处置边界 |
|---|---:|---|---|
| `missing-board-write-revision` | 59 | 白板 publish 未传 `expectedRevision` | 请求 schema 只把 action 列为必需；说明文字要求写入版本，runtime 拒绝缺失值。存在机器可读条件约束不足，不能默认版本或降低原子写校验 |
| `directed-neighbour-guard` | 45 | 向非出边邻居发送 | 既有单向边约束应保留 |
| `missing-advertised-required-argument` / `INVALID_ARGS` | 33 | `to` 17、`body` 14、`id` 1、`kind` 1 缺失 | 原始 schema 已将其标为 required；调用未满足已声明的合同，不是漏注册参数 |
| `checkpoint-entry-guard` | 13 | 非入口提交 checkpoint | 宿主入口权限应保留 |
| `ablation-guard` | 11 | fixed 重连 6、no-feedback 评分 3、no-board 白板 2 | 实验负对照限制应保留 |
| `experiment-discovery-boundary` | 11 | 发现查询使用非允许元数据 | 实验证据隔离应保留 |
| `task-ownership-guard` | 10 | 非持有者结算 9、非请求者换边样本 1 | 真实身份与所有权校验应保留 |
| `board-author-guard` | 9 | 修改他人白板条目 | 作者权限应保留 |
| `stale-board-cursor` | 8 | 翻页期间白板／查询已变 | 重新读取；不能接受失效游标 |
| `peer-lifecycle-guard` | 6 | 连接失活节点 4、给退休节点发任务 2 | 生命周期校验应保留 |
| `argument-bound-violation` | 5 | topics 超 8 条 3、contribution 超 160 字符 1、空 cursor 1 | 保留运行期边界；工具说明与可表达 schema 应同步边界 |
| `unknown-task-reference` | 4 | 任务不存在或不属于网络；含一条模型模板片段污染的 taskId | 不应猜测并代换任务身份 |
| `cancelled-tool-call` / `ABORTED` | 2 | 运行结束时取消 | 单独计数，不能写成成功 |
| `peer-limit-guard` | 2 | 超过实验出度 2 | 保留拓扑约束 |
| `checkpoint-phase-guard` | 2 | 当前阶段已提交／阶段不符 | 保留一次提交规则 |
| `incoming-tool-name-contains-nul` / `UNKNOWN_TOOL` | 2 | `read\u0000\u0000\u0000`、`at\u0000status` | 已复现；归因边界详见下文 |
| `review-before-submission` | 1 | 评价没有完整持有者提交的任务 | 保留反馈资格校验 |
| `experiment-task-visibility-boundary` | 1 | 读取非本人任务内容 | 保留实验 ACL |
| **合计** | **224** | 全部类别均可回查原始 Session | **无遗漏** |

原始白板 schema 的版本字段虽然在文字中要求写入时必需，顶层 `required` 只有 `action`。当前 Harness 参数 DSL 无法在保持现有 action 与并列参数形态的同时，表达跨字段 `if/then` 条件。这个限制与“缺版本”现象均已记录，但不能据此断言 59 次错误全由 schema 导致；文本要求被忽略也是可能解释。本审计未移除版本要求、自动猜测版本或将历史失败改记为成功。工具描述的改进不等于证明该失败率已下降。

## NUL 专项复现和归因

原始位置是第二轮 Space Bunny / fixed、node-21 的 `atn-03822100-b63d-44e5-9f80-b4b291200140/session.v4.jsonl`：

| 证据位置 | 观察 |
|---|---|
| 第 12 行，`request/header`，seq 10 | 发送给模型的 11 个工具名均为普通 ASCII；包括 `read_evidence`、`atn_status`；整份工具 schema 无 NUL |
| 第 43 行，`assistant/message`，seq 41 | 在持久化的 `tool-call-chunks` 中，工具名已经是 `read\u0000\u0000\u0000`，随后分派使用完全相同的字符串 |
| 第 45 行，`tool/result`，seq 43 | `UNKNOWN_TOOL`；未执行证据读取 |
| 第 48 行，`assistant/message`，seq 46 | 第二个输入名称已经是 `at\u0000status`；参数也包含转义 NUL 污染 |
| 第 50 行，`tool/result`，seq 48 | `UNKNOWN_TOOL`；未执行 status |
| 同 Session 的文本流 | 也含 NUL 和模型模板片段，不仅仅污染工具名 |

审计还检查了全部 192 个历史 request/header：不合法的已注册工具名为 **0**。用于测试的[原始 NUL fixture](../tests/fixtures/tool-error-nul.json)仅截取请求工具定义、原始工具块及错误结果，不包含模型推理正文；原文件哈希和事件位置一并保留。

两层零付费复现均通过：

1. 使用安装的 `opencode-go-pi-ai` OpenAI completions 解析器，注入合成 HTTP SSE 响应。两个有效名称按原样通过；两个含 NUL 名称也按原样进入 `toolcall_end`；出站 schema 始终无 NUL。HTTP 由测试 `fetch` 完全替代，无外网或模型调用。这证明受测解析路径没有从正常工具注册生成 NUL，也没有擅自修复名称。
2. 将保存的两条 NUL 调用交给真实 Harness Agent Loop 和 ATN 工具注册表。两条均得到 `UNKNOWN_TOOL`，随后正常 `atn_status` 成功；所有后续请求的工具名仍无 NUL、无重复。未将未知工具模糊匹配到现有工具。

**可确证结论：NUL 在进入 ATN 工具分派前的响应流中已经存在，不是 ATN 工具注册、名称编码或工具 schema 在分派时产生。** 安装的适配层源码也是直接复制名称：`dsh-opencode-go@0.1.20` 的 `toStreamChunks` 把上游 `toolCall.name` 交给 Harness；其依赖 `opencode-go-pi-ai@0.87.1` 从 HTTP delta 的 `function.name` 取值。源码检查和合成响应复现支持响应路径污染的解释。

**尚不能确证的边界：原运行没有保存原始 provider HTTP/SSE。** 因此无法绝对区分提供商模型、网关与当时适配器状态，也不能将本次合成 SSE 说成原提供商故障的现场重现。报告保留 `providerVsAdapterAttribution: unresolved upstream of the Harness stream boundary`，没有将“provider 模型输出导致”写成已证实事实。继续精确定位需要新的原始响应证据；本次没有发起付费请求或声称修复外部模型。

## 复现与测试

```powershell
node --import tsx/esm experiments/tool-error-audit.ts
node --import tsx/esm --test tests/integration/tool-error-audit.test.ts
```

审计脚本要求原始 `.artifacts` 存在，重建检查入库的分类 JSON 与 NUL fixture。普通测试始终验证检查入库的 35 + 224 条分类、NUL 证据及真实分派；若没有分发历史 archive，仅跳过原 archive 重算测试，不跳过 fixture 测试。

本次实测：5 项测试通过，archive 重算没有跳过；`npx tsc -p tsconfig.json --noEmit` 通过。首次加入测试时因审计模块尚不存在失败（`ERR_MODULE_NOT_FOUND`），实现后通过。这是新增审计能力的先失败后通过记录，**不是声称生产 NUL 故障已修复**。NUL 两层测试用于保留原异常与证明已有隔离边界；未修改生产 runtime、名称或错误语义，也不存在可诚实宣称的生产“修复前错误、修复后消失”。

## 恢复后 Space Bunny 五次 fixed 校准的独立审计

以下仅统计 `.artifacts/experiments/measurability-live-fixed-20261005-v2` 的五次真实调用，不并入前述历史 **35 / 224**，也不混入 LongCat。完整分类见 [measurability-live-tool-errors-20261005.json](../experiments/results/measurability-live-tool-errors-20261005.json)：保留全部 129 条工具错误、10 条 finish error 的原位置和 SHA-256，以及各报告、源码哈希和 NUL 边界证据；未收录完整模型正文。

| seed | 工具错误 | finish error | 阶段 1 提交／正确 | 阶段 2 提交／正确 | 停止原因 |
|---|---:|---:|---|---|---|
| 17 | 17 | 8 | 是／是 | 是／是 | `phase-2-submitted` |
| 31 | 26 | 0 | 是／是 | 否／否 | `observed-token-limit` |
| 45 | 36 | 1 | 是／是 | 否／否 | `observed-token-limit` |
| 59 | 22 | 0 | 是／是 | 是／是 | `phase-2-submitted` |
| 73 | 28 | 1 | 是／是 | 是／是 | `phase-2-submitted` |
| **合计** | **129** | **10** | **5 / 5 正确** | **3 / 5 正确** | **未达到 4 / 5 门槛** |

每次工具错误数量均与该次报告一致，未分类为零。10 次 finish error 单独为 `TRANSPORT` 7、`TIMEOUT` 2、`EMPTY_RESPONSE` 1。

| 工具错误类别 | 次数 |
|---|---:|
| 实验白板发现元数据越界 `experiment-board-discovery-boundary` | 59 |
| 非出边邻居发送 `directed-neighbour-guard` | 16 |
| 非入口 checkpoint `checkpoint-entry-guard` | 15 |
| 缺已声明必需参数 `missing-advertised-required-argument` | 10 |
| 失效白板游标 `stale-board-cursor` | 6 |
| fixed 重连拒绝 `ablation-guard` | 5 |
| 输入工具名含 NUL `incoming-tool-name-contains-nul` | 3 |
| 其余 10 个明确类别（逐条见 JSON） | 15 |
| **合计** | **129** |

59 次元数据拒绝来自实验的访问隔离规则：白板 `documents` 与 `topics` 只能来自当前节点、当前阶段的发现提示，证据必须进入计量正文。运行中可见自定义标签、非本节点标识以及阶段切换后可能失效的旧提示；不能把全部 59 次归成同一种模型行为，也不能归成生产 schema 注册失败。错误分类用于描述观察到的协议负担，不能据此分配最终失败或 token 消耗的因果比例。

本批共观察到 **369 次白板调用、181 次 publish**；publish 缺 `expectedRevision` 为 **0**，版本相关错误为 **0**。该结果可作为本批观察，不能单独证明描述改进造成了历史缺版本错误下降，因为任务配置和其他提示也同时改变。

新 `atn_status` 共 **102 次调用**：含 `review` 的 **21 次全部成功**，含 `rewire` 的 **5 次均被 fixed 拓扑禁令拒绝**。40 份请求头均无非法或重复注册名称，未发现 `status.review`／`status.rewire` 的新增注册或 schema 故障。fixed 拒绝属于保留的实验边界。

仍有 **3 次 NUL 工具名**，均在 seed 45：`atn\u0000_board` 1 次、`at\u0000_board` 2 次。对应请求注册名称正常，进入 Harness 的响应流中已带 NUL；归因仍止于响应流边界，缺原始 HTTP 证据不能进一步断言由提供商模型而非网关或适配器造成。两次阶段 2 未提交的运行已按实际 `observed-token-limit` 保留；本审计没有修题、放宽边界或隐藏失败。

## v3 源码、32 步 Space Bunny 五次的独立审计

目录 `.artifacts/experiments/measurability-live-fixed-steps32-20261005` 使用 32 步、256 调用、4m 观测 token 阈值和 600 秒期限，五个种子均提交且答对两个阶段。该批绑定 **v3 源码**，之后的源码修复及 v4 重复校准另计；不会以这批成功替换前述 20 步结果，也不会用历史源码结果直接打开当前源码闸门。源码快照保存在 `.artifacts/measurability/source-v3/`，完整错误索引见 [measurability-live-steps32-tool-errors-20261005-v3.json](../experiments/results/measurability-live-steps32-tool-errors-20261005-v3.json)。

| seed | 工具执行错误 | finish error | 两阶段均正确 |
|---|---:|---:|---|
| 17 | 30 | 0 | 是 |
| 31 | 35 | 0 | 是 |
| 45 | 22 | 0 | 是 |
| 59 | 33 | 0 | 是 |
| 73 | 17 | 0 | 是 |
| **合计** | **137** | **0** | **5 / 5** |

| 工具错误类别 | 次数 |
|---|---:|
| `experiment-board-discovery-boundary` | 63 |
| `checkpoint-entry-guard` | 23 |
| `missing-advertised-required-argument` | 14 |
| `directed-neighbour-guard` | 13 |
| `ablation-guard`（fixed 重连） | 10 |
| `stale-board-cursor` | 4 |
| `board-author-guard` | 3 |
| `task-ownership-guard` | 2 |
| `network-node-capacity` | 2 |
| `stale-board-write-revision` | 1 |
| `missing-board-key` | 1 |
| `unknown-task-reference` | 1 |
| **合计** | **137** |

逐次与报告的工具错误数、finish error 数对齐；未分类为零，40 份请求头无非法或重复注册名。**388 次白板调用中 202 次 publish，缺版本为 0；有 1 次旧版本写入被拒绝**，实际传入 0、当前版本为 83，归为精确版本守卫而非缺参数。**97 次 status 调用中 15 次 review 全成功，10 次 rewire 均被 fixed 禁令拒绝**；未发现这两个合并参数的新增注册或 schema 故障。本批没有 NUL 工具名，但不能据此宣称此前的上游异常已修复。

137 次工具拒绝在成功运行中仍完整保留。5/5 是该批特定源码和资源条件的可行性结果；不同预算、调用量与提供商响应使原始错误总数不适合直接作为修复效果率比较。

可从原始 Session 重新生成该独立索引；脚本遇到未知错误会失败，必须显式分类后再输出：

```powershell
node --import tsx/esm scripts/audit-measurability-tool-errors.mjs --directory .artifacts/experiments/measurability-live-fixed-steps32-20261005 --out experiments/results/measurability-live-steps32-tool-errors-20261005-v3.json
```

## 当前 v4 源码、32 步 Space Bunny 五次的独立审计

当前批次 `.artifacts/experiments/measurability-live-fixed-steps32-20261005-v4` 沿用 v3 的显式条件，五个种子均提交且答对两个阶段，完整结果与错误均保留。五次报告与 manifest 的源码 SHA-256 一致，且全部匹配当前受测源码；汇总的 `selectedLiveCalibration` 指向这批 **5/5、gate=passed** 的真实运行。这里只通过 fixed 可行性闸门，没有运行四臂比较，也不解释拓扑收益。该批与历史 35／224、20 步 v2 的 129 条、32 步 v3 的 137 条分别统计。

完整分类、原始位置、文件和报告哈希见 [measurability-live-steps32-tool-errors-20261005-v4.json](../experiments/results/measurability-live-steps32-tool-errors-20261005-v4.json)。

| seed | 工具执行错误 | finish error | 两阶段均正确 |
|---|---:|---:|---|
| 17 | 20 | 0 | 是 |
| 31 | 30 | 0 | 是 |
| 45 | 37 | 0 | 是 |
| 59 | 19 | 0 | 是 |
| 73 | 16 | 0 | 是 |
| **合计** | **122** | **0** | **5 / 5** |

| 工具错误类别 | 次数 |
|---|---:|
| `experiment-board-discovery-boundary` | 62 |
| `directed-neighbour-guard` | 21 |
| `missing-advertised-required-argument` | 11 |
| `stale-board-cursor` | 10 |
| `checkpoint-entry-guard` | 9 |
| `ablation-guard`（fixed 重连） | 4 |
| `task-ownership-guard` | 1 |
| `argument-bound-violation` | 1 |
| `review-before-submission` | 1 |
| `incoming-tool-name-contains-markup` | 1 |
| `missing-board-key` | 1 |
| **合计** | **122** |

每个运行的工具错误及 finish error 数均与原报告一致，未分类为零。40 份请求头无非法或重复注册名。**349 次白板调用、171 次 publish，缺版本及旧版本写入错误均为 0**。**98 次 status 调用包含 20 次 review（19 成功，1 次因任务尚无完成提交而被拒绝）、4 次 rewire（均被 fixed 禁令拒绝）**；没有观察到合并参数的注册或 schema 故障。

本批无 NUL 名称，但 seed 59 出现一种新的 `UNKNOWN_TOOL`：1100 字节的工具名以 `atn_send>` 开始，后面混入 `<body>`、`<invoke>` 等调用标记和参数文本。对应 Session 的第 12 行请求头注册正常；第 34 行输入流已含这个完整畸形名称，第 35 行按同名分派，第 36 行拒绝未知工具。索引保留这些事件的行号、seq、文件哈希，以及畸形名称 SHA-256 `932a5ca20f89e618721a4e5cfb7b4aebc3391a2c87dee29ed1d91bf41c219120`，不嵌入其中的完整正文。名称污染发生在 ATN 分派之前；没有原始 HTTP，仍不能区分提供商模型、网关和当时适配层。没有模糊匹配、执行畸形工具或宣称上游输出问题已修复。

复现本批只读审计：

```powershell
node --import tsx/esm scripts/audit-measurability-tool-errors.mjs --directory .artifacts/experiments/measurability-live-fixed-steps32-20261005-v4 --out experiments/results/measurability-live-steps32-tool-errors-20261005-v4.json
```
