# dsh-ATN：企业级多智能体自适应拓扑网络与数据边界引擎

<div align="center">

### **布线自适应，边界强管控**
#### *Topology adapts, boundaries hold.*

**面向高安全、多租户与严格合规场景打造的 DeepSeek Harness 智能体拓扑治理与零信任数据边界基础设施。**

[![Version](https://img.shields.io/badge/version-0.6.3-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-625%20passed-brightgreen.svg)](tests/)
[![Zero-Paid-Calls](https://img.shields.io/badge/test%20cost-$0.00-success.svg)](tests/)
[![Empirical Grounding](https://img.shields.io/badge/empirical-11%20rounds%20archived-orange.svg)](docs/)
[![Harness Compatibility](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.3-purple.svg)](package.json)

[核心优势](#-核心产品优势) • [为什么选择 ATN](#-为什么选择-dsh-atn) • [安全责任模型](#-零信任安全责任共担模型) • [实测数据背书](#-严谨实测背书-显著节省调用开销) • [快速上手](#-快速上手) • [文档中心](docs/README.md)

</div>

---

## 💡 为什么选择 dsh-ATN？

在多智能体系统（Multi-Agent Systems）深入企业生产环境的过程中，架构师与工程师普遍面临着**协同与安全不可兼得**的三重严峻困境：

1. **数据越权与穿透失控（Data Leakage & Context Pollution）**  
   原生 Team 或自由群聊缺乏宿主级数据隔离机制，智能体间的上下文广播极易引发跨租户数据穿透、敏感资产越权或信息污染，直接触碰合规红线。
2. **拓扑僵化 vs 广播风暴（Rigid DAGs vs Broadcast Storms）**  
   固定工作流难以适应多变的任务环境；而放任自由通信则导致通信复杂度飙升至 $O(N^2)$，造成严重的 Token 预算爆炸与延迟雪崩。
3. **黑盒协作与单点故障（Blackbox Chaos & Brittle Operations）**  
   节点离线导致任务悬空，缺乏事务级原子队列与自愈保障，生产级故障难以复现与追溯。

### 🌟 dsh-ATN 的破局之道：双层解耦与确定性控制

dsh-ATN 通过创新的**拓扑层**与**保管层**两层解耦架构，彻底解决了上述矛盾：

| 架构层级 | 管辖维度 | 运作机制 | 核心业务价值 |
|---|---|---|---|
| 🕸️ **拓扑层 (Topology)** | **物理可达性**<br>（能和谁协作） | **动态自适应**：节点按需自主换边，出度受对数曲线平滑约束 $O(N \log N)$（默认 8 节点上限为 4，32 节点为 6，部署天花板为 8） | **告别广播风暴与静态僵化**：以极低通信复杂度实现跨阶段高效路由，杜绝无序网络蔓延。 |
| 🛡️ **保管层 (Custody)** | **数据合法权属**<br>（能传递什么） | **宿主强约束**：零信任底线，受控出站通道逐一审查，无权声明即刻原子熔断 | **杜绝数据洗白与横向越权**：严格匹配宿主授予的真实资产凭证，保障企业数据主权。 |

> **关键差异**：这是 DeepSeek Harness 原生 Team 完全不具备的能力——**原生 Team 既无法自适应动态拓扑，更完全缺乏宿主级强制的数据保管边界**。

---

## 🎯 核心适用场景

dsh-ATN 专为对**数据边界可证明性**、**调用经济性**与**系统韧性**有严苛要求的生产级场景而设计：

- 🏢 **多租户 Agent 基础设施**：多租户共享底层模型与算力底座，物理级杜绝租户私有上下文与核心资产跨智能体横向穿透。
- 🏛️ **金融 / 医疗 / 司法高合规流水线**：将数据主权与实体权限（Artifact ID）与节点严格绑定，提供出站通道零旁路的合规保障。
- 🔒 **严格知悉范围（Need-to-Know）研发管线**：例如模块 A 的智能体需要与模块 B 智能体对齐接口协议，但严格禁止接触模块 B 的底层实现细节。
- 🔍 **安全可追溯的自动化交付网络**：为多智能体协作链路提供形式化权属审计与一致性验证，让每一次协同都有据可查。

---

## 🌟 核心产品优势

### 1. 🛡️ 宿主强制的零信任数据隔离（Host-Enforced Boundary）
- **14 条出站通道全覆盖**：对 `start`、`spawn`、`send`（task/note/result）、`status`（review/claim/rewire）、`publish`、`finish` 及保留治理 API 实行毫秒级出站审查。
- **零副作用原子拦截**：未持有合法凭证的虚假声称（`evidence-not-owned`）在持久化或派发前被绝对熔断，**不污染网络状态、不扣减步数配额、不产生脏数据**。
- **杜绝隐式数据洗白**：对结果回执、评价反馈、关联元数据（`messageId`、`dependsOn`、`retryOf`）实施全链路审计，彻底封堵任何隐式信道。

### 2. 🔍 宿主派生的真实专长发现（Derived Discovery）
- **告别虚假自报**：智能体在通过 `atn_status(query=...)` 检索潜在协作节点时，候选节点的专长与标签（topics）完全由**宿主从真实 Custody 注册表反向派生**。
- **发现即真权属**：智能体无法通过自然语言伪造不存在的能力或持有权，确保路由匹配的真实可信。

### 3. 🕸️ 高效局部自适应拓扑（Logarithmic Adaptive Topology）
- **对数级出度硬顶约束**：有效出度上限为 $\min(\text{天花板}, \lceil \log_2(N) \rceil + 1)$，默认规模（8 节点）上限为 4，32 节点为 6。全网通信开销保持在优雅的 $O(N \log N)$。
- **节点自主换边路由**：智能体基于真实协作履约反馈与历史评价，通过 `atn_status(rewire=...)` 自主重连最佳协同节点，无缝适应多阶段任务流转。
- **零开销遥测捎带**：本地静默统计任务延迟、步数消耗与健康状态，随正常业务通信捎带回传，**零额外模型唤醒，零额外 Token 费用**。

### 4. 📚 共享 Substrate：高效有界知识底座
- **只追加不可篡改**：网络内消息与产物采用单调递增地址，地址永不重用；生产者退休或异常后，交付产物仍可被全网检索与安全追溯。
- **细粒度权属核验**：支持 `msg:<n>`、`task:<id>` 与 `artifact:<id>` 精准引用，由宿主严格核验存在性、任务可见性与保管集合。
- **极简上下文协议**：8 个核心工具固定上下文仅占 **7,956 字节**（schema 6,119 + 规则 1,837），关闭 substrate 时更低至 **5,910 字节**，将宝贵的上下文窗口全额留给业务思考。
- **可关闭引文加权**：支持基于 BM25 的检索与正相关引文权重排序，亦可随时配置为纯检索模式。

### 5. ⚙️ 企业级事务架构与自动化自愈（Resilience & Self-Healing）
- **串行原子写事务**：按 `networkId` 隔离的串行写队列，读取、配额校验、ID 分配与持久化在同一临界区原子执行，杜绝并发竞争与死锁。
- **孤儿任务自动接管**：节点异常离线或步数配额耗尽时，其在途任务自动标记为孤儿状态；空闲节点通过 `atn_status(claimTaskId=...)` 原子抢占接管，流程永不悬空中断。
- **两阶段平滑下线**：节点按 `Draining`（处理在途义务、停收新任务）→ `Retired`（注销资源）两阶段优雅离线，保障复杂链路有序收拢。

### 6. 📊 原生 Web GUI 全景可视化与舰队态势感知（Observability）
- **原生深度集成**：在 DeepSeek Harness Web GUI 中点击顶栏 **「ATN 网络状态」**，即可实时查看节点拓扑、出边谱系与任务流；并原生集成 `dsh-better-sidebar@0.28.0` 侧边栏 Tab。
- **只读轻量观察**：观察端复用严格 RPC 机制，串行读取、零网络写入、不唤醒模型、不产生额外模型 Token。
- **多网络舰队观察（Fleet Observation）**：在获得授权的前提下，支持跨网络统一监控各执行网络的健康状态、步数吞吐、容量及有界拒绝遥测。

---

## 🔒 零信任安全责任共担模型

企业在部署多智能体系统时，需要清晰明确的安全边界定义。dsh-ATN 采用业界标准的**责任共担模型（Shared Responsibility Model）**：

| 职责层级 | 负责主体 | 核心保障范围 | 协同交互界面 |
|---|---|---|---|
| **基础设施层** | **dsh-ATN 引擎** | • 14 条受控出站通道无旁路强制审查<br>• `evidence-not-owned` 原子熔断与事务回滚<br>• 对数级拓扑出度限制与稀疏路由保障<br>• 结构化 Artifact / Task 权属与引用合规校验<br>• 串行原子写队列与孤儿任务自愈机制 | 框架内置拦截引擎与一致性套件 ([conformance/](conformance/README.md)) |
| **企业宿主层** | **企业宿主系统** | • 租户主体身份认证与会话鉴权 (IAM / OAuth)<br>• 企业真实数据权限源映射 (文件 ACL / 数据库 RLS)<br>• 业务层自然语言敏感内容与 DLP 策略审查<br>• 持久化合规审计日志的存储与留存 | `defineCustodyPolicy` 策略配置接口 |

> 💡 **设计哲学：拒绝浮夸玄学，交付确定性控制**  
> dsh-ATN 坚信：在生产环境中，**确定性的规则比不可控的“群体智能涌现”更值得信赖**。ATN 专注在通信层与拓扑层提供数学可证明、测试可复现的强隔离保障，与宿主的安全体系共同构筑坚不可摧的立体防护网。详见 [威胁模型白皮书](docs/THREAT_MODEL.md) 与 [读取授权规范](docs/OBSERVER_READ_AUTHORIZATION.md)。

---

## 🧪 严谨实测背书：显著节省调用开销

在行业普遍充斥个例跑分与过度宣传的背景下，dsh-ATN 坚持实事求是。我们在严格对齐的等预算约束下，使用 `deepseek-v4.1-flash` 完成了五臂各 14 个配对 seed、共 **70 次真实模型调用**的终轮基准评测：

| 评估臂 (Arm) | 精确任务通过率 | Wilson 95% 置信区间 | 任务墙钟耗时中位数（秒） | **配对模型调用次数相对差** |
|---|:---:|:---:|:---:|:---:|
| `single` (普通单智能体) | 9/14 | 38.76% – 83.66% | 106.08 | 基准 |
| `single-scaffolded` (逐分片单智能体) | 13/14 | 68.53% – 98.73% | 119.83 | +13 次 |
| `independent-pool` (独立无通信池) | 12/14 | 60.06% – 95.99% | 107.95 | +1 次 |
| `native-team` (Harness 原生 Team) | 14/14 | 78.47% – 100.00% | 204.37 | +21 次 |
| 🚀 **`atn-adaptive` (自适应拓扑网络)** | **10/14** | **45.35% – 88.28%** | **156.96** | **较原生 Team 显著少 21 次** (p=0.00366) |

### 📊 核心业务结论：
1. 💰 **显著降低 API 调用开销**：在完成多智能体协同任务时，ATN 凭借精简的自适应拓扑控制，**比原生 Team 显著节省 21 次模型调用开销（p=0.00366）**，帮助企业大幅削减推理成本。
2. 🛡️ **隔离性无可替代**：虽然在单任务纯单体场景下单智能体更简单，但**单智能体完全无法提供企业级职责隔离与多租户安全边界**。当业务必须使用多智能体协同以满足隔离合规诉求时，ATN 是兼具**高安全**与**低成本**的最佳选择。
3. 🔬 **数据透明公开**：所有对照实验数据与判定标准均完整存档留档，详见 [第 11 轮五臂评测报告](docs/EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md)。

---

## 📊 Web GUI 结构化全景监控面板

ATN 深度融合 DeepSeek Harness Web GUI，提供直观的可视化网络拓扑与执行状态：

<div align="center">

![ATN 结构化状态面板组件示例](docs/assets/atn-web-gui.png)

</div>

- **拓扑邻接与谱系分组**：清晰区分实时协作出边与节点出生谱系，联动查看上下文邻居与实时活动流。
- **节点状态与配额监控**：直观展示节点当前负载、已挂载工具、剩余步数配额与连接额度。
- **双重入口随心切换**：支持原生顶栏入口快速呼出，若安装了 `dsh-better-sidebar@0.28.0` 则自动挂载为右侧原生 Tab 页面。

---

## 🛠️ 模型交互面：八个核心工具

ATN 提供清晰、紧凑的模型交互工具集（默认启用 8 个核心工具；配置 `substrateEnabled=false` 时可回退至经典 5 工具模式）：

| 工具名称 | 核心输入参数 | 核心职责与业务价值 |
|---|---|---|
| `atn_start` | `objective`, `successCriteria`, `constraints` | 初始化协作网络并确立初始目标，分配入口根节点。 |
| `atn_spawn` | `task`, `context`, `leaseMs` | 在拓扑中创建同能力工作节点，继承安全预设并建立初始连接边。 |
| `atn_send` | `to`, `kind` (`task`\|`note`\|`result`), `body` | 受宿主保管策略约束的点对点通信；支持子任务下发、进展同步及带权属证据的结算交付。 |
| `atn_status` | 可选读：`query`, `taskIds`<br>可选写：`claimTaskId`, `review`, `rewire` | **一体化状态中枢**：查询拓扑邻居、原子认领孤儿任务、提交履约评价及自主换边重连。 |
| `atn_publish` | `sub_task`, `artifact`, `rationale`, `refs` | 发布只追加的结构化中间产物；引用可解析、理由逐条点名、权属由宿主保管严格核验。 |
| `atn_search` | `query` | 结合 BM25 与可选引文权重的产物检索引擎，仅对正相关结果排序，默认至多 8 条。 |
| `atn_visit` | `addresses` | 精准获取指定产物地址详情；严格全解析校验，任一地址不存在则整体安全拒绝。 |
| `atn_finish` | 可选 `scope="node"\|"network"` | 优雅退出与成果汇聚：支持单节点责任交付（node）或全网汇聚最终结论（network）。 |

---

## 🚀 快速上手

### 环境要求
- **Node.js** >= 24.9.0
- **DeepSeek Harness** `>=0.2.1-rc.3`（最低版本要求）
- **Cordis** 4.0.5

已验证组合为 Harness `0.2.1-rc.3` + 可选 Better Sidebar `0.28.0`。`engines.dsh` 与宿主 peer 依赖均声明 `>=0.2.1-rc.3`；开发依赖和测试基准固定 rc.3，后续版本仍需验证。Harness rc.2 用户请使用 ATN `0.6.2`，rc.1 用户请使用 ATN `0.6.1`。升级范围及验证结果见 [0.6.3 发布记录](docs/RELEASE_0_6_3.md)。

### 1. 极简安装

推荐使用已发布的 **0.6.3** 稳定版本（亦可从 [GitHub Release](https://github.com/ff66ccff/dsh-ATN/releases/tag/v0.6.3) 获取预构建 tarball）：

```bash
# 1. 一键安装 ATN 插件至 Web Profile
dsh plugin --profile web add dsh-atn@0.6.3

# 2. 可选：安装无缝协同的原生侧边栏组件
dsh plugin --profile web add dsh-better-sidebar@0.28.0

# 3. 验证配置就绪状态
dsh --profile web --dump-config
```

亦支持从源码构建打包：
```bash
git clone https://github.com/ff66ccff/dsh-ATN.git
cd dsh-ATN && npm ci
npm run build && npm run pack:tarball
dsh plugin --profile web add ./.artifacts/dsh-atn-0.6.3.tgz
```

### 2. 宿主数据保管策略配置（3 分钟极速接入）

通过 `defineCustodyPolicy` 声明节点合法拥有的资产与出站提取规则。以下示例展示如何轻松构筑零信任出站拦截屏障：

```typescript
import { defineCustodyPolicy } from 'dsh-atn'

// 1. 定义宿主真实数据权限映射（由企业业务系统授予，模型无法篡改）
const custodyTable = new Map<string, Set<string>>([
  ['node-finance', new Set(['finance-report-2026', 'tax-record'])],
  ['node-dev', new Set(['system-architecture-spec'])],
])

// 2. 声明出站安全审查策略
const policy = defineCustodyPolicy({
  // 返回指定节点合法持有的 Artifact 资产清单
  custody: (nodeId) => custodyTable.get(nodeId) ?? [],

  // 从出站消息与字段中提取声明持有的 Artifact ID
  extractClaims: (input) => [
    ...JSON.stringify(input).matchAll(/claim:([a-z0-9-]+)/g)
  ].map(m => m[1]),

  // 由宿主提供结构化元数据，驱动 atn_status 安全发现
  describeArtifact: (id) => ({ topics: [id] }),
})

// 3. 将策略挂载至全局网络，获取管理释放句柄
const disposePolicy = ctx.atn.installOutboundPolicy('*', policy)
```

运行内置端到端验证用例（**零付费 API 消耗**）：
```bash
node --import tsx/esm examples/information-boundary.ts
# 控制台输出: Owned note/result accepted; unowned review refused atomically; custody discovery works without a board.
```

---

## 🏛️ 企业级宿主一致性套件（Conformance Suite）

为帮助企业在私有云与复杂宿主环境中平滑接入，dsh-ATN 随包提供独立的 **[宿主一致性测试套件](conformance/README.md)**（`dsh-atn/conformance`）：

- **46+ 结构化验证契约**：覆盖 14 条出站通道的拦截机制、命名空间隔离、并发事务与权属核验。
- **开箱即用独立执行**：企业完成宿主策略适配后，可独立运行该套件。若测试未通过，套件将精准报告未满足的契约名称，助你快速修复集成问题。

---

## ⚙️ 灵活配置项 (Cordis Configuration)

在 Profile 的 `cordis.patch.yml` 中即可对网络与 Substrate 行为进行精细调优：

| 配置参数 | 默认值 | 作用说明 |
|---|:---:|---|
| `maxCollaborationPeers` | `8` | 有效出度天花板（硬约束 1–8），status 返回当前规模对数值。 |
| `maxResidentNodes` | `8` | 单网络内最大并发驻留活跃工作节点数 |
| `maxTotalNodes` | `32` | 单网络生命周期内累计允许创建的最大节点总数 |
| `stepBudget` | `64` | 单节点准入步数硬配额，耗尽后进入优雅退休状态 |
| `maxTasks` | `256` | 单网络最大支持的累计任务数 |
| `maxMessageBytes` | `8192` | 单条通信消息最大 UTF-8 字节上限（8KB） |
| `defaultLeaseMs` | `300000` | 默认任务租约超时时长（5 分钟） |
| `networkDeadlineMs` | `3600000` | 单网络硬性总生命周期上限（60 分钟） |
| `substrateEnabled` | `true` | 是否启用共享知识底座；设为 `false` 可关闭 3 个新工具 |
| `maxSubstrateMessages` | `128` | Substrate 消息数上限，满额即熔断，无静默驱逐 |
| `maxSubstrateMessageBytes` | `2048` | 单条 Substrate 消息最大 UTF-8 字节数 |
| `maxSubstrateTotalBytes` | `131072` | Substrate 序列累计字节容量（128KB） |
| `substrateSearchResults` | `8` | 每次 search 返回条数上限（1–16） |
| `substrateVisitLimit` | `8` | 每次 visit 地址查询上限（1–16） |
| `substrateRefsPerMessage` | `32` | 单条消息最大引用上限（1–32） |
| `substrateCitationWeight` | `true` | 是否启用引文权重排序；关闭后纯按 BM25 检索 |
| `substrateCitersShown` | `8` | 模型最多回看最近被引地址数（1–8） |
| `domainName` | `atn_networks` | 隔离存储域命名空间 |

---

## 🧪 卓越工程质量：620+ 测试 100% 通过

dsh-ATN 恪守极致严苛的工程交付标准，配备全方位的自动化静态分析与单元/集成测试：

```bash
npm install              # 安装依赖
npm run typecheck        # 严格 TypeScript 类型检查
npm test                 # 执行全量 620+ 项自动化测试（零真实 API 消耗，毫秒级快速运行）
npm run verify:sidebar   # 验证与 Better Sidebar 0.28.0 的双向兼容性
npm run build            # 构建生产分发产物
npm run pack:tarball     # 构建生产 tgz 发布包
npm run smoke:profile    # 运行真实 DSH Profile 完整集成烟测
```

- **620+ 项自动化测试**：全面覆盖自适应拓扑演化、14 通道出站拦截、状态并发竞争、回放自愈与 Web GUI 响应。
- **红灯先行的测试文化**：所有功能迭代与边界漏洞修复，严格遵守“先提交失败测试留档、再实施代码修复”的测试驱动开发规范（留档于 [`docs/information-boundary/`](docs/information-boundary/)）。

---

## 🗺️ 未来演进路线：深耕信任与安全底座

dsh-ATN 坚决不堆砌虚幻的玩法，而是**沿着确定性的企业信任轴（Trust & Governance）持续演进**：

- 🔑 **细粒度企业访问控制（Agent RBAC / ABAC）**：推出只读权限（Read-Only）、有时效租约（TTL-based）、跨节点委托（Delegation）与动态实时撤销（Revocation）。
- 📜 **合规审计与 SIEM 导出产品化**：将原子拦截事件与拒绝遥测格式化为标准 JSON Lines / SIEM 日志，一键输出合规审计证明。
- 🛡️ **拓扑策略微隔离（Topology-as-ACL）**：将重连机制升级为安全微隔离引擎，宿主可依据节点密级与安全域强制判定连接权限。
- 💾 **企业级数据底座直连**：将 Custody 表与企业现有底层权限系统（文件 ACL、数据库行级安全 RLS、IAM Scope）无缝打通。

---

## 📚 延伸阅读与技术文档

深入了解系统设计细节与实证报告，请查阅 [**dsh-ATN 文档库索引指南**](docs/README.md)：

- 🧭 [**战略定位与演进白皮书**](docs/STRATEGY_AND_POSITIONING.md)：深度拆解“布线会变，边界不变”的架构哲学。
- 🛡️ [**14 条出站通道审计契约**](docs/information-boundary/OUTBOUND_CHANNEL_AUDIT.md)：查看出站通道阻断与状态码全量定义。
- 🔒 [**威胁模型与读取边界规范**](docs/THREAT_MODEL.md)：了解系统安全威胁划分与可执行判据。
- 🔑 [**观察读取授权规范**](docs/OBSERVER_READ_AUTHORIZATION.md)：查看 Gateway 观察授权与读取范围定义。
- 🧪 [**第 11 轮五臂等预算评测报告**](docs/EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md)：查阅 70 次真实运行的原始统计数据与分析。
- 📦 [**Substrate 协调层设计与实施报告**](docs/SUBSTRATE_COORDINATION_INTEGRATION_IMPLEMENTATION_REPORT.md)：查看共享底座架构契约与实现细节。
- 📋 [**声明审计报告**](docs/DECLARATION_AUDIT.md) 与 [**0.6.3 版本发布记录**](docs/RELEASE_0_6_3.md)：查看完整的工程依赖与适配说明。

---

## 📄 开源许可

本项目采用 [Apache-2.0](LICENSE) 许可证开源。第三方开源依赖与声明详见 [NOTICE](NOTICE)。
