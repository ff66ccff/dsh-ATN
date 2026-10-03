# dsh-atn 修复实施报告

## 2026-10-04：0.2.0 独立 ATN 模式

默认产品入口调整为 **设置 → Agent 预设 → 自定义 → ATN**。Bundle 新增宿主级 `atn` 运行时和 `preset-atn` 声明；基础工作工具、九个 ATN 工具及模式提示词均属于预设作用域。安装不改默认项，Standard 等原有预设不获得 ATN 工具或提示词。

节点创建使用 `agentPresets.composeFrom` 加入创建者持有的实际预设版本，将 preset ID 和工作目录写入节点/Session。冷恢复使用记录的 preset ID 调用 `mount`，预设缺失时失败，不回退到默认模式；不要求创建者仍存活。

验证证据：

| 检查 | 范围与结果 |
|---|---|
| `npm run typecheck` / `npm test` / `npm run build` | 类型检查、139 项单元/集成测试和编译通过 |
| `tests/integration/preset.test.ts` | 6 项：声明结构、UI roster 与隔离、父子孙绑定和 cwd、旧预设版本继承、冷恢复、缺失预设拒绝 |
| `npm run smoke:profile` | 临时 Web profile 安装真实 tarball；预设 roster 同时包含 Standard/PTC/Minimal/Creator/ATN，ATN 可用且非默认；模型工具调用执行 start/spawn，子节点拥有同一套 22 个工具，其中 9 个为 ATN 工具 |
| 配置对比 | 183 条完整既有宿主行及其嵌套配置未改动，仅新增运行时和 ATN 声明；目标 profile 的用户 patch 未改动 |

Smoke 使用确定性 adapter，不读取用户凭据或真实 Session，不调用付费模型。测试辅助 adapter 单独识别模型的工具请求，避免 Web 的标题/摘要请求消耗测试脚本。预设测试通过不代表权限沙箱验证通过。

发布工程：版本由 `0.1.0` 升至 `0.2.0`，沿用 npm `next` 标签；安装示例改为 `dsh plugin --profile web add dsh-atn@0.2.0`。`.gitignore` 覆盖嵌套依赖、构建产物、tarball、缓存、报告、临时数据和本地设置；npm 使用独立白名单。源码、测试、文档、CI 与 lockfile 继续版本化。

当前缺口：AUTH-01/02/03 的受限执行路径、PROFILE-03 的完整消息/投票/退休/交付链路、CONTEXT-02 的模型读取确认语义、直接 GitHub 源码安装。AGENT-02 的预设绑定和真实 Web profile 的 start/spawn 路径现已有证据；下方 `0.1.0` 报告中的对应缺口仅描述当时状态。

## 2026-10-03 review 后直接修复

本节记录 `0.1.0` 时的状态，下方原 121 项报告同样作为历史实施记录保留。代码定位可能随版本变化。该版定位为开发者预览版，尚未满足完整正式验收；源码已推送 GitHub，`dsh-atn@0.1.0` 已发布 npm，未创建 GitHub Release。

| review 问题 | 当前处理 | 回归证据 |
|---|---|---|
| 在途 spawn 越过 stop | 创建/恢复登记 AbortController；停止先关闭持久状态，再取消在途操作；发布再次检查网络、生命周期和取消信号；完成门槛阻止 provisioning | REVIEW-01：真实 handle 延迟到 stop 超时以后返回，spawn 必须拒绝、节点 failed、没有 open task 或残留 Agent |
| 两个网络的 node id 碰撞 | 释放状态按全局唯一 sessionId 索引；报告按网络 Session 集合过滤 | REVIEW-02：两个网络各有 node-3，同时停止后两个 registry 对象均消失；handles 单测验证过滤 |
| 自定义 mail id 被自动分配覆盖 | 自动计数器跳过已存在 id，不改写旧消息 | MAIL-ID：预占 mail-3 后自动消息保留两个独立记录 |
| 发布后的失败遗留 open task | 补偿同时失败节点及其持有的 open task，保留结果原因，并释放 handle | REVIEW-04：注入 goal 回执写失败后，初始任务 failed，入口仍能完成交付 |
| dispose 超时后重入、晚成功丢失 | 每 Session 一个 dispose Promise；timeout 只结束等待；晚成功/失败更新实时记录；成功后才删 handle | handles 单测：超时后再 begin 不二次 dispose，晚成功/失败均可见，历史报告不被改写 |
| 预算耗尽退休但没有释放 | admission 只申请 draining；tick 对所有终态节点补做释放，而非只观察本轮转换 | REVIEW-06：已结清任务节点耗尽预算后 tick 退休并从 registry 移除 |
| 并发广播重复 goal | 按接收 Session 串行化查重、append、回执；WeakMap 跟踪已接收但处于 inbox 到日志间隙的消息；重启查 Session 历史 | REVIEW-07：并发全票提交与 recover 后每节点 v2 快照恰为一份 |
| 稳定 id 重试虚报 delivered | 重试读取真实邮件状态；queued 可重投，undeliverable 保持终态，不重复生成 task | REVIEW-08：queued 和 undeliverable 连续重试均保持准确回执及单一任务 |

