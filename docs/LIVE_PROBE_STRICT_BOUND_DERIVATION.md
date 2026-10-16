# 探针严格下界推导与恢复运行条件（2026-10-15）

本文件承接 [第 7.2 条停止报告](LIVE_PROBE_FEASIBILITY_IMPLEMENTATION_REPORT.md)。用户随后明确要求“推导一下严格下界之后再跑实验”，据此恢复前提推导、延迟口径实测、规划门与真实批次。旧停止报告和旧归档不改写。

## 结论及量词

对冻结的 revision-2、8 节点、链长 2、checkpoint-only 的每个 seed：

- **完全不加信息来源假设的下界只有至少 1 个模型响应。**任意模型可能猜中、硬编码或事先知道有限 fixture 的答案。验证器只看提交内容，不要求其证明获取过程；因此不能声称任意正确字符串都至少花 10 次调用。
- **在合法因果取证假设下，严格必要下界为至少 10 次模型调用，最大单节点步数至少 2。**这是必要下界，不是紧确最小值，也不是充足预算。实际运行包含请求、发现、转发、过期副本交叉检查、评分和空闲调用，通常多于该值。
- 60/8 继续只表示已知确定性参考策略的记账。它既不是上述下界，也没有被证明与真实模型调用一一对应。

原 5 个 seed 的下界由 [deriveProbeLowerBound](../experiments/live-probe-feasibility.ts) 从实际任务结构计算并验证；不依赖模型输出或联网。结果见恢复批次的 `feasibility.json`。

## 假设与证明

假设限定为模型从广告中的本地 `read_evidence` 工具和实际 directed mail 取得隐藏 proof，不猜测、不硬编码、不使用外部 fixture、隐藏 oracle 或训练中碰巧知道的答案。该假设是“正常取证求解”的前提，不是生产运行时已经强制了模型语义。

1. 从公开 root 依次沿当前事实的 next 指针确定每阶段的两个当前事实。生成器将阶段 1 的这两个事实放在 owners[0]、owners[1]，阶段 2 放在 owners[3]、owners[4]；owners 是槽位 2–6 的排列。故两阶段共有 **4 个互不相同且不是入口的当前持有者**。代码实测逐 seed 检查所有者数量、唯一性和非入口性，不满足时拒绝套用此证明。
2. 模型没有初始隐藏 proof；元数据发现不暴露 proof、next 或 terminal。每个当前持有者必须至少生成一次读取工具的响应，从自己的 ACL 内获得所需当前事实。当前 phase 的本地读取不会暴露未来 phase；过期副本不提供当前版本的新 proof。
3. 同一模型响应中的所有工具参数在工具结果被返回给模型之前已经生成。即使该响应批量调用多个工具，也不能让后一个 tool-call 参数因果依赖前一个工具尚未返回的隐藏 proof。因此每个持有者传回该证据至少需要**另一次**模型响应。允许转发或一次传多个事实不会消除这两个响应。
4. 四个持有者互不相同，故这些响应至少为 **4 × 2 = 8** 次，不能跨所有者合并为一次调用。
5. 入口独占 checkpoint 提交权限，并且不在上述四个持有者中。入口必须先收到当前证据，再生成对应 checkpoint。阶段 2 证据只在阶段 1 checkpoint 后可读取；合法因果取证不能在生成阶段 1 checkpoint 的同一个响应中已经知道未来阶段 2 的当前证据。因此入口至少还需要 **2** 次响应。
6. 相加得 **N ≥ 8 + 2 = 10**。每个必需持有者至少经过读取和返回两次决策，入口也至少经过两次 checkpoint 决策，故 **maxNodeSteps ≥ 2**。

证明不把工具数当作模型调用数，不要求每次响应只能发一个工具。它省略额外协议操作，所以是偏松的必要下界，不宣称能以 10 次完成。这也不能用来证明步数 12 或调用上限 96 足够。

## 延迟实测及时间下界的限制

使用原封不动的 `installTelemetry` 和真实 Harness `llm/stream` waterfall，构造两个必然排队的零网络 attempt，单 provider 并发 1：

| attempt | 进入 | 派发 | provider settle | kernel settle | 排队 | 服务 | 收尾 | 总时长 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 100 | 100 | 0 | 100 | 0 | 100 |
| 2 | 10 | 100 | 200 | 200 | 90 | 100 | 0 | 190 |

时间单位为测试逻辑时钟毫秒。两段服务不重叠，服务合计 200；旧 `metrics.totals.modelDurationMs=290`，等于逐 attempt 的含排队总时长之和，超过 200 ms 墙钟。逐项断言 `queue + service + cleanup = total`，无舍入。另有队列取消用例断言未派发、服务为 0、总时长全为排队。

