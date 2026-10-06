# dsh-ATN 可测性恢复实施说明

这份文档交给实现代理执行。上一轮（P0–P5）把反馈、发现、白板、拓扑约束和两阶段任务都建了起来，工程上成立，但真实模型实验没有产出一个可解释的结论。本轮**不新增任何机制**，目标是让后续实验第一次变得可测量：基础任务可解、协议成本可控、判据不再按构造不可达。

实现代理在动手前必须先完整阅读本文件，并按第 7 节的完成标准交付。

## 1. 当前基线

- 工作区：`D:\dsh-ATN`，分支 `codex/release-ready`。
- `npm test` 为 371 项 runtime／集成测试 + 8 项 UI 测试通过；`npm run typecheck`、`npm run build`、`npm run smoke:profile` 通过。
- 模型工具面 9 个：`atn_start`、`atn_spawn`、`atn_send`、`atn_status`、`atn_board`、`atn_feedback`、`atn_publish`、`atn_rewire`、`atn_finish`（`src/tools.ts`）。
- 共同规则 9 行（`src/tools.ts` 的 `SHARED_RULES`）。
- 参考实验：两轮 24 次真实运行，见 `docs/FULL_FEEDBACK_EXPERIMENT.md` 与 `experiments/results/full-feedback-20261005.json`。

## 2. 上轮已确证的事实

以下三条不是推测，是实现代理需要知道的前提。

### 2.1 换边证据判据按构造不可达

`selectRequesterRewireSamples`（`src/requester-feedback.ts`）要求：被移除的旧边**和**新加入的边，各自都存在同一请求者评过分的、带同一 `comparisonKey` 的样本。但 `atn_send(kind=task)` 只能发给自己的出边邻居，所以新加入的边在换边那一刻**必然没有任何历史任务**，candidate 侧恒为空。

持久记录中的实证（`.artifacts/experiments/full-feedback-bounded-20261005/space-bunny-free-adaptive-seed-17/storage/atn_networks.json`）：node-3 的一次换边 `[node-1, node-6] → [node-12, node-6]`，结果为

```json
{ "verdict": "insufficient-evidence",
  "baselineTaskIds": [], "candidateTaskIds": [],
  "reasons": ["empty-sample", "baseline-uncovered-peer", "candidate-uncovered-peer", "..."] }
```

node-3 对被移除的 node-1 和被加入的 node-12 都没有已评分任务。

确定性里程碑之所以能出现一次 `observed-improvement`，是因为脚本写死了序列：`experiments/feedback-milestone.ts` 先连上候选、对两侧各探一次并打分、断开候选、再连回来。只有"重新加回一个曾被你删掉的同伴"能凑齐两侧样本。真实模型在 20 步预算内不会执行这支舞蹈，提示词也没有要求它这样做。

**结论：74/74 `insufficient-evidence` 不是模型行为问题，是判据问题。**

### 2.2 真正的瓶颈是余量和协议成本，不是拓扑

- 第二轮 12 次运行：5 次停在 `observed-token-limit`，1 次超时，只有 6 次提交了第二阶段；两阶段均正确 **1/12**。
- 但协作本身成功了：持久记录里模型解出了第一阶段完整链（`key-00(witness-4uqi8w) → key-13(witness-d99jff) → key-05(witness-3215dt) → key-01(witness-1y6u5z) terminal=release-1-e3rar0`），并在真实交换证据、发布元数据、中继、上板。
- 失败集中在三处：入口未及时提交第一阶段 checkpoint（3 次出现"阶段 2 正确、阶段 1 未提交"）；第二阶段锚点（新 root holder）无人发布；工具执行异常（两轮 35 次 finish error，含缺参数、EMPTY_RESPONSE、工具名含 NUL）。
- 唯一两阶段全对的 DeepSeek／fixed 运行，通信量是参考策略的 3.89 倍、字节数是 6.04 倍。
- 模型仍在用长邮件广播（单封约 700 字节，"mail me ALL your facts verbatim"），白板没有取代广播。