额外证据：MAIL-02 整内核重建测试注入“邮件已写入 Session、网络投递回执失败”，重启后从 JSONL 历史查重；STOP-STREAM 在真实 Agent loop 的模型 stream 阻塞期间停止，观察 AbortSignal、资源释放和宿主保留。这些测试未调用真实模型。

本轮修正旧 STOP-02 的错误断言：dispose 拒绝不能证明 Agent 已释放，现在断言仍持有 handle 且 registry 中仍存在 Agent。不是将失败当作成功。原 spawn 测试补齐 finally 中的内核销毁。

发布工程调整：补声明运行期 `dsh-scope` peer；移除 package.json 重复键；打包命令自动创建输出目录，适用于干净检出；添加 Linux/Windows GitHub CI；smoke 校验安装退出码、删除行、id 和 name，比较目标 profile 自身安装前后的 patch；缺失 CLI 不再假成功，过滤凭据环境变量。

实测：`npm test` **133/133 通过**，`npm run typecheck` 和 `npm run build` 退出 0；tarball 57 文件。真实 profile smoke 安装退出 0，96 个既有行 id/name 不变，目标 profile 的 patch 不变，启动到 `MISSING_CREDENTIAL`；它不证明真实 profile 纵向路径通过。新增 12 项：8 项集成、4 项单元；原 121 项保留。另从 Git 暂存区导出干净目录，依次执行 `npm ci --ignore-scripts`、typecheck、133 项测试、build 和 pack，全部退出 0；检查 tarball 的 57 个文件，无 node_modules/tests/src/.env/upstream/prototype/.claude。

仍未完成：AUTH-01/02/03 受限执行路径；AGENT-02 的 preset 绑定；PROFILE-03 真实 profile 纵向运行；CONTEXT-02 未准入不算读取；GitHub 源码直接安装。MAIL-02 新测试证明整内核重建后的历史去重，不等于双进程同时写或硬崩溃跨存储事务保证。停止测试不能证明不遵守取消协议的外部操作一定退出。以上不标成通过。

## npm 首次发布与安装验证

2026-10-03，使用 npm 账号 `ff66ccff` 完成浏览器双重验证后，执行 `npm publish .artifacts/dsh-atn-0.1.0.tgz --access public --tag next --registry=https://registry.npmjs.org/`，退出 0。Registry 查询确认版本 `0.1.0`，`next` 和首次发布生成的 `latest` 均指向该版本；产品状态仍为开发者预览版。Registry 的 `dist.shasum` 与本地发布 tarball 一致：`909ca374905044874f8c14f100b115a3d009dda3`。

设置 `ATN_INSTALL_SPEC=dsh-atn@0.1.0` 后实际执行 `npm run smoke:profile`：从 npm 安装退出 0，bundle 注册存在、`atn`/`atn-tools` 两行存在、96 个既有行 id/name 未变、目标 profile 的 `cordis.patch.yml` 未变，启动到 `MISSING_CREDENTIAL`。pnpm 自动为本次明确指定的新版本添加 `minimumReleaseAgeExclude` 条目；未配置真实模型凭据或调用付费模型。

README 的首选安装方式已改为 `dsh plugin --profile headless add dsh-atn@0.1.0`，附模型配置、启用检查及源码构建备选步骤。新增 `publishConfig` 固定官方 registry、公开访问和 `next` 标签；`prepublishOnly` 执行类型检查、133 项测试和构建。原有完整验收缺口没有因发布 npm 而转为通过。

## 历史记录：首轮 121 项修复

**以下状态、命令、Git 信息均为首轮交付时的记录，不代表本轮最终发布状态。**

