# 2026-10-04：免费模型与 Muse 真实调用测试

本轮通过 dsh 已安装的 `dsh-opencode-go@0.1.20` 和 Harness `0.2.0-rc.2` 内核实际调用模型。3 次可调用性预检全部通过；随后固定参数执行 15 次正式对照，9 次答案通过。**主动 `atn_rewire` 调用和实际主动换边均为 0**，本轮仍不能支持拓扑收益结论。

## 执行范围与方法

仅调用实时目录确认免费的 `space-bunny-free`、`longcat-2.5-preview-free`，以及用户明确允许的 `muse-spark-1.3-contributor`。Muse 的目录费率不为零，但在本轮授权范围内。没有调用 DeepSeek 或其他付费模型，没有更改账户隐私设置。CLI 和直接 `runPilot` 入口均增加免费/Muse 范围检查，默认模型改为 `space-bunny-free`。

这是实际 provider 调用的内核实验，不是脚本模型，也不是桌面 UI/CLI profile 安装测试。使用仓库外的既有 DPAPI 凭据，由包装脚本临时传入进程。公开输入只有合成题目，模型不具备 shell、文件系统或网络读取工具，无法读取 oracle。

所有正式运行使用 `ledger-reconciliation`，每模型五种模式各一次；最多 3 个 Agent、全网 16 次模型调用、每调用 3,072 输出 token、80,000 已观测总 token 准入阈值、180 秒期限。模式顺序按模型轮换。预检只有单 Agent，上限 8 次调用、120 秒，独立保存，不并入正式通过率，也不以预检成功替换正式失败。

正式执行命令：

```powershell
.\scripts\run-pilot.ps1 -PilotArguments @(
  '--execute',
  '--models', 'space-bunny-free,longcat-2.5-preview-free,muse-spark-1.3-contributor',
  '--tasks', 'ledger-reconciliation',
  '--calls', '16', '--agents', '3', '--output-tokens', '3072',
  '--observed-tokens', '80000', '--timeout-ms', '180000',
  '--out', '.artifacts/experiments/pilot-free-muse-matrix-20261004'
)
```

上列产物目录已存在，runner 会拒绝覆盖；重跑应使用新的 `--out`。这是一轮相同资源上限的比较，实际消耗不同，不是严格成本匹配的统计实验。

## 正式结果

| 模型 | 模式 | 答案验收/失败类别 | 调用数 | Agent 数 | 已知总 token | 秒 |
|---|---|---|---:|---:|---:|---:|
| Space Bunny Free | 单 Agent | 通过 | 2 | 1 | 3,430 | 8.1 |
| Space Bunny Free | 独立候选合成 | 通过 | 6 | 3 | 9,999 | 19.7 |
| Space Bunny Free | 原生 Team | 调用触限，未提交；另有 TRANSPORT 错误 | 16 | 3 | ≥56,024* | 78.0 |
| Space Bunny Free | ATN 禁主动重连 | token 观测触限，未提交 | 15 | 2 | ≥83,560* | 52.2 |
| Space Bunny Free | ATN 自适应 | 答案通过，协作未收尾 | 12 | 2 | ≥70,168* | 88.0 |
| LongCat 2.5 Preview Free | 单 Agent | 已提交，事实检查失败 | 2 | 1 | 4,691 | 31.5 |
| LongCat 2.5 Preview Free | 独立候选合成 | 通过 | 3 | 3 | 7,369 | 58.4 |
| LongCat 2.5 Preview Free | 原生 Team | provider TIMEOUT，静默无提交 | 5 | 2 | ≥16,926* | 125.6 |
| LongCat 2.5 Preview Free | ATN 禁主动重连 | 第一次输出截断，未建网 | 1 | 1 | 6,685 | 57.6 |
| LongCat 2.5 Preview Free | ATN 自适应 | 第一次输出截断，未建网 | 1 | 1 | 6,656 | 62.8 |
| Muse Spark 1.3 Contributor | 单 Agent | 通过 | 2 | 1 | 5,354 | 15.1 |
| Muse Spark 1.3 Contributor | 独立候选合成 | 通过 | 4 | 3 | 10,012 | 16.4 |
| Muse Spark 1.3 Contributor | 原生 Team 配置 | 通过，但未实际组队 | 1 | 1 | 4,149 | 9.9 |
| Muse Spark 1.3 Contributor | ATN 禁主动重连 | 通过，单节点协议完成 | 6 | 1 | 40,672 | 23.6 |
| Muse Spark 1.3 Contributor | ATN 自适应 | 通过，单节点协议完成 | 5 | 1 | 30,369 | 19.9 |

每个带星号样本均有一次请求缺失总 token，包括被取消时尚未获得完整 usage 的情况。耗时包含清理。80,000 是观测准入阈值，在途调用可使实际值超过阈值，不能把 83,560 写成精确硬限内运行。

