# 等预算四臂基准实施报告

**执行覆盖诊断：** 12 次保留尝试中只有 6 次实际调用模型，5 次精确通过；另外 6 次在模型调用前报 `UNKNOWN_MODEL`。仅首个 seed 完成四臂实际调用，尚未完成 3 seed × 4 臂真实模型预检。此前一次 native-team 尝试有两次 `TRANSPORT` 错误。零调用失败仍在正确率分母中，不能当作模型推理失败或效率优势。

本报告已用修正后的覆盖统计重新生成，原始预检决策与运行记录未改写。事后防护重评为 `blocked-real-model-coverage`，仍不放行；[修订记录](../experiments/results/equal-budget-postrun-amendment-v2-20261007.json)保留冻结源码、前后哈希及原始决策。[调度诊断](../experiments/results/equal-budget-v2-dispatch-diagnosis-20261007.json)另列基础设施错误与归因限制。

生成时间：2026-10-08T01:25:08.600Z。状态：**按真实模型预检规则停止**。全部 `causalClaim=false`；不自动生成总体收益主张。

真实模型预检未放行，已按预登记规则停止在 12/56 次；无法作等预算收益判断。

**本轮只测协调开销与并行的权衡，不是上下文压力实验。输入上下文规模不再是本轮判据，不得推广为“协作有用”或“协作无用”的通用结论。**

## 真实模型预检与停止规则

输入文件保留的预检决策：`blocked-integrity`；已保留 12/12 次尝试，精确通过 5 次。主批次获准：false；研究线终止：false。

此处展示输入文件保存的决策，不改写冻结结果；下文根据逐运行计数重新核验实际模型调用覆盖。尝试记录齐全不等于真实模型预检完成。

诊断类别：`audit-or-allocation`。Live identity, equal allocation, model identity or positive fact-flow audit is incomplete.

预登记预检 seed：2026100701, 2026100702, 2026100703；要求至少 3 个 seed × 四臂，至少一次精确通过；大面积截断阈值为运行占比 25.00%。该阈值是可行性判断，不是正确率统计闸门。

全部预检样本计入本报告，失败、异常、未知 usage 不删除、不替换。本轮依规则停止，实际保留 12/56 次；未运行的主批次不计为失败或已执行样本。零调用构造性参考只证明任务可计算，不能替代真实模型预检。

[保留的原始结果](../experiments/results/equal-budget-runs-v2-20261007.json)；[统计 JSON（含每运行、每智能体峰值与全部配对指标）](../experiments/results/equal-budget-report-v2-20261007.json)。

## 预登记、预算与样本

模型：deepseek-v4.1-flash；冻结时间：2026-10-07T08:32:13.759Z；配对 seed：2026100701, 2026100702, 2026100703, 2026100704, 2026100705, 2026100706, 2026100707, 2026100708, 2026100709, 2026100710, 2026100711, 2026100712, 2026100713, 2026100714。计划 56 次，保留 12 次（失败 7 次），每臂至少 14 个配对 seed 的矩阵未齐全。未替换失败样本。

四臂配置总步数相等：true；实际配置与登记匹配：true；全部保留尝试均有实际模型调用证据：false；模型一致：true；全部正向事实流审计通过：false。stepBudget 只计 Agent 步数，不是 token、HTTP 请求或费用上限。

配置为 live-provider 的尝试 12/12 次；实际调用运行 6 次，已知零调用 6 次，调用证据未知或矛盾 0 次。零调用尝试不是已完成的真实模型运行，仍保留在正确率分母和失败消耗中。

| 臂 | 配置为 live-provider 的尝试 | 实际调用运行 | 已知零调用 | 调用证据未知或矛盾 |
|---|---:|---:|---:|---:|
| single | 3 | 1 | 2 | 0 |
| independent-pool | 3 | 2 | 1 | 0 |
| native-team | 3 | 2 | 1 | 0 |
| atn-adaptive | 3 | 1 | 2 | 0 |

实际调用要求 live-provider 配置、issuedModelCalls 与遥测 attempts 均为正整数且一致；两项都为零才计已知零调用。缺失或矛盾计数不补零，也不以配置标签证明调用已发生；非 live-provider 样本不能证明真实模型覆盖。零调用失败的短墙钟和零 token 消耗不能视为解题效率优势。

