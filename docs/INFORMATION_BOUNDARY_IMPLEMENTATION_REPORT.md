# 0.5.0 信息边界产品化实施报告

实施日期：2026-10-08。依据：[开发方案](INFORMATION_BOUNDARY_PRODUCT_PLAN.md)。`causalClaim=false`。

本次把宿主 artifact custody 检查接入完整出站路径，删除白板自由正文与 Agent 自报知识接口，并保留从真实保管集合派生的发现能力。源码和本地 tarball 版本为 **0.5.0**；工具面由 6 个减为 5 个。已发布的 0.4.1 和历史研究结果不改写。本次没有付费模型调用，不提出性能收益主张。

## 修复前记录

在任何产品实现修改之前，提交 `7133c42`（`test: record information boundary bypasses before repair`）保存两条原始失败测试及实验策略基线。

- [原始 TAP](information-boundary/pre-fix-failures.tap)：`review.summary` 搬运未持有文档与白板虚报发现元数据均得到 `Missing expected rejection`；退出码 1，2 tests / 0 pass / 2 fail。
- [失败记录说明](information-boundary/PRE_FIX_RECORD.md)：记录源代码基线及复现命令。
- [策略迁移前](information-boundary/binding-before.json)、[迁移后](information-boundary/binding-after.json)：同一零模型调用脚本生成的八个拒绝案例及完整有序记录，逐项深度比较。

修复前失败来自缺失的宿主约束，不是编译、导入或测试基础设施故障。原始测试仍可在该提交查看；当前回归测试改为断言五工具面与宿主保管元数据。

## 产品实现

`defineCustodyPolicy({ custody, extractClaims })` 从包根导出。`custody` 是真实持有者注册表，`extractClaims` 是宿主协议的完整输入解析器；工厂检查所有识别出的 artifact id，未持有时抛出 `AtnRefusal('evidence-not-owned', ...)`。同一 custody 还为发现生成 `documents/topics`，可选 `describeArtifact` 提供宿主目录标签；Agent 不拥有元数据写接口。

`installOutboundPolicy(networkId, policy)` 返回可重复调用的 disposer。`*` 策略可以在创建网络前安装，全局和网络策略均执行；`AtnRuntimeDeps.outboundPolicy` 支持在构造、自动恢复及 Agent 启动之前设置全局策略。策略和回调不序列化为可执行代码，宿主须在重启恢复前重新安装。

原 `installSendPolicy` 保留为弃用的邮件兼容入口，不是完整信息边界。已有拒绝码名称和实验验证顺序保持；公开词汇表导出为 `INFORMATION_BOUNDARY_REFUSAL_CODES`。新增 `async-policy`，防止 Promise 被当成同步准入成功。

完整通道审计见 [OUTBOUND_CHANNEL_AUDIT.md](information-boundary/OUTBOUND_CHANNEL_AUDIT.md)。显式登记 13 条路径：

| 路径组 | 登记通道 |
|---|---|
| 创建 | `start`、`spawn` |
| 邮件 | `send.task`、`send.note`、`send.result` |
| 状态写入口 | `status.review`、`status.claim`、`status.rewire` |
| 完成 | `finish.node`、`finish.network` |
| 保留的宿主 API | `propose`、`vote`、`renew` |

准入检查接收完整业务输入，包括 evidence、spawn context、messageId、dependsOn、retryOf 等可选字段；先检查，再分配 ID、入队、创建 Agent 或写入任务/评价/拓扑。最终交付的网络回执更新与业务写入也在通过策略的同一事务内完成；会话中原有输入回执不携带被拒绝内容。幂等重试仍重新检查当前 custody。

白板模块、schema、运行时 `board/publishKnowledge`、公开白板输入类型与 `atn_board` 工具均已删除。加载旧记录时显式丢弃白板字段，其余未知字段仍拒绝。旧知识没有 `source: 'host-custody'` 标记时，不作为真实保管声明。`knowledgeFingerprint` 保留为宿主快照；发现查询优先使用当前 custody，展示上限为 16 项、每项 160 字符，不截断用于准入的完整保管集合。