按模型计：Space Bunny 3/5、LongCat 1/5、Muse 5/5。Muse 的原生 Team 配置只调用了 `submit_answer`；其两次 ATN 都只创建入口节点，执行 `atn_start → atn_send(result) → atn_deliver` 后以最终文本提交 JSON。这说明本题可由单节点完成，不能把这些通过算作多 Agent 协作优势。

## 失败与协议状态

- **Space Bunny 原生 Team**：创建了两名成员，累计 16 次调用后触限；期间一次 `TRANSPORT` 错误导致成员重做读取。虽然未结任务与 queued 邮件为零，但没有最终提交。任务板为空表示它通过成员消息协作，不能据此认为完成了答案交付。
- **Space Bunny 禁重连 ATN**：入口与一名子节点完成多轮读取、状态查询和通信；调用了 5 次 `atn_peers`、1 次 `atn_tasks`、1 次 `atn_renew`。子任务已有提交，停止时仍有 1 个 open 任务、1 封 queued 邮件，最终触及 token 阈值。该样本暴露出明显协调开销，没有发生工具参数错误。
- **Space Bunny 自适应 ATN**：答案正确，但停止时网络仍 open，有 1 个 open 任务、2 封 queued 邮件和 2 个活动 Agent；没有调用 `atn_deliver`。不能把宿主 `submit_answer` 接受和外部答案验收等同于 ATN 正常结清。
- **LongCat 单 Agent**：余额与去重 id 正确，但 `excludedEventIds` 只给出 `e5`，漏掉按类型排除的 authorization 事件 `e3`，事实检查得分 0.75，因此整体不通过。此前预检通过不改变这条正式失败。
- **LongCat 两次 ATN**：输出都达到 3,072 token，轮次以 `max-tokens` 结束；没有任何工具调用，也没有 ATN 网络。最终文本提取以 `turn-not-completed` 拒绝。不能从这两个样本推断多节点协作或重连的表现。
- **Muse 两次 ATN**：网络 completed，未结任务、queued 邮件、待审提案和停止时活动 Agent 均为零。完成的是单节点协议，未创建子节点。

全部 18 次运行的清理均为 `released`，没有遥测写入失败、观察异常或关闭时未结束的模型计量。模型 usage 仍存在上述缺失项，两者不可混为一谈。

## 本轮没有验证到的机制

三种模型均未调用 `atn_rewire` 或 `atn_propose`，没有实际治理提案，也没有主动换边。此 runner 没有安装在线 `ctx.atn.verifyTask` 检查器，oracle 只在最终提交后评分。因此记录的子任务仍为 submitted/unverified，宿主任务验收通过数为零。

本轮验证了真实模型可调用性、新工具集下的基本协议行为、全网预算和可复查测量；**没有验证在线任务验收、依赖放行或 verified-improvement 重连的真实模型链路**。这些机制的正确性仍由[上一阶段确定性回归](VERIFIED_COLLABORATION.md)支持，不能用本轮答案通过率补作机制证据。

下一实验门应先加入任务特定的在线检查器，以及有阶段变化、分散信息和跨分支依赖的任务；同时提供低开销等待路径，避免模型靠连续状态查询消耗预算。应将明确要求执行某动作的协议测试与自主拓扑对照分开记录，并配禁重连、随机重连及同预算对照。当前每模式只有一次运行，既不能排名普遍能力，也不能进行因果归因。

## 预检、用量与复查

预检分别为：Space Bunny 3 次调用、5,029 token、22.6 秒；LongCat 1 次调用、3,736 token、56.5 秒；Muse 2 次调用、5,104 token、10.6 秒。三者均提交正确答案，所有失败正式样本仍保留。

预检加正式批次合计 87 次可观测模型调用、≥369,933 已知总 token，4 次调用缺失总 usage。按实时目录费率估算，Muse 六次运行合计约 0.005697 美元，两个免费模型目录费率为零；这些数字不是订阅扣款、实际账单或账户额度消耗。

- [结构化汇总](../experiments/results/pilot-free-muse-20261004.json)：18 次运行、通过/失败、调用与用量、工具次数、协议状态及每份 report 的 SHA-256。
- 正式完整记录：`.artifacts/experiments/pilot-free-muse-matrix-20261004/`。
- 预检完整记录：`.artifacts/experiments/pilot-free-muse-preflight-20261004/`。
- 两批 `source-snapshot/` 保存与运行 manifest 哈希一致的源码和 lockfile；生成汇总时逐文件验证，未在推理期间修改这些源码。

执行范围回归及全项目检查通过：`npm run typecheck`、`npm test`（267 项运行时/单元/集成，加 8 项前端，共 275 项）、`npm run build`。
