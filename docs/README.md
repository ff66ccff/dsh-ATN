# dsh-ATN 文档库索引指南

欢迎查阅 **dsh-ATN（自适应拓扑网络）** 文档库。本项目在经历十一轮严密的科学基准测试后，已完成从“追求协作涌现”到“宿主强制信息边界与可证明隔离”的战略转型。

所有历史研究记录、技术规范与测试留档均在此完整保留，不篡改历史，不对外虚报。

---

## 🧭 核心战略与定位白皮书

- [**战略定位与演进白皮书** (`STRATEGY_AND_POSITIONING.md`)](STRATEGY_AND_POSITIONING.md)  
  *必读纲领*。系统阐述“还能叫自适应拓扑网络吗”、“演进轴如何切换至信任轴”以及“怎么宣传与受众定位”。确立**“布线会变，边界不变”**的核心理念。
- [**0.5.0 信息边界产品化开发方案** (`INFORMATION_BOUNDARY_PRODUCT_PLAN.md`)](INFORMATION_BOUNDARY_PRODUCT_PLAN.md)  
  产品化实施方案。阐述为何移除白板、保留宿主派生发现元数据，以及 13 条出站通道的审计与红灯测试要求。

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
  详细定义节点自主决定的出边重连（出度上限 4）、局部邻居发现轮转、捎带式遥测与逐节点预算机制。
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
