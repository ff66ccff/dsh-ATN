# dsh-ATN：DeepSeek Harness 自适应拓扑智能体网络

[![Version](https://img.shields.io/badge/version-0.4.1-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-450%2B%20passed-brightgreen.svg)](tests/)

**dsh-ATN** 是为 DeepSeek Harness 量身打造的企业级去中心化多智能体协同网络预设。

它彻底打破传统中心化调度与僵化层级限制。每个智能体能力对等、自主决策，动态组建最优协作拓扑，高效达成共同目标。

---

## 核心优势

- **去中心化自组织网络**  
  无单点瓶颈。节点能力均等，自主寻找协作伙伴，自由分配工作。
- **协议开销直降 34%**  
  0.4.0 版本深度收敛设计。仅保留 6 个高效工具与 6 行极简规则，极大节省 Token 成本并提升响应速度。
- **智能自适应拓扑重连**  
  节点根据历史交付质量自主换边（Rewire）。优质连接自动聚合，低效连接动态剔除。
- **精简高效的局部邻域**  
  每节点专注维护最多 4 个活跃邻居。精准隔绝全网通信噪音，显著降低交互消耗。
- **有界高速共享白板**  
  `atn_board` 提供轻量级结构化知识广播。节点跨分支共享事实，无需唤醒无关模型。
- **任务永不丢失的原子事务**  
  单网络串行写队列保障强一致性。支持孤儿任务原子认领与两阶段平滑退休，确保业务闭环。
- **原生开箱即用可视化大屏**  
  深度集成 DeepSeek Harness Web GUI。一键打开动态拓扑面板，实时洞察全网协同状态。

---

## 快速上手

### 系统要求

- Node.js >= 24
- DeepSeek Harness >= 0.2.0-rc.2
- Cordis 4.0.4

### 1. 从 npm 安装（推荐）

运行以下命令安装插件并验证配置：

```bash
# 1. 安装指定版本到 web profile
dsh plugin --profile web add dsh-atn@0.4.1

# 2. 检查配置输出中是否包含 atn 与 preset-atn
dsh --profile web --dump-config
```

桌面端请将 `web` 替换为您当前使用的 Profile 名称。安装完成后重启该 Profile。

### 2. 从源码构建安装

如需体验最新源码，请按以下步骤构建：

```bash
git clone https://github.com/ff66ccff/dsh-ATN.git
cd dsh-ATN
npm ci
npm run build
npm run pack:tarball
dsh plugin --profile web add ./.artifacts/dsh-atn-0.4.1.tgz
```

### 3. 开始使用

1. 打开 **设置 → Agent 预设 → 自定义 → ATN**。
2. 确认插件状态正常，可选择“设为新任务默认”。
3. 新建任务并选择 **ATN** 预设。
4. 输入自然语言任务指令：

```text
请深入核对 docs/ 下的所有规格说明，拆分给多个节点并行查证，并汇总最终证据。
```

ATN 系统提示词将自动引导入口模型调用 `atn_start` 建立网络，全自动展开探索与协同。

---

## 原生网络可视化

在 ATN 预设会话顶部，点击 **「可视化ATN网络」** 按钮即可开启实时拓扑看板：

- **动态连接视图**：实时查看节点间的单向/双向协作边及出生谱系。
- **节点全景状态**：直观展示节点运行状态、正在调用的工具、当前负载与历史任务。
- **活动事件瀑布流**：毫秒级展示任务派发、结果交付、白板更新与动态重连。
- **零开销只读通道**：复用 Harness 认证通道。不唤醒休眠模型，不消耗额外 Token。

---

## 极简模型交互面：六大核心工具

0.4.0 版本将复杂的群体调度精炼为 6 个直观强大的原子工具：

| 工具名 | 必要输入参数 | 核心价值与功能 |
|---|---|---|
| `atn_start` | `objective`, `successCriteria`, `constraints` | 初始化协同网络与初始任务。返回网络标识与初始节点。 |
| `atn_spawn` | `task`, `context` | 快速创建同能力独立工作节点，建立初始协作通道。 |
| `atn_send` | `to`, `kind`, `body`（`result` 另需 `taskId`, `summary`, `evidence`） | 点对点高效通信。支持任务派发、协作通知与带证据的结果清算。 |
| `atn_status` | 可选 `query`, `taskIds`；可选写操作 `claimTaskId`, `review`, `rewire` | 一体化状态中枢。支持邻居查询、孤儿任务原子认领、质量评价与自主拓扑换边。 |
| `atn_board` | `action="read"\|"publish"\|"remove"`，写入需 `key`, `expectedRevision` | 高性能有界白板。跨节点安全共享事实与发现，内置乐观并发控制。 |
| `atn_finish` | 可选 `scope="node"\|"network"`（网络级另需 `summary`, `goalVersion`） | 优雅结清义务。支持单个节点退休或整网交付最终成果。 |

---

## 标准协作流程

节点在网络中自主探索与协同。典型调用时序如下：

### 1. 建立网络与派发子任务

```text
atn_start(objective="全面核对架构文档", successCriteria="所有结论具备引用来源", constraints="优先使用本地文件")
atn_spawn(task="核对第 2 节规格", context="docs/spec.md 第 2 节")
atn_status(query="规格核对")
atn_status(rewire={peers: ["node-2", "node-3"]})
atn_send(to="node-3", kind="task", body="请补充核对第 3 节接口定义")
```

### 2. 交付结果与质量评价

```text
// node-3 完成任务后回传结构化结果
atn_send(to="node-1", kind="result", taskId="task-102", body="完成核对", summary="第 3 节已核对", evidence=["docs/spec.md:40-58"])

// node-1 确认交付质量，提交评价并锁定优秀边
atn_status(review={taskId: "task-102", status: "accepted", summary: "证据确凿", evidence: ["docs/spec.md:40-58"]})
```

### 3. 网络交付

```text
atn_finish(scope="network", summary="全文档核对完毕，所有证据链已就绪", goalVersion=1)
```

---

## 企业级高可靠架构

### 1. 原子持久化队列
所有网络写操作均通过按 `networkId` 隔离的串行 Mutation 队列处理。读取、配额校验、ID 分配与持久化在同一临界区原子完成，从根源杜绝并发竞争。

### 2. 孤儿任务原子认领
若持有任务的节点异常或提早退出，任务将自动转为孤儿状态。空闲节点通过 `atn_status(claimTaskId=...)` 实现原子认领，业务永不悬空。

### 3. 两阶段优雅退休机制
节点退出分为两步：
1. **Draining（收尾阶段）**：停止接入新任务，继续清算存量任务与未完投票。
2. **Retired（退休释放）**：所有存量任务结清后，调度器平滑释放资源句柄。

### 4. 零开销捎带式反馈
运行时在本地静默统计任务耗时、步数与重试数据。当节点下一次正常接收输入时捎带该拓扑摘要，零额外模型唤醒，零额外计费。

---

## 灵活配置指南

所有配置参数均声明于 Cordis Config 中，可在各 Profile 的 `cordis.patch.yml` 中自由调整：

| 参数名称 | 默认值 | 说明 |
|---|---|---|
| `maxResidentNodes` | `8` | 网络内最大同时驻留工作节点数 |
| `maxTotalNodes` | `32` | 单网络生命周期内累计允许创建的最大节点数 |
| `maxCollaborationPeers` | `4` | 单节点最大出边邻居上限（支持 1–4） |
| `stepBudget` | `64` | 单节点准入步数预算，耗尽后平滑退休 |
| `maxTasks` | `256` | 单网络最大支持的累计任务数 |
| `maxProposals` | `64` | 单网络最大支持的累计提案数 |
| `maxMessageBytes` | `8192` | 单条消息最大 UTF-8 字节数 |
| `defaultLeaseMs` | `300000` | 默认节点任务租约时长（5 分钟） |
| `networkDeadlineMs` | `3600000` | 网络硬性总期限（60 分钟） |
| `domainName` | `atn_networks` | 持久化存储域名称 |

---

## 0.4.0 升级指南

0.4.0 版本对工具接口进行了大幅精简与性能升级：

1. **工具合并**：
   - 旧 `atn_feedback` 并入 `atn_status(review={...})`。
   - 旧 `atn_rewire` 并入 `atn_status(rewire={peers: [...]})`。
   - 旧 `atn_publish` 并入 `atn_board(action="publish", ...)`。
2. **白板强校验**：
   - 写入白板必须提供 `key` 与 `expectedRevision`（新建请传 `0`）。
3. **更低消耗**：
   - 固定协议上下文减少约 34%，为复杂任务留出更充裕的模型窗口。

---

## 开发者与工程质量

项目具备严密的测试矩阵与健全的工程规范：

```bash
npm install              # 安装依赖
npm run typecheck        # 严格 TypeScript 类型检查
npm test                 # 执行 450+ 项单元与集成测试（零真实 API 消耗）
npm run build            # 构建发布产物
npm run pack:tarball     # 打包发布 tarball
npm run smoke:profile    # 运行真实 DSH Profile 集成烟测
```

- **450+ 自动化测试**：覆盖拓扑演化、并发竞争、存储回放、故障补偿及 UI 交互。
- **100% 绿色构建**：严格的类型安全与代码规范。

---

## 开源协议

本项目采用 [Apache-2.0](LICENSE) 许可证开源。遵循相关开源软件声明与规范，详见 [NOTICE](NOTICE)。
