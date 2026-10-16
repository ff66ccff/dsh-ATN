# dsh-ATN Substrate 协作面引入实施说明

> 机制来源：**ScaleMAS — Scaling Multi-Agent Intelligence with Substrate-Centric Coordination**（arXiv:2610.16120v1，FAIR at Meta / Meta AI / Harvard，2026-10-12）。本地副本：`papers/2610.16120v1.pdf`。
> 性质：**机制引入**，不是依赖对齐，也不是性能优化。本轮新增 3 个模型工具与**第 14 条出站通道**，并把"发布"从被删除的自由文本白板**有据地**恢复为可核验的结构化 substrate。

这份文档交给实现代理执行。动手前必须完整阅读本文件，并按第 11 节完成标准交付。

## 0. 已由用户拍板的三项决策（不得自行改判）

| 决策 | 结论 | 影响 |
|---|---|---|
| 接入姿态 | **默认同时启用** | 模型面由 5 个工具变为 **8 个**；固定上下文字节基线必须重测；`SHARED_RULES` 与全部"五工具"声明需同步改写 |
| 引文权重 | **纳入，但可配置关闭** | 默认 `substrateCitationWeight=true`；提供 `false` 回退为纯 BM25；未来可作零模型消融臂 |
| 验证口径 | **仅零模型结构验证** | 不新增真实模型调用；**不主张任何正确率／效率／成本增益**；论文结论不可迁移（第 3.3 节） |

## 1. 机制提炼（论文契约，实现必须与之一致）

论文把多智能体协作从"agent-centric"（工作流／协调者／点对点消息）改为"substrate-centric"：把协作结构放进**共享介质**，agent 只与介质交互。三个必须落地的部分：

### 1.1 数据存储与消息形状

- 数据存储 `D` 是**只追加**的消息序列；消息获得下一个地址写入，**永不编辑、永不删除**，因此引用永远解析到写入时的正文。
- 单条消息 `m = (u, a, r, R)`：`u` 子任务（用"将来会用什么词去搜它"的措辞写成）、`a` 产出物（可被直接接续、不必重做的结果）、`r` 简短理由、`R` 引用集合。
- 引用 `R` 指向**更早的消息**或**任务自身工具暴露的资源**；引用构成只在最新端增长的 DAG。
- 参数（Table 6）：单消息最多 **32** 条引用；每条消息 `u`+`a` 受长度上限约束（论文按 benchmark 取 256 或 1,024 tokens）。

### 1.2 三个操作

| 操作 | 语义 | 论文细节 |
|---|---|---|
| `publish(u, a, r, R)` | 追加一条消息；从该时刻起对所有 agent 可读 | 校验失败则**整条不写**，并指出出错的那条引用 |
| `search(q)` | 自由文本检索，返回**最多 k** 条最高排名消息 | k=8；只排"检索分 > 0"的消息；并列取**更早**的消息 |
| `visit(m1…mj)` | 按地址取回指定消息 | 每次调用最多 k 个地址 |

读回的消息展示**四个字段 + 它引用的消息 + 引用它的最近至多 8 条消息**；**永不展示作者，也永不展示引用权重**——读者靠内容与链接判断。

### 1.3 两条准入规则（论文唯一的写入约束）

1. **引用必须真实存在**：每条引用都指向确实存在的东西（正文里表述为"只能引用你确实见过的东西"）。
2. **理由必须点名每条引用并说明它贡献了什么**：把引用从"顺带一提"变成**可被读者对照被引正文检查的显式依赖**。

### 1.4 权重与排序

- 新消息权重 `s0 = 0`。
- 每当一条消息引用 `m`，`m` 的权重朝 1 前进一个比例：`s ← s + α(1 − s)`（α=0.3），每条引用它的消息执行一次。
- 群体每推进一步，全部权重衰减：`s ← βs`（β=0.98）。
- 指向任务资源的引用**不携带权重**。
- 排序：`score(q, m) = s_m + Rel(q, m) / max_{m'∈D} Rel(q, m')`，`Rel` 用 BM25（k1=1.5、b=0.75）。**权重只能重排已相关的消息，永远无法把一个不相关的消息顶上来。**

### 1.5 论文的实测结论（仅作背景，**不得当作本插件的主张**）

