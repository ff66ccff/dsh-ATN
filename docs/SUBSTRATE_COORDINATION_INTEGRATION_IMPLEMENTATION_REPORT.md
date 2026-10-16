# Substrate 协作面引入实施报告（2026-10-16）

前置适配独立提交 `80ef94b`，其 alpha.4 / sidebar 0.26.1 八项命令全绿后才开始本阶段。没有真实模型或付费调用，没有重开等预算研究。工作区既有未提交探针工作保留；本轮开工实测为 569 项 runtime/集成 + 14 项 UI，不能用早期 551 数字代替。

## 实现结果

默认八工具；原六条行为规则逐字保留，增加两条 substrate 规则，涵盖先搜后写、引用所有用过的消息并说明贡献、用未来检索措辞写 sub_task、边做边发布中间产物四项规范。身份只来自 requireCaller(ctx,exec)，不从参数读取作者。三工具不是第二套调度器；不新增轮次、角色或预算。

- src/substrate.ts：只追加消息、单调 msg 地址、三类引用准入、完整 UTF-8 信封计数、容量拒绝、原子 search/visit 投影、消息证据闭包；不提供编辑/删除 API。
- src/substrate-ranking.ts：NFKC + Unicode 字母数字分词 + CJK 字符二元组，整数 BM25、消息引文权重、惰性逐步衰减与从消息历史重放。无 Math、浮点 literal、时钟或新增依赖。
- schema.ts/config.ts：九项配置与默认值、关系校验、可选严格 substrate 段、独立计数与权重缓存；domain 仍 1。旧记录不因加载添加字段；只有显式 substrate 调用才新建段。沿用既有 Schemastery Config（不是另造一份配置解析器）。
- runtime.ts：publish 在原 mutation 队列内校验并调用第 14 条 admitOutbound；artifact 引用使用 knowledgePolicy 的同一个 CustodyResolver。读取计量与写入分开；终态只读归档（包括排队读取碰到关闭时不提交）。
- observer-types/schema.ts + observer.ts + 原 NetworkView：复用一个 tab 与顶栏回退，观察消息子任务、权重、引用/被引数、容量、步纪元与交付消息闭包。列表最多 128 条、文字最多 512 字符，任务链最多 200 条，每链 128 地址并标截断。作者和权重只在宿主／观察面投影；模型 search/visit 无这些元数据。完整四字段、作者、引用/被引、权重和任务证据链由宿主 `await ctx.atn.exportSubstrate(networkId)` 导出为 JSON；该宿主 API 不注册为模型工具。

配置：substrateEnabled=true，maxSubstrateMessages=128，maxSubstrateMessageBytes=2048，maxSubstrateTotalBytes=131072，substrateSearchResults=8（1–16），substrateVisitLimit=8（1–16），substrateRefsPerMessage=32（1–32），substrateCitationWeight=true，substrateCitersShown=8（1–8）。消息与总容量均可配置，满则 substrate-full，绝不驱逐。关闭权重不创建 weights 字段，排序退化为同一 tie-break 的纯 BM25；关闭整个 substrate 不注册三个工具并恢复原六规则。

## 准入与边界

消息必须包含非空 sub_task/artifact/rationale；仅接受四个公开输入字段，未知字段拒绝。UTF-8 上限包含 address/authorId/publishedEpoch 等完整持久信封。msg 必须已存在且早于本次地址；task 必须存在且作者为 holder/requester；artifact 必须存在于真实保管集合，无解析器时 custody-unavailable。理由逐条按精确 token 点名引用；msg:1 不匹配 msg:10 或路径前缀。通过所有这些检查后调用宿主出站策略；任何异常不写消息、不分配地址、不改权重、步数或事件。模型工具本身使用已被准入的当前步骤；拒绝工具不退还此前已经发生的步骤准入。

新增公开冻结拒绝码恰为 ref-unresolved、ref-not-owned、ref-not-visible、rationale-missing-ref、custody-unavailable、substrate-full。旧十码、原 13 通道顺序不变，publish 追加为第 14 条。单消息／查询字节超限沿用 LimitExceededError 的 bound 分类，非法输入走严格 schema；不另扩张公开冻结词表。send.result / finish.network 对 msg: evidence 在原策略和既有任务／交付阻塞验证之后计算并验证消息闭包；普通历史 evidence 字符串形状不改。宿主导出对旧未解析 msg 根显式列 unresolved，避免旧任意字符串证据破坏观察。

brief 4.3 的“无重复”与 7.1 的“重复引用去重”字面不一致：准入遵循更严格的 4.3，重复 refs 整条拒绝（不消耗地址）；权重更新和重放同时用 Set 防御性保证同一发布一次引用最多贡献一次。未放宽任何既有出站检查。

