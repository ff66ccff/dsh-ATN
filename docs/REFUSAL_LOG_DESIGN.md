# 拒绝日志设计稿（V2 阶段 5；未实现）

2026-10-17。输入为最终 14 出站通道、16 稳定公开拒绝码、可选读策略与舰队授权契约。当前仅有[观察期有界计数](FLEET_OBSERVATION_CONTRACT.md)，**没有持久 journal、合规日志或日志读取端点**。本文件不变更源码、domain 1 或 B-ATOMIC；未来实施须另开先红后绿轮次。

## 一致性模型、崩溃窗口与取舍

业务拒绝始终不提交消息、地址、权重、步数、任务/邮件或唤醒。日志追加与业务回滚是两个问题；不能为追加日志把拒绝变成一次成功业务写入。

| 选项 | 追加与回滚模型 | 崩溃窗口／故障语义 | 取舍 |
|---|---|---|---|
| 单存储事务 | 同一后端事务读取业务状态、决定拒绝，业务部分不变，仅追加独立审计记录 | 事务提交前崩溃无日志；提交后但错误响应前崩溃，日志存在而调用者可能重试。持久提交失败时拒绝仍成立，但不能声称已存证 | 只有后端提供独立审计命名空间与原子 batch 才能实施；现有 NetworkStore.update 只覆盖一网络记录，不能伪称具备跨存储事务。把 journal 塞进 NetworkRecord 会破坏当前整记录/写次数原子断言，故本轮不做 |
| 宿主 durable sink（建议优先研究） | 保持 ATN 业务回滚，在可信宿主的内容最小化适配器中追加独立持久 sink；响应可选择等 durable ack | 拒绝决定到 sink ack 前崩溃可能丢事件；sink 已落盘但 ack/响应丢失可重复追加。sink 不可用时业务仍拒绝，宿主必须标明审计不可用，不能放行业务或声称存证成功 | 不要求 ATN 存储跨域事务，可明确由宿主管理 durability、保留期和身份。仍不等于业务与 journal 原子一致，必须公开丢失/重复窗口；未来另测 ack、恢复与故障注入 |
| 显式丢失策略 | 拒绝后尽力投递有界队列，满队列/关闭/崩溃时允许丢弃；另有内容无关的 dropped 计数与健康告警 | 内存入队后到 durable flush 前均可丢；队列满直接丢。进程崩溃连 dropped 计数也可能丢 | 适用于运营遥测，不能当审计证据。必须显式选择并展示易失/丢失；现有舰队计数属于此类遥测的更窄实现，没有事件队列 |

目前不替用户选择持久存储产品、事务 API 或保留期。建议下一轮研究宿主 durable sink，并由部署方明确选“等待 ack 仍允许崩溃窗口”还是“显式 best effort”。没有经过故障注入前不得宣称 at-least-once，更不能宣称 exactly-once。下述严格五字段不提供幂等事件 ID；时间与计数也不是唯一键。若未来要求去重，须另评审存储侧幂等 token/索引或修订允许字段，不能暗加正文/散列。

## JSON Lines 格式与内容最小化

每行恰好以下五字段。schema 版本、网络分区和保留期是宿主 sink 配置，不混入载荷；一份 stream 的分区归属由可信宿主 registry 绑定，不能由模型输入指定。示例为虚构主体，无业务文本：

```json
{"channel":"publish","refusalCode":"ref-unresolved","principalId":"host-principal-opaque-17","timestamp":"2026-10-17T02:00:00.000+08:00","count":1}
```

| 字段 | 约束／来源 | 理由 |
|---|---|---|
| channel | 下列 14 出站通道或明确列出的读取 action，固定枚举 | 不把任意工具名、地址或用户文本当通道 |
| refusalCode | 下列 16 稳定码、明确的网关拒绝码，其他归一为 other | 不能记录宿主在 error.code 中夹带的载荷 |
| principalId | 宿主认证后建立的稳定不透明主体句柄；未绑定时 null | 不采集自报 role/sender；禁止凭据、姓名、session 历史或任意模型字符串。主体句柄仍属受限运营数据 |
| timestamp | 可信宿主时间，带时区的 RFC3339；拒绝决定时间 | 不把请求提供时间当权威；不承诺跨主机全序；不用于性能收益推断 |
| count | 正整数，1..65535；单事件为 1，显式批次可聚合 | 有界；饱和或拆批必须由 sink 契约说明，不能静默推导精确总次数 |

**绝不允许**被拒内容、任何载荷片段、错误 message/stack、消息正文、task/artifact/msg 地址、refs、目标网络/会话文本、原始 RPC 参数、凭据、prompt 或输入散列进入日志。散列仍可成为已知文本猜测与关联通道，故不以“只存 hash”绕过内容最小化。禁止任意扩展字段；无权限/未知目标使用相同投影。身份映射失败也不得回退到用户给的 ID。

现有 `CustodyPolicyOptions.onRefusal` 会收到完整 record/input/error，**不能直接接日志序列化器**。未来 sink 适配器只接收经过固定枚举、主体 registry 与 schema 投影的五字段，且不得保留原对象或引用。策略故障文本不能转成 refusalCode；归 other 并通过独立内容无关健康信号报告。