论文在 4 个基准、2 个骨干模型上报告：随群体规模增长而提升（扩展到 128 agent）、同算力下优于 MAD/DeLM/AOrchestra/并行 ReAct、容忍 1 个永久失败 agent 与 p=0.8 的随机掉线、去掉引用权重后 BrowseComp-Plus N=8 由 60.0% 降到 40.8%、Contradiction Audit x4 由 23.1% 降到 9.7%。**这些数字来自论文自己的 harness、基准与基线，与本仓库的 11 轮等预算线不可比，不得转述为 dsh-ATN 的收益。**

## 2. ATN 侧映射（"有机结合"的具体含义）

### 2.1 概念映射

| 论文概念 | ATN 现状 | 本轮取舍 |
|---|---|---|
| 数据存储 `D` | 0.5.0 已删除自由文本白板；现只有邮箱（`mailRecordSchema`）与任务（`taskRecordSchema`） | 在网络记录内新增**结构化 substrate**，与邮箱、任务并列，不替换任何一条 |
| `publish / search / visit` | 无（`atn_send` 是点对点推送） | 新增 `atn_publish / atn_search / atn_visit` 三个工具，**默认启用** |
| 引用 `R` | `TaskRecord.result.evidence` 是字符串数组（注释明确允许 message id） | 建立统一引用命名空间 `msg:<n>` / `task:<id>` / `artifact:<id>`；交付证据可引用 substrate 消息 |
| "引用必须存在" | 无对应规则 | 升级为宿主可判定的**确定性准入**：`msg:` 必须存在且可见；`task:` 必须存在且对作者可见；`artifact:` 必须**在作者真实保管集合中** |
| "理由必须点名每条引用" | 无 | 宿主只校验**点名**（确定性 token 检查）；"说清贡献"属语义，宿主不判定，必须写成限制（第 12.2 节） |
| 引用权重 `s_m` | 无；`atn_status(query)` 用词项/短语匹配打分（`src/knowledge.ts:96`） | 新增消息级权重（定点整数、可关闭），**不改动**既有发现打分 |
| 消息在生产者离开后仍在 | 孤儿任务可被 `atn_status(claimTaskId=…)` 原子认领 | subtitle 让"认领后追读上下文"成为一条独立能力；退休只停推送，**不删消息** |
| 读取有界 | 邮箱是按接收者推送、逐条注入 | substrate 是**纯拉取**：发布不产生邮件、不唤醒任何节点，读取只消耗调用者自己的步数 |
| 交付 = 答案 + 引用（证据链） | `atn_finish(scope="network", summary, evidence, goalVersion)` | 证据链 = 交付所引消息的**引用传递闭包**，由宿主计算并可导出为审计工件 |

### 2.2 与 0.5.0 白板移除的关系（必须写进报告）

0.5.0 删除白板的理由是**不可核验**：自由正文可夹带任意事实，agent 可自报虚假发现元数据，宿主无从判定。substrate 与它的差别是结构性的，不是措辞上的：

| 维度 | 已删除的白板 | 本轮 substrate |
|---|---|---|
| 载荷形状 | 自由文本 | 严格四字段 + 引用集合，schema 逐字段校验 |
| 写入准入 | 仅作者权限与版本号 | 引用必须存在／必须可见／资源引用必须真实持有；理由必须点名每条引用 |
| 排序 | 作者与调用顺序 | 确定性排序：只排正相关，权重不能顶起无关消息 |
| 质量信号 | 无 | 引用权重：行为派生、会衰减、不展示、不授予任何权限 |
| 自报元数据 | 可用白板虚报专长（0.5.0 修复前失败留档见 `docs/information-boundary/PRE_FIX_RECORD.md`） | **不改变**发现路径：`atn_status` 的文档/主题仍由宿主 custody + descriptor 反向派生（`src/knowledge.ts:40`） |
| 读有界性 | 8 条 / 16 KiB | 最多 k 条消息、每条独立字节上限、每次调用独立上限 |
| 容量行为 | 满则明确拒绝，不静默驱逐 | 沿用：满则拒绝（`substrate-full`），**不得**驱逐或覆盖既有消息 |

结论：substrate 是白板的**结构性继承者**，并且把白板最大的漏洞（写入不可核验）焊死在准入规则与保管层上。

### 2.3 与现有层级的接口