| 臂 | 配置智能体数 | 各智能体步数分配 | 总步数 | 已记录/计划 | 缺失 seed |
|---|---:|---|---:|---:|---|
| single | 1 | 512 | 512 | 3/14 | 2026100704, 2026100705, 2026100706, 2026100707, 2026100708, 2026100709, 2026100710, 2026100711, 2026100712, 2026100713, 2026100714 |
| independent-pool | 16 | 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 | 512 | 3/14 | 2026100704, 2026100705, 2026100706, 2026100707, 2026100708, 2026100709, 2026100710, 2026100711, 2026100712, 2026100713, 2026100714 |
| native-team | 16 | 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 | 512 | 3/14 | 2026100704, 2026100705, 2026100706, 2026100707, 2026100708, 2026100709, 2026100710, 2026100711, 2026100712, 2026100713, 2026100714 |
| atn-adaptive | 16 | 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 | 512 | 3/14 | 2026100704, 2026100705, 2026100706, 2026100707, 2026100708, 2026100709, 2026100710, 2026100711, 2026100712, 2026100713, 2026100714 |

实际消耗逐运行列出；未创建的节点额度是未使用预算。调用数与步数单独计量，不能用前者冒充后者。

| 臂 | seed | 精确通过 | 实际智能体/空闲配额 | 模型调用 | 入口步 | 所有已记录 Agent 步数 | stopReason |
|---|---:|---|---|---:|---:|---:|---|
| single | 2026100701 | true | 1/0 | 10 | 10 | 10 | submitted |
| single | 2026100702 | false | 1/0 | 0 | 0 | 0 | quiescent-without-submission |
| single | 2026100703 | false | 1/0 | 0 | 0 | 0 | quiescent-without-submission |
| independent-pool | 2026100701 | true | 16/0 | 37 | 5 | 37 | submitted |
| independent-pool | 2026100702 | true | 16/0 | 37 | 7 | 37 | submitted |
| independent-pool | 2026100703 | false | 16/0 | 0 | 0 | 0 | quiescent-without-submission |
| native-team | 2026100701 | true | 9/7 | 75 | 14 | 75 | submitted |
| native-team | 2026100702 | false | 6/10 | 48 | 13 | 48 | quiescent-without-submission |
| native-team | 2026100703 | false | 1/15 | 0 | 0 | 0 | quiescent-without-submission |
| atn-adaptive | 2026100701 | true | 4/12 | 43 | 12 | 43 | submitted |
| atn-adaptive | 2026100702 | false | 1/15 | 0 | 0 | 0 | quiescent-without-submission |
| atn-adaptive | 2026100703 | false | 1/15 | 0 | 0 | 0 | quiescent-without-submission |

## 正确率

完成定义为宿主按 fixture 精确校验通过；宿主异常、未提交和错误答案均保留在分母，失败原因在上表中列出。

| 臂 | 正确/已记录 | 正确率 | Wilson 95% |
|---|---:|---:|---|
| single | 1/3 | 33.33% | [6.15%, 79.23%] |
| independent-pool | 2/3 | 66.67% | [20.77%, 93.85%] |
| native-team | 1/3 | 33.33% | [6.15%, 79.23%] |
| atn-adaptive | 1/3 | 33.33% | [6.15%, 79.23%] |

| 配对 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | 不一致对 A赢/B赢 | Holm p | 可区分 |
|---|---|---|---|---|---:|---|
| single − independent-pool | 3/11 | -33.33pp | [-79.23pp, 41.53pp] | 0/1 | 1.00 | 未建立差异 |
| single − native-team | 3/11 | 0.00pp | [-56.15pp, 56.15pp] | 0/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | 3/11 | 0.00pp | [-56.15pp, 56.15pp] | 0/0 | 1.00 | 未建立差异 |
| independent-pool − native-team | 3/11 | 33.33pp | [-41.53pp, 79.23pp] | 1/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 3/11 | 33.33pp | [-41.53pp, 79.23pp] | 1/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 3/11 | 0.00pp | [-56.15pp, 56.15pp] | 0/0 | 1.00 | 未建立差异 |