**结论：`1/12` 主要衡量提交纪律和预算，不是群体解决问题的能力。没有余量就没有可测的涌现。**

### 2.3 为了测量而增加的开销，正在制造它要测量的失败

P0–P2 增加了 3 个模型工具和更多每次调用都出现的固定上下文。结果：token 上限从上轮的"不是约束"变成这轮的头号停机原因。工具 schema 和共同规则是**每一次模型调用**都要付出的固定成本，因此工具面收敛既是省 token，也是省步数。

## 3. 本轮目标与明确不做的事

### 目标

- **G1 可解**：`fixed` 臂在重复校准中稳定解出两阶段（≥4/5）。
- **G2 收敛**：模型工具面 ≤6 个，共同规则 ≤6 行。
- **G3 降本**：单次调用的固定上下文（系统提示 + 工具 schema）和平均输入 token 相比本轮基线明显下降，并给出实测数字。
- **G4 判据**：换边判定不再要求新边预先存在样本，且能区分"新边尚未被观测"和"反馈通道没被使用"。
- **G5 归因**：工具执行错误按原因分类；凡由工具注册或 schema 引起的必须修复。
- **G6 可测**：实验准入闸门、主指标和报告口径按第 6 节重写并落地。

### 明确不做

1. **不新增任何模型工具、共享介质或协议概念。**
2. **不为了让实验通过而提高默认预算上限。** 任何预算变更只能是实验条件的显式参数，且两臂必须一致。
3. **不改** runtime 的原子 mutation 队列、持久投递回执、所有权与生命周期语义。
4. **不做因果声明**，不把工程通过当成智能收益。
5. **不删除已有测试，不降低断言强度。**

## 4. 必须实施的项目

### 4.1 重做换边判据：从"换边瞬间归因"改为"按边事后累计"

现状：`evaluateRequesterRewireEvidence` / `selectRequesterRewireSamples`（`src/requester-feedback.ts`）在换边时刻要求两侧预存匹配样本，见 2.1。

要求：

- 定义边 `edge = (requesterId, holderId, comparisonKey)`。每次请求者对结果打分时，为该 edge 累计一个样本；计数持久保存。
- 换边时**不再要求** candidate 侧已有样本。`requesterEvaluation` 记录被移除边的既有累计，并把新增边标记为 `unobserved`。
- 判定时机改为**事后**：新增边首次产生评分后，或网络停止时，重算并更新该次换边的 `requesterEvaluation`。只有两侧都达到最小样本数 `M`（建议 `M=2`，可配置）时才允许出现非 `insufficient-evidence` 的 verdict。
- `insufficient-evidence` 的 `reasons` 必须能区分：
  - `new-edge-unobserved`：正常状态，新边还没被用过；
  - `no-ratings-at-all`：请求者从未给任何结果打分，说明反馈通道没被使用。
  这两个原因不得再合并成同一个 `empty-sample`。
- 保留 `causalClaim: false`，不把边级相关性写成因果。

验收测试（真实 runtime + 可控时钟，零付费模型）：

- 换边到一个从未合作过的新同伴，`reasons` 含 `new-edge-unobserved`，**不含** `baseline-uncovered-peer` 之类的"样本缺失"归因。
- 新边产生两次 accepted 评分后，同一请求者的下一次换边能算出非 `insufficient-evidence` 的 verdict。
- 请求者一个评分都没给时，`reasons` 含 `no-ratings-at-all`，与上一条可区分。
- 一个从未请求过任何任务的节点换边，仍不会产生虚假的正向结论。

### 4.2 收敛模型工具面：9 → ≤6

现状：9 个工具，schema 在每次调用都占固定上下文。

要求：