对应文档：[修复实施说明](REPAIR_IMPLEMENTATION_BRIEF.md)、[最小正式 bundle 实施报告](MINIMAL_BUNDLE_IMPLEMENTATION_REPORT.md)、[验收清单](MINIMAL_BUNDLE_ACCEPTANCE.md)。
本报告只记录实际执行过的命令与观测结果。**未测试的内容不写成已通过**，第 4 节明确列出仍未完成的 AUTH / PROFILE 项。

---

## 1. 完成标准命令与实测结果

全部在 `D:\dsh-ATN`、Node.js v24.19.0 下执行。

| 命令 | 结果 | 观测 |
|---|---|---|
| `npm test` | **通过** | `ℹ tests 121 / ℹ pass 121 / ℹ fail 0`（基线 83 项全部保留，新增 38 项） |
| `npm run typecheck` | **通过** | `tsc -p tsconfig.json --noEmit` 无输出、退出 0 |
| `npm run build` | **通过** | `tsc -p tsconfig.build.json` 退出 0 |
| `npm run pack:tarball` | **通过** | 生成 `.artifacts/dsh-atn-0.1.0.tgz`（`npm notice total files: 57`） |
| `npm run smoke:profile` | **通过** | 见下表；安装退出 0、bundle 列表含 `dsh-atn`、composed config 含 `# == dsh-atn`、启动停在 `MISSING_CREDENTIAL` |

`npm test` 连续 5 次运行均为 121/121 通过（用于确认并发类测试没有偶发失败）。

`smoke:profile` 各步骤实际输出摘要：

| 步骤 | 退出码 | 观测 |
|---|---|---|
| PROFILE-01 安装 tarball | 0 | `pnpm ... added 5, done` |
| PROFILE-01 bundle 列表 | 0 | `@deepseek-ai/dsh-base, @deepseek-ai/dsh-headless, dsh-atn` |
| PROFILE-02 loader 组装 bundle 层 | 0 | `# == dsh-atn` 层与 `atn` / `atn-tools` 两行存在 |
| PROFILE-04 不覆盖既有行 | 0 | 96 个既有行的 id+name 完全一致，只新增 `atn`、`atn-tools` |
| PROFILE-02 profile 启动并 mount | 1 | `MISSING_CREDENTIAL: llm-deepseek: no API key ...`（说明所有行已 mount，无导入/激活错误） |
| PROFILE-04 用户 patch 未被改动 | 0 | `unchanged` |

---

## 2. 逐项修复内容与证据

### 2.1 建立每网络单一写入者，消除旧快照覆盖

**代码改动**

- `src/runtime.ts` 新增每 `networkId` 串行的 mutation 队列：`mutate(networkId, fn)` 返回 `{ record, value }`，`mutateOnce` 把「用最新 `current` 做决策」与「`store.update` 提交」放在同一个临界区内，`fn` 必须是同步纯变换；`fn` 抛错时不提交，队列也不被污染。
- 所有网络写操作改走 `mutate`：spawn 的意图、发布与初始任务、send 的邮件与任务创建、result 的结算、propose 的提案与通知邮件、vote 的投票与 goal 提交、admitStep 的额度扣减、renew、deliver 的完成门槛、stop 的终态、tick 的过期/退休、recover 的恢复与重排。
- 队列在网络终态后可清理（`mutationTails` 在尾部结算后删除），但清理不影响正在排队的调用者等待关系。
- 附带修正：`vote` 与 `send`/`settleByResult` 不再在临界区外读取最新记录来判断结果，避免把并发提交后的状态误报给调用者；`castVote` 的幂等分支改为回读传入记录里的提案，而不是调用前的旧快照。

**验收测试**（`tests/integration/concurrency.test.ts`）

| 测试 | 断言 |
|---|---|
| CONCURRENCY-01 | 并发两次 spawn 得到两个不同 node id，两个任务都保留，只有第一个发布者占用 `selectedChildId`，两个 handle 都在 |
| CONCURRENCY-02 | 三个节点链上的两个审批者并发投票：两票都保留，最后一个提交**只产生一个新 revision** |
| CONCURRENCY-03 | 并发发送 task 与 note：两封邮件、一个任务都在，id 不冲突，`sequence` 等于已分配 id 总数 |
| CONCURRENCY-04 | 把 `stepBudget` 冻结为 1，两个节点并发争抢：只有 1 次准入成功，`stepsUsed` 恰为 1 |
| CONCURRENCY（旧快照） | 三次并发 spawn 的每一次 committed 记录都不丢已有节点，节点数单调不减 |
| CONCURRENCY-05 | 并发 `deliver` 与 `result`：被接受的完成**绝不留下 open 任务**；未接受时网络保持 open |