## 有界读取与计量口径

模型返回 `{messages:[{address,sub_task,artifact,rationale,refs,citedBy}]}`。refs 是先前消息／任务／资源的地址，citedBy 是最近最多 8 条被引地址；不递归内联整张图，以保持本次 k 条上界，追读另用 visit。search 只排 Rel>0；空命中正常返回 []；并列按更早地址。visit 任一地址未解析整调用拒绝，连读取计量都不写。

每条消息持久信封最多 B 字节，地址是安全整数（msg 前缀 + 最多 16 位十进制），citedBy 最多 8 条。模型结果保守界为 `14 + k*(B+256)` UTF-8 字节；默认 k=8、B=2048 时为 **18,446** 字节，与节点数和 store 当前规模无关。该界是响应载荷，不包括查询／HTTP 信封，也不代表输入 token。配置 k/B 改变时此界随之改变。测试对满 k 返回实际 UTF-8 字节作断言。

持久 metrics 分列 publishCalls/publishedBytes 与 readCalls/readMessages/readBytes。publishedBytes 只计成功追加的完整消息信封，readBytes 计成功模型读取返回的 JSON 信封。没有与邮件字节混合的总账，不是 Provider token/费用；权重缓存与网络 JSON 的存储开销不冒称这些载荷字节。归档读取保持只读，因此不再写入读取计数。宿主 observer/export 读取不计模型 search/visit 的读次数。

## 固定上下文实测

| 条件 | 规则 bytes | 工具 schema bytes | 合计 bytes |
|---|---:|---:|---:|
| alpha.4 前置适配（五工具） | 1161 | 4749 | 5910 |
| substrate 默认八工具 | 1837 | 6119 | 7956 |
| substrateEnabled=false | 1161 | 4749 | 5910 |

新增单工具 JSON schema：publish=699、search=305、visit=363 字节；加上数组分隔符，schema 总增量 1370；规则增量 676；合计增量 2046。固定上下文闸门由 <7160 有意改为 <8500，工具精确清单改为八个，规则上限改为八条，显式禁 publish 的正则仅移除 publish，保留禁用 feedback/rewire 旧工具。inventory 同步工具字段／公开 API 分类／十六码；洗数据手写清单新增 publish。先跑红灯，后实现，未删除旧测试或减弱其他断言。agent/preset/profile/peer-rules 的五工具／六行断言同步新默认，关闭分支新增精确旧基线断言。历史实验装配显式 substrateEnabled=false 保持五工具条件，不把已有实验结果变成新机制证据。

## 整数算术与偏差

SCALE=1,000,000。权重增量 3/10、衰减 49/50，整数向下取整；每次衰减按真实 stepsUsed 差值逐步 floor，非浮点幂近似。权重到零后停止循环，因此大纪元差也有界。消息发布纪元、权重缓存与 network.stepsUsed 持久保存，读取时惰性折算，不为纪元推进写额外记录。

fixedLn 先用 2 的幂范围缩减到 [1,2)，用 z=(x-1)/(x+1) 的 atanh 级数 64 项；内部精度 10^24，ln2 截断常数 693147180559945309417232/10^24。z≤1/3，级数尾小于内部精度；安全整数计数范围内缩放输出误差保守小于两个固定单位（2×10^-6）。9,901 个单调性样本实测最大绝对偏差 **9.99955×10^-7**。

BM25 k1=3/2、b=3/4 使用精确整数变形：每词项 `idf * 20*tf*sumDl / (8*tf*sumDl + 3*sumDl + 9*dl*N)`。idf 输入比为 (2N+2)/(2df+1)。每个词项在 ln 量化误差加截断余项下的误差保守 <4×10^-6，Q 个去重词项累加 <4Q×10^-6；128 种语料规模、两词查询实测最大 **4.50212×10^-6**，小于 7×10^-6。复合比较使用 `weight*maxRel + Rel*SCALE`，等价于缩放后的论文公式；只处理正相关项。

每次权重操作舍入误差 <1/SCALE，最弱收缩为 49/50，因此任意增量／衰减序列相对理想实数递推的保守绝对误差 <50/SCALE=0.00005。100,000 步样本实测最大 **0.0000180864**。偏差界不意味着实数近似下的近分并列顺序必然相同；承诺是这套整数规则的确定性重放。float 仅出现在测试／numeric-audit.ts 的独立参考中，生产 ranking 模块的 AST 审计拒绝 Math/浮点 literal/时钟。

## 重放与零模型证据