- **保管层（写侧）**：`publish` 成为第 14 条受控出站通道，进入 `OUTBOUND_CHANNELS`，受 `installOutboundPolicy` 与 `defineCustodyPolicy` 覆盖。资源引用 `artifact:<id>` 的持有判定复用同一 `CustodyResolver`——**没有第二条判定逻辑**。
- **拓扑层**：substrate **不改变**可达性判定。协作边仍决定 `atn_send` 的合法性、重连与出度；substrate 读取不因边而变（与论文一致：agent 不经彼此、只经介质）。不得把 substrate 说成"绕过拓扑"或"替代拓扑"。
- **预算层**：三个操作在调用者已被准入的模型步内执行；**不新增步预算口径**，也不得把 substrate 读写折算成 token 或费用。
- **生命周期**：网络完成/停止时 substrate 随之归档（论文：数据存储为单个任务而生、随任务丢弃）；节点 `draining`/`retired`/`failed` **不删除**其消息。
- **唤醒语义**：发布不推送、不产生邮件、不唤醒空闲节点（与 0.5.0 白板的既定性质一致，仓库已有"无额外唤醒"测试）。读取是调用者主动行为。

## 3. 战略红线核对（必须原样留档在实施报告中）

`docs/STRATEGY_AND_POSITIONING.md` 第 2.2 节列了两条"坚决不做"的高压线。本轮逐条对照如下，结论须经用户已确认的决策背书：

### 3.1 对"不再设计中心仲裁、白板公告"的核对

- **不引入中心仲裁**：substrate 没有协调者、没有调度者、没有轮次；运行时不为任何节点分配角色或工作。
- **"白板公告"的字面禁令针对的是 0.5.0 删除的那一类**（自由文本、可虚报、不可核验）。substrate 的写入是**确定性可判定**的（第 2.2 节表），因此它落在该禁令想要排除的缺陷之外；但**这是对既有决定的一次有意修订**，必须在 `DECLARATION_AUDIT.md`、`OUTBOUND_CHANNEL_AUDIT.md` 与实施报告中显式声明"0.5.0 的发布禁令在本轮被有据地、受限地解除"，不得静默改测试。
- 该修订**只解除"结构化可核验发布"**，不恢复自由正文通道、不恢复 agent 自报知识接口。

### 3.2 对"不再加声誉算法"的核对

引用权重与"声誉算法"必须被严格区分，并把区分写进文档：

| 属性 | 声誉算法（被禁） | 引用权重（本轮引入） |
|---|---|---|
| 作用对象 | **节点／agent** | **单条消息** |
| 用途 | 影响信任、选择、授权 | 只在一个查询的相关结果内部**重排** |
| 来源 | 评分／评价聚合 | 行为派生：被后来的消息引用即上升，无人引用即衰减 |
| 是否展示 | 通常是公开的社交信号 | **永不向模型展示**（论文明确规则） |
| 是否授予权限 | 通常影响谁能做什么 | **不授予任何权限**；不参与 `rewire`、不参与 custody、不参与认领 |
| 能否放大无关信息 | — | **不能**：只排正相关消息 |
| 可关闭性 | — | `substrateCitationWeight=false` 可整体关闭 |

### 3.3 对"不宣称更快／更聪明／涌现"的核对

本轮**只**允许声明以下结构性属性（每条都必须有零模型测试背书）：

1. 每次读取的消息条数与字节数有上界，与群体规模、数据存储规模无关。
2. 排序是数据存储内容的纯函数，可由持久记录逐字节重放（无浮点、无时间依赖）。
3. 写入准入失败是原子的：不追加消息、不消耗地址、不改变任何权重、不产生业务 mutation。
4. 消息在生产者退休/失败后仍可读；新节点可通过检索追平进度。
5. 发布不产生邮件、不唤醒任何节点、不产生模型调用。

**禁止**由此写出"协作更好／更快／更高正确率"，也禁止把论文第 1.5 节的任何数字写成 dsh-ATN 的结论。

## 4. 必须实施的项目

### 4.1 模型工具与提示词

要求：

