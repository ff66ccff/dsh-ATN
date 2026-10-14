# D：下一轮范围决策记录

日期：2026-10-14；输入为 A/B/C 报告、B 的逐 seed 工件及统一声明审计。D 是事实核查与范围决策，**没有实施新安全机制、CI、舰队面板或审计存储**。已直接修正 ROADMAP_NEXT_DIRECTIONS 对当前代码的错误主张。

## 事实核查

| 路线图位置与判断 | 核查结论 | 当前证据与修正 |
|---|---|---|
| 基线542+8、旧Harness | 已过期 | 当前551 runtime/集成+14UI；Harness alpha.2，Cordis4.0.5-alpha.1；A/C闸门输出 |
| §0/1 动态B已经让全部旧结构证明失效；第5轮是唯一证据 | 错误，已修正 | B五seed两种配置0翻转；显式二边冻结，八节点wide仍四；另有topology-binding-proof/参考执行与测试，不代表任意规模或任务质量 |
| §2 缺形式化威胁模型 | 仍成立 | OUTBOUND_CHANNEL_AUDIT列通道，README列不防项；没有独立对手/宿主信任与读取授权模型，应锚定实际13通道测试 |
| §3 三个宿主策略接入点存在 | 仍成立但不完整 | information-boundary.ts同时有validate/onRefusal；策略opt-in，extractClaims决定可识别语法，无法从有限测试证明任意自然语言提取完备 |
| §3 现有测试全针对单一内置策略；外部只能凭信心 | 错误，已修正 | integration/information-boundary已用多种自定义extractor覆盖13通道、可选字段、异步策略拒绝、撤销/重试；缺口是独立可分发套件/公开判据 |
| §4 按networkId串行分区 | 仍成立 | schema/network原子存储与review-regressions REVIEW-02；分区不是认证租户身份 |
| §4 完全无跨网络验证，大概率纯计算即可宣布网络即租户 | 错误，已修正 | REVIEW-02明确同号nodeId跨网独立停止；nodeId/taskId是局部ID，foreign引用及live caller绑定/observer授权需不同测试，不能一概字符串拒绝 |
| §5 拒绝无任何日志，必须新增出口 | 错误，已修正 | defineCustodyPolicy:51,80已有同步onRefusal，携带完整operation。NetworkRecord回滚不等于宿主/Session无事件；尚无标准durable sink完整性契约 |
| §5 外部日志同一临界区即可原子追加；日志证明无任何未持有数据传输 | 不成立，已修正 | 跨存储原子性需要事务/outbox或明示故障窗口；日志也是读取面，raw operation可能含被拒内容；只可声明有限claim/通道覆盖下的拦截证据 |
| §6 完整better-sidebar已联合工作 | 过强，已修正 | C客户端注册、真实service、回退通过；0.26.0完整host pending webRuntime，不能据此立刻承诺舰队面板。observer只有单session有界窗口 |
| §7 升级门有价值 | 仍成立并提前 | A普通npm prerelease冲突、旧CLI拒绝和C真实激活pending是具体回归，不是预想风险；24篇guide核对可复用 |
| §7 宣称next支持，alpha永不阻塞 | 无依据，已修正 | 当前peer精确alpha.2，未测试next；精确声明版本须阻断发布，新版本探测可不阻断 |
| §8 终态NetworkRecord可完整重导拒绝序列并验证不可篡改，风险低 | 错误，已修正 | schema没有拒绝journal；binding-before/after是受控测试生成。完整重放需输入/策略/授权历史，抗篡改需可信密码学锚点，不能由快照推得 |
| §9 不做复杂协作/速度吞吐/更聪明拓扑 | 仍成立 | STRATEGY §2.2两条高压线与十一轮阴性结果，无本轮新证据推翻 |
| §10 先验证现有能力，再考虑rich custody/真实权限集成 | 仍成立，补充前提 | TTL/委托/Topology-as-ACL须共享授权模型；目前只能核验宿主识别的artifact ID，不是完整RBAC产品 |

## P0 结构复核的收口

| seed | 冻结ring（旧→新上限） | 默认八节点wide（旧→新上限） | 结论/比较资格翻转 |
|---|---|---|---|
|17|2→2，unreachable保持|4→4，unreachable保持|无|
|31|2→2，unreachable保持|4→4，unreachable保持|无|
|45|2→2，unreachable保持|4→4，unreachable保持|无|
|59|2→2，unreachable保持|4→4，unreachable保持|无|
|73|2→2，unreachable保持|4→4，unreachable保持|无|

