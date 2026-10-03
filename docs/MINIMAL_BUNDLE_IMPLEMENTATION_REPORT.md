# 最小正式 bundle 实施报告

**状态：实现完成并完成实际验证，等待 Claude review。未创建 GitHub 仓库、未推送、未发布 npm，也未开始 review。**

配套文档：[实现规格](MINIMAL_BUNDLE_SPEC.md)、[验收清单](MINIMAL_BUNDLE_ACCEPTANCE.md)、[原型验证报告](atn-prototype-validation.md)。
本报告只记录实际执行过的命令与观测结果；没有证据的项目在"未完成项"里明确列出，不写成已通过。

---

## 1. 本次实现范围与未实现项

### 1.1 已实现

一个可在真实 `dsh` profile 中安装和加载的 ESM bundle `dsh-atn`（`package.json` 声明 `dsh.bundle.patch`），包含：

- **Cordis service 插件**（`src/index.ts`）：`AtnRuntime` 在自己捕获的稳定上下文中持有全部网络与 ATN 创建的 Agent。
- **函数插件工具入口**（`src/tools.ts`）：9 个模型工具与一条共同规则 system prompt 段落。
- **持久领域模型**（`src/schema.ts`、`src/domain.ts`）：zod 校验的 Network / Node / Task / Mail / Proposal 记录，整份网络记录为一次原子更新单元，生产实现走 `storageDomain`。
- **纯拓扑推导**（`src/topology.ts`）：向上沿 `creator_id`、向下沿 `selected_child` 各取最近两个 `active` 节点；跳过非 active；路径尽头留空；循环/断裂明确报错。
- **局部任务**（`src/tasks.ts`）：持有者专属、单次结算、空闲不等于完成。
- **信箱**（`src/mailbox.ts`）：先持久入队再投递、每发送者背压、稳定 id 去重、不可达投递单独记录。
- **全票审议**（`src/proposals.ts`）：冻结基础版本/正文/审批名单，同票幂等、改票拒绝、stale/expired/rejected/cancelled 各自区分。
- **生命周期与恢复**（`src/lifecycle.ts`、`runtime.ts`）：`provisioning → active → draining → retired`，第一个成功发布的子节点占用 `selected_child`，注入时钟的租约与期限，宿主可调用的 `stop()`，插件加载时从持久记录重建。
- **可回放上下文**（`src/messages.ts`）：目标快照、任务、邮件、审议请求都以 `source.kind = 'atn'` 的 user message 落入 Session 日志。

### 1.2 本轮明确未实现/未验证

| 项 | 状态 | 原因 |
|---|---|---|
| AUTH-01 / AUTH-02 / AUTH-03 受限策略继承 | **未完成** | 测试装配未挂载 `permissionPresets` / `sandboxPolicy`，因此 `captureDelegatedPolicyOverrides` 在 fixture 里返回空对象，没有"真实受限策略下某操作被拒绝"的案例。代码路径已调用上游 helper，但没有证据。 |
| AGENT-02 的 preset 绑定部分 | **部分** | 同构工具集已验证（host 与子节点实际 model request 的工具集合逐项相同）；`agentPresets` 未挂载，节点 `presetId` 恒为 `null`。规格要求"有 preset 的组合若无法正确继承应明确失败"——本实现没有 preset 时依赖 profile 原有全局工具配置，未实现该失败分支。 |
| PROFILE-03 真实 profile 中的 ATN 纵向路径 | **未完成** | 需要在真实 profile 里注入确定性 adapter 并驱动 start/spawn/vote/drain/交付。纵向路径已在真实内核装配中验证（见 M2/M3 证据），但那不是 profile 启动路径。 |
| CONTEXT-02 未准入前不能提前确认看过新版 | **未实现** | 版本"已看到"由实际落入 Session 的 user message 决定，但没有针对 pre-step 取消/拒绝的专门测试。 |
| LIFE-06 分配与退出的提交次序 | **部分** | 每次网络变更是单次原子 `update`，退出与新任务不会交错写；但没有构造并发交错的显式测试。 |
| STOP-03 忙模型流期间停止达到真正静止 | **未测试** | `stop()` 会 `dispose()` 并用 10s 超时等待，但没有"模型流进行中停止"的用例。 |
| LIMIT-02 step budget 并发竞争 | **部分** | `admitStep` 在 pre-step 里计数并在超预算时 drain；只有单元级的限额测试，没有并发耗尽预算的集成用例。 |
| MAIL-02 崩溃后目标历史仅一条 | **部分** | 进程内重复投递用目标 inbox 内容比对去重；跨进程重启后若 Session 历史已有同一条 ATN 消息，重新投递会产生第二条记录。 |
| 自动退休释放的端到端 | **部分** | `retireSettledNodes` 由调度器执行，逻辑有单元测试；没有"节点结清后由 tick 自动 retired"的集成用例。 |
| `prepare`/GitHub 源码安装路径 | **未演练** | 没有 remote，无法真跑 `dsh plugin add github:...`。tarball 路径已实测。 |

