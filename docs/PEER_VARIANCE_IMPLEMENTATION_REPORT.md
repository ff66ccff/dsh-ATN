# 同伴质量差异与自适应验证实施报告

日期：2026-10-06。实施依据：[PEER_VARIANCE_IMPLEMENTATION_BRIEF.md](PEER_VARIANCE_IMPLEMENTATION_BRIEF.md)。此前工作区已有改动作为基线保留。本轮没有修改生产预算默认值。

代码、测试、确定性校准及用户指定的实际 Desktop 导入模型 **20 次 ATN 执行已完成，整体真实准入未通过**。DeepSeek V4.1 Flash 的 fixed 为 4/5，通过 G5；LongCat fixed 为 1/5，未通过 G5。两个模型都仅在 2/5 独立探针中实际换边，未通过 G2；LongCat 探针有节点用满 48/48，未通过 G3。本批没有记录到 provider 错误，失败没有删除，也没有记成连接失败。此前独立 bare-Node / Space Bunny 的 25 文件源码批次保留为历史；其 0/5 和 TIMEOUT／TRANSPORT 不证明实际 Desktop 导入路由失败。短工具往返成功不计作 ATN 成功。未执行四臂比较，不作拓扑收益或因果结论。

## 实现与判定边界

任务 revision 2 将同一查询的当前副本和旧副本放在不同持有者手上。8–16 节点中，第一阶段旧副本固定属于 slot 1，第二阶段属于 slot N−1；归属不随 seed 或查询重试随机漂移。第二阶段旧副本保留真实第一阶段内容与旧路线，仅使用独立副本文档标识。当前路线及当前持有者继续随阶段变化。

每条证据显式包含 `id / phase / version / key / next / proof / terminal`。请求者可以检查阶段／版本、键、字段是否齐全及结构是否合法；无法从本地检查不透明 proof 的真实正确性。后者仍由宿主独立核对。旧副本回复会产生真实 task/result，随后按可见字段给出 `rejected`；匹配的当前副本给出 `accepted`。评价不构成人类授权或宿主验收。

入口在每次 checkpoint 前从两个公开宣称持有 root 的节点核对同一个请求。固定臂通过环形 task/result 转发，转发不改写证据；自适应臂先查询、再按需要换到另一个持有者。事实仍只能从本地 ACL、实际邮件或计量白板获取。所有节点的模型路由、工具集合、权限相同，变化来自证据状态。

模型工具仍是六个，共同规则仍为六行。`atn_status.rewire` 的模型参数只剩完整 `peers` 列表；宿主 `runtime.rewire` 保留 `baselineTaskIds / candidateTaskIds`，原有宿主路径测试本来已经直接调用 runtime API，未削弱其断言。`claimTaskId / review / rewire` 的单次最多一个原子写约束保留。

换边记录关联工具 execution token、工具返回的 rewire id 和持久化历史。成功仅指已持久化并实际改变邻居列表；同列表提交、拒绝、ablation 拦截、尚未完成的调用分别计数。每次尝试记录阶段及此前是否成功调用过只读 `atn_status`。

探针与比较使用不同 purpose。多臂真实执行需要预先完成、同模型／条件／源码的独立探针；比较闸门还要求 fixed ≥4/5、各臂 ≥5、比较数据自身出现 rejected、每个节点用步 ≤80%。探针评价不能补充比较评价；脚本不能打开真实模型闸门。缺失源码身份、未结算换边或不完整的声明节点步数数据均不能通过。

## 固定协议实测

数字来自真实注册表，不是手工估算；前后 schemas 和测量保存于 `.artifacts/peer-variance/context-before.json`、`context-after.json`。

| UTF-8 字节 | 修改前 | 修改后 | 差值 |
|---|---:|---:|---:|
| `systemPromptBytes` | 969 | 1112 | +143 |
| `toolSchemaBytes` | 6191 | 5948 | −243 |
| `fixedContextBytes` | 7160 | 7060 | −100 |

新增明确拒绝判据和换边入口提示后，固定上下文仍下降 1.40%。这不代表真实输入 token 一定同比下降。

## 历史确定性双臂扫描（25 文件源码）

桥接实际 Desktop profile 之前，协作修复后的 25 文件源码执行预先固定的 3 个链长 × 3 个步数档 × fixed/adaptive × 5 个种子，共 **90 次**。种子为 17、31、45、59、73。执行为 `scripted-test`，无 provider 调用、无虚构 token usage，`liveProvider=false`、`mayInterpretTopology=false`。完整失败及预算耗尽都保留；主指标总计 **56/90**。协作修复前另一次 90 次扫描为 57/90，按源码分别保存，不能混合。