翻转集合为空；B以多数≥3/5为停止阈值，实际0/5，不回退/调整曲线。完整哈希及判据见 [B-proofs-after.json](execution-evidence/B-proofs-after.json)，可重跑 `node --import tsx/esm scripts/compare-degree-proofs.ts`，零模型调用。wide.requiredDirectEdgeCount=4且exceedsStaticDegree=false，**不能**推成所有四边静态策略必不可能；历史ring的二边资格保持。

既有重导本轮已经完成，不将其重复排为下一轮P0。N=16/32等新默认规模在增加对应产品声明或比较前，按相同fixture生成器、静态策略、实际累计N与冻结/动态参数重新绑定哈希；允许出现可达seed，将其退出该结构比较，不能通过调低预算/偷偷冻结参数保住旧叙事。当前不宣传一般大规模拓扑收益。

## 选定的下一轮范围

1. **威胁模型及公开声明边界先收口。** 对手能控制节点文本/传输可选字段；宿主custody/extractor/存储/认证属于明确的可信边界；把网络外工具、推理衍生、合谋/侧信道、observer读取权限逐项列出。每项锚定13通道、live身份、原子回滚测试，并提供新功能是否越界的判定问题。现在先做，因为D实测发现语义泄漏与网络即租户两类过强承诺，新增舰队/委托会扩大未定义读取和授权面。
2. **可独立运行的宿主custody一致性套件。** 仅用公开API和宿主声明的claim语法，覆盖拥有/未拥有、全部13通道、嵌套/可选字段、异步拒绝、撤销后重试、拒绝后网络/配额/派发不变，给可读契约失败原因。包含故意遗漏字段的负例，确保套件能检出不合格实现；不能宣称证明任意语义提取完备。现在先于TTL/委托，因为现有自定义测试已有可复用锚点，却没有企业宿主可带走的判据。
3. **跨网络引用绑定与observer读取授权验证。** 补nodeId/taskId重名、message/artifact宿主命名空间、真实live sender混用、foreign引用及两个认证主体读不同session的集成矩阵；将网络隔离与宿主租户映射分别报告，发现路径先留失败记录再修。现在先于舰队，因为REVIEW-02只证明停止隔离，snapshot(sessionId)本身没有ATN租户principal校验。身份绑定需要真实运行路径，不能只做纯计算枚举。
4. **精确Harness与可选provider兼容发布门。** 复用ci/typecheck/test/pack/profile smoke；支持alpha.2必须阻断。optional服务absent/present及published API赋值/真实registry检查成为客户端门；完整provider安装/host激活/browser单列支持状态，等待上游迁移后再扩展兼容声明。现在先于广泛版本矩阵，因为A/C已经发生可重现失败；旧provider被选中却pending的情况不能靠安装退出码检测。

以上是下一轮建议实施范围，本轮只给决策和验收边界，不把新代码提前混入D。拒绝日志仅允许先形成设计说明（分类、内容最小化、ownership、durable sink失败/崩溃窗口）；待边界/套件通过后另立实施brief。

## 暂不选的项与遗漏

- 不新增中心仲裁、白板回归、声誉、复杂投票来追求协作涌现；越过§2.2第一条高压线。不做对单Agent速度/吞吐优势实验；越过第二条。动态额度只解决规模匹配，没有质量优势证据。
- 舰队聚合暂缓：没有跨租户读取授权证明，当前快照无durable拒绝计数，全链路provider尚未激活。先明确运营主体读取资格再设计产品。
- 全生命周期确定性重放/不可篡改证明暂缓：终态快照不具备输入journal或密码学可信锚点；先定义有限可验证状态，再研究审计存证。
- TTL/委托/可转让保管与真实RLS/OAuth底座集成暂缓：先验证现有策略契约和撤销语义，避免把宽泛权限术语包装成已实现能力。
- 32节点结构实验不作为紧急回滚工作：当前五seed无翻转；在新大规模声明前条件触发，不篡改旧实验参数。

路线图遗漏的实际缺口：可选插件**安装、注册API、完整激活**是三个不同契约，C只前两层客户端通过；consumer-owned类型投影需要published API漂移门。另有observer窗口截断导致提交统计不能冒称完整履约率/孤儿资格；未来需host只读聚合契约，保留零模型请求条件。A旧基线KNOWLEDGE-02的后台邮件竞争已有日志，应在后续隔离性测试强化settle锚点而不是弱化状态不变断言；目标矩阵当前通过。

完整provider上游修复、未来的安全套件/授权门、真实付费模型及大规模结构补证均未在本轮实施。此记录不将它们列为已通过。