### 2.2 正常退休必须释放 handle，并阻止终态节点继续运行

**代码改动**

- `src/handles.ts` 新增 `HandleReleaser`：每个释放操作有 `pending` / `released` / `failed` / `timed-out` 状态，只有确认 `dispose()` 成功才记 `released`。
- `tick()` 记录本轮由非终态转为 `retired`/`failed` 的节点（`terminalNodesOf`），并在**同一次调度**里通过 `releaseSpecificHandles` 在安全步界释放其 handle，不在任何 Agent 的 `execute()` 栈内等待自己销毁。
- `stepDecision` 在同一个临界区内裁决：网络非 open、节点 `retired`/`failed`/`provisioning` 直接拒绝；`draining` 只有在仍有 open 任务或未投旧票时才允许继续；`admitStep` 的额度扣减与生命周期判断原子完成。
- 只有 `dispose()` 确认成功才从 `handles` 删除；失败或超时的 handle 继续可追踪并进入 straggler 记录。入口 Agent（`isEntry`）永远不释放。

**验收测试**（`tests/integration/retire.test.ts`）

- **RELEASE-01**：节点结清任务并 `atn_finish` 后为 `draining` 且仍持有 handle；调用 `tick()` 后 `lifecycle === 'retired'`、`ownsHandle(nodeId) === false`、被释放的 Agent 已离开 registry，入口 Agent 仍在。
- **RELEASE-02**：retired 节点 `admitStep` 返回 false（无法再产生 model step），且 renew / spawn / send 都被拒绝，没有新邮件产生。
- **RELEASE-03**：`draining` 节点仍可 `send(kind=result)` 结清旧任务；`send(kind=task)` 被 `sender-draining` 拒绝且**不产生 task 记录**。
- **RELEASE-04**：调度器运行后入口节点仍为 `active`，入口 Agent 仍 live。

### 2.3 修正 stop 的释放结果和 straggler 报告

**代码改动**

- `StopReport` 增加 `stragglerDetails`（`{ nodeId, sessionId, status, reason }`）；`released` 只包含确认 `dispose()` 成功的节点。
- `failed` 与 `timed-out` 都进入 `stragglers` 并带可诊断原因；超时返回后 handle 仍可追踪，之后 settle 只更新状态，不改写已返回的报告。
- `stop` 幂等：重复调用返回同一份终态报告；`stopped` 是持久终态，renew / spawn / vote / 邮件重放 / recover 都不能重新打开它。
- 释放窗口由 `cleanupTimeoutMs` 注入（默认 10s），测试可用毫秒级窗口观测超时。
- 修正：释放结果不再因为 `dispose()` 抛错而误判为已释放；释放完成的纪录不再被后续状态改写。

**验收测试**（`tests/integration/stop.test.ts`）

- **STOP-01**：注入永不完成的 fake handle；stop 等到清理窗口后返回，该节点在 `stragglers` + `stragglerDetails.status === 'timed-out'`，**不在 `released`**。
- **STOP-02**：注入立即 reject 的 fake handle；报告 `status === 'failed'` 且原因是真实错误文本，节点不在 `released`，`ownsHandle` 为 false。
- **STOP-03**：正常 stop 时节点进入 `released`，入口 Agent 仍存在，所有 open 任务都被结算。
- **STOP-04**：重复 stop 幂等（同一 `released` / `stragglers` / `reason`）；stop 之后 spawn、renew 都失败，网络仍是 `stopped`，节点数与任务数不变。

### 2.4 让 spawn 的创建意图、发布和初始任务具有失败补偿

**代码改动**

- spawn 先在一次 mutation 中持久化 `provisioning/pending` 意图（含 `sessionId`、路由、租约），并在**创建 Agent 之前**检查节点容量与任务额度（`maxTasks` 满时直接拒绝，不创建 Agent）。
- Agent 创建成功后，在**一次 mutation** 中同时完成：确认节点仍是 pending、`publishNode` 发布、按当前记录占用 `selectedChild`、`createTask` 创建初始任务、推进 `sequence`。
- 发布失败的补偿：`failProvisioning` 记录 `failed` 节点与失败原因，`disposeDetachedHandle` 释放已创建的 handle 并保留失败/超时记录；不再留下 active 无任务节点。
- 发布后写上下文/任务消息的失败同样走同一条补偿路径，避免“已发布但拿不到任务通知”的半成功状态。
- 恢复逻辑继续区分 `pending` / `published` / `failed`，不重复发布同一 session。