| 链长 | 每节点步数 | fixed 正确 | adaptive 正确 | adaptive 各 seed 最大占比 | 配置合格 |
|---:|---:|---:|---:|---|---|
| 2 | 20 | 0/5 | 0/5 | 全部 100% | 否 |
| 2 | 32 | 4/5 | 5/5 | 全部 78.125% | 否：fixed 超过 80% |
| 2 | 48 | 5/5 | 5/5 | 全部 52.083% | 是，选定 |
| 3 | 20 | 0/5 | 0/5 | 全部 100% | 否 |
| 3 | 32 | 3/5 | 5/5 | 全部 78.125% | 否：fixed 超过 80% |
| 3 | 48 | 5/5 | 5/5 | 全部 52.083% | 否：fixed seed 45 为 39/48 |
| 4 | 20 | 0/5 | 0/5 | 全部 100% | 否 |
| 4 | 32 | 4/5 | 5/5 | 全部 78.125% | 否：fixed 超过 80% |
| 4 | 48 | 5/5 | 5/5 | 全部 52.083% | 否：fixed seed 45 为 39/48 |

选定 2/48 的 adaptive 五个 seed 均最大 **25/48**；fixed 依次 **29/48、31/48、36/48、28/48、30/48**（60.417%、64.583%、75%、58.333%、62.5%）。保守地要求扫描中两臂均满足余量，而非只检查 adaptive。48 步是显式实验条件，生产 `stepBudget=64` 未变。

上述历史原始目录为 `.artifacts/experiments/peer-variance-calibration-20261006-v2/`，含 plan、90 份 manifest/report/events/session/storage 和完整 scan。可移植索引为 [peer-variance-calibration-v2-20261006.json](../experiments/results/peer-variance-calibration-v2-20261006.json)。初版原目录与 [peer-variance-calibration-20261006.json](../experiments/results/peer-variance-calibration-20261006.json) 保留。

## 当前 26 文件源码确定性扫描

当前源码另行完成相同 90 次双臂脚本扫描，正确 **57/90**，仍选择 2/48。选定配置 fixed 与 adaptive 各 **5/5**；adaptive 五个 seed 均 **25/48**，fixed 依次 **28/48、29/48、37/48、29/48、32/48**，均不超过 80%。90 份报告均与当前冻结源码一致，原目录为 `.artifacts/experiments/peer-variance-calibration-20261006-dsh-profile/`；可移植索引为 [peer-variance-calibration-dsh-profile-20261006.json](../experiments/results/peer-variance-calibration-dsh-profile-20261006.json)，源码核对见 `.artifacts/peer-variance/calibration-dsh-profile-source-audit.json`。此次 57/90 与协作修复前的 57/90 是不同批次，不互相替代。脚本策略的可解性与余量不代替真实模型验证，也不证明固定环或自适应拓扑最优。

## 历史独立 bare-Node / Space Bunny 真实验证

下列初版两档真实探针、协作修复后的两批独立探针及同配置 fixed 五次均已完成并保留。它们由独立 bare-Node 实验入口挂载 provider，未使用用户实际 Desktop profile 的已导入模型实例与 credential service。这组历史批次的真实探针与 fixed 闸门未通过；其 0/5 不能作为实际 Desktop 导入路由或当前 26 文件源码的验收结果。

资源条件：Space Bunny Free、链长 2、8 节点、出度 2、每节点 48 步、全局 384 个可观测调用、每调用输出 4096、每次期限 600 秒、自动推进关闭。首批已观测总 token 阈值为 4,000,000；复验显式提高至 8,000,000，后续 fixed 使用相同档位。缓存读取也计入 provider 的 totalTokens；两档结果分开保留，不跨配置累计成功。`--free-only` 在每批执行前要求当前目录全部参考标价为零。

前两次探针启动因 Node 的网关目录连接超时而失败，均停在模型安装／推理之前，不计作五次探针。原目录及日志保留。独立诊断显示价格元数据刷新成功、curl 访问同一目录为 HTTP 200；Node 限制最高 TLS 1.2 后同一目录与价格元数据均刷新成功。后续真实批次仅在进程内增加 `NODE_OPTIONS=--tls-max-v1.2`，退出后恢复，不修改系统网络设置、证书验证或源码。不能据此进一步归因具体 TLS／代理实现缺陷。

### 已完成的 400 万阈值探针

目录 `.artifacts/experiments/peer-variance-live-adaptive-probe-20261006-v3/`，索引 [peer-variance-probe-4m-20261006.json](../experiments/results/peer-variance-probe-4m-20261006.json)。五次全部保留。前 3 次每节点仅一次调用，原始 Session 中没有任何 tool/call；失败为 TRANSPORT／TIMEOUT，不能把它们的零换边进一步归因为模型找不到入口。