构建前清空项目内生成目录 `lib`，避免旧构建遗留的 `whiteboard.js/d.ts/map` 混入 0.5.0 tarball；清理脚本校验目标在项目根目录内。

## 边界保证与限制

保证成立的前提是宿主正确维护 custody，且 extractClaims 完整识别实际协议中的保管声明。安装策略后，已登记的 ATN 出站业务写入须通过同步宿主检查；Agent 不能自行发布或修改保管元数据。工厂不自行识别任意自然语言中的事实，也没有增加接收者隐私控制。

与保证并列的四条限制：

- **不防推导**：合法信息推出的新结论可以传递；边界管 artifact 身份，不管信息量。
- **不防侧信道**：时间、消息长度、交互次数和拒绝码可能传递信息。
- **不防合谋**：各自合法持有者可以在保管规则允许的范围内交换信息。
- **只在网络内有效**：策略约束 ATN 出站操作，不约束 Agent 直接调用宿主的其他能力。

README 提供安装方式、同样并列的限制与[可运行示例](../examples/information-boundary.ts)。示例验证合法请求/结果、原子拒绝和无白板发现，使用测试宿主且无需真实模型凭据。

## 回归与实验迁移

新增测试手写 13 条通道清单，每条都尝试洗数据，断言策略调用、网络快照、持久化写次数、Agent 数和模型请求数。另覆盖 review/result evidence、spawn context、可选运输字段、实际拓扑修复后的新边、setup 回执、发现元数据伪造、撤销 custody 后的幂等重试及异步策略拒绝。

独立 AST 审计测试固定公开运行时方法分类，以及五个工具的字段、嵌套写入口、kind/scope。新增未登记 API、工具或字段会失败；测试实际插入这些变更，验证漂移检测有效。`atn_board` 不存在的断言同时覆盖工具 schema 和真实模型调用。

`experiments/topology-binding-access.ts` 已改用工厂。原邮件域验证先执行，以保留拒绝优先级；八个迁移前后案例和有序记录一致。新增非邮件覆盖，不把原任务结果的合法 provenance 引用当成评价者自己的保管声明。现有 setup 夹带与固定边检查继续拒绝。

知识发现、身份/权限、评价来源隔离、质量排序、恢复、无额外唤醒和五工具可见性等原有测试保留并迁移到宿主元数据。确定性 shifting-evidence 脚本改用实际邮件/状态结果，不读取 oracle；仍检查精确阶段结果和原预算。遥测、成本和 observer 移除活白板读写；历史输出形状与历史解释脚本保留以便读取旧结果，当前参考报告明确 `sharedBoard=false`，旧 no-board 标签不再表示有效的白板消融。拓扑和评价算法未更改。

## 随功能删除的测试：逐条清单

仅删除四个白板专用测试文件的 16 个测试；每项原因如下。完整机器可读名称见 [removed-tests.json](information-boundary/removed-tests.json)。其他测试未因迁移而删除。