- 在 `src/tools.ts` 新增三个工具，命名 `atn_publish`、`atn_search`、`atn_visit`；身份一律取 `requireCaller(ctx, exec)`（既有函数），**不得**从参数取发送者。
- `atn_publish`：`sub_task`(string,必填)、`artifact`(string,必填)、`rationale`(string,必填)、`refs`(string[],可选，≤32)。返回新消息地址与当前权重纪元。
- `atn_search`：`query`(string,必填)。返回 ≤k 条，每条含四字段、地址、其引用、引用它的最近至多 8 条地址；**不得**返回作者或权重。
- `atn_visit`：`addresses`(string[],必填，≤8)。整调用原子：任一地址不存在或不可见则整体拒绝。
- 扩展 `SHARED_RULES`（保持既有 6 条行为规则不变，新增 1–2 条 substrate 规则），必须包含论文提示词（Section C.4）的四条规范：**先读后写**（做之前先搜，若已有消息声明该工作即为已完成）、**每条必落地并明说依据**（用过的消息必须引用）、**为被检索而写**（用将来会搜的确切词写 `sub_task`）、**大部分写入应是中间产物**（部分结果、线索、死胡同、被排除项，边做边写而非攒到最终答案）。建议措辞（可调整，但四条规范不得缺失）：

```text
Substrate: publish/search/visit are your only channel to other nodes' work; nobody is addressed.
READ BEFORE YOU WRITE: search the wording of the work you are about to do; if a message already records it, that work is DONE - build on it.
Mostly publish INTERMEDIATE work (partial results, leads, dead ends, ruled-out steps) as you go, not one final summary.
publish requires: sub_task in the words you would search for later, the artifact that can be reused without redoing the work, a short rationale NAMING every ref and what it contributed, and refs to what you actually saw. A ref must exist; reusing a message without citing it rejects nothing but hides your ground.
search returns at most k messages and NEVER shows authors or weights; visit fetches addresses you already have, including a message's refs and who cites it.
```
- 固定上下文成本必须重测：`measureAtnFixedContext`（`src/tools.ts:36`）的实测值、`scripts/measure-atn-context.ts` 的输出、以及声明中的字节数同步更新。

验收测试：见 7.1、7.3。

### 4.2 存储、地址与容量

要求：

- 在网络记录内新增 substrate 字段（新消息数组 + 下一个地址游标 + 权重纪元基线）；`networkRecordSchema`（`src/schema.ts:472`）必须**严格**校验：未知字段继续拒绝，旧记录（无该字段）必须可直接读取且行为不变。
- 地址单调递增、永不重用；**被拒绝的写入不消耗地址**（地址与内容同生共死）。
- 消息不可变：不存在编辑、删除、覆盖路径；不提供任何"修改已发布消息"的工具或宿主 API。
- 容量满时**明确拒绝**（`substrate-full`），**不得**静默驱逐、不得覆盖、不得按时间淘汰。
- 持久化 domain 版本保持 `ATN_DOMAIN_VERSION = 1`（`src/schema.ts:548`）；新字段为可选增量。

### 4.3 准入规则（确定性，宿主可判定）

写入前，在同一 mutation 临界区内按顺序校验：

1. `sub_task`、`artifact`、`rationale` 非空且不超 `maxSubstrateMessageBytes`（含信封的 UTF-8 字节数，`utf8Bytes`）。
2. `refs` 数量 ≤ `substrateRefsPerMessage`；无重复；解析为 `msg:` / `task:` / `artifact:` 三类前缀。
3. `msg:<n>`：必须是本网络已存在的 substrate 地址，且**必须早于本条**（只允许指向过去，保证 DAG 且只在最新端增长）。
4. `task:<id>`：必须存在且对作者可见（作者是该任务的持有者或请求者）。不得引用他人之间的任务，避免以引用泄露出任务的存在。
5. `artifact:<id>`：**必须**在宿主对该作者解析出的真实保管集合内（复用 `CustodyResolver`）。**未安装保管策略时，`artifact:` 引用一律拒绝**（`custody-unavailable`）——没有可信来源就无法核验，宁缺毋滥。
6. `rationale` 必须**点名每一条引用**：确定性 token 检查（如 `msg:7`、`task:abc`、`artifact:foo` 的精确出现）。缺一条则整条拒绝并指出该引用（`rationale-missing-ref`）。
7. 通过第 14 条出站通道 `publish` 执行宿主策略（`admitOutbound`，`src/runtime.ts:507`），策略抛错则整条拒绝。

任一失败 ⇒ **原子拒绝**：无消息、无地址消耗、无权重变化、无业务 mutation；错误码为公开契约的一部分。

**必须写明的限制**：规则 6 只校验"点名"，"说清贡献"是语义要求，宿主不判定，不得宣称已完成语义核验。