| seed | 两阶段正确 | rewire 调用／成功／拦截 | 换边前已查询 | accepted／rejected | 最大步数 | 结束 |
|---:|---|---|---:|---|---|---|
| 17 | 否 | 0／0／0 | 0 | 0／0 | 1/48 | phase-1-quiescence，8 TRANSPORT |
| 31 | 否 | 0／0／0 | 0 | 0／0 | 1/48 | phase-1-quiescence，4 TIMEOUT + 4 TRANSPORT |
| 45 | 否 | 0／0／0 | 0 | 0／0 | 1/48 | phase-1-quiescence，4 TIMEOUT + 4 TRANSPORT |
| 59 | 仅阶段 1 | 18／18／0 | 18 | 13／1 | 34/48 | observed-token-limit |
| 73 | 仅阶段 1 | 15／15／0 | 15 | 16／2 | 34/48 | observed-token-limit |

合计 **33 次调用、33 次改变邻居的持久化成功、0 次拦截、0 次同列表提交**；有成功换边的运行仅 **2/5**，因此探针闸门明确为 **未通过**。真实评价为 accepted 29 / rejected 3，已观察到质量方差，但该批没有两阶段正确运行。seed 59 已观测 totalTokens=4,003,854，其中 cacheReadTokens=3,511,724；不能将缓存视为不占观测阈值。两次第二阶段缺失都保留为失败，未改记成功。

本批每次 tool/call、持久化 rewireHistory 与报告计数独立核对一致。另一个单次、零标价路线、32 输出 token 的连通性诊断得到 HTTP 200，单独记为诊断调用，不加入探针或 fixed 样本。上述失败与预算观察促成独立 800 万档复验。

### 初版 800 万阈值探针与协作修复

初版目录 `.artifacts/experiments/peer-variance-live-adaptive-probe-8m-20261006/`，完整索引 [peer-variance-probe-8m-initial-20261006.json](../experiments/results/peer-variance-probe-8m-initial-20261006.json)，原始会话核对见 [peer-variance-probe-8m-audit-20261006.json](../experiments/results/peer-variance-probe-8m-audit-20261006.json)。

| seed | 两阶段正确 | 调用／实际换边／拦截 | 换边前已查询 | accepted／rejected | 最大步数 | 结束 |
|---:|---|---|---:|---|---|---|
| 17 | 是 | 16／16／0 | 16 | 18／2 | 28/48，58.33% | phase-2-submitted |
| 31 | 是 | 14／14／0 | 14 | 11／0 | 25/48，52.08% | phase-2-submitted |
| 45 | 仅阶段 1 | 22／22／0 | 22 | 23／1 | 41/48，85.42% | observed-token-limit |
| 59 | 仅阶段 1 | 21／21／0 | 21 | 21／2 | 43/48，89.58% | observed-token-limit |
| 73 | 是 | 21／21／0 | 21 | 18／1 | 45/48，93.75% | phase-2-submitted |

本批 **5/5 有实际换边、94 次持久化变更、0 拦截／同列表／未结算**，235 次只读 status 查询，全部 94 次换边前已有成功查询，accepted 91 / rejected 6，provider 错误为 0，cleanup 全部 released。可发现性通过；两阶段正确仅 3/5，真实步数余量三次超限，不能记作 G3 通过。

seed 45 的原始会话显示 217 个已准入模型调用中，7 个助手占 195 次；重复完整链搜索、广播和板写占用预算。334 个工具调用包括 status 112、board 85、send 106、read_evidence 26、checkpoint 5（其中 4 个非入口调用失败）。status 中只读尝试 66、成功查询 65，另有换边 22 和评价 24。入口已经收到第二阶段终点，但后续续算被全局观测阈值中止，未能提交 checkpoint；该次中止与另一次准入拒绝分别记录。逐事件和文件哈希见[协作诊断](../experiments/results/peer-variance-workflow-diagnosis-20261006.json)。这是该次具体延迟的诊断，不是拓扑效果或其他 seed 的因果证明。

因此追加最小协作提示修复：入口负责链组装、两持有者核验和 checkpoint；助手每阶段发布一次本地快照，响应／转发实际 task，无请求时结束当前 turn 等待消息，不退休。旧副本仍原样返回，不能自行查找当前副本替换；工具、模型和权限不变。初版 25 文件保存在 `.artifacts/peer-variance/source-probe8m-initial/` 及对应 hashes。修复前后批次按源码分别保留；修复后的历史 25 文件源码重新扫描和运行探针／fixed，不把初版成功补入之后的重复。

### 协作修复后历史源码的两批独立探针

协作修复后，同 2/48、384 调用、800 万阈值执行两个完整批次，每批五个种子全部保留。v2 目录后缀 `-8m-20261006-v2`，v3 为 `-8m-20261006-v3`；两批均为两阶段正确 **0/5**、换边调用／成功／拦截 **0／0／0**、accepted／rejected **0／0**，各自闸门为 false，不相互拼接样本。