**验收测试**（`tests/integration/spawn.test.ts`）

- **SPAWN-01**：`maxTasks=1` 时 start 成功后 spawn 被拒；网络中没有新增节点、没有新增任务、没有额外 Agent。
- **SPAWN-02**：注入 publish 写失败；spawn 拒绝，节点最终 `creationState='failed'` / `lifecycle='failed'`、note 保留真实原因、没有任务、没有占用 `selectedChild`、`ownsHandle` 为 false、已创建的 Agent 被释放。
- **SPAWN-03**：正常 spawn 仍保留初始任务、context、`selectedChild`、goal snapshot（`lastGoalVersionSent=1`）与 task message。

### 2.5 收紧续期与 draining 的工作边界

**代码改动**

- `RenewInput` 改为 `{ extendMs, taskId, basis? }`：`taskId` 是必填依据，`basis` 只是说明文字；`atn_renew` 工具同步为 `taskId` 必填。
- `renew` 在一个临界区内核验：网络 open、节点 `active` 或 `draining`、任务存在、任务由调用者持有、任务仍 open，并且时长在 `maxLeaseExtensionMs` 与网络 `deadlineAt` 之内。
- `retired` / `failed` / 已停止网络的 renew 全部拒绝。
- `send(kind=task)` 要求发送者仍为 `active`：`draining` 节点只能提交自己旧任务的 result、投旧票和发送普通通知；新任务只能分配给当前 `active` 目标。

**验收测试**（`tests/integration/renew.test.ts`）

| 测试 | 断言 |
|---|---|
| RENEW-01 | 未知 taskId 被拒（`unknown-task`）；结清任务或退休后 renew 被拒（`task-settled` / `not-active`） |
| RENEW-02 | 用别人的任务续期被拒（`not-holder`）；真正的持有者可以续期，只有租约变化，任务保持 open |
| RENEW-03 | 已结算任务不能作为依据（`task-settled`） |
| RENEW-04 | 已停止网络续期被拒，`leaseDeadlineAt` 仍为 null |
| RENEW-05 | `draining` 且仍持有 open 任务的节点可以续期，生命周期不变 |
| RENEW-06 | 空 `taskId` 被拒（`missing-task`），不会凭文本授予空白租约 |

### 2.6 恢复后补发当前 goal context

**代码改动**

- 节点记录新增 `lastGoalVersionSent`（可选字段，读取时按 `0` 处理）：只有在 goal snapshot **真的写入**该节点 live Agent 输入之后才推进。
- 新增 `markGoalSynced` 与 `syncGoalIfNeeded`：同一个 revision/session 只同步一次；commit 时没有 live Agent 的节点保持欠账状态。
- `recover()` 成功 resume 一个 `active`/`draining` 节点后，读取最新 `currentGoal(record)` 并补写该 session 的 ATN goal message；已有 handle 的节点如果版本落后也会补同步。版本广播继续使用 `inject`，不唤醒 idle 节点。

**验收测试**（`tests/integration/recover.test.ts`）

- **RECOVER-CONTEXT-01**：三节点链上，中间节点提案、叶子先投票；在提交票之前释放叶子的 live Agent。v2 提交后叶子 `lastGoalVersionSent` 仍为 1；`recover()` 返回 `resume` 且同步为 2；叶子下一次 model request 能读到 v2 内容；再次 recovery 返回 `leave` 且不再追加 snapshot。
- **RECOVER-CONTEXT-02**：仍持有 live handle 的节点在 recover 时不被重复追加 goal snapshot，Agent 实例保持不变。
- **RECOVER-CONTEXT-03**：已停止网络不产生任何 recovery 决策，也不会被重新打开。

### 2.7 完整继承模型 route 的 effort

**代码改动**

- spawn 传入 `reasoningEffort: route.effort === 'inherit' ? undefined : route.effort`（`effortOption` 同时把 `null` 与 `'inherit'` 归一为 undefined）。
- `recover()` / `agents.resume` 使用节点持久化的 `modelRoute.effort`，不回退到 profile 默认值。

