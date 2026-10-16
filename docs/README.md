# dsh-ATN 文档库索引指南

欢迎查阅 **dsh-ATN（自适应拓扑网络）** 文档库。本项目在经历十一轮严密的科学基准测试后，已完成从“追求协作涌现”到“宿主强制信息边界与可证明隔离”的战略转型。

所有历史研究记录、技术规范与测试留档均在此完整保留，不篡改历史，不对外虚报。

---

## 🧭 核心战略与定位白皮书

- [**战略定位与演进白皮书** (`STRATEGY_AND_POSITIONING.md`)](STRATEGY_AND_POSITIONING.md)
  *必读纲领*。系统阐述“还能叫自适应拓扑网络吗”、“演进轴如何切换至信任轴”以及“怎么宣传与受众定位”。确立**“布线会变，边界不变”**的核心理念。
- [**0.5.0 信息边界产品化开发方案** (`INFORMATION_BOUNDARY_PRODUCT_PLAN.md`)](INFORMATION_BOUNDARY_PRODUCT_PLAN.md)
  产品化实施方案。阐述为何移除白板、保留宿主派生发现元数据，以及 13 条出站通道的审计与红灯测试要求。
- [**下一步拓展方向** (`ROADMAP_NEXT_DIRECTIONS.md`)](ROADMAP_NEXT_DIRECTIONS.md)
  经 A/B/C 实测修订的方向库（非实施说明）。下一轮选定范围、逐条事实修正与五 seed 无翻转结论见 [D 决策记录](NEXT_SCOPE_DECISION_RECORD.md)。

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

## 🛡️ 信息边界与保管模型 (v0.5.0)

0.5.0 版本将信息边界确立为一等公民能力，提供宿主强制的数据隔离机制。

- [**13 条出站通道审计与公开拒绝码契约** (`information-boundary/OUTBOUND_CHANNEL_AUDIT.md`)](information-boundary/OUTBOUND_CHANNEL_AUDIT.md)
  列出从 `start`、`spawn` 到 `send`、`review`、`claim`、`rewire`、`finish` 等全部 13 条出站通道，固化 `evidence-not-owned` 等公开拒绝码。
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

- [上游最新版适配 brief](UPSTREAM_LATEST_ADAPTATION_BRIEF.md) / [实施报告](UPSTREAM_LATEST_ADAPTATION_IMPLEMENTATION_REPORT.md)：alpha.4 与 sidebar 0.26.1；旧报告为历史基线。