### 4.4 排序（整数域，可重放）

要求：

- 索引字段仅为消息的 `u`、`a`、`r` 三段（不含 `refs`）。
- 分词确定性：NFKC → 小写 → 按 Unicode 非字母数字切分 → **CJK 追加字符二元组**；分词器必须单独测试（含中英混排与标点用例）。
- `Rel` 采用 BM25（k1=3/2、b=3/4）。**排序路径不得出现浮点运算**：`tf`、`dl`、平均长度与 `idf` 均以定点整数实现（自带确定性自然对数，给出与浮点参考的偏差上界并单独测试其单调性）。
- 复合分数比较在整数域完成：`s_m · maxRel + Rel_m` 的整数比较等价于论文的 `s_m + Rel_m/maxRel`（权重按 1.4 的定点表示）。
- 只排序 `Rel > 0` 的消息；并列取**地址更小（更早）**的消息；返回前 k 条（默认 8）。
- 空结果必须有明确语义（返回空列表，不是错误）。
- **禁止**在排序路径出现 `Math.*`、浮点字面量或时间依赖；由 7.3 的静态审计测试强制执行。

### 4.5 权重动态（定点、惰性、可重放）

要求：

- 权重存储为定点整数（如缩放 1e6），参数以有理数给出：增量 3/10、衰减 49/50、初值 0。每次运算按整数取整（向下），偏差上界必须在报告中写明。
- 增量：每当一条新消息引用 `msg:n`，`s_n ← s_n + ⌊(3/10)·(SCALE − s_n)⌋`；同一发布中对同一地址的重复引用只计一次。
- 衰减纪元：**复用网络已持久化的步计数 `record.stepsUsed`**（`src/runtime.ts:681` 每次准入模型步 +1）作为群体步；权重求值惰性化——在读取/排序/写入时按 `β^(Δ 步数)` 折算到当前纪元。纪元推进不需要额外写入，排序仍是记录内容的纯函数。
- `artifact:`/`task:` 引用不携带权重。
- `substrateCitationWeight=false` 时：不计算、不记录、不展示权重，排序退化为纯 `Rel`（同一套 tie-break）。
- 必须提供逐条重放测试：由持久记录重算任意时刻的权重与任意查询的排名，结果必须与当时返回完全一致。

### 4.6 边界与审计契约

要求：

- `OUTBOUND_CHANNELS`（`src/information-boundary.ts:10`）新增 `'publish'`，并在 `docs/information-boundary/OUTBOUND_CHANNEL_AUDIT.md` 表中新增一行（实际入口、被检查载荷、可见/持久化去向与检查位置），审计对象从 13 条变为 **14 条**。
- 新增公开拒绝码并写入 `src/refusal.ts` 与审计文档：

| code | 含义 |
|---|---|
| `ref-unresolved` | 引用的消息/任务不存在，或指向未来消息 |
| `ref-not-owned` | `artifact:` 引用的 id 不在作者真实保管集合中 |
| `ref-not-visible` | `task:` 引用对作者不可见 |
| `rationale-missing-ref` | 理由未点名某条引用 |
| `custody-unavailable` | 未安装保管策略时出现 `artifact:` 引用 |
| `substrate-full` | 消息数或字节数达到上限，明确拒绝 |

- **`tests/unit/information-boundary-inventory.test.ts` 的冻结词表与工具面断言必须被有意修改**：该文件 `:81-86` 把拒绝码冻结为 10 个、`:29` 把工具面冻结为 5 个、`:66` 冻结每个工具的字段清单、`:11` 的审计分类列表需要新增 `publish`。修改时必须在报告中给出理由并同步声明审计，**不得**只改测试不改文档。
- `tests/integration/information-boundary.test.ts` 手写的通道枚举必须新增 publish 的洗数据用例（策略被调用、网络状态/写次数/Agent 数量/模型请求数不变）。

### 4.7 计量与遥测

要求：

- 记录 substrate 的成功发布/读取次数与载荷字节（沿用白板时期的分列口径思路），并与邮件口径**分开**；合计字段必须明确标注覆盖范围，不得把 substrate 字节写成 Provider token 或账单。
- 发布**不得**产生邮件、不得唤醒任何节点、不得触发额外模型调用；读取只消耗调用者当前步。
- 观察面（operator）可导出：消息地址、四字段、作者、权重、引用、被引、证据链。