| seed | v2 调用／最大步数／模型错误 | v3 调用／最大步数／模型错误 |
|---:|---|---|
| 17 | 8／1/48／8 TRANSPORT | 8／1/48／6 TIMEOUT + 2 TRANSPORT |
| 31 | 8／1/48／8 TRANSPORT | 8／1/48／2 TIMEOUT + 6 TRANSPORT |
| 45 | 10／2/48／3 TIMEOUT + 5 TRANSPORT | 7／2/48／2 TIMEOUT + 5 TRANSPORT |
| 59 | 8／1/48／2 TIMEOUT + 6 TRANSPORT | 8／1/48／2 TIMEOUT + 6 TRANSPORT |
| 73 | 9／2/48／8 TRANSPORT | 8／1/48／2 TIMEOUT + 6 TRANSPORT |

所有结束均为 `phase-1-quiescence`，cleanup 全部 released。v2 的实际工具调用数为 0、0、4、0、2，只有 3 次只读 status 查询；v3 没有任何工具调用。零换边和零 rejected 使这两个历史批次未达到真实验收要求，但不能据此把基础设施错误归因为模型找不到入口或旧副本不可判定，也不能推断实际 Desktop 导入路由失败。极低步数不构成真实协议余量验证。

两批各有可移植索引与独立 Session／持久化核对：[v2 索引](../experiments/results/peer-variance-probe-8m-v2-20261006.json)、[v2 审计](../experiments/results/peer-variance-probe-8m-v2-audit-20261006.json)、[v3 索引](../experiments/results/peer-variance-probe-8m-v3-20261006.json)、[v3 审计](../experiments/results/peer-variance-probe-8m-v3-audit-20261006.json)。源码 SHA-256 与历史 25 文件快照 `.artifacts/peer-variance/source-pre-dsh-profile/` 及 `source-pre-dsh-profile-hashes.json` 一致，所有换边计数及节点步数与原始记录一致。

v3 的进程只额外加载只读 fetch 错误观察器，转发原请求参数，不改变网络行为。模型 endpoint 实际记录 39 次连接／socket 错误，其中 14 个 `UND_ERR_CONNECT_TIMEOUT`、25 个 `UND_ERR_SOCKET`；目录／元数据错误另列，不混入模型调用。此前另一次零标价、32 输出 token 的原生 fetch 连通性诊断仍得到 HTTP 200，单独留存，不作为模型完成任务的证据。两次诊断调用均不计入探针／fixed。现有记录不足以归因 socket 错误的具体协议、网络或模型原因。

### 历史源码 fixed 复验与该批验收状态

fixed 使用与历史 v3 探针相同模型、2/48、384 调用、800 万阈值、25 文件源码及进程诊断条件，且在探针之后执行。目录 `.artifacts/experiments/peer-variance-live-fixed-8m-20261006-v2/`。五次均未提交第一阶段，两阶段正确 **0/5**，accepted／rejected、换边调用／成功／ablation 拦截均为 0。总计 47 个模型调用、14 个实际工具调用、6 次只读 status 查询，provider 错误为 20 TIMEOUT + 20 TRANSPORT，cleanup 全部 released。

| seed | 模型调用 | 最大步数 | provider 错误 | 结束 |
|---:|---:|---|---|---|
| 17 | 8 | 1/48 | 3 TIMEOUT + 5 TRANSPORT | phase-1-quiescence |
| 31 | 8 | 1/48 | 4 TIMEOUT + 4 TRANSPORT | phase-1-quiescence |
| 45 | 8 | 1/48 | 6 TIMEOUT + 2 TRANSPORT | phase-1-quiescence |
| 59 | 15 | 3/48 | 5 TIMEOUT + 3 TRANSPORT | phase-1-quiescence |
| 73 | 8 | 1/48 | 2 TIMEOUT + 6 TRANSPORT | phase-1-quiescence |

该历史批次合并索引为 [peer-variance-20261006.json](../experiments/results/peer-variance-20261006.json)，原始审计为 [fixed 审计](../experiments/results/peer-variance-fixed-8m-v2-audit-20261006.json)。`probeMatchesComparison / separateProbeRuns / probePrecedesComparison=true`，但 `fixedGatePassed / adaptiveProbeGatePassed / feedbackVarianceGatePassed / everyArmRepeated / mayInterpretTopology=false`。探针没有充作 adaptive 比较臂；该索引不能当作实际 Desktop 导入验证结果。

| 目标 | 历史 25 文件源码独立批次验收状态 |
|---|---|
| G1 同伴质量差异 | 证据分布、本地判据和真实 runtime 确定性评价通过；初版真实出现 rejected，协作修复后两批 rejected=0，该批真实验收未达成 |
| G2 可发现换边 | 初版 800 万档为 5/5；协作修复后两批各 0/5，闸门未通过，不能沿用旧源码结果 |
| G3 步数余量 | 该版脚本 adaptive 各 seed 为 25/48、选定 fixed 全部 ≤80%；该版真实协议工作未完成，真实余量未确认 |
| G4 模型面瘦身 | 通过：移除两参数、宿主 API 与原子写保留、固定协议下降 100 字节 |
| G5 新任务仍可解 | 该版脚本 fixed 5/5；同源码真实 fixed 0/5，该批真实验收未达成 |

