# A/B/C 统一声明审计

现行发布说明见 [0.6.0 记录](RELEASE_0_6_0.md)：宿主依赖已统一 alpha.5，侧栏验证集合为 0.26.1 npm 包与 0.27.0 固定提交源码。以下审计表保留各阶段的版本与实测上下文。

日期：2026-10-14，C 代码 `feb242d` 之后、D 之前执行。位置列保留总纲输入时的行号，后续插入文案使实际行号改变。表中旧声明是审计对象，不代表当前承诺。

| 原位置 → 当前段落 | 旧声明 | 新声明 | 依据（阶段 / 测试或实测） |
|---|---|---|---|
| README:32 → 拓扑层表格 | 出度严格受限 ≤4 | 累计规模对数曲线；默认8节点=4，32节点=6；历史证明限定冻结额度 | B / DYNAMIC-01..05，degree-table完整1..32，五seed脚本 |
| README:62 → 出度硬顶控制 | 单节点最大活跃出边4 | min(天花板,ceil(log2累计N)+1)，默认/硬顶8，累计含退休失败；保留稀疏承诺 | B / DYNAMIC-01..05、DYNAMIC-STATUS，192/992边比例 |
| README:220 → 配置表 | 默认4，硬约束1–4 | 默认天花板8，范围1..8，status报告有效值；旧4/缺省冻结4，显式2保留 | B / CONFIG-02、DEGREE-05、ADAPT-12、DYNAMIC-STATUS |
| README:73–86 → 状态面板 | 动态有向连通图，旧可视化入口，全量历史履约率，无系统负载 | 节点表/有向邻接/出生分区/详情/活动；顶栏ATN网络状态及条件侧栏；窗口提交率/候选明确限制；有RPC开销无模型调用 | C / 原8UI保留、VIEW-PROPS、VISIBLE、MENU，真实Web smoke只读与请求数 |
| docs/assets/atn-web-gui.png | 旧SVG截图 | 实际NetworkView+确定性mockSnapshot生成的结构化组件示例 | C / render:screenshot成功及人工查看；不声称provider联合页面截图 |
| ADAPTIVE_TOPOLOGY:11 → status重连段 | atn_rewire，上限1–4 | status(rewire)，天花板1..8/默认8，累计曲线/旧记录冻结；N8仍4 | B / CONFIG-02、DYNAMIC-STATUS、冷恢复/domain与拓扑测试 |
| STRATEGY:14 → 机制定位 | 出度上限4 | 随累计规模增长，N8=4/N32=6，安全天花板8 | B / 度数表、单调性/保边测试 |
| STRATEGY:22 → 拓扑证据 | 出度上限4作为证据 | 动态额度；历史结构证明只用于显式冻结实验，不外推大网络 | B / compare-degree-proofs五seed 0翻转 |
| STRATEGY:63 → Topology-as-ACL | 局部配额上限4 | 局部动态配额（8→4、32→6、顶8），未来策略授权仍是方向 | B / DYNAMIC-STATUS；未将未来ACL声明成新实现 |
| docs/README → 当前实施/机制索引 | 固定四边、图形看板及22篇guide | 当前曲线/结构化双路径；24篇实测guide；完整provider尚待上游适配；输入与历史分开说明 | A/B/C / 各报告、24篇核对表、PENDING、真实registry检查 |
| README:107 → 环境要求 | Harness≥0.2.0-rc.2，Cordis4.0.4 | 精确验证Harness0.2.1-alpha.2及Cordis4.0.5-alpha.1；npm历史发布和本分支tarball区分 | A / 干净npm ci、实际manifest、目标profile smoke；旧Desktop CLI拒绝记录 |
| ADAPTIVE_TOPOLOGY:3–5及末段（额外发现） | 当前九工具、feedback/publish/board、当前九工具smoke | 当前五工具；review/rewire合入status，发现由host派生，白板与旧smoke明确历史 | A/C / preset/tool注册测试、fixed-context 5工具4749bytes、真实profile smoke |
| README → 核心口号（额外发现） | 永远说不出未持有的数据 | 启用宿主策略时检查extractClaims识别的artifact身份；不冒称任意语义检测或网络即认证租户 | 既有information-boundary/reference-policy测试与defineCustodyPolicy公开契约；D需进一步形式化 |

## grep 与剩余命中的解释

命令：`rg -n '出度|≤ 4|上限 4|1–4|硬约束|拓扑图|连通图|atn-canvas|可视化ATN网络' README.md docs -g '*.md'`。完整原始结果见 [declaration-grep.txt](execution-evidence/declaration-grep.txt)，不筛掉历史资料以制造零命中。客户端另外检查 `rg -n 'atn-canvas|atn-edge|<svg|zoomIn|zoomOut|layout\.ts' src/client lib/client.js` 无命中，见 [declaration-client-grep.txt](execution-evidence/declaration-client-grep.txt)。

逐类核对：