- **`atn_feedback` 并入 `atn_status`。** `atn_status` 已经是"读取 + 一个可选原子写"的形态（`claimTaskId`）。新增可选参数 `review`，结构为 `{ taskId, status: accepted|rejected|needs-more, summary, evidence, comparisonKey? }`，语义和校验与现 `atn_feedback` 完全一致。删除独立工具。
- **`atn_publish` 并入 `atn_board`。** 白板条目就是知识发布：`atn_board` 的 publish 增加可选 `documents` 和 `topics` 字段；发现（`atn_status` 的 query/candidate）改为检索白板条目与任务元数据，不再依赖独立的 `knowledgeFingerprint` 索引。删除独立工具。
  - 兼容：旧记录里的 `knowledgeFingerprint` 仍可读，读到时按只读元数据处理，不报错。
- `atn_start`、`atn_spawn`、`atn_send`、`atn_status`、`atn_board`、`atn_rewire`、`atn_finish` 之外的任何模型工具都不再有。
- 共同规则（`SHARED_RULES`）收敛到 ≤6 行，且以行为为主（先读、再查、后问；发布到板；给结果打分；据记录选同伴；结算与交付），不写实现细节。
- 记录并报告 `systemPromptBytes`（规则）与 `toolSchemaBytes`（全部工具定义）两个固定成本数字，作为 4.3 的基线。

验收测试：

- 工具注册表恰好包含上述 6–7 个 ATN 工具；`atn_feedback` / `atn_publish` 不再存在。
- `atn_status(review=...)` 的行为与旧 `atn_feedback` 等价：所有原有 feedback 测试保持通过（迁移断言，不降低强度）。
- `atn_board` publish 带 `documents`/`topics` 后，`atn_status(query=...)` 能按这些元数据发现该节点。
- 旧记录（含 `knowledgeFingerprint`、无白板条目）可正常加载和查询。

### 4.3 降低每次调用的固定上下文

要求：

- 在实验计量里新增 `fixedContextBytes`（规则 + 工具 schema）与 `meanInputTokensPerCall`，并保留每次运行的分布，不只给均值。
- 同一任务线程里的重复样板（task 头、`Settle it with atn_send...`、`completed records your submission...` 等）不得在每条后续邮件里整段重复；保留一次即可，后续消息只带 `task` 标识和必要差异。
- 局部反馈摘要（`topology-feedback.ts`）与白板读取结果都要有明确字节上限，并在超限时截断而不是整段注入。
- 给出实施前后 `systemPromptBytes`、`toolSchemaBytes`、`meanInputTokensPerCall` 的实测对比。

验收测试：

- 新增单元测试固定 `fixedContextBytes` 的上界；超过即失败。
- 同一任务的第二条及以后邮件，其模型可见长度显著小于第一条（用确定性的 fixture 断言）。
- 反馈摘要超过上限时被截断，且截断不改变语义字段（peer id、计数）。

### 4.4 让基础任务在预算内可解

现状：`shifting-evidence` 是 8 节点、出度 2、**四跳**依赖链，两个阶段，每节点 20 步；入口还要自己走完整条链并提交。上轮 5/12 死于 token 上限。`shifting-evidence-task.ts` 还让宿主在半预算时自动推进阶段，与入口提交第一阶段 checkpoint 竞争。

要求：

- 把链长、每节点步数、调用上限、输出上限做成显式实验参数，并做一次**校准扫描**（建议链长 2/3/4 × 每节点步数 20/32/48），选出 `fixed` 臂 ≥4/5 通过的最低配置。
- 自动推进阶段改为可配置（默认关闭）。若开启，报告中必须显式标注该运行发生过自动推进。
- 提示词明确要求：第一阶段 checkpoint 一旦能拼出就必须提交；"至少留一半步数给第二阶段"这类约束改为按实际配置表述。
- 校准结果写入报告；不得事后调整题库来迁就已经跑出的数据。

验收测试：

- 校准脚本可在零付费模型下运行，输出每个配置的完成率。
- 对最终选定配置，`fixed` 臂在 ≥5 次重复中 ≥4 次两阶段均正确，且这 5 次运行的全部产物保留。

### 4.5 修正两阶段评价口径

现状：主指标是"两阶段均正确"，而 3 次运行出现"阶段 2 正确、阶段 1 未提交"，被记为失败。这混淆了"没解出来"和"没提交"。

要求：