---

## 2. 文件/模块职责与关键公开接口

```
src/index.ts      Cordis service 插件入口；name/inject/Config 导出 + 默认导出 AtnRuntimePlugin
src/runtime.ts    AtnRuntime：网络所有权、创建/恢复、投递、调度、停止、上下文写入
src/tools.ts      函数插件：9 个 ATN 工具 + atn-shared-rules prompt 段落
src/schema.ts     zod 记录定义（Network/Node/Task/Mail/Proposal/GoalRevision/Limits）
src/domain.ts     NetworkStore 接口、DomainNetworkStore、MemoryNetworkStore、额度核算
src/topology.ts   deriveNeighbourhood / neighbourIds 纯函数，TopologyError
src/tasks.ts      createTask / settleTask / markTaskUnreachable / openTasks
src/mailbox.ts    enqueueMail / markDelivered / markUndeliverable / pendingMails / inboxOf
src/proposals.ts  openProposal / castVote / resolveProposal / expireProposals / cancelPendingProposals
src/lifecycle.ts  publishNode / failProvisioning / requestDrain / retireSettledNodes / planRecovery
src/messages.ts   MessageSourceMap 扩展 + goal/task/mail/proposal 消息构造
src/config.ts     Cordis Config（全部可变参数）+ 关系校验 + limitsFromConfig
cordis.patch.yml  bundle 层：插入 atn 与 atn-tools 两行，不覆盖任何既有行
```

关键公开接口：

- `ctx.atn`：`start / spawn / send / peers / finish / propose / vote / renew / deliver / stop / tick / recover / network / networkIds / findBySessionId / ownsHandle / shutdown`。
- 插件导出：`export const name = 'atn'`、`export const inject = ['agents','tools','sessions']`、`export const Config`、`export { AtnRuntime }`、`export default class AtnRuntimePlugin extends AtnRuntime`。`AtnRuntime` 另有 `static inject` 与 `static Config`，因此 Loader 的 `exports.default ?? exports` 解包后仍能取到配置 schema 与依赖。
- 工具绑定：`ctx.atn` 服务由 service 行注册，`atn-tools` 行通过 `inject: ['tools','systemPrompt','agents','atn']`（模块命名导出 `inject`）在其后激活。

工具身份规则统一走 `exec.agent` 加 `ctx.agents.get(agent.id) !== agent` 检查（`src/tools.ts` 的 `requireCaller`），模型参数里的 `sender`/`voter` 字段一律忽略。

---

## 3. 实际执行的命令与结果

所有命令在仓库根目录 `D:\dsh-ATN` 执行，Node.js `v24.19.0`，npm `11.17.0`。

| 命令 | 结果 |
|---|---|
| `npm install --ignore-scripts --no-audit --no-fund` | exit 0，added 74 packages（含后续追加的 storage / zod / schemastery） |
| `npm run typecheck`（`tsc -p tsconfig.json --noEmit`） | exit 0，无输出 |
| `npm test`（`node --import tsx/esm --test "tests/**/*.test.ts"`） | **83 tests / 83 pass / 0 fail**，约 1.6s |
| ├ `tests/unit/*.test.ts` | 61 tests，61 pass |
| └ `tests/integration/*.test.ts` | 22 tests，22 pass |
| `npm run build`（`tsc -p tsconfig.build.json`） | exit 0；`lib/` 生成 23 个 `.js`，另有 `.d.ts` 与 source map；产物 import 已由 TypeScript 重写为 `.js` 后缀 |
| `npm run pack:tarball` | exit 0，`dsh-atn-0.1.0.tgz`，53 个文件 |
| `npm run smoke:profile` | 7 个步骤全部按预期；见第 5 节 |

