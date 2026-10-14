# 阶段 B：动态出度实施记录

日期：2026-10-14。代码基线：阶段 A `25cf67c`。本报告保存 B 当时的证据与数量；后续 C 客户端、声明审计与 D 已收口，最新进度及外部限制见 [最终验收](FINAL_EXECUTION_VALIDATION.md)。

## 实现与边界

统一入口 `collaborationPeerLimit(record)` 按 `Object.keys(record.nodes).length` 计算，包含 failed/retired/provisioning 节点；`min(ceiling, ceil(log2(max(1,N)))+1)`。
新配置天花板默认 8、绝对硬顶 8；默认 maxTotalNodes=32 时有效值最多 6，因此天花板不约束默认网络。纯节点映射读取的旧 overload 保留四槽，生产所有持有网络记录的读取/写入仍显式传有效值。
旧记录冻结 4 或缺失天花板字段时继续以 4 为天花板，不重写数据。注意 brief 的“旧网络 N≤8 行为完全不变”过强：**小网络报告的额度会变化**，但旧合法边不会丢失；N≤4 时合法目标不超过 N−1，N=5..8 时曲线为 4。N=2 按指定公式报告 2，实际只有一个可能邻居；有效额度不是可用邻居计数。

修复 durable node.peerIds、rewire before/after/history 的五处额外 max(4)，以及 observer peers codec；统一引用同一硬顶常量。模型工具 schema 完全未改。
观察面新增可选 `network.maxCollaborationPeers`，新端点始终提供有效值，旧端点 payload 仍可解码，便于下一阶段显示余量；此为只读数据字段，非模型工具或新路由。
feedback 对日志快照按有效额度校验，六邻居日志不再被误判。

## 证据与完整度数表

修复前记录：[B-PRE_FIX_RECORD.md](execution-evidence/B-PRE_FIX_RECORD.md) 与 [B-pre-fix.tap](execution-evidence/B-pre-fix.tap)。6 项新用例中 4 失败、2 通过，未将原本就成立的纯函数/单调/保边性质冒充失败。
修复后聚焦 29 项通过；DYNAMIC-04 增加日志真实包含六邻居的断言。
DYNAMIC-STATUS 用真实 live host + MemoryNetworkStore 调用 status/observer，验证 N=2→2、N=32→6、读取不改变网络或模型调用数、六边重连可持久化且可通过严格观察 codec。
启动的普通任务先 settle，再测纯只读属性，防止与启动模型步骤竞争；没有削弱状态/请求数断言。

脚本：`node --import tsx/esm scripts/degree-table.ts`。完整 N=1..32 输出：[B-degree-after.csv](execution-evidence/B-degree-after.csv)。列为 N、有效值、N×min(N−1,有效值)、N×(N−1)、比例。N=1 无全连接边，比例记 n/a。
默认实测 **N=8 为 4**、**N=32 为 6**。32 节点出边上界 192，全连接 992，比例 0.193548。
逐点测试 N=1..64 单调；增长 1..32 时每步核对所有既有 peerIds 完整保持；退休/失败不减少计数。源码未找到删除 nodes 的生命周期路径，失败补偿保留 failed 节点。

## 五个 seed 的结构复核

脚本：`node --import tsx/esm scripts/compare-degree-proofs.ts`，零模型调用。
完整输出：[B-proofs-before.json](execution-evidence/B-proofs-before.json)、[B-proofs-after.json](execution-evidence/B-proofs-after.json)。

| seed | 历史 degree-two ring 上限前→后 | ring 可达性前→后 | default fixed-wide 上限前→后 | wide 可达性前→后 | 资格翻转 |
|---|---|---|---|---|---|
| 17 | 2→2 | unreachable→unreachable | 4→4 | unreachable→unreachable | 无 |
| 31 | 2→2 | unreachable→unreachable | 4→4 | unreachable→unreachable | 无 |
| 45 | 2→2 | unreachable→unreachable | 4→4 | unreachable→unreachable | 无 |
| 59 | 2→2 | unreachable→unreachable | 4→4 | unreachable→unreachable | 无 |
| 73 | 2→2 | unreachable→unreachable | 4→4 | unreachable→unreachable | 无 |

wide 的 requiredDirectEdgeCount=4、exceedsStaticDegree=false，在旧证明也不是“任意四边静态策略必不可能”的证据。这里只证明该固定选边不可达，不能包装成所有固定拓扑不可达。
历史 ring 明确冻结低天花板 2，故仍为合格 degree-two 比较；audit 的 wide 四边与夹具的两边均补入冻结理由，原有实验不偷换为默认动态额度。
停止条件“大量 seed 翻转”在这组五 seed 中按多数（≥3/5）判定；多数翻转会推翻比较集的代表性并触发报告。本轮 0/5，未触发。此复核范围只有既有 8 节点实验，不声称大规模结论已被证明。

## 既有断言逐项说明

| 位置/用例 | 处理与理由 |
|---|---|
| unit/config CONFIG-02 | 接受范围 1..4 扩到 1..8，非法 5 改为 9，新配置含 omitted 配置默认 4 改 8；仍逐项检查持久化与非法拒绝 |
| unit/topology-limit DEGREE-05 | 非法 5→9、错误范围 4→8，新增 nodes 参数；校验集合与次数不减少 |
| unit/adaptive-topology ADAPT-12 | durable codec 拒绝五边改为拒绝九边，并增加八边完整解析断言；网络有效额度由运行时和新增测试约束 |
| unit/topology-limit DEGREE-01/03/04，其余 brief 所列行 | 保留：旧四天花板、冻结两边、纯节点 map 四槽或 N=5..8 曲线仍四；不必为了“预计变化”去改正确断言 |
| unit/topology、unit/adaptive-topology ADAPT-01/04/09 | 保留相同列表与修复语义；N=5..8 曲线四、同伴退出只替换失活槽 |
| integration/adaptive-topology、integration/experiment-topology | 保留：既有实验为八节点或显式冻结，四边断言仍真 |
| unit/experiment-topology、unit/five-arm-comparison | 保留：历史记录的比较参数/结构约束，不是新部署默认值 |
| integration/topology-binding-reference | 保留 wide.maxPeers=4，八节点动态默认仍四 |
| fixtures/binding-evidence | 保留 maxPeers=2，增加显式冻结注释 |

没有删除任何测试，没有降低已有断言强度。

## 闸门与共享不变式

typecheck、npm test、build、pack:tarball、目标 CLI 下 smoke:profile 全部退出码 0。完整输出在 `execution-evidence/B-{typecheck,test,build,pack-tarball,smoke-profile}.txt`。
完整测试 **550 runtime/集成 + 8 UI** 全通过，0 skipped。工具 schema/fixed context 仍为 **4749/5910 bytes**（B-context.json）。client.js=485539 bytes，是 C 的体积基线。
十二项共享不变式逐条确认：入口所有权未改且 lifecycle/stop/retire 通过；原子记录及临界区未改且 concurrency/domain 通过；单向边/谱系及引导常量未改、topology 通过；live 身份未改、agent/preset 通过；人类授权和宿主验收未改、information-boundary 通过；stepBudget 仍为准入步数、budget 通过；模型/工具/权限不改、preset/smoke 同能力通过；观察只读、observer 与 DYNAMIC-STATUS 通过；domain 版本 1、domain 通过；五工具/schema 字节不变；既有测试保留且全部通过；报告只陈述实际运行结果。
B 验收时 C/D 尚未开始；当前已完成 C 客户端与 D。32 节点五-seed 可达性实验、真实付费模型及完整 provider browser 联合验收仍未做，不计入已通过项；C 的真实展示组件截图另有说明。