### 4.8 观察面（复用现有侧栏，不新增 tab）

要求：

- 扩展 `AtnNetworkView`（`src/observer-types.ts`）与 `observerSnapshotSchema`（`src/observer-schema.ts`，**严格** schema）新增可选 `substrate` 段：消息列表（地址、`sub_task` 截断、权重、引用数、被引数）、容量使用量、当前纪元；条数与文本长度沿用既有上限纪律（`OBSERVER_MAX_*`、`OBSERVER_TEXT_LIMIT`）。
- 在既有 `atn-network` tab（`src/client/index.tsx:35,44`）内新增分区展示，**不新增注册项**，不改动侧栏契约；顶栏回退路径必须同步支持。
- **模型面与观察面分离**：模型可见的 `search`/`visit` 渲染**不得**包含作者与权重；观察面可以包含。

### 4.9 交付、证据链与退休语义

要求：

- `atn_finish(scope="network"|…)` 的 `evidence` 允许 `msg:<n>` 地址；`TaskRecord.result.evidence`（`src/schema.ts:254`）无需改形状。
- 宿主计算证据链：交付所引消息的引用**传递闭包**（去重、按地址排序），在观察面与实施报告中给出；不得把证据链长度当作质量指标。
- 节点 `draining`/`retired`/`failed` 后其消息仍可被检索与引用；孤儿任务被 `claimTaskId` 认领后，认领者可通过检索追平上下文（这是本轮"成员可自由更替"能力的落点）。
- 网络完成/停止后 substrate 只读归档，不再接受发布。

### 4.10 配置

要求（`src/config.ts`，全部进入 `Config` zod schema 与 `limitsFromConfig`，并在 `assertConfigRelations` 中校验关系）：

| 字段 | 默认 | 约束 |
|---|---|---|
| `substrateEnabled` | `true` | 关闭时不注册三个工具（工具面回到 5 个，固定上下文基线随之回到旧值） |
| `maxSubstrateMessages` | `128` | 正整数 |
| `maxSubstrateMessageBytes` | `2048` | 正整数；含信封 |
| `maxSubstrateTotalBytes` | `131072` | ≥ `maxSubstrateMessageBytes` |
| `substrateSearchResults` | `8` | 1–16 |
| `substrateVisitLimit` | `8` | 1–16 |
| `substrateRefsPerMessage` | `32` | 1–32 |
| `substrateCitationWeight` | `true` | 布尔 |
| `substrateCitersShown` | `8` | 1–8 |

`substrateWeightAlpha`/`substrateWeightDecay` 若暴露，必须以**有理数分子/分母**给出并校验取值范围，不得以浮点默认值直接参与运算。

## 5. 必须保留的既有语义（不变式）

1. 既有 13 条出站通道、拒绝优先级与既有拒绝码**一个都不改**；本轮只是新增。
2. 网络记录仍是唯一原子持久化单元；"校验 + 修改"在同一 mutation 临界区内完成。
3. 发送者/持有者/投票者身份只取自真实 live Agent，不从参数取。
4. 发布不唤醒、不推送、不产生邮件；`atn_send` 的推送语义不变。
5. `stepBudget` 口径不变，不得折算 token/费用；substrate 不新增预算种类。
6. 持久化 domain 版本保持 1；旧记录可读。
7. 发现路径仍由宿主 custody/descriptor 反向派生；substrate **不得**成为第二种发现来源，也不得让 agent 通过发布自报能力。
8. `rewire`/`claim`/`review` 语义不变；引用权重**不得**参与任何一条。

## 6. 与论文的偏离清单（必须与实现一致并逐条留档）

| # | 偏离 | 理由 |
|---|---|---|
| 1 | 衰减纪元用"网络已准入模型步计数"，而非论文的"群体步" | ATN 是异步的、没有同步轮次；用已持久化的既有计数可重放 |
| 2 | 增加宿主强制的引用准入（保管/可见性），论文只要求"存在" | 论文的 agent 之间没有隔离需求；ATN 的边界必须落在写入侧 |
| 3 | 保留点对点工具（论文中不存在） | 不破坏既有通道与测试；代价是本轮配置**不等于**论文配置，因此论文结果不可迁移 |
| 4 | 长度上限用 UTF-8 字节而非 tokens | ATN 的既有界都是字节界，且字节界无需分词器即可判定 |
| 5 | 权重与排序用定点整数 | 保证跨平台逐字节可重放；与论文实数运算的偏差必须给出上界 |
| 6 | 分词增加 CJK 二元组 | 论文语料为英文；本仓库文档与用户语言含中文 |
| 7 | 无策略时 `artifact:` 引用被拒绝 | 无法核验的持有声明不进入数据存储 |