测试全程使用确定性 adapter `atn-script`（`tests/fixtures/kernel.ts` 的 `ScriptedModel`），**真实模型调用 0 次**，不读取用户凭据、既有 Session 或工作区；每次运行新建 `os.tmpdir()` 下的独立目录并在 `finally` 中删除，同时 dispose 内核。

失败情况：开发过程中出现过并已修复的问题记在第 8 节；最终状态无失败测试。

---

## 4. 验收编号 → 证据映射

### M0

| 编号 | 证据 | 结果 |
|---|---|---|
| PKG-01 | 第 9 节 Git 状态；`prototype/` 与 `upstream/` 未被改写；无 reset/clean/stash | 通过 |
| PKG-02 | `npm run build` 干净构建；`package.json` 的 `dsh.bundle.patch = ./cordis.patch.yml`，文件在 tarball 中存在；`exports` 指向 `lib/index.js`、`lib/tools.js` | 通过 |
| PKG-03 | harness 包全部在 `peerDependencies` + `devDependencies`，版本锁 `0.2.0-rc.2` / Cordis `4.0.4`；`dependencies` 只有 `zod` 与 `@deepseek-ai/schemastery`；tarball 不含第二套 Cordis/registry | 通过 |
| PKG-04 | 第 5 节 tarball 清单：无 `.env`、`.claude`、`node_modules`、`tests`、`upstream`、`prototype/.scratch` | 通过 |
| PKG-05 | 构建只依赖本包 `src/` 与已声明依赖，不引用本机绝对路径或 `upstream/`；`prepare` 只跑 `npm run build`。GitHub 源码安装路径未演练 | 部分 |
| PKG-06 | `LICENSE` 保持 Apache-2.0；`NOTICE` 声明未复制上游源码并列出依赖许可证 | 通过 |

### M1

| 编号 | 证据 | 结果 |
|---|---|---|
| STATE-01 | `tests/integration/state.test.ts`：真实 `storageDomain` + `json` backend 写入后读回一致；把存储文档里的 `"open"` 改成 `"bogus-status"` 后重新 `open` 被 schema 拒绝，不会变成空网络 | 通过 |
| STATE-02 | `tests/unit/domain.test.ts`、`state.test.ts`：注入写失败后 `load` 仍是旧值，提交计数不增加；create 失败不留记录 | 通过 |
| TOPO-01 | `tests/unit/topology.test.ts`：五节点链中间节点恰为 `B,A,D,E`；首尾不伪造占位者 | 通过 |
| TOPO-02 | `topology.test.ts`、`tests/integration/network.test.ts`：A 先发布 B 后新建 X，`selectedChildId` 仍是 B，A 下游是 `B,C` 不含 X；X 反向可把 A 当上游 | 通过 |
| TOPO-03 | `tests/unit/lifecycle.test.ts`：两个 pending 子节点交错发布，先发布者占位，后者不抢占；失败创建不占位 | 通过 |
| TOPO-04 | `topology.test.ts`：B 变 draining 后 C 上游为 `A`、A 下游为 `C,D`，`C.creatorId` 仍是 `B`；`lifecycle.test.ts` 同向断言 | 通过 |
| TOPO-05 | `topology.test.ts`：无在飞请求的 active 节点仍在邻域内 | 通过 |
| TOPO-06 | `topology.test.ts`：路径尽头留空不跨分支；dangling-link / lineage-cycle / unknown-node 三种损坏分别抛 `TopologyError` | 通过 |
| TASK-01 | `tests/unit/tasks.test.ts`：非持有者结算被拒（`not-holder`）；重复结算被拒（`already-settled`）且首个结果保留 | 通过 |
| TASK-02 | `tasks.test.ts`：全部 Agent 空闲但任务仍 open，`openTasks` 非空 | 通过 |
| TASK-03 | `tasks.test.ts` + `mailbox.test.ts`：请求者 retired 后独立后代仍能结算，结果与证据保留、`requesterId` 不被改写、不复活请求者；投递不可达单独记为 `undeliverable` 并保留真实产出者与收件人 | 通过 |