上述历史失败与实际 Desktop 导入路径分别记录。实际导入模型已完成短工具往返、完整独立探针与 fixed，不挑选零散成功或降低闸门。仅在同源码真实 rejected、≥4/5 成功换边、fixed ≥4/5、各比较臂 ≥5 且余量合格后，才允许解释四臂差异；当前两模型仍未通过探针闸门。

## 实际 Desktop 导入模型验证（20 次完成）

用户要求使用 dsh 中 OpenCode Go 实际已导入模型验证。实际 provider 为 `dsh-opencode-go`，Desktop `llm.listModels` 返回 10 个模型。公开[模型目录](https://opencode.ai/zen/go/v1/models)与[参考价](https://models.dev/api.json)仅作 GET 查询，`checkedAt=2026-10-06T05:21:57.464Z`；交集与价格原始声明见 [peer-variance-dsh-authorized-models-20261006.json](../experiments/results/peer-variance-dsh-authorized-models-20261006.json)，原始记录为 `.artifacts/peer-variance/dsh-imported-authorized-models-20261006.json`。免费判据为输入、输出、缓存读写及上下文分档参考价全部为零。此次选定免费 `longcat-2.5-preview-free`，以及用户明确授权的 `deepseek-v4.1-flash`（参考价非零）。公开参考价按每百万 token 计，不代表账户订阅计费承诺。

`muse-spark-1.3-contributor` 虽已导入，但参考价为输入 0.1、输出 0.2、缓存读取 0.002、缓存写入归一化为 0，未纳入免费集合、未发送推理请求。`space-bunny-free` 不在实际导入列表，Desktop 路由检查在发请求前以 `MISSING_IMPORTED_MODEL` 终止、rounds=0；没有强行导入或请求该路线。此前 Space Bunny 的独立实验请求仍保留在历史部分。

验证使用实际安装 Desktop 的 Electron 所带 Node `v24.18.1`、原 profile 的 `dsh-opencode-go@0.1.20` 与 `@earendil-works/pi-ai@0.87.1`。公开 `runProfile` 加载实际 Desktop 的 LLM／credential／OpenCode Go 层，helper 将配置写回重定向到实验 scratch profile；原 `package.json / cordis.yml / cordis.patch.yml` 的前后 SHA-256 均相同。没有记录凭据值。实验源码 `experiments/shifting-evidence-profile-run.ts` 将 ATN 子 runtime 的请求交由实际父 `ctx.llm.prepareCall` 与其 prepared stream 执行，保留 tools、session、signal、agent-loop 身份及请求内容，并检查模型路由和输出上限。独立 ATN runtime 保留相同模型能力、六工具和节点 ACL；这是实际导入 provider 的源码桥接验证，不是此前独立裸 provider 实例，也不等于操作 GUI 完成任务。

LongCat 与 DeepSeek 各完成 **2 rounds** 的短工具往返：首轮产生一次加法工具调用，回放工具结果后第二轮正确返回 4。可移植审计为 [peer-variance-dsh-imported-route-smoke-20261006.json](../experiments/results/peer-variance-dsh-imported-route-smoke-20261006.json)，原始审计为 `.artifacts/peer-variance/desktop-import-smoke-audit-20261006.json`；两次原始结果分别位于 `desktop-import-smoke-20261006/longcat-2.5-preview-free.json` 和 `desktop-import-deepseek-smoke-20261006/deepseek-v4.1-flash.json`。这些调用只证明已导入路由能够处理该次工具往返，不计入 ATN 探针、fixed 重复或拓扑比较。

正式 ATN 条件为 8 节点、出度 2、链长 2、每节点 48 步、全局 384 调用、每调用输出上限 4096、已观测总 token 阈值 8,000,000、每次期限 600 秒、关闭自动推进；种子 17、31、45、59、73。每个模型先执行五次独立 adaptive 探针，再执行五次同模型／配置／26 文件源码 fixed，两个模型分别判定，不跨模型或历史源码拼接样本。四臂比较未执行。

| 实际导入模型／阶段 | 两阶段正确 | 可观测 LLM 尝试 | 实际换边／有换边运行 | 持久化 accepted／rejected | 最大节点步数 |
|---|---:|---:|---|---|---|
| LongCat 独立 adaptive 探针 | 0/5 | 268 | 4／2/5 | 5／0 | 48/48，100% |
| LongCat fixed | 1/5 | 352 | 0／0/5 | 32／1 | 18/48，37.5% |
| DeepSeek 独立 adaptive 探针 | 3/5 | 547 | 7／2/5 | 63／6 | 30/48，62.5% |
| DeepSeek fixed | 4/5 | 791 | 0／0/5 | 82／10 | 33/48，68.75% |

20 次均完整保留，总计 **1,958 次可观测 LLM 尝试**；4 个批次父进程均 exit 0，cleanup 全部 released，原 Desktop 三个配置文件前后哈希不变。四批均未记录到 provider 错误。LLM 尝试包含可观测重试／辅助调用，不等于底层 HTTP 请求数；隐藏 HTTP 重试仍未知。两个探针合计 11 次换边都是改变邻居列表的持久化成功，无同列表、拦截或未结算；全部 11 次换边前已有成功只读 status 查询。探针有换边的运行各为 **2/5**，没有达到 ≥4/5 的可发现性要求。

LongCat 的逐 seed 记录如下。表中的评价为最终持久化意见；“仅阶段 1”与未提交第二阶段均不算两阶段成功。

| seed | adaptive 探针：正确／调用／换边／accepted・rejected／步数 | 探针结束 | fixed：正确／调用／accepted・rejected／步数 | fixed 结束 |
|---:|---|---|---|---|
| 17 | 否／34／0／0・0／6/48 | phase-1-quiescence | 是／112／15・0／18/48 | phase-2-submitted |
| 31 | 否／90／3／0・0／48/48 | phase-1-quiescence | 否／43／2・1／9/48 | phase-1-quiescence |
| 45 | 否／52／0／4・0／8/48 | phase-1-quiescence | 否／44／4・0／8/48 | phase-1-quiescence |
| 59 | 否／49／1／0・0／9/48 | phase-1-quiescence | 否／78／1・0／13/48 | phase-1-quiescence |
| 73 | 否／43／0／1・0／7/48 | phase-1-quiescence | 否／75／10・0／16/48 | phase-1-quiescence |

DeepSeek 的逐 seed 记录如下。

| seed | adaptive 探针：正确／调用／换边／accepted・rejected／步数 | 探针结束 | fixed：正确／调用／accepted・rejected／步数 | fixed 结束 |
|---:|---|---|---|---|
| 17 | 是／119／4／12・2／23/48 | phase-2-submitted | 是／181／13・2／31/48 | phase-2-submitted |
| 31 | 是／151／0／21・1／24/48 | phase-2-submitted | 是／188／21・2／33/48 | phase-2-submitted |
| 45 | 仅阶段 1／119／0／14・1／18/48 | phase-2-quiescence | 是／134／9・2／21/48 | phase-2-submitted |
| 59 | 否／48／0／6・0／8/48 | phase-1-quiescence | 是／158／15・4／23/48 | phase-2-submitted |
| 73 | 是／110／3／10・2／30/48 | phase-2-submitted | 否／130／24・0／21/48 | phase-1-quiescence |

原始四目录分别为 `.artifacts/experiments/peer-variance-dsh-longcat-probe-20261006/`、`peer-variance-dsh-longcat-fixed-20261006/`、`peer-variance-dsh-deepseek-probe-20261006/`、`peer-variance-dsh-deepseek-fixed-20261006/`。原始 `imported-provider-calls.jsonl`、Session 和持久化记录保留；可移植[总索引](../experiments/results/peer-variance-dsh-import-20261006.json)、[LongCat 结果](../experiments/results/peer-variance-dsh-longcat-20261006.json)、[DeepSeek 结果](../experiments/results/peer-variance-dsh-deepseek-20261006.json)记录来源与文件哈希。逐批独立校对见 [LongCat probe 审计](../experiments/results/peer-variance-dsh-longcat-probe-audit-20261006.json)、[LongCat fixed 审计](../experiments/results/peer-variance-dsh-longcat-fixed-audit-20261006.json)、[DeepSeek probe 审计](../experiments/results/peer-variance-dsh-deepseek-probe-audit-20261006.json)、[DeepSeek fixed 审计](../experiments/results/peer-variance-dsh-deepseek-fixed-audit-20261006.json)。

20 份 run 均匹配当前 26 文件源码；8 节点使用同模型路由、相同八个 schema（六个 ATN 工具及两个实验工具），本地 slot 的 fact ACL 与原始文档一致。entry 的 `permissionSeed=null`、child 的 `{}` 都没有显式 delegated policy，按 runtime 与 `appendDelegatedPolicyOverrides` 的行为归一化后权限相同；原存储哈希差异和实际 policy event 哈希仍保留。每个模型自身 probe/fixed 的 13 项实际安装、profile、插件／SDK、helper、Node、父服务实例与标记、子请求配置及用户配置不变检查全通过。该校对没有逐调用记录实际父 `prepareCall` 生效的 reasoning／temperature 默认值；不能将子请求头的相同配置表述为所有父端生效参数都已实测。

LongCat fixed seed 17 有 **14 次成功返回的 review 调用、15 条持久化 accepted 最终意见**。唯一额外意见的 raw review 参数与 taskId／caller／status／summary／evidence／comparisonKey 精确匹配实际提交；提交后工具返回 `isError=true`、aborted／closed。审计分别保留 14、15、`rawReviewCountsEqualFinalFeedback=false`，按已持久化且原调用可核对的最终意见计量，不改写报错返回。其他运行的成功 review 返回与最终意见计数一致。

DeepSeek fixed 有 **6 条已准入父调用缺少 finish／throw 终止记录**：seed 17 为 2、31 为 1、59 为 3，其余为 0。它们仍计入 791 次已发尝试；对应子 runtime 尾部为 4 条 interrupted message 与 2 条空 attempt，`parentTraceAllChecksPass=false` 保留，不能补记为已观测 provider 错误或连接失败。其余三批父轨迹完整性检查为 true。token 字段缺失和未知 usage 保持未知，不以零填补。

另观察到 LongCat probe 的 27 次 `max-tokens` finish 全部仅有 reasoning，fixed 为 16 次中的 15 次；DeepSeek probe 为 6 次中的 5 次，fixed 为 11 次中的 10 次。该对应由父 finish 和子原始输出块核对，不读取或导出 reasoning 原文。这说明部分调用在输出界限处结束，不足以将全部未提交、静默结束或换边不足归因于截断；本轮没有改输出上限或删去这些调用。

| 目标 | LongCat 实际导入验证 | DeepSeek 实际导入验证 |
|---|---|---|
| G1 同伴质量差异 | probe rejected=0；fixed 有 1 条真实 rejected，比较自身有质量信号 | probe rejected=6；fixed rejected=10，比较自身有质量信号 |
| G2 可发现换边 | 未通过：有实际换边仅 2/5 | 未通过：有实际换边仅 2/5 |
| G3 步数余量 | 未通过：probe seed 31 达 48/48 | 步数条件通过：probe 最大 30/48、fixed 最大 33/48；未完成任务仍保留为失败 |
| G4 模型面瘦身 | 通过：固定协议减少 100 字节，宿主 API／原子写保留 | 相同源码，通过 |
| G5 新任务仍可解 | 未通过：fixed 1/5 | 通过：fixed 4/5 |

两模型的 `probeMatchesComparison / separateProbeRuns / probePrecedesComparison=true`，比较自身 rejected 非零，探针评价未填入比较评价。但 `adaptiveProbeGatePassed=false`、`everyArmRepeated=false`、`mayInterpretTopology=false`。fixed 的五次是可解性复验，独立探针不充作 adaptive 比较臂；四臂效果比较没有执行，不能据本批次数、正确率或 token 差异声称拓扑收益。

## 测试与过程留证

| 目标 | 实际修复前失败记录 | 修复后验证 |
|---|---|---|
| 4.1 副本／同能力／真实评价 | `evidence-red.log`：4 个失败；缺少 stale 分布、校验函数及脚本真实评价 | `evidence-green.log`：13/13，含原 ACL、reference 与工具路径 |
| 4.2 可枚举拒绝判据 | `tools-red.log` 的规则失败；`evidence-red.log` 的本地判据失败 | 规则与实验判据断言通过 |
| 4.3 换边探针计量与闸门 | `protocol-red.log`：4 个失败；`reporting-red.log`：计量失败 | 原子计量、无换边失败、同列表不算成功、缺失输入关闭闸门等通过 |
| 4.4 实际双臂扫描与余量 | `calibration-red.log`：原扫描没有 adaptive 臂；protocol 余量断言失败 | 扫描两臂并逐 seed 判定超限 |
| 4.5 模型面移除参数／字节下降 | `tools-red.log` 的参数与固定字节失败 | 真注册表 peers-only、原宿主证据测试、原子写约束均通过 |
| 探针与比较拒绝分离 | `probe-variance-separation-red.log`：比较零拒绝被探针补足 | 对应修复后测试通过 |
| 助手重复全链工作修复 | `role-workflow-red.log`：共同角色提示、实际助手任务、实际阶段 2 通知三处失败（7 通过／3 失败） | `role-workflow-green.log`：10/10，保留同能力与真实 task/result 判据 |
| 实际导入 profile 桥接／输出上限 | [profile-bridge-red.log](../.artifacts/peer-variance/profile-bridge-red.log)：4 项中 3 通过／1 失败，prepared 输出上限缺失可抹除实验上限 | [profile-bridge-green.log](../.artifacts/peer-variance/profile-bridge-green.log)：6/6，含导入交集、请求字段／身份、路由与输出界限 |
| 实际安装包的 agent-loop 身份 | 未单独重放 marker 修复前红灯，不补造失败记录 | [PROFILE-BRIDGE-02 测试](../tests/unit/shifting-evidence-profile.test.ts)用独立 WeakSet 核对实际标记与父 stream 接收同一请求对象；[最终测试日志](../.artifacts/peer-variance/test-dsh-profile-final.log)通过，实际调用 `sourceAgentLoopRequest=true` 另由四批原轨迹核对 |

日志位于 `.artifacts/peer-variance/`。测试中已有通过的单写互斥断言并非修复前失败；不将它补记为红灯。`tests/unit/peer-variance-protocol.test.ts` 中后续复查才新增的 `malformed or missing identities, review counts, correctness and node coverage cannot open admission`、`comparison preflight refuses missing, unsuccessful, mismatched or later probes` 两项没有重放原工作区，严格“所有新增测试均有原工作区修复前失败”的要求仍非逐项完整，不补造证据。

原 fixed 脚本测试的 20 步／160 调用输入迁移为 48／384，以容纳新增两副本 task/result 核对；原有正确性、ACL、通信计量、无自动推进和未知 token 断言均保留。20 步失败记录在 `evidence-green-attempt.log`，没有把旧任务 20 步成功写成新任务成功。

| 必须执行命令 | 实测 | 日志 |
|---|---|---|
| `npm test` | 当前 419 项 runtime／集成 + 8 项 UI 全通过，0 跳过 | `test-dsh-profile-final.log` |
| `npm run typecheck` | 通过 | `typecheck-dsh-profile-final.log` |
| `npm run build` | 通过 | `build-dsh-profile.log` |
| `npm run pack:tarball` | 最终文档同步后通过：`dsh-atn-0.3.2.tgz`，98 文件，296,431 字节 | `pack-dsh-profile-final.log` |
| `npm run smoke:profile` | 通过：隔离 profile 安装、六工具、子节点预设一致、用户配置不变 | `smoke-dsh-profile.log` |

当前冻结的 **26 个源文件**（含实际 profile 桥接）与 SHA-256 保存于 `.artifacts/peer-variance/source-final/` 和 `source-final-hashes.json`。实际 Desktop 批次必须与这份源码一致。此前 25 文件源码单独保存在 `source-pre-dsh-profile/` 和 `source-pre-dsh-profile-hashes.json`；当时 413 项 runtime／集成 + 8 项 UI 的 `test-final.log` 等旧日志保留。修改前工具和实验文件也留存于 `source-before/`。没有将历史源码的 fixed 5/5 替代当前验证，也未执行四臂效果比较。

## 复核命令

历史 25 文件源码确定性扫描使用 `npm run experiment:calibrate -- --out .artifacts/experiments/peer-variance-calibration-20261006-v2`；当前 26 文件扫描输出目录改为 `.artifacts/experiments/peer-variance-calibration-20261006-dsh-profile`。以下仅是历史独立 bare-Node / Space Bunny 的 800 万档命令，不能用它复现实际 Desktop 导入桥接；实际 Desktop helper 的配置与哈希保存在各新批次 `profile-bootstrap.json` 和 `.artifacts/peer-variance/dsh-*-config-20261006.json`。重跑必须使用新的 `--out`，不能覆写已有证据。TLS 参数只记录历史本机诊断后采用的进程条件。

```powershell
$taskPreviousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = ($taskPreviousNodeOptions + ' --tls-max-v1.2 --import=file:///D:/dsh-ATN/.artifacts/peer-variance/transport-diagnostic.mjs').Trim()
  ./scripts/run-pilot.ps1 -Experiment shifting-evidence --execute --free-only --models space-bunny-free --modes adaptive --probe --chain-length 2 --steps 48 --max-calls 384 --max-output-tokens 4096 --observed-token-limit 8000000 --timeout-ms 600000 --repeats 5 --seed 17 --out .artifacts/experiments/peer-variance-live-adaptive-probe-8m-20261006-v3
  ./scripts/run-pilot.ps1 -Experiment shifting-evidence --execute --free-only --models space-bunny-free --modes fixed --chain-length 2 --steps 48 --max-calls 384 --max-output-tokens 4096 --observed-token-limit 8000000 --timeout-ms 600000 --repeats 5 --seed 17 --probe-report .artifacts/experiments/peer-variance-live-adaptive-probe-8m-20261006-v3/batch.json --out .artifacts/experiments/peer-variance-live-fixed-8m-20261006-v2
} finally {
  $env:NODE_OPTIONS = $taskPreviousNodeOptions
}
```

`scripts/summarize-peer-variance.mjs` 读取历史完整 batch/report，核对 run id、文件 SHA-256 与该批记录的源码，再生成对应可移植索引；历史索引生成时的“当前源码”不能被解释为后续 26 文件源码。原始 Session 和持久化记录由单独审计器核对，不能只信 summary。