`node --import tsx/esm scripts/replay-substrate.ts` 记录真实 runtime search 的返回，再读取严格持久记录，仅从消息及 publishedEpoch 重建权重缓存并重算排名，JSON 逐字节相同。见 replay-record.json、replay-result.json、replay-output.txt；结果 byteIdentical=true。初始网络构建发出 2 次本地脚本适配器请求，substrate 过程额外请求=0，外部模型请求=0；不把脚本适配器 setup 写成“没有任何请求”。

测试覆盖：三类引用、未来/不可见/未持有/无 custody、逐条理由缺失、精确 token 与重复 refs、超限（含完整 UTF-8 信封）、容量满不驱逐、并发唯一地址、磁盘失败与宿主策略拒绝原子性、纯拉取不写其他 Agent 输入/邮件/请求、模型响应元数据隔离、退休/失败后的消息、孤儿认领追读、链式与分叉证据闭包、实际 domain-v1 冷加载（含无 substrate/无新 limits 的旧记录）、整数排序/重放/关闭权重、旧五工具回退、严格观察面 schema 与 UI 共用分区。冷恢复夹具初期误用了 create 已存在会话，已改用真实 resume 并等待原恢复过程完成；没有改动运行时恢复语义去迎合测试。

### 执行结果

最终 npm ci、typecheck、npm test、build、pack:tarball、smoke:profile、smoke:visualization 全部退出 0；额外 verify:sidebar 与 render:screenshot 也退出 0。588 项 runtime/集成 + 15 项 UI，零失败／零跳过（相对开工增加 19 + 1）。测试驱动使用本地脚本适配器，外部／付费模型调用为零。

最终打包的 alpha.4 Web profile 实际执行 publish/search/visit，子节点继承八工具，原 Standard 模式隔离与 profile 188 行保留验证通过。visualization 先跑普通 smoke，再以 ATN_VISUAL_PREVIEW=1 保留真实页面；最终预览也正常退出 0。浏览器从未分组真实会话打开顶栏“ATN 网络状态”，看到共享 Substrate 两条消息、容量 374/131072、引文权重随 stepsUsed 衰减、引用/被引计数与原节点表；见 real-browser.png。它是实际安装包页面，区别于 docs/assets 的示例数据图。浏览器预览在检查后通过 visualization-stop 正常清理；没有留运行服务器。

完整 provider host 联合激活仍未验证，未以回退浏览器截图冒充第三方侧栏联合验收。

证据目录：[substrate-2026-10-16](execution-evidence/substrate-2026-10-16/)。red-gates.tap 是三个既有闸门有意变更后的原始红灯（4 失败），red-substrate.tap 是新增模块缺失时红灯，red-ui.txt 是新增分区缺失时红灯。core.tap 是包括新用例与三处闸门的全绿 TAP；test.txt 是 npm test 全量输出。未把旧证据重写为新版通过。

## 与论文的七项偏离（逐条核验）

| # | 偏离 | 实现一致性与依据 |
|---|---|---|
| 1 | 纪元为已准入模型步，非同步群体步 | 一致；publishedEpoch/weight.epoch 来自 record.stepsUsed，admitStep 仍为唯一步准入，无额外轮次。 |
| 2 | 增加 custody/任务可见性准入 | 一致；复用知识发现同一 CustodyResolver，三类 ref 测试。 |
| 3 | 保留点对点工具 | 一致；原 13 通道及发送／换边／评价回归保持，模型默认八工具。 |
| 4 | UTF-8 字节替代 tokens | 一致；utf8Bytes 计算完整持久信封，独立容量／响应字节界。 |
| 5 | 定点整数 | 一致；BigInt BM25/ln/权重，持久缓存为安全整数，偏差与 AST 审计如上。 |
| 6 | CJK 字符二元组 | 一致；混合中英、标点、全半角、大小写测试；不声称检索质量。 |
| 7 | 无策略拒绝 artifact ref | 一致；custody-unavailable 原子拒绝，有策略但未持有为 ref-not-owned。 |

## 战略红线原文留档

以下三节依 brief 要求原样保留决策文本。它们的“可核验”只指本报告明确列出的结构/存在性/可见性/保管/点名检查，不等于正文真实性或语义贡献已核验。

### 2.2 与 0.5.0 白板移除的关系（必须写进报告）

0.5.0 删除白板的理由是**不可核验**：自由正文可夹带任意事实，agent 可自报虚假发现元数据，宿主无从判定。substrate 与它的差别是结构性的，不是措辞上的：