| 原文件 | 原测试名称 | 删除原因 |
|---|---|---|
| `tests/unit/whiteboard.test.ts` | legacy empty boards read as metered durable state without changing nodes, mail, tasks or steps | 白板读取与计量删除；旧记录丢弃白板由升级测试覆盖。 |
| 同上 | publication persists authenticated authorship, immutable creation time and exact successful byte accounting | 发布、作者及正文计量已删除。 |
| 同上 | only authors may mutate existing keys and stale revisions never replace newer or recreated entries | 白板修改与 revision 已删除。 |
| 同上 | entry-count capacity refuses additional keys but allows own replacement and deliberate removal | 白板容量、替换和删除已删除。 |
| 同上 | UTF-8 entry and global live-byte limits are enforced before committing | 白板正文及 live-byte 限额已删除。 |
| 同上 | read pagination respects item and byte bounds, preserves order and meters every successful page | 白板分页读取与读取计量已删除。 |
| 同上 | search uses keys, topics and body while cursors reject writes or different filters | 白板正文搜索与 cursor 已删除；宿主发现排序仍有原有测试。 |
| 同上 | invalid payloads, spoofed fields and unavailable callers leave state unchanged | 白板接口已删除；工具不存在与元数据伪造拒绝另有集成覆盖。 |
| 同上 | durable boundary rejects duplicate keys, invalid generations and oversized payloads | 白板 durable schema 已删除；旧记录升级另有覆盖。 |
| `tests/unit/whiteboard-cost.test.ts` | BOARD-COST-01: repeated and stale snapshots cannot reset or double-count cumulative usage | 活白板累计计量删除；其他 ATN 成本测试保留。 |
| 同上 | BOARD-COST-02: independent networks add once and empty reads charge their array payload | 白板读取成本删除；其他网络/邮件计量保留。 |
| `tests/integration/whiteboard.test.ts` | BOARD-01: real tool publication derives author identity and refuses foreign mutation or outsider access | 模型白板发布接口删除；身份与权限测试保留。 |
| 同上 | BOARD-02: publishing, reading and removing create no mail, driver calls or peer steps | 三种白板操作删除；宿主元数据无额外唤醒测试保留。 |
| 同上 | BOARD-03: concurrent compare-and-swap writes cannot lose updates or successful read accounting | 白板 CAS 与读取计量删除；网络事务回归保留。 |
| 同上 | BOARD-04: entries, monotonic revisions and metering survive cold recovery | 白板状态删除；宿主知识快照冷恢复测试保留。 |
| `tests/integration/whiteboard-telemetry.test.ts` | BOARD-TELEMETRY-01: live publish/read/remove exports only counters, charges empty reads and preserves totals | 活白板事件删除；宿主来源知识遥测与隐私断言保留。 |

## 第 5 轮证据重新表述

第 5 轮“真实 `evidence-not-owned` 拦截 = 0”**弱于当时报告的证据表述**。它只说明没有观察到邮件洗数据。提示约束同时提到 board bodies，但白板正文没有宿主强制；走白板不会被该策略拦截，**该通道的行为合规性从未被这项结果检验过**。

结构可达性、零模型调用的构造性参考结论不受影响。研究线“未发现协调机制性能收益”的结论不受影响。本次补足信息边界，属于信任属性；既不追认旧行为合规性，也不提出性能收益。历史报告保持原样，README 与本报告明确缩小该证据的范围；全部 `causalClaim=false`。

## 验收记录

所有命令退出码均为 0，无 skipped/cancelled 测试。机器可读记录和证据哈希见 [validation.json](information-boundary/validation.json)。

| 必需命令 | 实际结果 |
|---|---|
| `npm test` | 服务端/实验 542 / 542 通过，客户端 8 / 8 通过。 |
| `npm run typecheck` | 主项目与客户端测试 TypeScript 检查通过。 |
| `npm run build` | 清洁构建通过，生成目录没有白板模块。 |
| `npm run pack:tarball` | 生成 `.artifacts/dsh-atn-0.5.0.tgz`，102 个文件。实际 tar 内容无白板模块，包含新策略与拒绝码声明。 |
| `npm run smoke:profile` | 真实隔离 Web Profile 安装、bundle 合成、工具可见性、子节点创建通过；183 条原配置及用户 patch 未变化。 |

此外，编译后的包根能够导入 custody 工厂、13 通道清单与公开拒绝码；仓库示例成功验证合法 note/result、原子 review 拒绝和宿主发现。八个实验拒绝案例及有序记录完全一致，`git diff --check` 通过。

本地包 SHA-1：`7987d3a1316e2a1b88415df2dbfb153ead9312cf`。本轮只构建和安装临时验收 Profile，未发布 npm 版本。