## 7. 测试与闸门（全部零模型调用）

### 7.0 失败留档先行（强制）

先写测试与断言、跑出**红灯**，把原始 TAP 留档到 `docs/execution-evidence/substrate-2026-10-16/`；再实现到全绿。不得先实现再补测试，也不得把未跑过的路径写成已通过。至少必须留下这三处**有意变更的既有闸门**的红灯证据：

1. `tests/integration/fixed-context.test.ts`：工具面清单（`:14-17`）5 → 8、`SHARED_RULES` 行数上限（`:18`，当前 ≤6 条）、`fixedContextBytes < 7160` 的字节天花板（`:22`）、以及 `:24` **显式禁止 `atn_publish` 出现**的正则。
2. `tests/unit/information-boundary-inventory.test.ts`：拒绝码冻结词表、工具面与字段清单、`outbound` 审计分类。
3. `tests/integration/information-boundary.test.ts`：13 条手写通道枚举。

### 7.1 单元测试

- 准入：三类引用的存在性/方向性/可见性/保管性；重复引用去重；引用数超限；理由未点名（逐条引用各一例）；未装策略时的 `artifact:` 拒绝；字节上限（含信封）。
- 原子性：每种拒绝后，消息数、地址游标、全部权重、步计数、事件列表**逐一断言不变**。
- 排序：正相关过滤；并列取更早地址；空结果；k 边界；分词器（中英混排、标点、大小写、全角/半角、CJK 二元组）；**同一输入任意顺序重放排名一致**。
- 权重：手算样例（一次引用、两次引用、跨纪元衰减、同一发布重复引用只计一次）；定点取整；`substrateCitationWeight=false` 时权重字段不出现且排名等于纯 `Rel`。
- 容量：达到消息数上限与总字节上限时各自拒绝，且既有消息**一条都没少**。
- 确定性静态审计：扫描 substrate 排序与权重模块，断言不含浮点字面量与 `Math.*` 调用。

### 7.2 集成测试

- 真实 kernel 端到端：A 发布 → B 检索命中 → B `visit` 引用地址 → B 发布引用 A 的消息（图增长）→ 断言消息 DAG、被引列表与权重。
- **无唤醒**：完整 substrate 流程中，邮件数、其他节点的模型输入、模型请求数均不因发布而增加。
- **跨退休持久**：发布者 `retired`/`failed` 后消息仍可检索、可引用；`claimTaskId` 认领者检索追平。
- **证据链**：`finish.network` 证据引用 `msg:` 后，宿主算出的传递闭包与手工期望一致（含链式与分叉）。
- **恢复**：冷加载（含旧记录无 substrate 字段）后地址、权重纪元、排名与拒绝语义一致。
- **模型面渲染**：`search`/`visit` 的模型可见文本不含作者 id、权重数值、权重百分比（正则断言）。
- **通道覆盖**：publish 的洗数据用例被策略拦截，网络状态不变。

### 7.3 静态审计

- 工具面 inventory、固定上下文重测（给出前后字节数与新增三工具各自的 schema 字节数）。
- 若 `substrateEnabled=false`，工具面与字节数必须回到当前基线（给出实测）。

### 7.4 命令与完成判定

```text
npm ci
npm run typecheck
npm test
npm run build
npm run pack:tarball
npm run smoke:profile
npm run smoke:visualization
```

全部退出码 0；`npm test` 零失败零跳过；断言强度只增不减。

## 8. 声明与文档更新（与实现同轮完成）