| 维度 | 已删除的白板 | 本轮 substrate |
|---|---|---|
| 载荷形状 | 自由文本 | 严格四字段 + 引用集合，schema 逐字段校验 |
| 写入准入 | 仅作者权限与版本号 | 引用必须存在／必须可见／资源引用必须真实持有；理由必须点名每条引用 |
| 排序 | 作者与调用顺序 | 确定性排序：只排正相关，权重不能顶起无关消息 |
| 质量信号 | 无 | 引用权重：行为派生、会衰减、不展示、不授予任何权限 |
| 自报元数据 | 可用白板虚报专长（0.5.0 修复前失败留档见 `docs/information-boundary/PRE_FIX_RECORD.md`） | **不改变**发现路径：`atn_status` 的文档/主题仍由宿主 custody + descriptor 反向派生（`src/knowledge.ts:40`） |
| 读有界性 | 8 条 / 16 KiB | 最多 k 条消息、每条独立字节上限、每次调用独立上限 |
| 容量行为 | 满则明确拒绝，不静默驱逐 | 沿用：满则拒绝（`substrate-full`），**不得**驱逐或覆盖既有消息 |

结论：substrate 是白板的**结构性继承者**，并且把白板最大的漏洞（写入不可核验）焊死在准入规则与保管层上。

### 3.1 对"不再设计中心仲裁、白板公告"的核对

- **不引入中心仲裁**：substrate 没有协调者、没有调度者、没有轮次；运行时不为任何节点分配角色或工作。
- **"白板公告"的字面禁令针对的是 0.5.0 删除的那一类**（自由文本、可虚报、不可核验）。substrate 的写入是**确定性可判定**的（第 2.2 节表），因此它落在该禁令想要排除的缺陷之外；但**这是对既有决定的一次有意修订**，必须在 `DECLARATION_AUDIT.md`、`OUTBOUND_CHANNEL_AUDIT.md` 与实施报告中显式声明"0.5.0 的发布禁令在本轮被有据地、受限地解除"，不得静默改测试。
- 该修订**只解除"结构化可核验发布"**，不恢复自由正文通道、不恢复 agent 自报知识接口。

### 3.2 对"不再加声誉算法"的核对

引用权重与"声誉算法"必须被严格区分，并把区分写进文档：

| 属性 | 声誉算法（被禁） | 引用权重（本轮引入） |
|---|---|---|
| 作用对象 | **节点／agent** | **单条消息** |
| 用途 | 影响信任、选择、授权 | 只在一个查询的相关结果内部**重排** |
| 来源 | 评分／评价聚合 | 行为派生：被后来的消息引用即上升，无人引用即衰减 |
| 是否展示 | 通常是公开的社交信号 | **永不向模型展示**（论文明确规则） |
| 是否授予权限 | 通常影响谁能做什么 | **不授予任何权限**；不参与 `rewire`、不参与 custody、不参与认领 |
| 能否放大无关信息 | — | **不能**：只排正相关消息 |
| 可关闭性 | — | `substrateCitationWeight=false` 可整体关闭 |


## 声明、许可与未验证边界

README、ADAPTIVE_TOPOLOGY、OUTBOUND_CHANNEL_AUDIT、DECLARATION_AUDIT、STRATEGY_AND_POSITIONING 与索引同步八工具／十四通道／发布禁令修订／消息权重边界。NOTICE 引用本地论文 arXiv:2610.16120v1（CC BY 4.0）及作者，说明机制改编与独立实现来源；软件 LICENSE 仍为原 Apache-2.0，不改写标准许可文本。没有复制论文实现代码，没有新增运行时依赖。

真实模型会不会正确使用 substrate、任务正确率／效率／吞吐／成本／延迟、CJK 检索质量、语义贡献核验与任意自然语言泄漏防护，均**未验证且不主张**。论文的基准数字不迁移；本轮与论文有上述七项偏离，等预算线保持收束。当前代码验证的是网络内部结构与宿主策略，不是网络即认证租户。完整 better-sidebar provider host 激活仍因 webRuntime 缺失未验证，未打补丁；真实浏览器验收使用可用的顶栏回退。

### 额外同步性修复与优先级复核

最终全量复跑曾触发 BOUNDARY-ADMISSION 原有测试竞态：驱动 idle 后，一封已接收邮件的异步持久回执仍可从 queued 变为 delivered。失败原始输出保存在 boundary-receipt-race-before-barrier.txt。测试现在在取拒绝基线前逐封调用真实 deliverMail 并断言 delivered，完整网络相等断言不变；十轮完整 information-boundary 文件回归通过（boundary-barrier-repeat-*.tap）。未改变生产邮件或恢复机制。新增 SUBSTRATE-PRIORITY 实测 not-holder 和既有交付 blockers 先于新 msg: 引用错误，保持原 13 通道拒绝优先级。

浏览器 preview 先前持续发送演示邮件，约 64 步后目标正常退休而触发动画换边拒绝（preview-budget-exhaustion.txt）。仅改预览夹具：达到真实步数／生命周期界后保持只读页面，不再演示发信；不放宽运行时预算或重新激活节点。普通 smoke 流程不受影响。