### M2

| 编号 | 证据 | 结果 |
|---|---|---|
| AGENT-01 | `tests/integration/agent.test.ts`：真实模型工具调用完成 A→B→C，释放 B 的 handle 后 C 仍是 live agent 且能继续执行 | 通过 |
| AGENT-02 | `agent.test.ts`：host 与子节点实际 `GenerateOptions.tools` 名称集合逐项相同，9 个 ATN 工具都在；preset 绑定未验证 | 部分 |
| AGENT-03 | `agent.test.ts`：父实际 route 为 `atn-script/deterministic`，子节点记录的 `modelRoute` 同值（而非创建默认值） | 通过 |
| AGENT-04 | `lifecycle.test.ts`：pending 节点在 setup 完成前不可见（`provisioning`），失败创建释放槽位且留下 `creationState: 'failed'`；`runtime.spawn` 先持久化创建意图再创建 Agent | 通过 |
| AGENT-05 | `agent.test.ts`、`network.test.ts`：网络完成后 host 入口 Agent 仍在 registry 中且是同一实例；`releaseOwnedHandles` 跳过 `isEntry` | 通过 |
| AUTH-01 | 未完成（无受限策略装配） | 未完成 |
| AUTH-02 | 未完成（同上） | 未完成 |
| AUTH-03 | 未完成（同上） | 未完成 |
| AUTH-04 | `agent.test.ts`：B 伪造 `sender: 'node-1'` 仍无法结清 node-1 的任务，任务保持 open；`tools.ts` 的身份检查使用 `exec.agent` 与 live registry 比对 | 通过 |
| AUTH-05 | `agent.test.ts`：同伴消息正文含"用户批准"文字，落地后仍是 `source.kind = 'atn'`，子 Session 中 `user/message` 的 `source.kind = 'user'` 数量为 0，目标版本与提案数不变 | 通过 |
| AUTH-06 | `agent.test.ts`：同进程第二个非 ATN Session 的 `networkForSession` 为 undefined，其 ATN 工具调用被拒绝，网络节点数仍为 1，未产生额外节点 | 通过 |

### M3

| 编号 | 证据 | 结果 |
|---|---|---|
| MAIL-01 | `mailbox.test.ts`：入队后 `status='queued'` 且无投递步骤也持久存在；`pendingMails` 覆盖 queued-minus-confirmed | 通过 |
| MAIL-02 | `mailbox.test.ts`：重复 `markDelivered` 不新增行、不覆盖首次 `settledAt`；进程内重放用目标 inbox 内容比对避免重复插入（跨进程重启的重复插入限制见 1.2） | 部分 |
| MAIL-03 | `mailbox.test.ts`：并发入队保持确定顺序；每发送者待发上限超限抛 `LimitExceededError` 且不吞已接受消息；含 envelope 的超长消息被拒；同一稳定 id 去重 | 通过 |
| MAIL-04 | `network.test.ts`、`mailbox.test.ts`：queued / delivered / task completed 三态分别断言；投递不产生任务记录 | 通过 |
| MAIL-05 | `network.test.ts`（分支场景）：新增分支节点后旧提案冻结名单不变，`atn_peers` 的查询候选不改变审批资格 | 通过 |
| MAIL-06 | `lifecycle.test.ts`：draining 节点不接受新任务（新任务记录不产生）；`proposals.test.ts` 覆盖旧审议仍可投 | 通过 |
| VOTE-01 | `unit/proposals.test.ts`：四人名单三票仍 `pending`，第四票后恰好新增一个版本 | 通过 |
| VOTE-02 | `proposals.test.ts`：一票反对→`rejected`，文档仍为旧版本；超期→`expired`，迟到票被 `not-pending` 拒绝 | 通过 |
| VOTE-03 | `proposals.test.ts`：投票后改动拓扑/新分支仍不能把票移到别的提案，冻结名单不变 | 通过 |
| VOTE-04 | `proposals.test.ts`：draining 节点仍可投旧票、不能提新提案；补位节点不能投旧提案 | 通过 |
| VOTE-05 | `proposals.test.ts`：已 retired 的审批者的票仍被接受 | 通过 |
| VOTE-06 | `proposals.test.ts`：两份同 base 提案交错全票，只有一份提交，另一份 `stale`，版本只 +1 | 通过 |
| VOTE-07 | `proposals.test.ts`：同票重试不新增票/版本，改票抛 `already-voted-differently`；部分票保存在提案记录上 | 通过 |
| VOTE-08 | `proposals.test.ts`：最后一票前网络关闭 → `cancelled`，不产生新版本 | 通过 |
| CONTEXT-01 | `agent.test.ts`、`network.test.ts`：子节点 Session 中能读到实际使用的 `version=N` 与正文；`atnMessages` 从 `user/message` + `source.kind='atn'` 还原 | 通过 |
| CONTEXT-02 | 未实现专门用例 | 未完成 |
| CONTEXT-03 | `network.test.ts`：提交目标新版前后 B 的 model request 数不变（未唤醒）；B 下一次真实请求带 `version=2` | 通过 |

