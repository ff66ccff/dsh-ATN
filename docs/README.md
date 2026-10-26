# dsh-ATN 文档库索引指南

当前版本 **0.6.3**（[npm](https://www.npmjs.com/package/dsh-atn/v/0.6.3)）：Harness **>=0.2.1-rc.3**（验证基准 rc.3）；Better Sidebar **0.28.0 发布包与上游源码**；Node.js **>=24.9.0**。安装与能力说明以[主 README](../README.md)、[CHANGELOG](../CHANGELOG.md)和[0.6.3 发布记录](RELEASE_0_6_3.md)为准。以下阶段报告保留各自执行时的版本、计数及发布边界；[0.6.2 发布记录](RELEASE_0_6_2.md)适用于 rc.2 历史宿主。

- [V2 合并实施计划](MASTER_EXECUTION_PLAN_V2.md)：用户批准的阶段顺序与停止条件。
- [V2 阶段 0 证据](execution-evidence/round-v2-phase0/README.md)：依赖处置与命令闸门。
- [V2 阶段 1 证据](execution-evidence/round-v2-phase1/README.md)：分区与授权两张判定表，结构和 live/RPC 两层。
- [V2 阶段 2 证据](execution-evidence/round-v2-phase2/README.md)：可选读侧策略、关闭对照与重放。
- [宿主一致性套件接入](../conformance/README.md)：随 npm 包交付的 CLI/API、46 个结构用例与负例。
- [舰队观察与计数契约](FLEET_OBSERVATION_CONTRACT.md)：独立授权、计数口径、易失性与 UI 分区。
- [拒绝日志设计稿](REFUSAL_LOG_DESIGN.md)：仅设计，三种一致性/丢失策略、内容最小化与 B-REFUSAL-LOG。
- [V2 总实施报告](ROUND_V2_IMPLEMENTATION_REPORT.md)：各阶段结果、证据与明确未验证范围。

欢迎查阅 **dsh-ATN（自适应拓扑网络）** 文档库。本项目在经历十一轮严密的科学基准测试后，已完成从“追求协作涌现”到“宿主强制信息边界与可证明隔离”的战略转型。

所有历史研究记录、技术规范与测试留档均在此完整保留，不篡改历史，不对外虚报。

---

## 🧭 核心战略与定位白皮书

- [**威胁模型与读取边界**](THREAT_MODEL.md)：B-* 可执行判据、三类读取面与四项排除；V2 §3。
- [**观察读取授权接入**](OBSERVER_READ_AUTHORIZATION.md)：owner/operator、内容/元数据 action、整网会话别名授权与可信宿主导出决策；V2 §4。
- [**读取边界实施报告**](READ_BOUNDARY_IMPLEMENTATION_REPORT.md)：V2 §14 推荐范围、先红后绿和最终验证。

- [**战略定位与演进白皮书** (`STRATEGY_AND_POSITIONING.md`)](STRATEGY_AND_POSITIONING.md)
  *必读纲领*。系统阐述“还能叫自适应拓扑网络吗”、“演进轴如何切换至信任轴”以及“怎么宣传与受众定位”。确立**“布线会变，边界不变”**的核心理念。
- [**0.5.0 信息边界产品化开发方案** (`INFORMATION_BOUNDARY_PRODUCT_PLAN.md`)](INFORMATION_BOUNDARY_PRODUCT_PLAN.md)
  产品化实施方案。阐述为何移除白板、保留宿主派生发现元数据，以及 13 条出站通道的审计与红灯测试要求。
- [**下一步拓展方向 V2** (`ROADMAP_NEXT_DIRECTIONS_V2.md`)](ROADMAP_NEXT_DIRECTIONS_V2.md)
  **现行方向库**（非实施说明），取代 V1。按上游适配 + substrate 引入后的实测证据重排，含对 V1/D 记录的十项事实修订：威胁模型与**读取面**边界、观察/导出的读取授权（alpha.4 网关已具备执行机制）、宿主 custody 一致性套件（14 通道）、跨网络地址命名空间补证、拒绝日志设计稿、读侧可见性分区、舰队面、engines.dsh 化发布门。§14 给出建议的下一轮范围（§3+§4，全零模型）与硬闸门，§15 重列不主张红线。
- [**本轮总纲 V2** (`MASTER_EXECUTION_PLAN_V2.md`)](MASTER_EXECUTION_PLAN_V2.md)
  把方向库 V2 的 **§5–§9 与 §11 合并为一个轮次**，但**分六个阶段、各自独立提交**（失败信号必须可归因）：0 卫生 → 1 跨网络引用与 `msg:` 地址命名空间补证 → 2 读侧可见性（need-to-know 分区，含**第 8 条论文偏离**；过滤必须宿主侧、对模型透明、"过滤即不存在"）→ 3 宿主 custody 一致性套件（覆盖最终通道与词汇，附**负例实现**证明套件能红灯）→ 4 舰队观测面（新的跨网络读取面，必须沿用既有 principal/resource/action 授权；拒绝计数只做**有界计数**，不得冒充合规日志）→ 5 拒绝日志设计稿（零代码）。含 12 条共享不变式（模型工具面与固定上下文 7,956/5,910 不得变）、六条停止条件与三项**需用户批准**的决策。§10（engines.dsh 发布门与 GitHub 矩阵首次真跑）不在本轮。
- [**下一步拓展方向 V1** (`ROADMAP_NEXT_DIRECTIONS.md`)](ROADMAP_NEXT_DIRECTIONS.md)
  历史输入（其基线 551+14/alpha.2 与"不做新协作机制"的表述均需按 V2 §2 的精确化修订阅读）。下一轮选定范围、逐条事实修正与五 seed 无翻转结论见 [D 决策记录](NEXT_SCOPE_DECISION_RECORD.md)。

---

## 📋 当前轮实施说明

> **入口：先读 [**本轮总纲** (`MASTER_EXECUTION_PLAN.md`)](MASTER_EXECUTION_PLAN.md)。** 它定义阶段顺序（A→B→C→D）、阶段之间的硬闸门、12 条跨阶段不变式、跨阶段声明审计、停止条件与最终验收，并指向下面三份阶段 brief。**与阶段 brief 冲突时以阶段 brief 为准；顺序、闸门、不变式与跨阶段任务以总纲为准。**

以下三份文档各自独立、**不得混做**。每份都遵守本仓库的既有规范：先有失败测试留档、后有代码修复；不得把未测试内容写成已通过。

- [**Harness 0.2.1-alpha.2 适配实施说明** (`HARNESS_0_2_1_ADAPTATION_BRIEF.md`)](HARNESS_0_2_1_ADAPTATION_BRIEF.md)
  把全部 `@deepseek-ai/dsh-*` 依赖从 `0.2.0-rc.2` 提升到 `0.2.1-alpha.2`，移除 `dsh-invariants`。实测目录为 24 篇 guide（输入 brief 写 22），逐篇核对见 A 报告；固定工具协议字节保持不变。
- [**接入 better-sidebar 实施说明** (`BETTER_SIDEBAR_INTEGRATION_BRIEF.md`)](BETTER_SIDEBAR_INTEGRATION_BRIEF.md)
  彻底移除自绘拓扑图（内联 SVG / 环形布局 / 缩放），改为结构化面板，并接入 better-sidebar 的 `registerTab` 成为原生右侧栏 tab。better-sidebar 为可选依赖，未安装时必须保留可用回退。
- [**动态出度实施说明** (`DYNAMIC_DEGREE_IMPLEMENTATION_BRIEF.md`)](DYNAMIC_DEGREE_IMPLEMENTATION_BRIEF.md)
  把写死的出度上限 4 改为随累计节点数按对数曲线增长（`⌈log₂N⌉ + 1`，默认规模 8 节点下仍为 4），并保持「稀疏、单调、可离线核验」三条性质。

实施记录：[A：Harness 适配](HARNESS_0_2_1_IMPLEMENTATION_REPORT.md)、[B：动态出度](DYNAMIC_DEGREE_IMPLEMENTATION_REPORT.md)、[C：结构化面板与可选侧栏](BETTER_SIDEBAR_IMPLEMENTATION_REPORT.md)、[统一声明审计](DECLARATION_AUDIT.md)。C 的 ATN 客户端双路径通过，完整 better-sidebar 0.26.0 host 激活仍受上游旧服务依赖阻碍；回退可用，不把 API 验证当作联合启动验证。

[D：下一轮范围决策](NEXT_SCOPE_DECISION_RECORD.md) 已收口；最终整轮命令与十二项不变式见 [最终验收记录](FINAL_EXECUTION_VALIDATION.md)。

总纲/brief 是实施前输入，其中旧版本、固定额度、图形描述是基线或待删除项，不能用作现行产品说明。当前行为以根 README、阶段报告和声明审计为准；历史实验仍保留原条件。

---

## 🔒 复核后续修复

- [**残余验证缺口修复说明** (`RESIDUAL_VERIFICATION_GAPS_BRIEF.md`)](RESIDUAL_VERIFICATION_GAPS_BRIEF.md)
  复核 A/B/C/D 后的收口工作，**不新增功能**：把已写好但无人执行的 better-sidebar 双检查接进 CI 门禁（缺一即红）、对齐 `^0.26.0` 声明与实际只验证 `0.26.0` 的不一致、为两处有意冻结旧出度的实验调用补说明。含一条**自我撤回**：复核中提出的「稀疏度声明在 N≤5 不成立」经重算不成立（`O(N log N)` 为正确的渐近界），本轮不实施。
- [**残余验证缺口实施报告** (`RESIDUAL_VERIFICATION_GAPS_IMPLEMENTATION_REPORT.md`)](RESIDUAL_VERIFICATION_GAPS_IMPLEMENTATION_REPORT.md)
  精确可选 peer `0.26.0`、独立 Ubuntu/Windows 门禁、可选字段漂移与注册服务失败的阻断证据，以及注释改变原始实验哈希的实测与重放约束。GitHub 托管矩阵、完整 provider host/browser 联合验收仍未执行。
- [**OpenCode Go 免费模型真实探针（2026-10-15）**](FREE_MODEL_PROBE_2026-10-15.md)
  按后续授权使用订阅插件实际调用 Step 5 免费模型，记录 44 次模型调用；5 seed 计划中，1 次超时失败、1 次限流后中断、3 次未启动。原始输出、未知 usage 和驱动限流 guard 缺口完整留档，不宣称实验全部通过。
- [**dsh-agy Gemini 3.8 Flash medium 真实实验（2026-10-15）**](AGY_GEMINI_MEDIUM_PROBE_2026-10-15.md)
  指定模型和 medium 档位完成 5 seed 探针，76 次实际插件派发、0/5 两阶段通过；全部超时未提交，未记录到认证/限流错误。包含请求体档位核对、未知总 usage、单并发排队边界和 553+14 项回归结果，不作跨模型效率比较。

---

## 🎯 下一轮实施说明

- [**静默活性审计 V2 实施报告**](PROBE_LIVENESS_AUDIT_V2_IMPLEMENTATION_REPORT.md)
  [事件语义表](PROBE_LIVENESS_EVENT_SEMANTICS_V2.md)先行；真实内核故障注入覆盖请求缺失、收据缺失，正常同一步延迟及 retired/failed 对照通过。五 seed 均为 no-wake-eligible-work，含 60 封正常收据与 1 封不可达；完整历史审计依赖 40 个未跟踪 session 和 5 个 network 文件，采用 4.6(b)。[完整明细](execution-evidence/probe-liveness-audit-v2-20261015/analysis-tables.md)。
- [**探针静默活性审计实施说明（V2，锚点修订版）** (`PROBE_LIVENESS_AUDIT_V2_BRIEF.md`)](PROBE_LIVENESS_AUDIT_V2_BRIEF.md)
  **取代** V1 的方法部分（其 4.2/4.4 判据已被证伪），继承其未完成交付项。结构性变化：**先确立事件语义，再写任何判据**——4.0 事件语义表与 4.1 类别可达性证明均为**阻塞性闸门**，未完成前不得产出任何 seed 级判定。判据锚点从 `delivered` 改为实际造成唤醒的事件（基线显示为 `queued`），并把旧判据混在一起的三类拆开：**(a) 正常同一步收据延迟（非缺陷）**、**(b) 输入已记录但模型请求从未开始**、**(c) 持久收据缺失**；每个缺陷类必须由**故障注入证明可达**，否则删除该类。三类对照含「seed 59 / mail-10 式延迟必须判为非缺陷」这一固定用例——正是 V1 的致命盲点。
- [**静默活性审计前置核验与停止报告**](PROBE_LIVENESS_AUDIT_IMPLEMENTATION_REPORT.md)
  按 brief 第 7.3 条停止：delivered 确认发生在输入记录之后，唯一时间候选 seed 59 / mail-10 已在最后一步获得输入。指定正向对照未能在代码定义下建立额外唤醒义务，未签发五 seed 二值判定；后续完整审计和工程回归未冒充完成。[唤醒条件定义](PROBE_WAKE_ELIGIBILITY_DEFINITION.md)。
- [**探针静默活性审计实施说明** (`PROBE_LIVENESS_AUDIT_BRIEF.md`)](PROBE_LIVENESS_AUDIT_BRIEF.md)
  V1，方法部分已被 V2 取代，保留为历史输入。上一轮把静默成因**收窄但未识别**：五分之五都是义务未完成的活性静默，但「为什么没有活着、没在跑、还有余步的节点去取下一个动作」仍未回答。本轮把它变成**可判定的二值审计**（`mechanism-gap` / `no-wake-eligible-work`），零模型调用。关键实测依据：`mail.state` 只有 `queued`/`delivered`、**没有「已消费」**，而 `step/start` 与 `model.start` 携带 `session`，故「投递后接收者是否获得过模型输入」可判定。要求**双向构造对照**（只跑出一种结论即判分类器无效），并把预置角色义务与纯拉取式义务明确排除在「应当唤醒」之外。
- [**探针门分位修正与静默成因定位实施说明** (`PROBE_GATE_AND_QUIESCENCE_BRIEF.md`)](PROBE_GATE_AND_QUIESCENCE_BRIEF.md)
  要求零模型完成门的分位修正与静默定位，不得以放宽预算重跑。其“全部入口步数耗尽”前提经实施核验修正：仅 17/45/73 耗尽，31/59 分别因 max-tokens/上游错误停止。四个展示的延迟代入值均拒绝 600 秒，完整五 seed 中 73 的均值略低于旧输入，见下方报告。
- [**探针门分位修正与静默定位实施报告**](PROBE_GATE_AND_QUIESCENCE_IMPLEMENTATION_REPORT.md)
  224 次 dispatch→finish 全配对、aborted=0；独立 p90 覆盖政策和四档敏感性曲线使 600 秒配置在 p90 下被拒绝。3 次错误提交、2 次未提交，五次均为义务未完成静默；附完整持有者状态、具名工具映射、逐步分类和 37 个未变哈希。totalTokens 从有效预算维度去列，保留其历史不可用后果。
- [**真实模型探针可行性门实施说明** (`LIVE_PROBE_FEASIBILITY_BRIEF.md`)](LIVE_PROBE_FEASIBILITY_BRIEF.md)
  输入 brief 提出实测延迟口径与零模型可行性门，要求 4.1–4.3 完成前不得开始任何新的真实模型运行。其“60/8 为严格下界、期限是唯一不足”的前提经核验不成立或未经证明，不能作为现行结论；实施已按第 7.2 条停止，详见下面报告。
- [**真实探针可行性前提核验与停止报告** (`LIVE_PROBE_FEASIBILITY_IMPLEMENTATION_REPORT.md`)](LIVE_PROBE_FEASIBILITY_IMPLEMENTATION_REPORT.md)
  5 个原 seed 均在同一运行时与 ACL 下复现原参考 60/8，以及省略策略反馈后的 46/6 答案通过对照；后者不作为替代下界或真实模型成功。37 个固定源码哈希与 AGY 归档全部一致。可行性门、延迟口径实测及 Gemini medium 重跑未执行；逐 seed usage 与工程验证完整留档。
- [**严格下界推导与恢复运行条件** (`LIVE_PROBE_STRICT_BOUND_DERIVATION.md`)](LIVE_PROBE_STRICT_BOUND_DERIVATION.md)
  用户后续授权恢复。合法因果取证下至少 10 次模型调用／最大单节点至少 2 步；不加信息来源假设时只能保证至少 1 个响应。实测旧 modelDurationMs 包含排队；规划门采用有来源的服务延迟与明确余量，不能作为数学不可行证明。仅将指定 AGY Gemini medium 的期限改为 600 秒。
- [**真实探针恢复实施报告** (`LIVE_PROBE_RESUMED_IMPLEMENTATION_REPORT.md`)](LIVE_PROBE_RESUMED_IMPLEMENTATION_REPORT.md)
  记录用户后续授权下的新批次，保留原 seed 和失败样本；包含模型／档位核对、门输出、逐 seed 延迟及 usage、真实停止原因与规划假设限制。前一份停止报告是恢复之前的历史记录。

---

## 🧱 上游适配与 Substrate 机制引入（2026-10-16 新增）

> 两份相互独立、**不得混做**的实施说明。**顺序闸门**：上游适配必须先完成并全绿，再做 Substrate 引入——后者会把模型工具面由 5 个改为 8 个，混做会让固定上下文字节基线的失败信号无法归因。

- [**上游最新版适配实施说明** (`UPSTREAM_LATEST_ADAPTATION_BRIEF.md`)](UPSTREAM_LATEST_ADAPTATION_BRIEF.md)
  把全部 `@deepseek-ai/dsh-*` 由 `0.2.1-alpha.2` 提升到 **`dsh-v0.2.1-alpha.4`**，Cordis 到 `4.0.5-alpha.2`、schemastery 到 `3.18.5-alpha.2`、include/loader 到 `-alpha.2`，better-sidebar 精确 optional peer 由 `0.26.0` 改为 **`0.26.1`**。最重要的语义变更：**自 alpha.4 起 `engines.dsh` 单独决定插件兼容性，`@deepseek-ai/dsh-*` peer 范围被忽略**（依据：`docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md` 与 `packages/boot/app-boot/src/plugin-compatibility.ts:57-80`），因此 `engines.dsh` 必须收窄到与验证集合一致。已确证 alpha.4 下槽位 `conversation.session.header.actions`、`ConnectionHandle`、`defineTool`、typert 协议与注册表均未变；`0.26.1` 除版本号外与 `0.26.0` 源码逐字节相同（无公开接入 API 变化）。**完整 provider 联合启动仍受上游已删除的 `webRuntime` 服务阻塞**（alpha.4 全量检索无该服务），只能验证 client Tab API 与真实注册服务，不得宣称已联合验证。
- [**Substrate 协作面引入实施说明** (`SUBSTRATE_COORDINATION_INTEGRATION_BRIEF.md`)](SUBSTRATE_COORDINATION_INTEGRATION_BRIEF.md)
  把 arXiv:2610.16120v1（**ScaleMAS**，substrate-centric coordination）的机制引入本插件：新增 `atn_publish` / `atn_search` / `atn_visit` 三个工具与**第 14 条出站通道**，落地只追加消息、确定性写入准入（引用必须存在／可见／真实持有，理由必须点名每条引用）、整数域 BM25 + 引文权重排序、证据链与跨退休持久性。含对 `STRATEGY_AND_POSITIONING` 两条高压线（"不再加白板公告""不再加声誉算法"）的**逐条对照与有据修订说明**，以及用户已拍板的三项决策：默认同时启用、引文权重可配置关闭、**仅零模型结构验证且不主张任何性能增益**。文中列出三处必须先留红灯的既有闸门测试（固定上下文、边界 inventory、通道枚举）与与论文的七处偏离清单。

2026-10-16 历史实施结果（两阶段已分阶段提交）：[上游适配报告](UPSTREAM_LATEST_ADAPTATION_IMPLEMENTATION_REPORT.md)、[Substrate 实施报告](SUBSTRATE_COORDINATION_INTEGRATION_IMPLEMENTATION_REPORT.md)。该两轮时点为 588 项 runtime/集成 + 15 项 UI；读取边界轮次后为 **593 + 15**（本人独立复跑确认零失败零跳过）。八工具固定上下文 7,956 字节、关闭 substrate 精确回到 5,910；`engines.dsh` 为 `>=0.2.1-alpha.4 <0.3.0`（仅 alpha.4 实测）；完整 provider host 激活仍受 `webRuntime` 缺失阻塞，顶栏回退通过真实浏览器验证。后续范围见 [方向库 V2](ROADMAP_NEXT_DIRECTIONS_V2.md) 与[本轮总纲 V2](MASTER_EXECUTION_PLAN_V2.md)。

---

## 🛡️ 信息边界与保管模型 (v0.5.0)

0.5.0 版本将信息边界确立为一等公民能力，提供宿主强制的数据隔离机制。

- [**14 条出站通道审计与公开拒绝码契约** (`information-boundary/OUTBOUND_CHANNEL_AUDIT.md`)](information-boundary/OUTBOUND_CHANNEL_AUDIT.md)
  列出从 `start`、`spawn` 到 `send`、`review`、`claim`、`rewire`、`finish` 以及新增的 `publish` 共 **14 条**出站通道，固化 `evidence-not-owned` 等公开拒绝码，并记录读取面授权与 `exportSubstrate` 的可信宿主前提。
- [**修复前失败留档** (`information-boundary/PRE_FIX_RECORD.md`)](information-boundary/PRE_FIX_RECORD.md)
  严格执行“先有失败测试留档，后有代码修复”规范，记录 `review.summary` 与虚报发现元数据的修复前拦截日志。
- [**信息边界实施报告** (`INFORMATION_BOUNDARY_IMPLEMENTATION_REPORT.md`)](INFORMATION_BOUNDARY_IMPLEMENTATION_REPORT.md)
  记录 0.5.0 的完整实施过程、白板移除影响分析与 550+ 测试矩阵。
- **验证与对比工件**：
  - [`information-boundary/pre-fix-failures.tap`](information-boundary/pre-fix-failures.tap)：修复前测试失败原始 TAP 日志。
  - [`information-boundary/binding-before.json`](information-boundary/binding-before.json) / [`binding-after.json`](information-boundary/binding-after.json)：策略工厂重写前后拒绝序列一致性对比。
  - [`information-boundary/removed-tests.json`](information-boundary/removed-tests.json)：随白板废除而安全退役的测试清单。
  - [`information-boundary/validation.json`](information-boundary/validation.json)：自动化校验元数据。

---

## 🕸️ 拓扑机制与运行时架构

- [**最小自适应拓扑机制规范** (`ADAPTIVE_TOPOLOGY.md`)](ADAPTIVE_TOPOLOGY.md)
  定义节点自主重连、局部发现、捎带遥测与逐节点预算；有效出度按累计规模增长，默认 N=8→4、N=32→6，天花板 8。历史实验冻结值另行标明。
- [**任务验收与验证协同** (`VERIFIED_COLLABORATION.md`)](VERIFIED_COLLABORATION.md)
  定义执行结果与验收结果的解耦，区分本地请求者判定与宿主验收证据。
- [**故障自愈与修复机制报告** (`REPAIR_IMPLEMENTATION_REPORT.md`)](REPAIR_IMPLEMENTATION_REPORT.md)
  孤儿任务原子认领、两阶段优雅退休（Draining/Retired）与串行持久化队列规范。

---

## 🧪 十一轮科学基准测试档案库 (2026-10)

本项目进行了横跨 11 轮的严格对照实验与等预算评测。实测明确证实：**未建立自适应拓扑在任务正确率、效率或成本上的独立优势（全部 `causalClaim=false`）**。这些阴性结果是本项目最重要的诚实基石。

### 终轮：第 11 轮（五臂配对等预算收束）
- [**第 11 轮五臂等预算基准测试报告** (`EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md`)](EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md)
  *终轮收束报告*。五臂各 14 个配对 seed（共 70 次真实模型调用运行），严格执行精确 McNemar 检验与 Holm 显著性校正。明确判定：分布式协调未带来总体效率或正确率收益，等预算研究线正式收束。
- [**第 11 轮执行记录与环境审计** (`EQUAL_BUDGET_EXECUTION_NOTES_V3.md`)](EQUAL_BUDGET_EXECUTION_NOTES_V3.md)
- [**第 11 轮实验方案简报** (`EQUAL_BUDGET_BENCHMARK_BRIEF_V3.md`)](EQUAL_BUDGET_BENCHMARK_BRIEF_V3.md)

### 第 9–10 轮：等预算四臂对照与分片探索
- [第 10 轮 10 订单组实施报告 (`EQUAL_BUDGET_BENCHMARK_REPORT_V2_UNITS10.md`)](EQUAL_BUDGET_BENCHMARK_REPORT_V2_UNITS10.md)
- [第 10 轮 8 订单组实施报告 (`EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V2.md`)](EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V2.md)
- [第 10 轮执行记录 (`EQUAL_BUDGET_EXECUTION_NOTES_V2.md`)](EQUAL_BUDGET_EXECUTION_NOTES_V2.md)
- [第 10 轮方案简报 (`EQUAL_BUDGET_BENCHMARK_BRIEF_V2.md`)](EQUAL_BUDGET_BENCHMARK_BRIEF_V2.md)
- [第 9 轮四臂等预算实施报告 (`EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT.md`)](EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT.md)
- [第 9 轮执行记录 (`EQUAL_BUDGET_EXECUTION_NOTES.md`)](EQUAL_BUDGET_EXECUTION_NOTES.md)
- [第 9 轮方案简报 (`EQUAL_BUDGET_BENCHMARK_BRIEF.md`)](EQUAL_BUDGET_BENCHMARK_BRIEF.md)

### 第 6–8 轮：机制消融与多臂对比
- [机制精简消融实施报告 (`SIMPLIFICATION_STUDY_IMPLEMENTATION_REPORT.md`)](SIMPLIFICATION_STUDY_IMPLEMENTATION_REPORT.md)
- [机制精简消融简报 (`SIMPLIFICATION_STUDY_BRIEF.md`)](SIMPLIFICATION_STUDY_BRIEF.md)
- [五臂对照实施报告 (`FIVE_ARM_COMPARISON_IMPLEMENTATION_REPORT.md`)](FIVE_ARM_COMPARISON_IMPLEMENTATION_REPORT.md)
- [四臂对照实施报告 (`FOUR_ARM_COMPARISON_IMPLEMENTATION_REPORT.md`)](FOUR_ARM_COMPARISON_IMPLEMENTATION_REPORT.md)
- [四臂对照方案修订版 (`FOUR_ARM_COMPARISON_REVISED_BRIEF.md`)](FOUR_ARM_COMPARISON_REVISED_BRIEF.md)
- [拓扑绑定实施报告 (`TOPOLOGY_BINDING_IMPLEMENTATION_REPORT.md`)](TOPOLOGY_BINDING_IMPLEMENTATION_REPORT.md)
- [对等方差实施报告 (`PEER_VARIANCE_IMPLEMENTATION_REPORT.md`)](PEER_VARIANCE_IMPLEMENTATION_REPORT.md)

### 第 5 轮：拓扑测量与结构可达性（核心证明）
- [**拓扑测量结果报告** (`TOPOLOGY_MEASUREMENT_RESULTS_2026-10-05.md`)](TOPOLOGY_MEASUREMENT_RESULTS_2026-10-05.md)
  *拓扑层核心证据*：证明自适应换边机制能到达静态固定边在拓扑约束下不可达的结构位置（零模型调用的确定性结构证明）。
- [拓扑测量方案设计 (`DESIGN_TOPOLOGY_MEASUREMENT.md`)](DESIGN_TOPOLOGY_MEASUREMENT.md)
- [全反馈拓扑实验 (`FULL_FEEDBACK_EXPERIMENT.md`)](FULL_FEEDBACK_EXPERIMENT.md)
- [P0/P1 反馈机制里程碑 (`FEEDBACK_MILESTONE.md`)](FEEDBACK_MILESTONE.md)
- [可测性恢复报告 (`MEASURABILITY_RECOVERY_REPORT.md`)](MEASURABILITY_RECOVERY_REPORT.md)
- [模型调用与工具错误审计 (`TOOL_ERROR_AUDIT.md`)](TOOL_ERROR_AUDIT.md)

### 第 1–4 轮：早期原型与试点
- [实验试点报告 (`EXPERIMENT_PILOT.md`)](EXPERIMENT_PILOT.md)
- [试点运行结果 (`PILOT_RESULTS_2026-10-04.md`)](PILOT_RESULTS_2026-10-04.md)
- [Free Muse 试点结果 (`PILOT_FREE_MUSE_RESULTS_2026-10-04.md`)](PILOT_FREE_MUSE_RESULTS_2026-10-04.md)
- [评审验证记录 (`REVIEW_VALIDATION_2026-10-04.md`)](REVIEW_VALIDATION_2026-10-04.md)

---

## 🏗️ 早期架构与工程设计历史

- [早期源码分析与架构设计 (`atn-source-analysis-and-design.md`)](atn-source-analysis-and-design.md)
- [原型系统验证报告 (`atn-prototype-validation.md`)](atn-prototype-validation.md)
- [最小插件包规格说明 (`MINIMAL_BUNDLE_SPEC.md`)](MINIMAL_BUNDLE_SPEC.md)
- [最小插件包实施报告 (`MINIMAL_BUNDLE_IMPLEMENTATION_REPORT.md`)](MINIMAL_BUNDLE_IMPLEMENTATION_REPORT.md)
- [最小插件包验收记录 (`MINIMAL_BUNDLE_ACCEPTANCE.md`)](MINIMAL_BUNDLE_ACCEPTANCE.md)
- [工程交接文档 (`DEEPSEEK_HANDOFF.md`)](DEEPSEEK_HANDOFF.md)