- 四个独立布尔：`phase1Submitted`、`phase1Correct`、`phase2Submitted`、`phase2Correct`。
- 主指标仍是 `phase1Correct && phase2Correct`；报告必须同时给出 `phase1Submitted` 与 `phase2Submitted` 的比例。
- 只要 `phase1Submitted` 为假，就必须在报告中把该运行标记为"提交纪律失败"，与"求解失败"分开统计。

验收测试：

- 构造"阶段 2 正确但阶段 1 未提交"的确定性场景，报告能把它与"求解失败"区分开。

### 4.6 分类并修复工具执行错误

现状：两轮 35 次 finish error，含缺参数、EMPTY_RESPONSE 和"工具名含 NUL"。后者可能是模型输出问题，也可能是工具注册／schema 问题。

要求：

- 输出一张错误分类表：`errorCode → 次数 → 触发场景 → 是否可修复`。
- 专门复现"工具名含 NUL"这一例。若由 ATN 工具注册、名称编码或 schema 引起，必须修复；若确认是 provider 侧模型输出问题，必须在报告中明确写出该结论和证据。
- 修复项要有"修复前失败、修复后通过"的测试。

验收测试：

- 分类表覆盖全部 35 次错误，无未分类项。
- 若做出修复，新增对应回归测试。

## 5. 必须保留的既有语义

- 入口 Agent 始终由宿主拥有；完成、停止、退休都不 `dispose` 入口。
- 网络记录仍是唯一原子持久化单元；所有"检查 + 修改"在同一 mutation 临界区内完成。
- 边是单向的；出生谱系 `creatorId` / `selectedChildId` 只作追溯，不决定协作。
- 工具身份、发送者、投票者一律取自真实 live Agent，模型参数不可伪造。
- 同伴文本不构成人类授权；请求者评价不构成宿主验收。
- 白板的作者权限、精确版本、分页失效、读写计量语义不变。
- 不得把 `stepBudget` 宣称成 token、HTTP 请求或费用上限。

## 6. 实验协议与判据（重写）

- **准入闸门**：任何"自适应 vs 固定"的解释，必须建立在 `fixed` 臂于选定配置下 ≥4/5 通过之上。闸门未达成就只报告可行性，不解释拓扑。
- **四臂**保持：`adaptive`、`fixed`、`no-feedback`、`no-board`。差异仍需结合 `no-board` 解读。
- **重复**：任何比较每臂 ≥5 次；报告每次运行，不做隐藏失败的聚合。
- **主指标**：`phase1Correct && phase2Correct` 的比例。
- **成本指标**：`atnTotalInteractions`、`atnTotalTransferBytes`、`meanInputTokensPerCall`，以及相对参考策略的倍数。
- **旧里程碑作废**：不再把"换边 verdict 不再是 `insufficient-evidence`"当作目标或判据。它是归因质量指标，不是能力指标。边级判据只作诊断输出。
- 所有失败、超时、工具异常和未知 usage 照常保留；源码哈希照常记录。

## 7. 完成标准

实现代理必须完成以下命令并保留输出摘要：

```text
npm test
npm run typecheck
npm run build
npm run pack:tarball
npm run smoke:profile
```

并且：

1. 所有原有测试继续通过；迁移到 `atn_status(review=...)` 和 `atn_board` 的断言强度不降低。
2. 4.1–4.6 各自的新增测试在修复前失败、修复后通过。
3. 工具面确实 ≤6，规则确实 ≤6 行；给出 `fixedContextBytes` 和 `meanInputTokensPerCall` 的前后实测数字。
4. 完成一次零付费模型的校准扫描，选出 `fixed` 臂 ≥4/5 的配置；报告写入 `docs/`。
5. README、`docs/FULL_FEEDBACK_EXPERIMENT.md` 与本轮报告同步记录实际通过项与仍未完成项。**不得把未测试内容写成已通过。**

交付物：

- 代码与测试改动。
- `docs/` 下的一份本轮实施与校准报告。
- 错误分类表（4.6）。
- 固定上下文与输入 token 的前后对比数字（4.3）。