- `README.md`：核心能力新增 substrate 一段；**"五大核心工具"必须改为八个**；明确写出第 7 节可声明的结构性属性与第 12.2 节的限制。
- `docs/ADAPTIVE_TOPOLOGY.md`：第 3 行"默认模型工具为 …五个"必须改为八个；补一段"substrate 与拓扑/发现的关系"。
- `docs/information-boundary/OUTBOUND_CHANNEL_AUDIT.md`:13 → 14 条通道 + 新拒绝码表。
- `docs/DECLARATION_AUDIT.md`：新增本轮行（五工具→八工具、13→14 通道、白板禁令的有据修订）。
- `docs/STRATEGY_AND_POSITIONING.md`：在第 2.1 节"值得做的四个方向"下增补一条"有界读取的共享 substrate"，并在第 2.2 节写明本次修订的**边界**（只解除结构化可核验发布）。
- `docs/README.md`、根 `README.md` 文档索引新增本文件与实施报告。
- `NOTICE`/`LICENSE`：引用论文（arXiv:2610.16120v1，CC BY 4.0）与实现来源说明。

## 9. 不要做的事

1. 不恢复自由正文白板、不恢复 `publishKnowledge`、不给 substrate 加自由文本字段。
2. 不让 substrate 成为发现路径，不接受 agent 自报的能力/专长声明。
3. 不新增节点级评分、声誉、信任分，不让权重影响权限、换边、认领、验收或结算。
4. 不删除、不改语义地重排既有 13 条通道；不为 substrate 增加豁免通道。
5. 不引入浮点到排序/权重路径；不引入新的运行时依赖（BM25 与分词自实现，禁止为此加包）。
6. 不把 substrate 说成"更快/更聪明/涌现"，不转述论文数字为本插件收益。
7. 不做静默驱逐、不做消息编辑、不做地址重用。
8. 不把本轮与上游版本适配（`docs/UPSTREAM_LATEST_ADAPTATION_BRIEF.md`）混在同一次提交。
9. 不删除既有测试、不降低断言强度；修改冻结词表/闸门必须留理由与留档。
10. **不得把未测试内容写成已通过。**

## 10. 无法确定时的处理与停止条件

- 任何一条第 4 节要求若在实现中证明**与既有不变式冲突**（例如需要放宽通道审计、需要浮点、需要改 domain 版本），**立即停止该条**并在报告中写明冲突与依据，不得自行放宽。
- 若上游版本适配尚未完成（见 `docs/UPSTREAM_LATEST_ADAPTATION_BRIEF.md`），本轮**只允许在 alpha.4 基线上开工**；在旧基线上实现后不得直接宣称与新版兼容。
- 若某条结构性属性无法用零模型测试证明，**删除该条声明**，不得保留为"设计意图"式表述。

## 11. 完成标准与交付物

1. 第 7.4 节命令全部退出 0，测试数只增不减。
2. `docs/execution-evidence/substrate-2026-10-16/` 内：三处闸门的红色 TAP、修复后全绿 TAP、substrate 相关用例清单、字节数前后对照、固定上下文重测输出。
3. 第 6 节偏离清单逐条给出"实现是否一致 + 依据"。
4. 第 2.2/3.1/3.2 节的红线对照结论原样进入实施报告。
5. 逐条重放证据：任选一次检索，给出由持久记录重算排名的脚本输出与当时返回值的一致性证明。
6. 第 8 节全部声明更新完成。
7. 交付物：源码与测试改动、`docs/SUBSTRATE_COORDINATION_INTEGRATION_IMPLEMENTATION_REPORT.md`、执行证据目录、更新后的审计与索引文档。

## 12. 已知未验证项与不主张的内容

### 12.1 未验证（实现代理必须自行确认，不得当作已确认）

1. 三个新工具在真实 Harness profile 中的注册、`dsh` 工具面展示与子节点继承——必须由 `npm run smoke:profile` 实测。
2. 侧栏分区展示在真实浏览器中的渲染——必须由 `npm run smoke:visualization`／截图脚本实测，不得只跑类型检查。
3. 新增字段对旧记录的兼容只有 schema 推导，需由冷加载测试实证。
4. 定点自然对数与论文 BM25 的偏差上界只有设计值，需实测给出。
5. CJK 二元组分词对中文消息的检索质量**未测**；本轮只测确定性，不测相关性质量。

### 12.2 明确不主张的内容

- 不主张任务正确率、效率、吞吐、成本、延迟的任何改善。
- 不主张"真实模型会正确使用 substrate"（确定性测试证明不了这一点）。
- 不主张语义层面的引用核验（宿主只校验"点名"）与任意自然语言泄漏防护。
- 不主张与论文基准的任何可比性；本轮配置与论文配置存在第 6 节的七处偏离。
- 不主张等预算研究线重新开启（见 `docs/EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md` 的收束结论）。
