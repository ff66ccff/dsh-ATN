# 拓扑绑定实施报告（2026-10-06）

对应 [TOPOLOGY_BINDING_IMPLEMENTATION_BRIEF.md](TOPOLOGY_BINDING_IMPLEMENTATION_BRIEF.md)。代码、结构证明、确定性验收和真实五次 adaptive 探针已完成。最终 DeepSeek 两阶段正确 **4/5**，换边 **21/21** 成功，最大节点 **31/48 步（64.58%）**。未观察到真实第三方 `result` 的所有权拦截，第 4.5(2) 条不成立，四臂比较未执行；`mayInterpretTopology=false / causalClaim=false`。初始失败批次与最终未提交样本均保留，预算未提高。

## 宿主强制与能力边界

- `src/runtime.ts` 增加仅宿主可安装的、按网络作用域保存的同步发送策略。策略在原有 mutation 临界区内、分配新邮件／结算任务之前执行；拒绝不修改网络记录。没有新增模型工具，生产未安装策略时行为不变。
- revision 3 仅接受 `{phase,key}` 事实请求和精确本地事实 `result`。事实的 id、phase、version、key、next、proof、terminal 必须与提交者自己的当前本地快照严格相等；收到别人的 mail 不会增加本地所有权。第三方返回值以 `evidence-not-owned` 明确失败。
- 同一策略应用于所有节点。真实 live Agent 仍决定身份；边保持单向，请求者须先连接持有者。实际已承接 task 的结果回传仍沿该 task 的窄通道，不要求持有者增加反向边。
- 旧副本的真实持有者可以返回其精确旧事实，宿主不把它变成当前事实，也不替请求者给出评价。请求者仍按 phase/version 自主 rejected；本地评价不等于宿主答案验收或人类授权。
- 白板保留作者、精确 revision、分页失效与计量实现，但 bound 实验只允许 `phase-N:AUTHOR-ID` 键与 `JSON.stringify(discoveryHints)` 元数据 body；notes、额外请求字段、传输身份／依赖引用被拒绝。发现隐藏事实 prose；第三方不可读任务内容。读取本地证据时自动发布规范元数据，使 no-board 臂仍可发现持有者。
- 固定臂保存初始环边 ACL，运行时自动拓扑修复也不能产生环外事实通道。未改变入口的宿主所有权、停止／退休／完成释放语义、白板引擎或生产默认配置。
- 初始化 task 仅能以固定 body/summary `{"ready":true}`、空 evidence 结算一次；宿主逐字段验证，不允许在该回执中携带事实。正式事实仍须用直连事实 task 返回。根校验改为逐个请求、逐个收取和评价，避免在响应已经返回后再次等待同一 task；该流程写入共同提示，不改变节点权限。

revision 2 fixture 与历史确定性环转发校准仍可重跑。新任务必须显式设置 `topologyBinding=true`，最终源码批次 manifest 的 `protocolRevision=6`、fixture `revision=3`。策略必须由实验宿主在模型开始前安装；本轮实验未测试中途崩溃后的重新安装／恢复，不宣称已覆盖该情形。

## 纯计算证明与构造性可解性

[证明脚本](../experiments/topology-binding-proof.ts) 不安装 runtime、不调用模型。它从同一完整 fixture 的两阶段链计算必需事实、持有者、入口直连边集合、初始边、不可达事实与出度约束；SHA-256 同时绑定 fixture 与拓扑参数。验证时重新计算整份证明，不信任已存的结论。可达／未绑定／直连边需求未超过上限的 seed 不得进入比较。

```text
npm run experiment:topology-proof
```

输出保留在 [topology-binding-proof-20261006.json](../experiments/results/topology-binding-proof-20261006.json)。入口 slot=0；固定初始 peers=[7,1]；出度上限=2。以下四个事实按各 phase 的 pointer 链列出（不包括用于评价的旧副本）。

| Seed | Phase 1 必需 key / holder | Phase 2 必需 key / holder | 所需不同直连边 | 固定结论 | 比较 seed 资格 |
|---|---|---|---:|---|---|
| 17 | key-00/4, key-13/5 | key-00/3, key-09/6 | 4 > 2 | 不可达 | 结构条件通过 |
| 31 | key-00/6, key-12/4 | key-00/5, key-15/2 | 4 > 2 | 不可达 | 结构条件通过 |
| 45 | key-00/2, key-01/4 | key-00/6, key-08/3 | 4 > 2 | 不可达 | 结构条件通过 |
| 59 | key-00/3, key-02/5 | key-00/2, key-01/4 | 4 > 2 | 不可达 | 结构条件通过 |
| 73 | key-00/3, key-02/2 | key-00/4, key-10/5 | 4 > 2 | 不可达 | 结构条件通过 |

