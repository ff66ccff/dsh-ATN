# 等预算基准实施记录（2026-10-07）

对应 [第 9 轮实施说明](EQUAL_BUDGET_BENCHMARK_BRIEF.md)。统计结果由 [四臂报告](EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT.md) 和 [统计 JSON](../experiments/results/equal-budget-report-20261007.json) 记录；此文件记录实现与工程验证。全部 `causalClaim=false`。

最终状态：56/56 次真实运行已完成并保留，四臂各 14 次，均为 0/14 精确通过；全部运行完整性检查通过。[逐运行结果](../experiments/results/equal-budget-runs-20261007.json)与[完整性及失败诊断](../experiments/results/equal-budget-integrity-20261007.json)已保存。频繁输出截断和未达到预设规模参考线使本轮不足以判断协作收益；没有将全失败写成等效或 ATN 优势。55 次无提交的审计通过不代表正向交付成功，唯一有正向来源证据的提交也未通过答案校验。

## 已实现

- 在既有 `runPilot` 中增加显式等预算入口，保留旧 pilot 与拓扑运行路径。没有新增模型工具或修改 ATN 核心机制。
- `single` 配置 1×512；其他三臂配置 16×32，总预算均为 512 次可见模型调用。独立池包含 15 个候选和 1 个合并入口，入口的 32 步已包含在总额内。未创建节点的额度不能被其他节点借用。
- 预算在调用 adapter 前同步预留；逐 Agent 配额、全局准入、实测调用和未用配额分别落盘。该上限不是 token、隐藏 HTTP 重试或费用上限。
- 8 个独立账本分片，每片 40 个订单；25 份真实整数账务文档。每个分片独立完成事件去重、截止边界、授权排除和带版本审核纠正，最终必须合并四个账户余额与总计。所有臂可读取全部文档，提示仅列文档索引，不使用拓扑 ACL，允许传递事实。
- 精确宿主校验不反馈正确答案给模型。零调用参考解只检查配置可解性：单入口串行读取并提交需 26 步，ATN 加初始化共 27 步；每臂均不超过其入口配额。参考解不计为第五个对照臂。
- 真实读文档、ATN 邮件、白板读取、status 结果、native 邮件和独立候选交付均执行正向事实流审计。证据必须在发送前获得并实际交付；只列文档 ID、通信连通或发送后补读不能证明来源。按实际提交值审计，错误答案不会因此被当作非法来源。无法还原的转发明确保留审计缺口。
- 独占批次锁阻止并发重复执行。预注册和结果保存 SHA256；每个样本前核验代码、任务与预算。已尝试样本不重新运行；中断样本保留失败及未知消耗。清理未完成时停止后续推理。
- 报告提供 Wilson 正确率区间、配对正确率差、墙钟中位数与四分位、中位数区间、每运行和每智能体峰值、已知/未知 token、协议量与失败消耗；全部六个臂对和未观察到的差异均列出。

## 预注册

冻结时间：2026-10-07 14:08:11（Asia/Shanghai）。[完整设计](../experiments/results/equal-budget-design-20261007.json) 与 [14 个 seed 的四臂可解性证据](../experiments/results/equal-budget-reference-20261007.json) 已落盘，先于任何本轮真实推理。

模型为 `deepseek-v4.1-flash`，使用现有 `dsh-opencode-go` 路由。seed 为 2026100701–2026100714，控制 fixture，不能视为服务商采样随机种子。逐 seed 配对运行，臂顺序循环轮换；不按结果选择或替换样本。每次运行 600000 ms，单调用输出上限 8192，已观察 token 准入阈值 8000000；所有臂相同。

目录报告的模型上下文上限为 1000000。约 97 KB 的任务证据不保证达到 single 峰值输入的半上限参考线，报告必须据实检查规模。遥测 `inputTokens` 不包含 cache 计数，因此该比值还有缓存口径限制。14 个 seed 是方案最低样本量，不是统计功效或等效性的保证。

## 工程验证

| 命令/检查 | 实测结果 |
|---|---|
| `npm test` | 494 后端测试 + 8 客户端测试通过，0 失败 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm run pack:tarball` | 通过；本地生成 0.4.1 tarball，没有发布 |
| `npm run smoke:profile` | 通过；原有 183 条 profile 配置未改，ATN preset 与子节点创建检查通过 |
| 等预算专项测试 | 39 项通过 |
| 真实 Harness + 模拟 adapter 四臂检查 | 四臂精确通过；未知 usage 保留；预算耗尽拒绝进入 adapter |

模拟 adapter 的独立池测试实际消耗为 101 次调用＝15×5＋26，实际创建 16 个智能体。这个数值仅为测试证据，不是真实模型测量结果。

原始验证日志保留在 `.artifacts/equal-budget-*.log`，真实输入、会话、事件、审计和逐样本报告保留在 `.artifacts/equal-budget/20261007/`。

最终测试日志为 `.artifacts/equal-budget-final-tests.log`；最终类型检查为 `.artifacts/equal-budget-typecheck-final.log`。之前的诊断日志也保留，不能将早期失败尝试当作最终检查状态。

## 重现

创建新研究目录后，先注册，再执行；不得覆盖已有研究目录：

```powershell
npm run experiment:equal-budget -- --prepare --root .artifacts/equal-budget/new-study
./scripts/run-pilot.ps1 -Experiment equal-budget --execute --root .artifacts/equal-budget/new-study
npm run experiment:equal-budget-report -- --results .artifacts/equal-budget/new-study/batch.json --design .artifacts/equal-budget/new-study/design.json
```

脚本使用环境中已有凭据或既有当前用户 DPAPI 凭据，不将密钥写入报告。异常恢复时先确认原进程已退出，再处理遗留锁；不得为了重试失败样本删除 `attempt.json` 或 `report.json`。恢复命令只继续尚未尝试的计划项。

## 解释边界

墙钟包括初始化与结束清理，并受共享 API 延迟和限流影响。native 自带传输与 ATN 邮件/白板有固有差异；native 的 task/member/fork 上下文并未全部计入邮件字节，不能无条件比较协议成本。未建立差异不代表等效。规模不足、审计缺口、失败导致低消耗均不能支持 ATN 优势；本轮不自动升级版本或发布。