**正确率未区分的臂对：** single ≈ independent-pool（配对不全）；single ≈ native-team（配对不全）；single ≈ atn-adaptive（配对不全）；independent-pool ≈ native-team（配对不全）；independent-pool ≈ atn-adaptive（配对不全）；native-team ≈ atn-adaptive（配对不全）。≈ 仅表示此样本下未建立差异，不是等效证明，也不是零效应。

## 墙钟、上下文与消耗

所有连续指标均为中位数、Q1/Q3 和中位数 95% 区间，单位见表头；不使用墙钟均值。全部样本、完成与失败分别列出。CI 在少于 6 个已知样本时不可有限估计，未知值不记零。

### 墙钟 ms

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 10,341；IQR [10,330, 59,027]；95% CI 不可估计；已知/未知 3/0 |
| single/完成 | 1 | 107,713；IQR [107,713, 107,713]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 10,330；IQR [10,324.5, 10,335.5]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/全部 | 3 | 91,220；IQR [55,978.5, 97,405]；95% CI 不可估计；已知/未知 3/0 |
| independent-pool/完成 | 2 | 97,405；IQR [94,312.5, 100,497.5]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 20,737；IQR [20,737, 20,737]；95% CI 不可估计；已知/未知 1/0 |
| native-team/全部 | 3 | 140,248；IQR [75,292, 197,521]；95% CI 不可估计；已知/未知 3/0 |
| native-team/完成 | 1 | 140,248；IQR [140,248, 140,248]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 132,565；IQR [71,450.5, 193,679.5]；95% CI 不可估计；已知/未知 2/0 |
| atn-adaptive/全部 | 3 | 10,343；IQR [10,332, 92,615.5]；95% CI 不可估计；已知/未知 3/0 |
| atn-adaptive/完成 | 1 | 174,888；IQR [174,888, 174,888]；95% CI 不可估计；已知/未知 1/0 |
| atn-adaptive/失败 | 2 | 10,332；IQR [10,326.5, 10,337.5]；95% CI 不可估计；已知/未知 2/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | -10,396；IQR [-51,833.5, 3,048.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − native-team | -32,535；IQR [-138,505, -16,265]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | -24；IQR [-33,599.5, -2]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − native-team | -49,028；IQR [-100,116, -19,313.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 10,416；IQR [-36,626, 51,831.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 15；IQR [-17,312.5, 122,233]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 峰值输入 token

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 4,913；IQR [4,913, 4,913]；95% CI 不可估计；已知/未知 1/2 |
| single/完成 | 1 | 4,913；IQR [4,913, 4,913]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/2 |
| independent-pool/全部 | 3 | 7,611.5；IQR [6,746.75, 8,476.25]；95% CI 不可估计；已知/未知 2/1 |
| independent-pool/完成 | 2 | 7,611.5；IQR [6,746.75, 8,476.25]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/1 |
| native-team/全部 | 3 | 8,611；IQR [7,804.5, 9,417.5]；95% CI 不可估计；已知/未知 2/1 |
| native-team/完成 | 1 | 6,998；IQR [6,998, 6,998]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 10,224；IQR [10,224, 10,224]；95% CI 不可估计；已知/未知 1/1 |
| atn-adaptive/全部 | 3 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/3 |
| atn-adaptive/完成 | 1 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/1 |
| atn-adaptive/失败 | 2 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/2 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | -4,428；IQR [-4,428, -4,428]；95% CI 不可估计；已知/未知 1/2 | 1.00 | 未建立差异 |
| single − native-team | -2,085；IQR [-2,085, -2,085]；95% CI 不可估计；已知/未知 1/2 | 1.00 | 未建立差异 |
| single − atn-adaptive | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/3 | 1.00 | 未建立差异 |
| independent-pool − native-team | -999.5；IQR [-2,670.75, 671.75]；95% CI 不可估计；已知/未知 2/1 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/3 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/3 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 完整 input+output token

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 0；IQR [0, 26,364.5]；95% CI 不可估计；已知/未知 3/0 |
| single/完成 | 1 | 52,729；IQR [52,729, 52,729]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/全部 | 3 | 119,514；IQR [59,757, 120,987]；95% CI 不可估计；已知/未知 3/0 |
| independent-pool/完成 | 2 | 120,987；IQR [120,250.5, 121,723.5]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| native-team/全部 | 3 | 177,251；IQR [88,625.5, 189,581.5]；95% CI 不可估计；已知/未知 3/0 |
| native-team/完成 | 1 | 201,912；IQR [201,912, 201,912]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 88,625.5；IQR [44,312.75, 132,938.25]；95% CI 不可估计；已知/未知 2/0 |
| atn-adaptive/全部 | 3 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/1 |
| atn-adaptive/完成 | 1 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/1 |
| atn-adaptive/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | -66,785；IQR [-94,622.5, -33,392.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − native-team | -149,183；IQR [-163,217, -74,591.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/1 | 1.00 | 未建立差异 |
| independent-pool − native-team | -54,791；IQR [-68,594.5, -27,395.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 61,230；IQR [30,615, 91,845]；95% CI 不可估计；已知/未知 2/1 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 88,625.5；IQR [44,312.75, 132,938.25]；95% CI 不可估计；已知/未知 2/1 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 模型调用

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 0；IQR [0, 5]；95% CI 不可估计；已知/未知 3/0 |
| single/完成 | 1 | 10；IQR [10, 10]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/全部 | 3 | 37；IQR [18.5, 37]；95% CI 不可估计；已知/未知 3/0 |
| independent-pool/完成 | 2 | 37；IQR [37, 37]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| native-team/全部 | 3 | 48；IQR [24, 61.5]；95% CI 不可估计；已知/未知 3/0 |
| native-team/完成 | 1 | 75；IQR [75, 75]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 24；IQR [12, 36]；95% CI 不可估计；已知/未知 2/0 |
| atn-adaptive/全部 | 3 | 0；IQR [0, 21.5]；95% CI 不可估计；已知/未知 3/0 |
| atn-adaptive/完成 | 1 | 43；IQR [43, 43]；95% CI 不可估计；已知/未知 1/0 |
| atn-adaptive/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | -27；IQR [-32, -13.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − native-team | -48；IQR [-56.5, -24]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | 0；IQR [-16.5, 0]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − native-team | -11；IQR [-24.5, -5.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 0；IQR [-3, 18.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 32；IQR [16, 40]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 协议交互

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 3/0 |
| single/完成 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/全部 | 3 | 15；IQR [15, 15]；95% CI 不可估计；已知/未知 3/0 |
| independent-pool/完成 | 2 | 15；IQR [15, 15]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 15；IQR [15, 15]；95% CI 不可估计；已知/未知 1/0 |
| native-team/全部 | 3 | 4；IQR [2, 6]；95% CI 不可估计；已知/未知 3/0 |
| native-team/完成 | 1 | 8；IQR [8, 8]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 2；IQR [1, 3]；95% CI 不可估计；已知/未知 2/0 |
| atn-adaptive/全部 | 3 | 0；IQR [0, 15.5]；95% CI 不可估计；已知/未知 3/0 |
| atn-adaptive/完成 | 1 | 31；IQR [31, 31]；95% CI 不可估计；已知/未知 1/0 |
| atn-adaptive/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | -15；IQR [-15, -15]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − native-team | -4；IQR [-6, -2]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | 0；IQR [-15.5, 0]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − native-team | 11；IQR [9, 13]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 15；IQR [-0.5, 15]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 0；IQR [-11.5, 2]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 传输字节

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 3/0 |
| single/完成 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/全部 | 3 | 3,442；IQR [1,949.5, 4,254]；95% CI 不可估计；已知/未知 3/0 |
| independent-pool/完成 | 2 | 4,254；IQR [3,848, 4,660]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 457；IQR [457, 457]；95% CI 不可估计；已知/未知 1/0 |
| native-team/全部 | 3 | 7,209；IQR [3,604.5, 7,752]；95% CI 不可估计；已知/未知 3/0 |
| native-team/完成 | 1 | 8,295；IQR [8,295, 8,295]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 3,604.5；IQR [1,802.25, 5,406.75]；95% CI 不可估计；已知/未知 2/0 |
| atn-adaptive/全部 | 3 | 0；IQR [0, 13,007.5]；95% CI 不可估计；已知/未知 3/0 |
| atn-adaptive/完成 | 1 | 26,015；IQR [26,015, 26,015]；95% CI 不可估计；已知/未知 1/0 |
| atn-adaptive/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | -3,442；IQR [-4,254, -1,949.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − native-team | -7,209；IQR [-7,752, -3,604.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | 0；IQR [-13,007.5, 0]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − native-team | -3,229；IQR [-3,498, -1,386]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 457；IQR [-10,246, 1,949.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 0；IQR [-8,860, 3,604.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 入口步数

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 0；IQR [0, 5]；95% CI 不可估计；已知/未知 3/0 |
| single/完成 | 1 | 10；IQR [10, 10]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/全部 | 3 | 5；IQR [2.5, 6]；95% CI 不可估计；已知/未知 3/0 |
| independent-pool/完成 | 2 | 6；IQR [5.5, 6.5]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| native-team/全部 | 3 | 13；IQR [6.5, 13.5]；95% CI 不可估计；已知/未知 3/0 |
| native-team/完成 | 1 | 14；IQR [14, 14]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 6.5；IQR [3.25, 9.75]；95% CI 不可估计；已知/未知 2/0 |
| atn-adaptive/全部 | 3 | 0；IQR [0, 6]；95% CI 不可估计；已知/未知 3/0 |
| atn-adaptive/完成 | 1 | 12；IQR [12, 12]；95% CI 不可估计；已知/未知 1/0 |
| atn-adaptive/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | 0；IQR [-3.5, 2.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − native-team | -4；IQR [-8.5, -2]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | 0；IQR [-1, 0]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − native-team | -6；IQR [-7.5, -3]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 0；IQR [-3.5, 3.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 2；IQR [1, 7.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 全部工具启动次数（补充测量）

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 3 | 0；IQR [0, 25]；95% CI 不可估计；已知/未知 3/0 |
| single/完成 | 1 | 50；IQR [50, 50]；95% CI 不可估计；已知/未知 1/0 |
| single/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/全部 | 3 | 110；IQR [55, 111.5]；95% CI 不可估计；已知/未知 3/0 |
| independent-pool/完成 | 2 | 111.5；IQR [110.75, 112.25]；95% CI 不可估计；已知/未知 2/0 |
| independent-pool/失败 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| native-team/全部 | 3 | 181；IQR [90.5, 185.5]；95% CI 不可估计；已知/未知 3/0 |
| native-team/完成 | 1 | 181；IQR [181, 181]；95% CI 不可估计；已知/未知 1/0 |
| native-team/失败 | 2 | 95；IQR [47.5, 142.5]；95% CI 不可估计；已知/未知 2/0 |
| atn-adaptive/全部 | 3 | 0；IQR [0, 96]；95% CI 不可估计；已知/未知 3/0 |
| atn-adaptive/完成 | 1 | 192；IQR [192, 192]；95% CI 不可估计；已知/未知 1/0 |
| atn-adaptive/失败 | 2 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 2/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − independent-pool | -63；IQR [-86.5, -31.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − native-team | -131；IQR [-160.5, -65.5]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| single − atn-adaptive | 0；IQR [-71, 0]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − native-team | -68；IQR [-74, -34]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 0；IQR [-39.5, 55]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 0；IQR [-5.5, 95]；95% CI 不可估计；已知/未知 3/0 | 1.00 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 输入/输出已知部分与未知覆盖

| 臂/分组 | input+output 已知部分 | 完整/不完整运行 | 输入已知/未知调用 | 输出已知/未知调用 | 未结算调用 | 缺失遥测运行 |
|---|---:|---|---|---|---:|---:|
| single/全部 | 52,729 | 3/0 | 10/0 | 10/0 | 0 | 0 |
| single/完成 | 52,729 | 1/0 | 10/0 | 10/0 | 0 | 0 |
| single/失败 | 0 | 2/0 | 0/0 | 0/0 | 0 | 0 |
| independent-pool/全部 | 241,974 | 3/0 | 74/0 | 74/0 | 0 | 0 |
| independent-pool/完成 | 241,974 | 2/0 | 74/0 | 74/0 | 0 | 0 |
| independent-pool/失败 | 0 | 1/0 | 0/0 | 0/0 | 0 | 0 |
| native-team/全部 | 379,163 | 3/0 | 123/0 | 123/0 | 0 | 0 |
| native-team/完成 | 201,912 | 1/0 | 75/0 | 75/0 | 0 | 0 |
| native-team/失败 | 177,251 | 2/0 | 48/0 | 48/0 | 0 | 0 |
| atn-adaptive/全部 | 220,488 | 2/1 | 41/2 | 41/2 | 0 | 0 |
| atn-adaptive/完成 | 220,488 | 0/1 | 41/2 | 41/2 | 0 | 0 |
| atn-adaptive/失败 | 0 | 2/0 | 0/0 | 0/0 | 0 | 0 |

已知部分合计不等于完整总量；缺失遥测运行的未知调用数也不可确定，单列缺失运行，不能把已记录未知调用数误当完整覆盖。此处严格按 inputTokens + outputTokens 汇总；沿用遥测口径：input 不含 cacheRead/cacheWrite，reasoning 已包含在 output，不能重复相加，也不将 provider totalTokens 替代本指标。

### 每运行与每智能体峰值上下文

峰值严格取单次 inputTokens，作为描述性成本指标。inputTokens 不含 cacheRead/cacheWrite，可能低估完整上下文。输入上下文不参与本轮可行性判断，也不支持上下文压力结论。

| 臂 | seed | 完整运行峰值 | 已知下界 | 已知/未知调用 | 每 Agent 映射完整 | 每 Agent 完整峰值（未知保留） |
|---|---:|---:|---:|---|---|---|
| single | 2026100701 | 4,913 | 4,913 | 10/0 | true | agent-1: 4,913（已知下界 4,913） |
| single | 2026100702 | 未知 | 未知 | 0/0 | true | agent-1: 未知（已知下界 未知） |
| single | 2026100703 | 未知 | 未知 | 0/0 | true | agent-1: 未知（已知下界 未知） |
| independent-pool | 2026100701 | 9,341 | 9,341 | 37/0 | true | agent-1: 9,341（已知下界 9,341）；agent-2: 1,781（已知下界 1,781）；agent-3: 1,788（已知下界 1,788）；agent-4: 1,786（已知下界 1,786）；agent-5: 1,811（已知下界 1,811）；agent-6: 1,824（已知下界 1,824）；agent-7: 1,783（已知下界 1,783）；agent-8: 2,479（已知下界 2,479）；agent-9: 1,785（已知下界 1,785）；agent-10: 1,851（已知下界 1,851）；agent-11: 1,799（已知下界 1,799）；agent-12: 1,784（已知下界 1,784）；agent-13: 1,811（已知下界 1,811）；agent-14: 1,811（已知下界 1,811）；agent-15: 1,784（已知下界 1,784）；agent-16: 1,820（已知下界 1,820） |
| independent-pool | 2026100702 | 5,882 | 5,882 | 37/0 | true | agent-1: 5,882（已知下界 5,882）；agent-2: 1,807（已知下界 1,807）；agent-3: 1,846（已知下界 1,846）；agent-4: 1,788（已知下界 1,788）；agent-5: 1,797（已知下界 1,797）；agent-6: 1,806（已知下界 1,806）；agent-7: 1,822（已知下界 1,822）；agent-8: 1,795（已知下界 1,795）；agent-9: 1,798（已知下界 1,798）；agent-10: 1,785（已知下界 1,785）；agent-11: 1,789（已知下界 1,789）；agent-12: 1,787（已知下界 1,787）；agent-13: 1,802（已知下界 1,802）；agent-14: 1,784（已知下界 1,784）；agent-15: 1,789（已知下界 1,789）；agent-16: 1,811（已知下界 1,811） |
| independent-pool | 2026100703 | 未知 | 未知 | 0/0 | true | agent-1: 未知（已知下界 未知）；agent-2: 未知（已知下界 未知）；agent-3: 未知（已知下界 未知）；agent-4: 未知（已知下界 未知）；agent-5: 未知（已知下界 未知）；agent-6: 未知（已知下界 未知）；agent-7: 未知（已知下界 未知）；agent-8: 未知（已知下界 未知）；agent-9: 未知（已知下界 未知）；agent-10: 未知（已知下界 未知）；agent-11: 未知（已知下界 未知）；agent-12: 未知（已知下界 未知）；agent-13: 未知（已知下界 未知）；agent-14: 未知（已知下界 未知）；agent-15: 未知（已知下界 未知）；agent-16: 未知（已知下界 未知） |
| native-team | 2026100701 | 6,998 | 6,998 | 75/0 | true | agent-1: 6,998（已知下界 6,998）；agent-2: 5,348（已知下界 5,348）；agent-3: 5,536（已知下界 5,536）；agent-4: 5,139（已知下界 5,139）；agent-5: 2,589（已知下界 2,589）；agent-6: 2,227（已知下界 2,227）；agent-7: 4,181（已知下界 4,181）；agent-8: 5,028（已知下界 5,028）；agent-9: 2,408（已知下界 2,408） |
| native-team | 2026100702 | 10,224 | 10,224 | 48/0 | true | agent-1: 10,224（已知下界 10,224）；agent-2: 5,848（已知下界 5,848）；agent-3: 4,869（已知下界 4,869）；agent-4: 4,946（已知下界 4,946）；agent-5: 3,561（已知下界 3,561）；agent-6: 9,009（已知下界 9,009） |
| native-team | 2026100703 | 未知 | 未知 | 0/0 | true | agent-1: 未知（已知下界 未知） |
| atn-adaptive | 2026100701 | 未知 | 18,037 | 41/2 | true | agent-1: 18,037（已知下界 18,037）；agent-2: 5,111（已知下界 5,111）；agent-3: 未知（已知下界 6,067）；agent-4: 未知（已知下界 5,653） |
| atn-adaptive | 2026100702 | 未知 | 未知 | 0/0 | true | agent-1: 未知（已知下界 未知） |
| atn-adaptive | 2026100703 | 未知 | 未知 | 0/0 | true | agent-1: 未知（已知下界 未知） |

### 单次输出余量与第 9 轮截断诊断

共同单次输出上限 8,192；预登记最小余量 40.00%。预检精确完成运行所需最大单次输出完整值 未知，已知下界 7,596，完整余量 未知；判据状态：`insufficient-output-headroom`。全部预检（包含失败）最大单次输出 未知，已知下界 7,596。零完成时不存在可用的完成见证，不能把失败运行的输出余量写成可行性确认。

| 臂 | 截断调用/涉及运行 | 最大单次输出完整值/已知下界 | 完整余量 | 输出已知/未知调用 | 截断未知调用/覆盖不完整运行 | 调用覆盖未知运行 |
|---|---|---|---|---|---|---:|
| single | 0/0 | 5,212/5,212 | 36.38% | 10/0 | 0/0 | 0 |
| independent-pool | 0/0 | 6,081/6,081 | 25.77% | 74/0 | 0/0 | 0 |
| native-team | 0/0 | 6,396/6,396 | 21.92% | 123/0 | 0/0 | 0 |
| atn-adaptive | 0/0 | 未知/7,596 | 未知 | 41/2 | 2/1 | 0 |

第 9 轮共 384 次截断、56/56 次运行涉及截断。本轮保留样本观察到 0 次截断、0/12 次运行涉及截断；截断遥测覆盖不完整，不能判定第 9 轮问题已经消除。

截断调用按 finishReason=max-tokens/length 或 outputTokens≥共同上限计数，同一调用只计一次；reasoning 已在 outputTokens 中。未知输出、未知终止原因、未结算调用和缺失遥测均保留；有未知覆盖时截断次数是已观察下界，未知调用计数不包含调用总数也未知的运行。已知最大输出是下界，不能据此声称完整余量充足。

| 臂 | seed | 截断调用 | 最大输出完整值/已知下界 | 输出已知/未知调用 | 截断未知调用 |
|---|---:|---:|---|---|---|
| single | 2026100701 | 0 | 5,212/5,212 | 10/0 | 0 |
| single | 2026100702 | 0 | 未知/未知 | 0/0 | 0 |
| single | 2026100703 | 0 | 未知/未知 | 0/0 | 0 |
| independent-pool | 2026100701 | 0 | 5,226/5,226 | 37/0 | 0 |
| independent-pool | 2026100702 | 0 | 6,081/6,081 | 37/0 | 0 |
| independent-pool | 2026100703 | 0 | 未知/未知 | 0/0 | 0 |
| native-team | 2026100701 | 0 | 6,396/6,396 | 75/0 | 0 |
| native-team | 2026100702 | 0 | 4,919/4,919 | 48/0 | 0 |
| native-team | 2026100703 | 0 | 未知/未知 | 0/0 | 0 |
| atn-adaptive | 2026100701 | 0 | 未知/7,596 | 41/2 | 2 |
| atn-adaptive | 2026100702 | 0 | 未知/未知 | 0/0 | 0 |
| atn-adaptive | 2026100703 | 0 | 未知/未知 | 0/0 | 0 |

## 三类结果如何解释

1. 四臂区间均未建立差异：在当前模型、任务和预算下未观察到相对优势，不能认定效果相等。若预检停止，只有可行性诊断，不能将未执行主批次写成完成比较；触发研究线终止时不再设计下一轮或继续缩小任务。
2. independent-pool 相对 single 有质量与成本联合支持，而 ATN 相对 pool 未建立差异：观察更符合并行有帮助，尚无 ATN 协调层的额外贡献证据；不能仅凭墙钟更短作此判断，也不能把未区分写成已证明无贡献。
3. ATN 相对 native-team 的正向差异获区间支持、质量未被失败偏差替代且成本可比较：可报告该模型、fixture、预算下的额外关联收益；本实验仍不作因果机制主张。single/native-team 失败本身不能独立证明 ATN 优势。

## 方法与限制

- Wilson 95%; paired Tango nominal 95% score interval plus two-sided exact McNemar。Tango 为名义渐近配对区间，不是有限样本精确覆盖；零不一致对也有非零宽度。
- 墙钟与其他连续指标使用二项顺序统计中位数区间，Q1/Q3 使用线性插值。配对量是每 seed 的 A−B 差值的中位数，不是两个边际中位数之差。
- 各指标内六个臂对的精确 McNemar/符号检验使用 Holm 校正；区间仍为名义 95%，不是同时区间，也未保证跨指标家族错误率。可区分要求完整配对、CI 排除零且校正 p<0.05。
- 墙钟受共享 API 服务延迟与限流影响，并行可能被限流，不能单独当作效率证明。完成条件下的短耗时也不能代表无条件效率。
- 墙钟按宿主 completedAt−startedAt 计算，包含运行初始化和结束清理；不是仅模型推理或仅解题时间。
- 峰值上下文只说明每个智能体承受多少单次输入，不说明答案质量；已知下界不是完整峰值。模型可用上限与 input 遥测的 cache 口径需要一并考虑。
- native-team 使用 Harness 自带传输，ATN 使用邮件/白板，传输结构是固有差异。ATN 统计已提交 mail+board；native 仅统计唯一排队 team/message 与 JSON 信封字节，未包含 task metadata、member 元数据和 fork 继承上下文；independent-pool 统计候选向合并入口的交付（包括空候选），single 为零。此覆盖差异不能支持无条件同口径的协议成本优劣结论。
- 另列全部工具启动次数辅助观察，包含文档工具与协作工具，不能替代遗漏传输成本；协议次数与字节不等同于 HTTP 字节或真实账单。
- 失败、异常和未知 usage 全部保留；未完成登记矩阵或审计时不作等预算收益判断。全部 causalClaim=false。

本报告仅陈述输入文件中实际保留的结果；测试、构建、打包与 smoke 验证由实施记录另行列出，未执行项目不得写为通过。