固定边集合跨两阶段不能更换；即使重新挑选某个静态度二邻域，也不能同时覆盖这四个不同持有者。自适应可逐次旋转度二邻域，收集并缓存已经得到的精确事实。当前初始环甚至不能直接获取任一当前链事实。多跳连通性不能替代所有者直连 ACL。

[构造性参考](../experiments/results/topology-binding-reference-20261006.json) 在真实 Harness 和本轮 ACL 下逐一运行全部五个 seed，使用公开持有者元数据与实际收到的 task/result 构造答案。两阶段 **5/5 正确，模型调用 0，入口最大 27/48 步（56.25%）**。它证明这组自适应配置有可执行解，不证明模型能力或拓扑收益，也不宣称最优。

## 判据与准入

- 可发现性：至少一次换边尝试、成功换边数／尝试数=100%，完整 durable commit 与 tool/result 计数相符。尝试、成功、拦截、同列表、未结算分别统计。零尝试为 `not-observed`，拦截为 `blocked`，未结算为 `pending`，同列表为 `unchanged`；仅 blocked>0 标记可发现性问题。换边运行频率仅作描述，已从准入逻辑移除。
- 必要性：每个比较 seed 的 fixture-bound 结构证明通过，并在汇总时重新计算。
- 模型能力：独立同模型／配置／源码 live adaptive 探针至少五次、两阶段正确率 ≥80%，最大节点步数 ≤预算 80%。LongCat 明确排除。
- 比较前检查：匹配且早于比较的独立探针、有效结构证明、至少一次真实 `evidence-not-owned` 拦截，五个不同 seed。比较后还必须是四臂各至少五次、配对 seed 相同、比较数据自身有 rejected、全部节点余量合格。探针 rejected 不借给比较数据。
- 不再要求结构上不可解的 fixed 臂先达到 ≥4/5 正确。保留的 `fixedGatePassed/calibrationGatePassed` 是 revision 2 历史可解性校准字段，不参与 revision 3 的 `mayInterpretTopology` 判定。所有因果声明仍为 false。

## 修复前记录与测试

本轮改动前真实执行了以下七个新验收，输出为 `.artifacts/topology-binding/red-tests.txt`（7 项失败、0 通过、0 跳过）。没有补造失败记录。

| 验收 | 修复前实际失败 |
|---|---|
| BIND-ACL | 第三方 result 被接受，`assert.rejects` 缺少预期拒绝 |
| BIND-CHANNELS | 白板接受完整事实，缺少预期拒绝 |
| BIND-PROOF：全部 seed | 证明模块不存在 |
| BIND-PROOF：可达 seed 禁入 | 证明模块不存在 |
| BIND-DISCOVERY：单次成功 | 旧频率判据返回 false |
| BIND-DISCOVERY：零尝试／全拦截 | 两种诊断状态均未实现 |
| BIND-CAPABILITY | 能力闸门未实现 |

这些记录来自当时的未提交工作区；修改前没有完整归档该工作区，**以上七项均不能在现有 checkout 原样重放修改前源码**。可核对原始测试名、断言和堆栈；不把反向重构源码当作当时证据。

后续增加的 BIND-STALE、BIND-FIXED、结构准入重算／真实拦截检查三项是额外回归，没有对应的改动前失败记录。旧测试未删除；旧准入测试按新要求加入结构证明与 owner ACL 夹具，并加强“一次 blocked 也拒绝”的断言。模型、工具与实际权限相等、原子无副作用、旧副本独立 rejected、阶段更新拒绝旧快照、固定自动补边禁入均已验证。