- README/STRATEGY/ADAPTIVE当前机制段与索引：只陈述新曲线、默认八节点仍四、旧记录兼容；不存在将常量四作为现行全规模硬顶的段落。已撤回旧图形承诺并说明新呈现，无旧图产品引用。
- MASTER_EXECUTION_PLAN、三个A/B/C brief：用户提供的实施前输入；含旧基线、预计失败断言和待删除关键字。索引明确标为历史输入；保留输入原文可归因，不将旧基线改成事后基线。路线图也是待D核实输入，后续结论见D决策。
- FULL_FEEDBACK_EXPERIMENT、FIVE_ARM/FOUR_ARM报告及方案、MEASURABILITY、PEER_VARIANCE、TOPOLOGY_BINDING、TOOL_ERROR_AUDIT：历史实验固定二边或wide四边、旧白板/工具条件。对应档案保留，涉及生产默认常量四的早期报告加历史提示；没有把实验四边改成新默认八或抹掉阴性结果。
- DESIGN_TOPOLOGY_MEASUREMENT/MEASURABILITY中“上限4096”是输出token实验条件；第1–4轮/4.1–4.6是章节或轮次，不是度数范围。EQUAL_BUDGET的“硬约束”是等预算实验条件，仍正确。
- MINIMAL_BUNDLE_SPEC“不做拓扑图WebUI”是早期范围，已加历史说明；现行结构化面板由C报告描述。
- 本审计、C删除清单、B报告、输入brief的grep命令：引述旧声明/移除项，不是现行功能。不得为满足字面grep而删除证据。

这些分类覆盖全部命中文档；原有历史参数和正文未被伪造。本审计独立docs提交，不混C代码/D决策。

## 2026-10-16 上游适配

| 声明 | 本轮变更 | 依据 |
|---|---|---|
| 当前验证版本 | Harness alpha.4、Cordis alpha.2、sidebar 0.26.1 精确 optional peer | UPSTREAM_LATEST_ADAPTATION_IMPLEMENTATION_REPORT；engines.dsh 单独判兼容，范围内仅 alpha.4 实测 |
| 运行行为 | 五工具与固定上下文保持，domain=1；JSONL 入口改为命名空间导入 | 上游移除 default export；类型检查、全量测试和真实 profile |

## 2026-10-16 Substrate 有意修订

| 声明／闸门 | 本轮改动 | 依据 |
|---|---|---|
| 五工具／六规则／固定字节上界 | 默认八工具、保留六条原规则并增加两条；7956 字节，关闭回 5910 | fixed-context / context.json；红灯 red-gates.tap |
| 13 通道与 10 个拒绝码 | 新增 publish 为第 14 条；新增 6 码，原码及顺序不变 | inventory / 手写 14 通道洗数据用例 / 审计表；红灯先留档 |
| 0.5.0 发布禁令 | **0.5.0 的发布禁令在本轮被有据地、受限地解除**：仅结构化可核验发布 | 不恢复白板、自报知识或编辑／删除；substrate admission + host custody |
| 权重与发现 | 消息引文权重不是节点声誉；不参与发现或授权 | tokenizer/BM25/weight/replay 测试，knowledge 代码路径未扩展 |
| 历史实验 | 显式 substrateEnabled=false，五工具固定条件继续保留 | measurement-gate、shiftingConfig、reference-kernel；不重开等预算线 |

## 2026-10-17 读取边界收尾与 V2 开工基线

| 声明 | 核对结果 | 依据 |
|---|---|---|
| 观察读取授权 | 非 owner 使用 atn-observation/sessionId 与 snapshot/metadata 独立 action；session 是整网披露别名；宿主 API 仍可信 | READ_BOUNDARY_IMPLEMENTATION_REPORT、READ-AUTH-* |
| 本轮开工实测 | 593 runtime/集成 + 15 UI，零失败零跳过；八工具 7956 字节，关闭 substrate 为 5910 | execution-evidence/round-v2-preflight/tests.txt、context.txt |

用户已批准 MASTER_EXECUTION_PLAN_V2 §12 三项推荐：读策略缺省关闭、套件随包发布、舰队显式授权且缺省不授予。原有探针记录仅收尾归档，本轮不执行外部模型探针。

## V2 阶段 0：无直接引用包的逐项处置

以下包全名均带 `@deepseek-ai/` 前缀，版本均精确为 alpha.4。保留不是声称有直接 import；依据是已安装发布包的 manifest 与本仓库覆盖的真实宿主依赖图。所有 override 钉版也继续保留。