**验收测试**（`tests/integration/effort.test.ts`）

- **EFFORT-01**：父 Agent 以 `reasoningEffort='high'` 创建；子节点 `modelRoute.effort === 'high'`、`agent.options.reasoningEffort === 'high'`，并且比较父与子**实际 request** 的 provider / model / reasoningEffort 完全一致。
- **EFFORT-02**：释放 handle 后 `recover()` resume，新 Agent 与随后的实际 request 都携带持久化的 `medium`。
- **EFFORT-03**：父请求没有 effort 时，子节点不凭空造出 effort（`options.reasoningEffort === undefined`，`modelRoute.effort === null`）。

### 2.8 公开稳定 message id，并让重试真正幂等

**代码改动**

- `SendInput` 与 `atn_send` 增加 `messageId` 参数，工具描述明确说明“用同一个 id 重试”。
- `existingMail` 在同一个 mutation 内先按 id 查已有邮件行：`from` / `to` / `kind` / `body` 任一不一致即抛 `MailIdentityError` 拒绝；完全一致则直接返回已有 mail 状态，不创建第二个 task、不重复结算。
- result 重试还要匹配该任务已记录的 summary 与 evidence，避免“同 id 但换一个说法”。
- `SendResult.duplicate` 如实反映幂等重试；mail row、发送者、目标、任务关联和首次时间都保留。

**验收测试**（`tests/integration/message-id.test.ts`）

- **MESSAGE-ID-01**：同一 `messageId` 的 task 重试只产生一封 mail 与一个 task，第二次 `duplicate=true` 且返回同一个 taskId。
- **MESSAGE-ID-02**：同一 `messageId` 的 result 重试不产生第二次结算，`settledAt` 与 evidence 保持不变，邮件数只 +1；同 id 换 summary 被拒绝且不扰动已记录结算。
- **MESSAGE-ID-03**：同 id 换 body、换目标、换 kind 都被拒绝（`cannot be reused`），第一封邮件及关联记录完全不变。
- **MESSAGE-ID-04**：note 重试保留发送者、目标与首次 `enqueuedAt`。

### 2.9 配置边界修复

**代码改动**（`src/config.ts`）

- `assertConfigRelations` 逐个校验 13 个计数与时长必须是**正整数**（`0`、负数、小数、NaN 都拒绝，并点名具体字段）。
- `domainName` 在加载时校验 `[a-z][a-z0-9_]*`，非法域名立即失败。
- 原有的字段关系校验（`maxTotalNodes >= maxResidentNodes`、`maxLeaseExtensionMs >= defaultLeaseMs`、`networkDeadlineMs >= defaultLeaseMs`、`proposalDeadlineMs <= networkDeadlineMs`、`maxPendingMailPerNode <= maxRetainedMail`）保留。

**验收测试**（`tests/unit/config.test.ts`）

- 13 个字段逐个 `0` 值都在加载时失败并点名该字段；负数、小数、NaN 同样失败。
- `''`、`Atn_Networks`、`1atn`、`atn-networks`、`atn networks`、`ATN` 六个非法域名全部被拒；合法默认值与 `atn_networks_v2` 通过。
- 关系冲突（`maxTotalNodes=2 < maxResidentNodes=8`、`proposalDeadlineMs` 超过 `networkDeadlineMs`）仍然失败。

---

## 3. 实施过程中发现并修复的附带缺陷

这些不在 brief 的清单里，但不修就无法满足验收条件：

1. **释放状态更新被快照遮蔽**（`src/handles.ts`）：`settle()` 最初遍历等待前的快照对象判断 `status`，而结算回调更新的是 Map 里的新对象，导致成功释放被误判为 `timed-out`。改为等待结束时回读 live 记录，并把「等待的 promise」定义成真正执行状态迁移的那个 promise。
2. **spawn 发布失败时补偿是空操作**（`src/runtime.ts`）：catch 里先 `handles.delete(sessionId)`，随后 `disposeDetachedHandle` 的 `delete` 返回 false 直接 return，已创建的 Agent 永远不会被 dispose。删除重复 delete，由 `disposeDetachedHandle` 独占释放职责。
3. **并发 vote 的状态误报**（`src/runtime.ts` / `src/proposals.ts`）：并发提交时先完成的调用者可能读到另一票提交后的最高状态，回答与自己的提交不一致。改为按调用者自己的提交回答，并在回读时同步已被并发提交的提案状态；`castVote` 幂等分支回读传入记录里的提案而不是旧快照。
4. **注册后写路径不在临界区**（`src/runtime.ts`）：`renew` 的读-判断-写曾分成两次读和一次写，竞争下可能用过期租约判断。
5. **teardown 重入正在销毁的 Agent**（`src/runtime.ts`）：当清理窗口内 `dispose()` 尚未完成时，运行时的 teardown 会对同一个 Agent 再次 `dispose()`。在 32 路并行测试下这会触发 Cordis 的 `cannot get property "href" without inject`，并让 `RELEASE-01` 偶发失败。teardown 现在跳过已经处于 in-flight 释放的 handle，测试窗口也改为足够容纳真实销毁时间（超时行为仍由专门的毫秒级窗口测试覆盖）。