### M4

| 编号 | 证据 | 结果 |
|---|---|---|
| LIFE-01 | `lifecycle.test.ts`：同一节点完成第一个任务后仍 `active`，再完成第二个任务 | 通过 |
| LIFE-02 | `unit/lifecycle.test.ts`：draining 保留旧任务与已分配投票，`retireIfSettled` 只有在两者都结清后才转 `retired` 并清空租约；集成层见 LIFE-03 | 通过（单元） |
| LIFE-03 | `lifecycle.test.ts`：真实 `atn_finish` 工具调用正常返回（若等待自身销毁会挂死），节点转 `draining`、handle 仍被持有、未结任务被如实报告 | 通过 |
| LIFE-04 | `unit/lifecycle.test.ts`：已投票节点 `canRelease` 为真，不等待其他审批者 | 通过 |
| LIFE-05 | `lifecycle.test.ts`：注入时钟下 `leaseDeadlineAt = now + leaseMs`，推进 61s 后 `tick()` 转 draining；`RECOVER-01` 断言重启后 `stepsUsed` 不重置 | 通过 |
| LIFE-06 | 单次原子 `update` 保证顺序；无显式并发交错测试 | 部分 |
| RECOVER-01 | `lifecycle.test.ts`：销毁整个内核后用同一 store 重建，open 网络保留、retired 不复活、active 节点按 Session resume | 通过 |
| RECOVER-02 | `lifecycle.test.ts`：`creationState='pending'` 且无 Session 的节点恢复时明确 `fail` 并结算其任务，不重复发布 | 通过 |
| RECOVER-03 | `lifecycle.test.ts`：两次并发 `recover()` 共享同一次运行，每个 Session 至多一个 live agent | 通过 |
| STOP-01 | `lifecycle.test.ts`：`ctx.atn.stop(networkId, reason)` 宿主方法直接触发，不需要模型配合 | 通过 |
| STOP-02 | `lifecycle.test.ts`：停止后 `renew` 与 `spawn` 均被拒绝，网络保持 `stopped`，无新节点 | 通过 |
| STOP-03 | 未测试忙模型流期间的停止 | 未完成 |
| STOP-04 | `tests/fixtures/kernel.ts` 的 `withKernel` 在 `finally` 中 `ctx.fiber.dispose()`；测试通过 `agents.list()` 与 `handleFor` 断言 ATN handle 归零、入口 Agent 保留。未显式枚举 timer/子进程 | 部分 |
| LIMIT-01 | `unit/domain.test.ts`：draining 占驻留槽，retired 释放槽位但累计计数不减；`assertNodeCapacity` 分别报 `maxResidentNodes`/`maxTotalNodes` | 通过（单元） |
| LIMIT-02 | `unit/domain.test.ts` + `config.ts` 关系校验；`admitStep` 为 admitted step 计数并在超预算时 drain。无并发耗尽预算的集成用例 | 部分 |

### M5