| 包 | 处置 | 为何声明 |
|---|---|---|
| dsh-brand | 保留 | agent-loop/session/llm 等真实 kernel peer；顶层 peer 保证运行时身份品牌一致；并覆盖 dsh-opencode-go 的旧 dependency，避免双版本品牌 |
| dsh-attachment | 保留 | llm/subagent 与 api-session-controller 的传递 peer；精确 dev 钉版供实际 Agent/profile/Web 组装 |
| dsh-client-store | 保留 | client-connection/client-locale/client-ui-conversation 的传递 peer；用于客户端构建与 Web profile 验证 |
| dsh-credentials | 保留 | client-connection/api-session-controller 的传递 peer；实际 Web 认证装配需统一 alpha.4，未执行凭据或付费模型请求 |
| dsh-launch-environment | 保留 | dsh-opencode-go 声明的非 optional peer；保留测试用 provider 依赖闭包及 overrides，未激活真实 provider |
| dsh-settings | 保留 | agent-preset-registry/client-locale 等传递 peer，实际 preset/kernel 路径依赖 |
| dsh-timeout | 保留 | llm/api-gateway/session-persistence 等传递 peer，真实 Agent/RPC/JSONL 路径依赖 |

后续新增读取面的强制核对项：B-HOST-EXPORT 的可信宿主、无调用者校验前提；`atn-observation` 整网 session 别名；`atnObserver/snapshot` 与 `atnObserver/metadata` 独立 action。每次扩展都复核 principal/resource/action、严格 schema、授权先于加载与未知标识行为。

V2 阶段 1：`NAMESPACE-STRUCTURE` / `NAMESPACE-LIVE` 补足 msg/node/task/artifact 网络局部解析与双主体 Gateway 证据，无生产语义变更。负对照显式注入错误 resolver；不宣称生产代码曾存在该漏洞。artifact 外网独有仍按既有 custody 返回 ref-not-owned，不改变优先级。

V2 阶段 2 公开增量：installSubstrateReadPolicy、defineSubstrateReadPolicy、SubstrateReadPolicy/Options、substrateResourceId、ATN_SUBSTRATE_READER。资源 atn-substrate/action atnSubstrate/read；仅宿主映射 live node，模型工具面不变。READ-POLICY* 与 fixed-context 精确 7956/5910 锚定开启/关闭、被引/证据、排序权重、错误不可区分、失败原子性和冷重放。论文偏离新增第 8 项，默认未安装保持全读。

V2 阶段 3 公开增量：npm 白名单的 conformance/、`dsh-atn/conformance` 类型和 JS 入口、CLI 与宿主接入指南。46 个黑箱 case 对示例策略全绿；两个错误宿主 fixture 必须红灯。16 拒绝码词汇全冻结；8 个协议专属码无通用 custody 触发，按停止条件 4 收窄可携带语义范围，保留 reference-policy 真实协议测试，不增测试后门、不声称通用套件能证明任意宿主协议。

V2 阶段 4 公开增量：ATN_FLEET_READER、fleetNetworkResourceId、AtnFleetSnapshot 与 atnObserver/fleet；不新增模型工具。B-OBSERVE/权限表登记 index 与逐网络资源；默认无授权、owner 拒绝。拒绝桶为观察期易失计数，不追加 journal、不写 NetworkRecord，domain 1、旧记录冷读。FLEET-AUTH/COLD/COUNTERS、UI carrier 生命周期和真实浏览器留档锚定；不声称完整 sidebar provider 激活或外部 IAM 证明。

V2 阶段 5：REFUSAL_LOG_DESIGN 仅设计，无日志代码/存储/端点。B-REFUSAL-LOG 标注“设计未实现”；五字段 JSON Lines、14/16 最终词汇、宿主 ownership、独立未来授权与三种一致性选项均由文档审计锚定。不会把现有易失桶称作合规日志或把未来故障测试称作已通过。

V2 最终复核：606 runtime/集成 + 17 UI，0 fail/skip；九项命令全 exit 0；八工具、7956/5910、domain 1、14 通道、16 码保持。最终源码、测试、套件与 tarball SHA-256 见 execution-evidence/round-v2-final/invariants.json；实现/收窄/未验证范围见 ROUND_V2_IMPLEMENTATION_REPORT。

## 2026-10-17：0.6.1 上游 RC 适配

现行宿主版本更新为 Harness `0.2.1-rc.1`、Cordis `4.0.5`、schemastery `3.18.5`，可选 Better Sidebar 为 `0.28.0`；全部宿主 overrides 同步。主 README、CHANGELOG、文档索引和 CI 目标一并更新，历史报告不改写。侧栏上游现通过 `connection.requestRejection` 执行宿主准入，旧 `webRuntime` 阻塞仅适用于历史版本；具体检查范围和结果以 [0.6.1 发布记录](RELEASE_0_6_1.md)为准。

## 2026-10-18：0.6.2 上游 RC.2 适配

现行宿主版本更新为 Harness `0.2.1-rc.2`，全部直接宿主依赖及 overrides 同步，锁文件重新解析。Better Sidebar 本地 upstream 仍为 `0.28.0`，其 optional peer 与 CI 固定提交保持。ATN 消费的运行接口没有变化，上游 Web provider 设置变化无需 ATN 代码迁移。主 README、CHANGELOG 与索引更新；历史实验和发布记录保留原基线。本次验证及发布结果以 [0.6.2 发布记录](RELEASE_0_6_2.md)为准。