---

## 4. 仍未完成的项（不声称通过）

| 项 | 状态 | 说明 |
|---|---|---|
| AUTH-01 / AUTH-02 / AUTH-03 受限策略继承 | **仍未完成** | 测试装配依旧没有挂载 `permissionPresets` / `sandboxPolicy`，`captureDelegatedPolicyOverrides` 在 fixture 中返回空对象，因此没有“真实受限策略下某操作被拒绝”的证据。本轮没有放宽任何断言来掩盖它。 |
| AGENT-02 preset 绑定部分 | **部分** | 同构工具集仍已验证；`agentPresets` 未挂载，节点 `presetId` 恒为 `null`。 |
| PROFILE-03 真实 profile 的 ATN 纵向路径 | **仍未完成** | 纵向路径在真实内核装配中验证（M2/M3），但那不是 profile 启动路径；`smoke:profile` 只证明安装、组装与 mount。 |
| CONTEXT-02 未准入前不能提前确认看过新版 | **未实现** | `lastGoalVersionSent` 只在消息实际写入后推进，但没有针对 pre-step 被拒绝/取消场景的专门测试。 |
| MAIL-02 跨进程重启后的目标历史去重 | **部分** | 进程内重复投递仍按目标 inbox 内容比对去重；跨进程重启后 Session 历史已含同一 ATN 消息时可能再投一次。 |
| STOP-03 忙模型流期间停止达到真正静止 | **未测试** | 有 stop 的 straggler/失败/幂等测试，但没有“模型流进行中停止”的用例。 |
| `prepare` / GitHub 源码安装路径 | **未演练** | 没有 remote，tarball 路径已实测。 |

上一份[实施报告](MINIMAL_BUNDLE_IMPLEMENTATION_REPORT.md)中已列出的其他未完成项，本轮没有新增证据，也不在此重复声称通过。

---

## 5. 变更文件

| 文件 | 变更 |
|---|---|
| `src/runtime.ts` | 每网络 mutation 队列；spawn 意图/发布/任务三合一的失败补偿；renew 的 taskId 边界；draining 工作边界；退休与终态节点的 handle 释放；stop 的释放状态与 straggler 明细；goal context 幂等补发；effort 继承；`messageId` 幂等；step 生命周期门禁 |
| `src/handles.ts` | 新增：释放操作状态机（pending/released/failed/timed-out） |
| `src/mailbox.ts` | `MailIdentityError` 与 `mailMatches`：稳定 id 只接受同一条消息 |
| `src/proposals.ts` | 幂等投票回读当前记录里的提案 |
| `src/domain.ts` | `MemoryNetworkStore.updateHook` 故障注入、`updateAttempts`、`syncedGoalVersion` |
| `src/schema.ts` | 节点记录新增 `lastGoalVersionSent` |
| `src/lifecycle.ts` | `markGoalSynced` |
| `src/config.ts` | 正整数与 `domainName` 加载期校验 |
| `src/tools.ts` | `atn_send.messageId`、`atn_renew.taskId` |
| `src/messages.ts` | 无签名变化（`atn_source` 语义不变） |
| `tests/` | 新增 `concurrency` / `retire` / `stop` / `spawn` / `renew` / `recover` / `effort` / `message-id` 集成测试与 `config` 单元测试；fixture 支持 `cleanupTimeoutMs`、故障注入与 reasoning effort 能力声明 |
| `README.md` | 工具语义、stop 返回值、配置校验、并发与生命周期一致性、测试布局 |
| `docs/REPAIR_IMPLEMENTATION_REPORT.md` | 本文件 |