| 编号 | 证据 | 结果 |
|---|---|---|
| PROFILE-01 | `smoke:profile`：真实 `dsh` CLI 在临时 `DSH_HOME` 中 `plugin --profile atn-smoke-atn add .artifacts/dsh-atn-0.1.0.tgz`，退出 0，manifest 的 `dsh.profile.bundles` 为 `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-headless, dsh-atn]` | 通过 |
| PROFILE-02 | `--dump-config` 出现 `# == dsh-atn` 层及 `atn` / `atn-tools` 两行；实际启动 `dsh --profile atn-smoke-atn noop` 停在 `MISSING_CREDENTIAL`（说明所有行都已 mount，没有任何导入/激活错误） | 通过 |
| PROFILE-03 | 未完成 | 未完成 |
| PROFILE-04 | 有/无 bundle 的两次 `--dump-config` 对比：96 个既有行的 id+name 完全一致，只新增 `atn`、`atn-tools`；profile 自己的 `cordis.patch.yml` 安装前后字节相同 | 通过 |
| DELIVERY-01 | `network.test.ts`：其他节点仍持有任务时 `atn_deliver` 被拒绝，网络保持 open，任务不被提前结清 | 通过 |
| DELIVERY-02 | `network.test.ts`：目标升到 v2 后，基于 v1 的交付被拒绝（`goalVersion` 不匹配），网络保持 open | 通过 |
| DELIVERY-03 | `network.test.ts`：满足门槛的交付成功 → 网络 `completed`、B/C handle 释放、host 入口仍能收到工具结果并继续 | 通过 |
| DOC-01 | README 的 build/pack/plugin add/dump-config 步骤与实际执行一致；命令不含本机绝对路径（smoke 脚本的 CLI 路径可用 `DSH_CLI` 覆盖） | 通过 |
| DOC-02 | README 说明兼容版本、单进程、权限范围、`stepBudget` 计量单位、数据位置、停止入口与未支持功能 | 通过 |
| DOC-03 | 无本地私密数据；链接均为仓库内相对路径，不依赖 `upstream/`；README 明确当前无 remote、未发布，未来仓库地址写作 `ff66ccff/dsh-ATN` 属于计划而非既成事实 | 通过 |

---

## 5. tarball 与 profile smoke

**产物**：`.artifacts/dsh-atn-0.1.0.tgz`，53 个文件。

```
cordis.patch.yml
package.json
README.md
LICENSE
NOTICE
lib/{index,runtime,tools,schema,domain,topology,tasks,mailbox,proposals,lifecycle,messages,config}.js
lib/*.d.ts
lib/*.js.map 与 lib/*.d.ts.map
```

不含：`node_modules`、`tests`、`src`、`prototype`、`upstream`、`.env`、`.claude`、任何临时 Harness home 或 Session 数据。

**smoke 的临时环境**：脚本在 `os.tmpdir()` 下 `mkdtemp('dsh-atn-profile-')` 建独立 `DSH_HOME`，把 `DSH_HOME` 只注入子进程环境，命令 stdin 关闭、单命令 180s 超时，结束后递归删除该目录。它不读用户凭据、不使用用户 profile，也不访问网络上的模型服务。启动步骤因临时 home 中没有 API key 而停在 `MISSING_CREDENTIAL`——这正是"行已全部 mount"的判据（若有导入或激活失败，启动器会先报错并退出）。

本机 `dsh` CLI 路径为 `D:\DeepSeekDesktop\resources\runtime\cli\bin\dsh.cmd`（DeepSeek Desktop 的 launcher，`0.2.0-rc.2`）。

---

## 6. 权限继承测试

**现状：没有可用证据。** 测试装配只挂载了 `LlmRuntime`、`SessionStore`、`SessionProjectionRegistry`、`SystemPrompt`、`ToolRuntime`、`AgentRegistry`、`JSONL` 持久化、`AgentLoop`、`Storage` + `json` backend + `StorageDomain`，**没有**挂载 `permissionPresets` 或 `sandboxPolicy`。

后果：`captureDelegatedPolicyOverrides(parent)`（`src/runtime.ts` 的 `spawn`，在第一个 `await` 之前调用）在 fixture 中返回 `{ permissionPreset: undefined, sandboxMode: undefined, approvalPolicy: undefined }`，`appendDelegatedPolicyOverrides` 因此不写入任何事件。所以：