首轮探针之后增加的 BIND-READY 另有真实修复前记录 `.artifacts/topology-binding/ready-red.txt`：1 失败、0 通过、0 跳过，固定确认被旧策略以 `invalid-fact-request` 拒绝。`source-probe/` 保存该批 manifest 的 28 个源码文件及哈希。用当前支持模块加归档文件覆盖，在独立 `ready-replay/` 中实际重放，仍为同一 `invalid-fact-request` 失败，见 `ready-red-replay.txt/json`。重放命令为 `node .artifacts/topology-binding/replay-ready.mjs`；辅助模块来自当前工作区的事实在记录中明确标注。它不替代上面七项缺失的原始源码快照。

| 完成标准命令 | 当前实际输出 |
|---|---|
| npm test | 430 runtime／集成 + 8 UI，通过；0 失败、0 跳过 |
| npm run typecheck | exit 0 |
| npm run build | exit 0 |
| npm run pack:tarball | exit 0；最终 README 已纳入 0.3.2 tarball，98 文件、297.7 kB |
| npm run smoke:profile | exit 0；对最终 tarball 的真实临时 profile 全部检查通过 |

输出保留于 `.artifacts/topology-binding/npm-test.txt`、`typecheck.txt`、`build.txt`、`pack.txt`、`smoke-profile.txt`。首次完整批次的 28 个 manifest 源码文件和 plan 归档于 `.artifacts/topology-binding/source-probe/`，最终批次同一范围的源码和 plan 归档于 `.artifacts/topology-binding/source-final/`。

最终 tarball 为 `.artifacts/dsh-atn-0.3.2.tgz`，npm 记录的 shasum 为 `7600e707d91991bb0fc120c24096491ff7b19e7d`；README 更新后已经重新打包和重跑 smoke。`git diff --check` exit 0。

与 build／参考同时执行的一次全套测试出现 RELEASE-03 时序失败（预期 draining，观察到调度器已转为 retired）；原始输出保留为 `.artifacts/topology-binding/npm-test-timing-failure.txt`。该文件单独运行 4/4 通过，随后完整 `npm test` 430+8 全过。未修改该测试或降低断言，也未据此宣称已解决此偶发时序风险。

## 真实探针与四臂状态

采用实际 Desktop profile 已导入的 `dsh-opencode-go` → `deepseek-v4.1-flash`，通过父 profile 的 prepareCall 和 installed agent-loop 身份桥接，不直接发 HTTP 推理。原 profile 写回重定向到 scratch，最终版本的 profile 完整性核对通过。预算沿用前轮显式配置：8 节点、链长 2、48 步／节点、384 次全网调用准入、4096 输出 token／调用、800 万已观测 token 准入阈值、每次 600 秒；各 seed 条件一致，自动推进关闭。步骤不是 token、HTTP 请求或费用上限。

首个启动器只完成 seed 17（两阶段正确、22/48 步、4 次成功换边、2 rejected），进程随后退出且没有最终 observer 完成记录；它作为 [不完整独立批次](../experiments/results/topology-binding-incomplete-probe-20261006.json) 保留，**不并入完整探针准入**。新启动器增加有限期 referenced keep-alive，使用全新目录重新执行 seed 17/31/45/59/73，不修改任务／模型／预算／被测源码。

首轮完整批次路径为 `.artifacts/experiments/topology-binding-deepseek-probe-v2-20261006/`，[核对结果](../experiments/results/topology-binding-probe-initial-20261006.json) 为 **3/5 两阶段正确**：

| Seed | Phase 1 | Phase 2 | 最大节点步数 | 成功换边 |
|---|---|---|---:|---:|
| 17 | 正确 | 正确 | 23/48 | 4 |
| 31 | 正确 | 未提交 | 18/48 | 3 |
| 45 | 正确 | 正确 | 24/48 | 4 |
| 59 | 未提交 | 未提交 | 12/48 | 2 |
| 73 | 正确 | 正确 | 26/48 | 4 |

换边尝试 17、成功 17、拦截 0、同列表 0、未结算 0；所有尝试之前已有只读 status，成功率 100%。accepted 15／rejected 9，真实 owner-refusal 0。原始 Session、durable 数据和运行源码核对通过，原 Desktop profile 的三个文件哈希前后一致。此批能力为 60%，不满足 ≥80%，不与新批次合并。

原始记录显示 seed 31/59 并行请求的两个根响应均已返回，入口却再次等待已经完成的 current task 后停住；另有 helper 尝试用事实结算初始化 task，被 `invalid-fact-request` 拒绝。因此仅调整根请求串行等待和固定初始化确认，在新目录 `.artifacts/experiments/topology-binding-deepseek-probe-v3-20261006/` 重跑同一五个 seed，任务难度／fixture／模型／预算均保持一致。