## 最终通道与拒绝词汇

14 个出站通道按公开顺序逐一列出：`start`、`spawn`、`send.task`、`send.note`、`send.result`、`status.review`、`status.claim`、`status.rewire`、`finish.node`、`finish.network`、`propose`、`vote`、`renew`、`publish`。不添加“通用 text”逃逸通道。

独立读取 action：`atnSubstrate/read`（宿主映射节点）、`atnObserver/snapshot`、`atnObserver/metadata`、`atnObserver/fleet`（真实 Peer）。它们不是新的出站通道或模型工具。visit 不可见/不存在必须同为 ref-unresolved，日志也不得多一个“隐藏存在”标记；同一输入地址不入日志。

| 稳定公开拒绝码 | 最终语义／锚点 |
|---|---|
| `evidence-not-owned` | 宿主识别的 artifact 声明未持有；14 通道 held/unheld 与传输字段套件 |
| `not-task-holder` | 宿主参考协议中的非任务持有人事实请求；reference-policy 测试 |
| `metadata-only` | 参考协议配置限制载荷；reference-policy 测试 |
| `fact-requests-and-owner-results-only` | 参考协议只许事实请求与所有者结果；reference-policy 测试 |
| `extra-transport-fields` | 参考协议拒绝非允许的传输字段；reference-policy 测试 |
| `invalid-fact-request` | 参考协议事实请求格式无效；reference-policy 测试 |
| `fixed-edge-required` | 参考协议要求冻结边；reference-policy 测试 |
| `invalid-setup-receipt` | 参考协议 setup 回执无效；reference-policy 测试 |
| `invalid-owner-result` | 参考协议所有者结果不满足约束；reference-policy 测试 |
| `async-policy` | 同步决策点收到异步值；出站准入或读策略都拒绝 |
| `ref-unresolved` | 引用未知/未来 msg 或 task；读策略下不可见 msg 与未知完全同码同措辞 |
| `ref-not-owned` | 已装 custody，artifact 不在真实保管集合 |
| `ref-not-visible` | task 引用对发布者不可见；不会用它标记隐藏 msg |
| `rationale-missing-ref` | rationale 未精确点名声明引用 |
| `custody-unavailable` | artifact 无策略；或读策略抛错/无效。策略缺省关闭仍是全读，不产生此码 |
| `substrate-full` | 容量满原子拒绝，不驱逐已有消息 |

网关读取拒绝明确归 `remote-access/denied`。其他网关参数/codec 失败与非稳定运行时/宿主码先归 `other`，不得自动采集原始未知码。16 稳定码的顺序和名称由 BOUNDARY-CONTRACT 与 portable conformance 冻结；八个协议专属码不伪装成所有宿主都有相同触发条件。

## ownership、读取权与舰队计数的区别

日志是可信宿主资产，按宿主管理的 stream 分区存储。网络不因拥有 networkId、模型角色、邻接、权重或消息作者身份取得 journal 的 ownership。宿主负责主体假名映射、访问撤销、保留期、加密/完整性与删除策略；本设计不认证这些外部系统，也不提供法律合规结论。

未来远程读取必须复用同一 principal/resource/action，建议**另设** `atn-refusal-log` stream 资源与 `atnRefusalLog/read` action，缺省不授予。这只是设计名称，尚未注册、导出或实施。fleet/index、fleet 网络绑定、snapshot/metadata 和 node substrate 授权均不隐式授予日志；授予前必须核验整个 stream 的运营元数据可向该主体披露。未知或未授权 stream 的拒绝必须不可区分，授权先于存在性查找。

舰队计数是观察服务存活期、每桶最多 65535、最多 64 网络的易失累计量；它没有时间序列、主体、通道逐事件、持久性、重放或完整性保证。日志设计允许按事件/批次固定五字段追加；两者即使拒绝码同名也不能相减推导精确丢失率、合规覆盖率或模型成本。日志 sink 故障不应污染/回滚已决定的业务拒绝，更不能触发模型唤醒。

## B-REFUSAL-LOG：未来实施的可引用判据

判定问题：新增拒绝记录是否只含固定五字段，能否由日志反推出被拒内容/目标存在性，业务拒绝原子性与审计 durability 的边界是否在故障时仍与所选模型一致？权限是否独立于舰队与会话别名？

当前锚点是阶段 5 文档审计（14/16 最终词汇、双向引用、无源码 diff）与 FLEET-COUNTERS 的内容无关有界遥测。它们只证明设计/现状边界，**不证明尚不存在的日志实现**。未来实现前必须先添加并留红灯：额外字段与载荷/错误文本注入、假 principal、未知/未授权 stream、sink 拒绝/队列满/提交前后崩溃/重复重试、业务快照/邮件/唤醒不变；再实现与故障注入。现有测试不能替代这些持久日志测试。

本判据在 [威胁模型](THREAT_MODEL.md) 与 [通道审计](information-boundary/OUTBOUND_CHANNEL_AUDIT.md) 双向引用；实际计数口径另见 [舰队契约](FLEET_OBSERVATION_CONTRACT.md)。