- 没有"原策略 / 子策略"的实际对照；
- 没有"某个受限操作在真实执行路径上被拒绝"的案例；
- 没有"创建者后来放宽策略、恢复的子节点不跟着放宽"的案例。

代码里已按规格接上 helper 并在节点记录中保存 `permissionSeed`，但**这不足以声称 AUTH-01/02/03 通过**。补齐方式：新增一个显式受限的 fixture（挂载受限 `permissionPresets` 与 `sandboxPolicy`，或使用 base-backed profile），在其中断言子 Session 的 `sandbox/mode`、`approval/policy`、`permission/preset` 事件来自 `source: 'delegation'`，并让一个被父策略拒绝的工具调用在子节点上同样被拒绝。

已验证的相关项只有 AUTH-04 / AUTH-05 / AUTH-06（身份不可冒充、同伴文本不是人类授权、安装不影响其他 Session）。

---

## 7. 自动退出与重建测试

- **自动退出**：`tick()` 由插件启动的调度器按 `min(defaultLeaseMs, 1000)` 周期自动运行，不依赖外部驱动器调用 `settle()`。每轮执行 `expireProposals` → `expireLeases` → `retireSettledNodes` → 信箱重放 → 网络硬期限检查。注入时钟测试中，推进 61 秒后 `tick()` 把过期租约节点转为 `draining`，其旧任务保留、旧票仍可投；任务与票都结清后由 `retireIfSettled` 转 `retired` 并清空租约（单元层证据）。
- **旧审议**：draining 节点在 `VOTE-04`/`VOTE-05` 场景中仍能投旧票；`LIFE-04` 断言已投票节点不再被算作有义务。
- **当前拓扑**：draining/retired 被 `deriveNeighbourhood` 跳过，`creator_id` 与 `selected_child` 记录不被改写（TOPO-04 断言）。
- **资源清理**：`stop()` 先持久关闭入口、取消未完成提案、结算开放任务，再 `dispose()` 所有 ATN owned handle，`Promise.race` 10s 清理超时，返回 `{ released, stragglers }`；`releaseOwnedHandles` 明确跳过 `isEntry`。`network.test.ts` 断言交付完成后 B/C 的 `handleFor` 为 `undefined`，host 入口 Agent 仍是同一实例。
- **重建**：`RECOVER-01/02/03` 销毁整个内核后用同一 store 重建：open 网络保留、`stepsUsed` 不重置、retired 不复活、active 按 Session `resume`、`provisioning` 且无 Session 的节点明确 `fail` 并结算任务、并发 `recover()` 共享同一次运行且每个 Session 至多一个 live handle。

---

## 8. 与规格不同的实现选择

