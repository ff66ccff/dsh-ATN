# dsh-ATN：DeepSeek Harness 自适应拓扑网络

V2 工程卫生：七个零直接引用包按真实宿主依赖图保留并逐项说明，见 [声明审计](docs/DECLARATION_AUDIT.md)。

网络局部 `msg:`、node/task 标识及宿主 custody 的跨网络补证见 [两张判定表](docs/execution-evidence/round-v2-phase1/README.md)；网络仍不等于认证租户。

<div align="center">

### **布线会变，边界不变。**
#### *Topology adapts, boundaries hold.*

面向高安全、多租户与严格合规场景打造的智能体间拓扑隔离与可控协作基础设施。

[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-550%2B%20passed-brightgreen.svg)](tests/)
[![Zero-Paid-Calls](https://img.shields.io/badge/test%20cost-$0.00-success.svg)](tests/)
[![Empirical Grounding](https://img.shields.io/badge/empirical-11%20rounds%20archived-orange.svg)](docs/)

</div>

---

## 💡 为什么选择 dsh-ATN？

在多智能体系统（Multi-Agent Systems）落地生产环境的过程中，企业面临着两难困境：
- **静态工作流或原生 Team**：拓扑结构死板，节点间缺乏动态寻路能力；更致命的是**完全缺乏宿主级的数据隔离机制**，任一节点的上下文扩散都可能导致数据越权或信息污染。
- **自由交互群聊**：缺乏出度与拓扑管控，极易引发广播风暴、上下文爆炸与不可控的虚假事实传播。

**dsh-ATN 带来了一个前所未有的、经过双向严密实证的坚实解法：**

> **节点可以自由重连；启用宿主保管策略后，出站通道拒绝声明宿主未授予的 artifact 身份。**

此边界取决于宿主 `custody` 与 `extractClaims` 的授权映射和提取规则，不保证识别任意自然语言泄漏。网络隔离也不自动等于租户认证；跨租户授权与完整审计证明仍需宿主接入及独立补证。

| 架构层级 | 负责维度 | 运行性质 | 严密实证支撑 |
|---|---|---|---|
| 🕸️ **拓扑层 (Topology)** | **能和谁说话**（物理可达性） | **动态自适应**：节点可按需自主换边，累计规模的对数曲线限制出度；默认 8 节点上限为 4，32 节点为 6 | **第 5 轮结构证明**：在显式冻结的实验额度下，自适应换边能够到达静态拓扑不可达的协作节点（零模型调用）。 |
| 🛡️ **保管层 (Custody)** | **能说什么**（数据合法声称） | **宿主强约束**：不变的边界底线，出站通道逐一审查，无权声明即刻熔断 | **0.5.0 全量安全审计**：当前覆盖 14 条出站通道（0.5.0 历史审计为 13 条），修复前拦截留档，彻底杜绝数据洗白。 |

这是 DeepSeek Harness 原生 Team 所完全不具备的能力——**原生 Team 既无法动态自适应拓扑，也无法提供宿主级强制的数据保管边界**。

---

## 🎯 专为严苛场景而生

dsh-ATN 不迎合虚浮的“通用协同”幻想，而是精准解决对**可证明隔离性**有强诉求的专业场景：

- 🏢 **多租户 Agent 基础设施**：多租户共享底座模型与 Agent 服务时，杜绝租户私有上下文与数据资产跨节点横向穿透。
- 🔍 **安全审查与合规审计**：对智能体协作链路有严格可追溯性要求，需要形式化证明“没有任何智能体在生命周期中传输或声称过未授权数据”。
- 🔒 **严格知悉范围（Need-to-Know）协同**：研发链路中模块 A 的智能体需要与模块 B 智能体对齐接口，但绝对禁止接触模块 B 的内部实现上下文。
- 🏛️ **金融 / 医疗 / 司法高合规流水线**：将数据主权与实体权限（Artifact ID）严格映射至智能体节点，提供零旁路的数据流动保障。

---

## 🌟 核心能力优势

### 1. 🛡️ 宿主强制的信息边界（Host-Enforced Boundary）
- **全通道审查**：覆盖 `start`、`spawn`、`send`（task/note/result）、`status`（review/claim/rewire）、`finish` 及保留治理 API 共 **14 条出站通道**（新增受控 `publish`）。
- **原子拦截无副作用**：未持有 artifact 的虚假声称（`evidence-not-owned`）会在持久化或派发前被绝对拦截，不修改网络状态、不扣减步数配额、不留下脏数据。
- **杜绝数据洗白**：结果回执、评价反馈、可选传输字段（`messageId`、`dependsOn`、`retryOf`）全方位审计，彻底封堵隐式隧道。

### 2. 🔍 宿主派生的安全知识发现（Derived Discovery）
- **告别不可控白板**：0.5.0 删除了自由文本白板；本轮有据地、受限地解除结构化可核验发布禁令，默认工具面为 8 个。发现元数据仍仅由宿主派生。
- **防虚报元数据**：`atn_status(query=...)` 检索候选节点时，其文档与标签（topics）完全由**宿主从真实 Custody 注册表反向派生**。智能体无法自报虚假专长，发现即代表真实持有。

### 3. 🕸️ 高效局部自适应拓扑（Adaptive Topology）
- **出度硬顶控制**：有效上限为 `min(天花板, ceil(log2(累计节点数)) + 1)`；默认天花板及绝对硬顶均为 8，默认规模（8 节点）下上限仍为 4，32 节点为 6。退休和失败节点仍计入累计数，额度不会随退休下降；全网出边保持 O(N log N)。天花板 8 高于默认最大规模的曲线值 6，只作为部署安全阀。
- **零开销遥测捎带**：本地静默统计任务延迟、步数消耗与终态；在节点正常接收输入时捎带拓扑健康摘要，**零额外模型唤醒，零额外 Token 费用**。
- **自主换边寻路**：节点基于真实评价与任务历史，通过 `atn_status(rewire=...)` 自主重连协作伙伴，快速适应多阶段任务变迁。

### 4. ⚙️ 企业级事务性架构与自愈保障
- **串行原子 Mutation 队列**：按 `networkId` 严格隔离的串行写事务，读、配额校验、ID 分配与持久化在同一临界区原子执行，彻底杜绝并发死锁与状态竞争。
- **孤儿任务原子认领**：节点异常离线或耗尽预算时，未完成任务自动转为孤儿状态；空闲节点通过 `atn_status(claimTaskId=...)` 抢占接管，流程永不悬空。
- **两阶段平滑退休**：节点按 `Draining`（处理在途义务、停止接新单）→ `Retired`（注销资源句柄）两阶段优雅离线，保障系统平稳收拢。

---


### 5. 共享 Substrate：有界拉取中间产物

默认启用 `atn_publish / atn_search / atn_visit`。网络内消息只追加，地址永不重用，生产者退休或失败后正文仍可检索；认领者可主动追读。引用采用 `msg:<n> / task:<id> / artifact:<id>`，宿主核验存在性、任务可见性、真实 artifact 保管集合，并检查理由是否逐条点名。引用权重作用于单条消息，仅重排正相关结果，不展示给模型，不授予权限；可设 `substrateCitationWeight=false` 回退纯 BM25。发布不产生邮件、不唤醒节点、不额外请求模型；仍在调用者当前获准步骤内执行。

每次读取消息条数与 UTF-8 字节有上界；整数排序和权重可从持久记录重放。拒绝写入不追加消息、不消耗地址、不修改权重或网络业务状态。domain 保持 1，旧记录可冷加载。网络完成／停止后只读归档。默认八工具固定上下文 **7,956 字节**（schema 6,119、规则 1,837）；关闭 substrate 精确回到 **5,910 字节**（4,749 + 1,161）。观察面复用原 tab／顶栏回退，展示容量、步纪元、消息权重与证据链；完整四字段、作者、被引和证据链可由宿主 `ctx.atn.exportSubstrate(networkId)` 导出。

限制：这些是零模型结构验证，不主张正确率、效率、吞吐、延迟或成本收益；不证明真实模型会正确使用它。宿主只校验理由“点名”，不判定是否真的说明贡献，也不证明正文真实或阻止任意自然语言泄漏。论文结果不迁移，本轮不重启等预算研究。

## 📊 Web GUI 结构化网络状态面板

观察读取现使用 Gateway principal/resource 授权：owner 可查看；非 owner 必须获授 `atn-observation` 会话别名上的内容快照或独立元数据 action。快照授权允许观察该会话所属**整个网络**，不能直接复用普通会话阅读权限。`exportSubstrate` 和进程内原始读取 API 仍以宿主插件可信为前提，不校验调用者。见[威胁模型](docs/THREAT_MODEL.md)与[读取授权接入](docs/OBSERVER_READ_AUTHORIZATION.md)。

在 DeepSeek Harness Web GUI 中运行 ATN 预设任务，点击顶栏 **「ATN 网络状态」** 查看节点表、邻接分组与任务详情。浏览器中的 `betterSidebar` 服务可用时，还会注册原生右侧栏 `atn-network` tab；顶栏入口始终可用。

<div align="center">

![ATN 结构化状态面板组件示例](docs/assets/atn-web-gui.png)

</div>

- **有向邻接分组**：协作出边与出生谱系分开列表，节点选择联动邻居、任务结果和活动流。
- **节点状态与配额**：展示当前负载、工具、剩余步数/连接额度。历史统计仅为快照窗口内的提交/结算数，不等于验收率；遗留任务候选是否可认领由 `atn_status` 确认。
- **只读观察**：复用认证 RPC 与严格 schema，可见时串行读取，隐藏/切会话/切预设/卸载取消；不写网络、不唤醒模型、不产生模型 token，仍有普通 RPC 处理开销。

截图由真实展示组件与确定性示例数据生成。`dsh-better-sidebar@0.26.1` 是精确固定的 optional peer，仅此版本完成 API/注册服务验证，无须安装即可使用顶栏回退；当前 0.26.1 provider 在目标 Harness 上仍等待已删除的 `webRuntime`，普通 npm 同装也有 peer 冲突。因此已验证客户端 Tab API 和真实注册服务，完整 provider 联合启动及侧栏浏览器验收仍待上游适配。非 ATN 会话不渲染/取数，provider 的全局菜单条目会禁用。详见 [C 实施报告](docs/BETTER_SIDEBAR_IMPLEMENTATION_REPORT.md)及[残余验证缺口实施报告](docs/RESIDUAL_VERIFICATION_GAPS_IMPLEMENTATION_REPORT.md)。

---

## 🛠️ 模型交互面：八个核心工具

默认启用原有五工具与三个 substrate 工具；`substrateEnabled=false` 时恢复原五工具和原六条行为规则。

| 工具名称 | 核心输入参数 | 核心职责与业务价值 |
|---|---|---|
| `atn_start` | `objective`, `successCriteria`, `constraints` | 初始化协作网络并确立初始目标，分配入口根节点。 |
| `atn_spawn` | `task`, `context`, `leaseMs` | 在拓扑中创建同能力工作节点，继承安全预设并建立初始边。 |
| `atn_send` | `to`, `kind` (`task`\|`note`\|`result`), `body`（`result` 需携带 `taskId`, `summary`, `evidence`） | 点对点加密级安全通信；支持下发子任务、同步进展及带权属证据的交付结算。 |
| `atn_status` | 可选读：`query`, `taskIds`<br>可选写：`claimTaskId`, `review`, `rewire` | **一体化状态中枢**：查询拓扑邻居、原子认领孤儿任务、提交履约评价及自主换边重连。 |
| `atn_publish` | `sub_task`, `artifact`, `rationale`, `refs` | 只追加结构化中间产物；引用可解析、理由逐条点名、artifact 引用由宿主保管核验。 |
| `atn_search` | `query` | BM25 与可关闭的消息引文权重，仅对正相关结果排序；默认最多 8 条。 |
| `atn_visit` | `addresses` | 默认最多 8 个地址；任一未解析则整体拒绝，不展示作者或权重。 |
| `atn_finish` | 可选 `scope="node"\|"network"`（网络级需 `summary`, `goalVersion`） | 优雅履行责任退出：单个节点退休（node）或全网汇聚交付最终结论（network）。 |

---

## 🚀 快速上手

### 环境要求
- Node.js >= 24
- DeepSeek Harness 0.2.1-alpha.4（本轮仅此版本实测；engines.dsh 为 >=0.2.1-alpha.4 <0.3.0，范围内其他版本未验证；alpha.4 起由它单独判定兼容性）
- Cordis 4.0.5-alpha.2（目标 Harness 实际依赖）

本轮 A、B、C 客户端改造、统一声明审计及 D 决策已完成并分阶段提交。干净 `npm ci` 后的最终六项命令与额外真实 Web 观察 smoke 全通过，551 项 runtime/集成 + 14 项 UI，零失败/跳过。C 的完整外部 provider 激活仍有限制，见上文。阶段报告：[A](docs/HARNESS_0_2_1_IMPLEMENTATION_REPORT.md)、[B](docs/DYNAMIC_DEGREE_IMPLEMENTATION_REPORT.md)、[C](docs/BETTER_SIDEBAR_IMPLEMENTATION_REPORT.md)；[审计表](docs/DECLARATION_AUDIT.md)、[D 决策](docs/NEXT_SCOPE_DECISION_RECORD.md)、[最终验收](docs/FINAL_EXECUTION_VALIDATION.md)。

残余验证修复将双检查接入独立的 `sidebar-contract` CI job（Ubuntu/Windows），通过 `npm run verify:sidebar` 阻断契约漂移，并拒绝未验证的 provider 版本。本轮六项要求命令全部退出 0，551 项 runtime/集成 + 14 项 UI 零失败/跳过。Windows 本地已实测 npm 安装副本及故意漂移红灯；GitHub 托管矩阵尚未实际运行。冻结实验的注释会改变原始 `sourceHashes`，重放归档实验需使用匹配冻结哈希的源码快照。实际命令结果和限制见[本轮报告](docs/RESIDUAL_VERIFICATION_GAPS_IMPLEMENTATION_REPORT.md)。

### 1. 从 npm 安装已发布版本
以下命令安装历史发布的 0.5.0；本轮源码依赖和 UI 改动尚未重新发布，验证本轮请使用下节源码 tarball。
```bash
# 安装已发布版本至 web profile
dsh plugin --profile web add dsh-atn@0.5.0

# 检查配置中是否包含 atn 扩展
dsh --profile web --dump-config
```

### 2. 从源码构建安装最新版本 (0.5.0 信息边界)
```bash
git clone https://github.com/ff66ccff/dsh-ATN.git
cd dsh-ATN
npm ci
npm run build
npm run pack:tarball
dsh plugin --profile web add ./.artifacts/dsh-atn-0.5.0.tgz
```

### 3. 配置宿主保管策略（最小接入示例）
在宿主启动网络前，通过 `defineCustodyPolicy` 声明数据保管权限与提取规则。以下代码展示如何安装策略并原子拦截无权声称：

```typescript
import { defineCustodyPolicy } from 'dsh-atn'

// 1. 宿主真实授权映射（由宿主业务系统授予/撤销，不可由模型声明）
const custodyTable = new Map<string, Set<string>>([
  ['node-1', new Set(['finance-report-2026', 'shared-guidelines'])],
  ['node-2', new Set(['engineering-spec'])],
])

// 2. 声明策略规则
const policy = defineCustodyPolicy({
  // 返回该节点真实持有的合法 artifact 列表
  custody: (nodeId) => custodyTable.get(nodeId) ?? [],

  // 从出站消息的任意字段中解析声称持有的 artifact ID
  extractClaims: (input) => [
    ...JSON.stringify(input).matchAll(/claim:([a-z0-9-]+)/g)
  ].map(m => m[1]),

  // 由宿主提供合规的结构化元数据，驱动 atn_status 安全发现
  describeArtifact: (id) => ({ topics: [id] }),
})

// 3. 安装到全局网络，返回释放句柄
const disposePolicy = ctx.atn.installOutboundPolicy('*', policy)
```

验证内置端到端安全用例（**零付费 API 消耗**）：
```bash
node --import tsx/esm examples/information-boundary.ts
# 输出: Owned note/result accepted; unowned review refused atomically; custody discovery works without a board.
```

---

## 🏆 极致诚实：说的每一句话都有测试背书

在行业普遍充斥着过度宣传（Overclaim）与个例跑分的背景下，**dsh-ATN 坚信：科学的真实性才是最不可替代的技术壁垒。**

我们量了十一轮，公开透明地记录了所有对照数据。**负面结果不是尴尬，而是最具公信力的工程徽章。**

### 1. 十一轮等预算实测终轮收束结论 (Round 11)
我们在严格对齐的等预算约束下，使用 `deepseek-v4.1-flash` 完成了五臂各 14 个配对 seed、共 **70 次真实模型调用**的终轮基准评测：

| 评估臂 (Arm) | 精确通过率 | Wilson 95% 置信区间 | 任务墙钟中位数及 95% 区间（秒） | 配对模型调用数相对差 |
|---|:---:|:---:|:---:|:---:|
| `single` (普通单智能体) | 9/14 | 38.76% – 83.66% | 106.08 [96.92, 115.78] | 基准 |
| `single-scaffolded` (逐分片单智能体) | 13/14 | 68.53% – 98.73% | 119.83 [101.26, 143.35] | +13 次 |
| `independent-pool` (独立无通信池) | 12/14 | 60.06% – 95.99% | 107.95 [98.09, 125.40] | +1 次 |
| `native-team` (Harness 原生 Team) | 14/14 | 78.47% – 100.00% | 204.37 [151.81, 334.78] | +21 次 |
| **`atn-adaptive` (自适应拓扑)** | 10/14 | 45.35% – 88.28% | 156.96 [131.18, 199.19] | **较原生 Team 少 21 次** (p=0.00366) |

**客观科学的判读结论**：
- 经精确 McNemar 检验与严格的 Holm 多重比较校正，**未建立 ATN 相对其他臂在最终任务正确率上的统计学优势**。
- ATN 在复杂任务通信中较原生 Team 显著节省了模型调用次数（配对中位数减少 21 次），但分布式通信客观上增加了调度墙钟耗时。
- **我们明确宣布等预算研究线在本轮正式收束，全部结论锁定为 `causalClaim=false`**。详细审计见 [第 11 轮五臂报告](docs/EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md)。

### 2. 严守客观的宣传红线
在 dsh-ATN 的产品与宣传词典中，**明确禁止使用以下过度宣传词汇**：
- ❌ **更快**（分布式协作存在固有的信令开销，无隔离需求时单智能体更直接）
- ❌ **涌现**（不依赖神秘玄学，只相信可复现的代码与宿主规则）

### 3. 严肃而并列的安全边界限制（非脚注）

以下四项分别对应[威胁模型](docs/THREAT_MODEL.md)的 X-INFERENCE、X-SIDECHANNEL、X-COLLUSION、X-EXTERNAL；网络业务分区不自动构成租户认证。
宿主策略提供的是“**禁止节点声称持有未被授予的数据**”。遵循负责任的安全披露准则，它明确**不包含**以下防护：
1. **不防推理衍生**：智能体可从合法数据中提炼推论并传递；策略约束 Artifact 身份标识，不度量语义信息熵。
2. **不防物理侧信道**：交互延迟、正文字节数、调用频次及错误码反馈等侧信道可能残留信号。
3. **不防合谋互通**：两个合法持有不同数据的节点可在策略许可范围内主动互换数据。
4. **网络内部生效**：仅约束 ATN 框架内的 14 条出站通道，不拦截智能体在 ATN 外直接调用宿主未纳管能力的动作。

---

## 🗺️ 未来演进路线：沿“信任轴”持续深耕

我们不再堆砌复杂的协作玩法去赌虚无缥缈的“群体智能”，而是**全面沿着确定性的信任与安全轴稳步演进**：

- 🔑 **丰富数据保管模型**：引入只读（Read-Only）、有期租约（TTL-based）、跨节点委托（Delegation）及动态撤销（Revocation）等企业级细粒度访问控制。
- 📜 **拦截日志转化为合规产品**：将原子拒绝事件格式化为合规审计报告，为企业提供“智能体间绝对无越权数据传输”的形式化证明工件。
- 🛡️ **拓扑换边纳入策略管辖（Topology-as-ACL）**：将 `rewire` 从单纯的出度配额控制升级为策略级微隔离机制，宿主可按节点安全密级决定“谁能连谁”。
- 💾 **对接真实数据权限底座**：将保管表与底层文件系统 ACL、数据库行级安全性（RLS）和企业 IAM 授权体系实时挂接。

---

## ⚙️ 灵活配置项 (Cordis Config)

可在 Profile 的 `cordis.patch.yml` 中自由微调网络参数：

| 配置参数 | 默认值 | 作用说明 |
|---|---|---|
| `maxCollaborationPeers` | `8` | 有效出度的天花板（硬约束 1–8），status 返回当前曲线值。旧网络冻结 4 或省略此字段时继续以 4 为天花板，无迁移；显式冻结 2 的实验仍最多 2。 |
| `maxResidentNodes` | `8` | 网络内最大并发驻留活跃工作节点数 |
| `maxTotalNodes` | `32` | 单网络生命周期内累计允许创建的最大节点数 |
| `stepBudget` | `64` | 单节点准入步数硬配额，耗尽后进入优雅退休 |
| `maxTasks` | `256` | 单网络最大支持的累计任务数 |
| `maxMessageBytes` | `8192` | 单条通信消息最大 UTF-8 字节数 |
| `defaultLeaseMs` | `300000` | 默认任务租约超时时长（5 分钟） |
| `networkDeadlineMs` | `3600000` | 网络硬性总生命周期上限（60 分钟） |
| `substrateEnabled` | `true` | 关闭三个新工具并恢复原固定上下文 |
| `maxSubstrateMessages` | `128` | 消息数上限，满则拒绝，无驱逐 |
| `maxSubstrateMessageBytes` | `2048` | 单条含完整持久信封的 UTF-8 字节上限 |
| `maxSubstrateTotalBytes` | `131072` | 消息序列累计字节上限，至少等于单条上限 |
| `substrateSearchResults` | `8` | 每次 search 返回 1–16 条中的配置上限 |
| `substrateVisitLimit` | `8` | 每次 visit 的地址上限，1–16 |
| `substrateRefsPerMessage` | `32` | 单条引用上限，1–32，重复引用拒绝 |
| `substrateCitationWeight` | `true` | 关闭后不记录权重，采用纯 BM25 |
| `substrateCitersShown` | `8` | 模型最多回看最近被引地址数，1–8 |
| `domainName` | `atn_networks` | 隔离存储域命名空间 |

---

## 🧪 工程质量与测试矩阵

项目坚持零技术债务，配备了极其严苛的工程测试与静态审计体系：

```bash
npm install              # 安装依赖
npm run typecheck        # 严格 TypeScript 类型检查
npm test                 # 执行全量 550+ 项测试（零真实 API 消耗，毫秒级自愈验证）
npm run verify:sidebar   # 需 SIDEBAR_PACKAGE_DIR 指向独立安装的 dsh-better-sidebar@0.26.1
npm run build            # 构建生产分发产物
npm run pack:tarball     # 打包 tgz 安装包
npm run smoke:profile    # 运行真实 DSH Profile 完整集成烟测
```

- **550+ 项自动化测试**：全面覆盖拓扑演化、13 通道出站审查、并发竞争、状态回放、故障补偿及 Web UI。
- **红灯失败测试在先留档**：信息边界重构与漏洞修复严格遵守“先提交失败测试留档、再实施代码修复”原则，留档见 [`docs/information-boundary/`](docs/information-boundary/)。

---

## 📚 延伸阅读与文档索引

完整技术报告与历史档案请参阅 [**dsh-ATN 文档库索引指南**](docs/README.md)：
- 🧭 [**战略定位与演进白皮书**](docs/STRATEGY_AND_POSITIONING.md)：深度拆解设计哲学与信任轴演进逻辑。
- 🛡️ [**14 条出站通道审计契约**](docs/information-boundary/OUTBOUND_CHANNEL_AUDIT.md)：查看出站通道与拒绝码定义。
- 🧪 [**第 11 轮五臂等预算评测报告**](docs/EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md)：查阅 70 次真实运行的原始统计数据。
- 🔬 [**真实探针可行性前提核验与停止报告**](docs/LIVE_PROBE_FEASIBILITY_IMPLEMENTATION_REPORT.md)：首次零模型核验发现 60/8 不是严格下界，按 brief 第 7.2 条停止；保留该次未执行重跑的历史记录。
- 🔬 [**严格下界推导与恢复运行条件**](docs/LIVE_PROBE_STRICT_BOUND_DERIVATION.md)：后续授权恢复；区分因果取证下界、参考策略与带延迟假设的规划准入，指定 Gemini medium 仅增加期限。
- 🔬 [**真实探针恢复实施报告**](docs/LIVE_PROBE_RESUMED_IMPLEMENTATION_REPORT.md)：指定 AGY Gemini medium 新批次的冻结条件、逐 seed 结果、延迟分解和未知 usage 边界。
- 🔬 [**探针门分位修正与静默定位报告**](docs/PROBE_GATE_AND_QUIESCENCE_IMPLEMENTATION_REPORT.md)：零模型重算 224 个无删失样本的 p50/p75/p90/p95；区分 3 次错误提交与 2 次未提交，并给出任务持有者、具名工具映射和入口步数证据。
- 🔬 [**静默活性审计前置核验与停止报告**](docs/PROBE_LIVENESS_AUDIT_IMPLEMENTATION_REPORT.md)：零模型核验发现 delivered 是持久输入收据；seed 59 唯一时间候选已在同一步接收邮件，按 brief 第 7.3 条停止，未宣称双向对照或整轮验收通过。[唤醒条件定义](docs/PROBE_WAKE_ELIGIBILITY_DEFINITION.md)。
- 🔬 [**静默活性审计 V2 实施报告**](docs/PROBE_LIVENESS_AUDIT_V2_IMPLEMENTATION_REPORT.md)：先确立事件语义，再用真实内核故障注入证明两类缺陷可达；60 封正常收据、1 封不可达，五 seed 均无尚欠推送工作。含完整任务/末次动作表、期限口径对照及复现记录；完整历史重算依赖未跟踪持久文件（4.6b）。

---

## 📄 开源协议

本项目采用 [Apache-2.0](LICENSE) 许可证开源。遵循相关第三方开源声明与规范，详见 [NOTICE](NOTICE)。

当前上游适配依据与验证边界见 [alpha.4 实施报告](docs/UPSTREAM_LATEST_ADAPTATION_IMPLEMENTATION_REPORT.md)。旧 A/B/C 报告保留历史版本与测试数；本轮开工基线为 569 项 runtime/集成 + 14 项 UI。

- [Substrate 实施说明](docs/SUBSTRATE_COORDINATION_INTEGRATION_BRIEF.md) / [实施报告](docs/SUBSTRATE_COORDINATION_INTEGRATION_IMPLEMENTATION_REPORT.md)：结构契约、论文偏离、字节数与零模型证据。