因此旧口径确定为：**对遥测关闭前已 settle 的 `llm/stream` attempt 累加生命周期，包含派发前等待／准备和收尾；成功、失败、取消都可计入。**关闭后才 settle 的 attempt 不回填；未 settle 调用不能当作零耗时或完整观测。876033 ms 不能读作单次服务时间。

新增 [live-probe-timing.ts](../experiments/live-probe-timing.ts) 记录 entered、dispatch、provider settle、kernel settle 四个时刻。`queueMs` 包含 provider 派发前的准备／解析和槽位排队，不冒充纯 FIFO 等待。服务时长为实际调用 provider 流到 iterator settle；收尾为随后到内核 wrapper settle。内容不包含 prompts、completions 或凭据。

**时间严格下界不能从历史均值推出。**在明确假定每次服务至少为 L 的情形，可推出工作量条件 `T ≥ 10L / concurrency`；历史均值不是这样的硬下界。本轮没有宣称 120 秒数学不可能完成。

## 历史延迟与独立规划门

从旧 AGY `provider-calls.jsonl` 逐 call 配对 dispatch.at 与 finish.at，取得 **71 个未取消的成功 finish 区间**，均值 **8143.309859 ms**，向上取整为 **8144 ms**作为显式输入。排除 5 个取消区间，因为它们为右删失观测；没有使用 120 秒除以派发数。来源文件 SHA-256 与样本计数一起保存。

可比性仅限同一 provider／模型／medium／输出 4096 的历史插件批次。幸存调用均值有选择偏差；未来负载、长调用及准备／收尾可能更慢。它不是新批次保证。此选择不需要额外标定，新增标定调用为 0。

规划门把参考计数作为工程先验，显式附加余量，独立于严格下界：

```text
plannedCalls = max(10, ceil(60 × 1.125)) = 68
plannedMaxNodeSteps = max(2, ceil(8 × 1.125)) = 9
requiredDeadlineMs = ceil(68 × 8144 / 1 + 30000) = 583792
```

12.5% 是预先声明的模型动作规划余量，30000 ms 是宿主、准备及工具开销预留；两者都不是通过样本拟合得到的充分性定理。门的结论为 `admitted-under-assumptions`／`not-admitted-under-assumptions`，避免把工程拒绝冒充数学不可行。

| 对照 | 步数 | 调用上限 | 调度判定 |
| --- | --- | --- | --- |
| 上一批 120000 ms、并发 1 | 12 ≥ 9，余 3 | 96 ≥ 68，余 28 | 期限少 463792 ms，拒绝规划准入 |
| 期限恰为 583792 ms | 同上 | 同上 | 边界可准入 |
| 固定 120000 ms，以并发为调整轴 | 同上 | 同上 | 需要 ceil(553792 / 90000)=7，并发 1 不足 |
| 新冻结 600000 ms、并发 1 | 同上 | 同上 | 多 16208 ms，可准入 |

期限与并发是相同工作量不等式中的可替代调整轴。仅靠算术不能识别“唯一物理原因”；边界对照中的 `schedulingRemedy` 明确表示选定的调整策略。实际新批次只选期限，不同时增加并发。并发推算还假设槽位能充分利用，忽略因果链导致的闲置，不能自动当作并发 7 一定足够。

## 实验边界与复核

新批次保持 agy / dsh-agy@0.4.4 / gemini-3.8-flash-tiered / medium，seed 17/31/45/59/73，8 节点、链长 2、每节点 12、调用上限 96、输出 4096、已观测 token 阈值 400000、checkpoint-only、provider 并发 1。**只将期限 120000 改为 600000 ms。**历史五臂的 48/384/600 秒与本批仍是不同条件。

`src/`、旧 telemetry 和固定的 37 个源码文件不改动；新度量放在独立模块。新入口在加载 provider／读取账号之前运行门，所有 seed 前再次检查旧源码与新扩展源码哈希；新源身份单独留档，不重写旧 `sourceHashes`。缺少延迟来源、路由不符或门拒绝时不会执行 provider mount。真实运行使用插件自带账号读取路径，不直接 HTTP 推理。

命令：

```text
node --import tsx/esm --test tests/unit/live-probe-feasibility.test.ts tests/integration/live-probe-timing.test.ts
node --import tsx/esm scripts/live-probe-feasibility.ts
node --import tsx/esm scripts/run-live-probe-agy.ts                 # 离线预览，不读账号
node --import tsx/esm scripts/run-live-probe-agy.ts --execute       # 门先于真实 provider 装载
```

指定真实批次结果另见 [恢复实施报告](LIVE_PROBE_RESUMED_IMPLEMENTATION_REPORT.md)。通过门后失败仍可能暴露规划过于乐观：例如动作数超出先验余量、单节点步数先耗尽、服务变慢或协议停滞。必须逐 seed 如实记录，不换 seed、模型或临时放宽预算来追求通过。