1. **`storageDomain` 用 `ctx.get('storageDomain')` 读取，而非声明 `inject`。** `inject` 会让没有该服务的 profile 中整个 ATN 行静默不激活；改为加载时可用、第一个操作时以 `storage-unavailable` 明确失败，符合"misconfiguration fails loud"。
2. **不新建 Cordis scope 的 `Scope` 用于创建 Agent。** `runtime` 用构造函数里捕获的插件上下文作为 owner，并用 `createScope(ctx, …)` 建立自己的注册作用域。这是为了让"每次 `this.ctx` 都可能被重新绑定到调用者"不会影响所有权：owner 是显式保存的字段。工具 handler 与生命周期回调都不作为 owner。
3. **`stepsUsed` 只统计 ATN 持有节点的 admitted step。** 入口节点是宿主所有，其步数不计入也不受预算拦截；README 与 `config.ts` 都写明该计数器不覆盖 provider 重试、辅助模型调用或宿主其它 Agent。
4. **`deliver` 只把"其他持有者的开放任务"当作阻塞。** 入口节点自己的本地任务正是该调用要结清的交付任务；其他节点的开放任务、pending 提案、未投递邮件都会拒绝完成。
5. **`MemoryNetworkStore` 是真实测试替身，不是 mock。** 它执行与持久实现相同的原子读改写，并可注入写失败，用来验证"失败写不改变内存状态"（STATE-02）。`ownsStore` 保证注入的 store 由调用者关闭。
6. **消息去重用目标 inbox 内容比对**（`alreadyQueued`），因为 Harness 的 `createMessage` 不接受调用者提供的 message id。这覆盖进程内重复投递；跨进程重启后若 Session 历史已含同一 ATN 消息，会再追加一条（已列入未完成项）。
7. **`recover()` 用"乐观尝试 resume、失败即 fail"代替静态的 session 存在性判断。** `SessionStore` 没有 `has`/`exists`，`get()` 只反映已加载会话，用它判断会把已持久化的 Session 误判为不存在。
8. **没有提供 CLI 停止子命令。** 停止入口是 `ctx.atn.stop(networkId, reason)` 宿主方法（验收项 STOP-01 明确接受"宿主方法/command"）。没有实现 Harness command registry 的接入。
9. **ID 使用普通 `string` 类型别名，未使用 `Branded`。** 上游建议跨边界的不透明 id 使用品牌类型；本版为控制改动范围保留字符串别名，在 README 与本节记录。
10. **`presetId` 恒为 `null`。** 未挂载 `agentPresets`，因此没有 `composeFrom`/`mount` 路径；没有 preset 时依赖 profile 原有全局工具配置，未实现"有 preset 却无法继承时必须失败"的分支。

开发中修复的问题（供 review 参考）：`storageDomain` 未 inject 导致工具全部报错；域名字符集不合法（`atn-networks` → `atn_networks`，必须匹配 `[a-z][a-z0-9_]*`）；恢复与 `atn_start` 并发打开同一域触发 `already-open`（改为单次 memo 化的 `openStore`）；`atn_spawn` 返回的是创建者的邻域而不是新节点的邻域。

---

## 9. Git 状态与发布确认

```
分支：prototype/atn-validation（与交接时相同，未切换、未 rebase）
remote：无
stash：无
git status --short：
 M README.md          （交接时已修改，本次由我更新为正式说明）
?? .gitignore ?? NOTICE ?? cordis.patch.yml ?? docs/ ?? package-lock.json
?? package.json ?? prototype/ ?? src/ ?? tests/ ?? tsconfig.build.json ?? tsconfig.json
```

- `prototype/` 与 `docs/` 是交接时已有的未跟踪内容，**未被删除或覆盖**；`docs/` 下新增的只有本报告。
- `upstream/` 被 `.gitignore` 忽略，全程只读，未修改。
- 未执行 `git reset`、`git clean`、`git checkout --`、`git stash`，也没有改写任何他人未提交的修改。
- `lib/`、`node_modules/`、`.artifacts/`、`prototype/.scratch/`、`.env`、`.claude/settings.local.json` 已加入 `.gitignore`，不会进入提交或发布包。
- **未创建 GitHub 仓库、未推送、未发布 npm 或 release，未开始 Claude review。** 所有变更留在工作区等待 review。
- profile 演练中曾因 PowerShell `$home` 只读变量导致 DSH_HOME 指向用户目录，意外在 `C:\Users\66ccff\profiles\atnsmoke` 创建了一个 profile；该目录（以及随后变空的 `C:\Users\66ccff\profiles`）已确认路径后删除，用户真实 `~/.dsh` 未被写入。此后所有演练都使用 `os.tmpdir()` 下的独立 home。

---

## 10. 建议 review 关注点

1. `src/runtime.ts` 的 owner 捕获与 `spawn`/`recover` 的两阶段（先持久化 intent，再发布）是否真的把创建/恢复从出生者 scope 解耦。
2. `proposals.ts` 的 `resolveProposal`：四个终态（rejected / expired / stale / cancelled）的判定顺序与"提交时再检查"是否覆盖 VOTE-08 与 VOTE-06 的竞争。
3. `deliver` 的完成门槛是否足够机械，以及入口节点自有任务豁免是否可接受。
4. `mailbox.ts` 的进程内去重是否够用，跨进程重启的重复插入是否需要在 MVP 内解决。
5. 第 1.2 节未完成项中，AUTH-01/02/03 与 PROFILE-03 是否必须在发布前补齐。