最终批次 [核对结果](../experiments/results/topology-binding-probe-20261006.json) 为 **4/5 两阶段正确**。各次执行均为同模型、配置与 28 文件源码；manifest revision 6。每次最大节点用量均小于 80%，所有节点计数均与持久化记录一致。

| Seed | Phase 1 | Phase 2 | 最大节点步数 | 尝试 / 成功 / 拦截 / 同列表 / 未结算 | accepted / rejected |
|---|---|---|---:|---|---|
| 17 | 正确 | 正确 | 26/48 | 5 / 5 / 0 / 0 / 0 | 6 / 0 |
| 31 | 正确 | 正确 | 23/48 | 5 / 5 / 0 / 0 / 0 | 5 / 1 |
| 45 | 正确 | 正确 | 25/48 | 6 / 6 / 0 / 0 / 0 | 7 / 1 |
| 59 | 正确 | 正确 | 31/48 | 5 / 5 / 0 / 0 / 0 | 6 / 3 |
| 73 | 未提交 | 未提交 | 6/48 | 0 / 0 / 0 / 0 / 0 | 1 / 0 |
| 合计 | 4/5 正确 | 4/5 正确 | 最大 64.58% | **21 / 21 / 0 / 0 / 0** | **25 / 5** |

seed 73 的旧根 task 已完成，入口未继续请求当前根或提交 checkpoint，运行以 `phase-1-quiescence` 结束；原始记录见 `.artifacts/topology-binding/probe-final-seed73-diagnosis.txt`。未提交不能改记为“已提交但证明错误”。此运行零换边尝试，不等于有尝试被拦截；批次可发现性仍按所有 21 次尝试的 100% 成功率通过。没有删除该样本或额外补跑成功样本。

`scripts/summarize-topology-binding.mjs` 独立重算 fixture 与 checkpoint，并核对全部原始 Session、实际 tool/result、durable rewire、请求者评价、精确本地读取与合法 owner result、同模型／8 个实验工具 schema（其中 ATN 仍为 6 个）／权限事件、源码哈希和全部节点步数，五次 `rawAudit.passed=true`，汇总 `auditPassed=true`。实际调用计数分别 83/80/86/102/34，合计 385 次准入；全部 cleanup 为 released。observer 完整结束且 exit 0；原 Desktop 的 package.json、cordis.patch.yml、cordis.yml 前后哈希一致，installed LLM 身份匹配。

真实工具拒绝另有 `metadata-only` 1 次、`extra-transport-fields` 1 次、helper 越权提交 checkpoint 1 次；这些均不冒充第三方所有权拦截。**五次 `evidence-not-owned` 合计 0**。确定性 BIND-ACL 对非本地事实 result 的明确拒绝与无副作用已通过，但这不替代真实模型尝试转发时的拦截证据。

四臂比较的逐条状态：

| 第 4.5 条 | 最终状态 |
|---|---|
| (1) 全部比较 seed 固定不可达 | 五个 seed 的独立结构证明通过；具备结构资格 |
| (2) 至少一次真实转发拦截 | **未满足：真实非所有者 result 拦截为 0** |
| (3) 同模型／配置／源码 adaptive ≥4/5 | 通过：最终完整批次 4/5；与旧批次分开 |
| (4) 比较数据自身有 rejected | 未验证：四臂未执行；探针 5 条 rejected 不能借用 |
| (5) 四臂各 ≥5 次且均 ≤80% 步 | 未验证：四臂未执行；探针余量通过不能替代各臂 |

对实际最终 batch 执行 `assertTopologyComparisonPreflight`，明确返回 `Topology comparison admission failed: no real evidence-not-owned interception`，记录为 `.artifacts/topology-binding/comparison-admission.json`，未发起额外 provider 调用。按准入要求没有运行四臂，只有机制／能力观察，不给出拓扑收益或因果结论。

可重跑最终数据核对（不调用模型）：

```text
node --import tsx/esm scripts/summarize-topology-binding.mjs --probe .artifacts/experiments/topology-binding-deepseek-probe-v3-20261006 --bootstrap .artifacts/topology-binding/desktop-probe-v3-20261006 --out experiments/results/topology-binding-probe-20261006.json
```
