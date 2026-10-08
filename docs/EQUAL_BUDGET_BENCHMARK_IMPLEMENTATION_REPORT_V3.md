# 第 11 轮等预算分解指令对照报告（终轮）

生成时间：2026-10-08T04:48:02.357Z。全部 `causalClaim=false`。5 臂登记矩阵完成；全部正确率臂对均未建立差异，不是等效证明。审计缺口保留为未知，不设闸；仅作描述性关联，causalClaim=false。研究线在第 11 轮收束。

**问题：在同等分解指令下，分布式结构是否仍有优势？** 第 10 轮的 16 分片 × 10 订单与 16 分片 × 8 订单两组历史样本分别冻结，均不混入本轮统计。本轮在 16 分片 × 10 订单、每次输出上限 8192、各臂 512 次可见调用预算下比较。stepBudget 只计 Agent 步数，不是 token、HTTP 请求或费用上限。

[保留的原始结果](../experiments/results/equal-budget-runs-v3-20261008.json)；[统计 JSON（含每运行、每智能体与全部配对指标）](../experiments/results/equal-budget-report-v3-20261008.json)。

## 可行性与执行位置

闸门仅两条：① 至少一次宿主精确完成；② 全部预检真实模型调用覆盖，issuedModelCalls 与 metrics.totals.attempts 一致为正整数。截断、单次输出余量、审计缺口均只报告，不设阈值、不阻止主批次。零调用尝试单列、保留分母，不记为模型推理失败。开跑前的只读模型目录检查是基础设施先决条件。

保存的预检状态：`passed`；保留 15/15 次，精确通过 11 次；主批次获准：true。诊断：`feasible`，At least one exact completion and complete positive matching live-model dispatch coverage. Truncation, per-call headroom and audit gaps are report-only; this is not evidence of an architecture advantage.

模型：deepseek-v4.1-flash；冻结时间：2026-10-08T01:52:33.871Z；登记配对 seed：2026100801, 2026100802, 2026100803, 2026100804, 2026100805, 2026100806, 2026100807, 2026100808, 2026100809, 2026100810, 2026100811, 2026100812, 2026100813, 2026100814。登记 5 臂 × 14 seeds = 70 次，实际保留 70 次（未精确通过 12 次）；完整矩阵：true。未执行样本不是失败样本；失败、异常、零调用、未知 usage 均不删除或替换。

总步数相等：true；运行配置与登记匹配：true；模型一致：true；真实调用覆盖齐全：true；正向事实流审计全部通过：false（报告项）。比较资料齐全：true。

| 臂 | 智能体数 | 各智能体步数 | 总步数 | 已记录/计划 | 缺失 seed | 实际调用运行 | 零调用 | 调用证据未知/矛盾 |
|---|---:|---|---:|---|---|---:|---:|---:|
| single | 1 | 512 | 512 | 14/14 | 无 | 14 | 0 | 0 |
| single-scaffolded | 1 | 512 | 512 | 14/14 | 无 | 14 | 0 | 0 |
| independent-pool | 16 | 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 | 512 | 14/14 | 无 | 14 | 0 | 0 |
| native-team | 16 | 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 | 512 | 14/14 | 无 | 14 | 0 | 0 |
| atn-adaptive | 16 | 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 | 512 | 14/14 | 无 | 14 | 0 | 0 |

配置为 live-provider 的尝试 70/70 次；实际调用运行 70 次，已知零调用 0 次，调用证据未知或矛盾 0 次。零调用基础设施失败仍保留在正确率分母和失败消耗中，不能归因于模型推理或架构能力，短墙钟/零 token 也不是效率优势。

## 正确率与同 seed 配对区间

| 臂 | 精确通过/已记录 | 正确率 | Wilson 95% |
|---|---:|---:|---|
| single | 9/14 | 64.29% | [38.76%, 83.66%] |
| single-scaffolded | 13/14 | 92.86% | [68.53%, 98.73%] |
| independent-pool | 12/14 | 85.71% | [60.06%, 95.99%] |
| native-team | 14/14 | 100.00% | [78.47%, 100.00%] |
| atn-adaptive | 10/14 | 71.43% | [45.35%, 88.28%] |

| 配对 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | A赢/B赢 | Holm p | 可区分 |
|---|---|---|---|---|---:|---|
| single − single-scaffolded | 14/0 | -28.57pp | [-54.65pp, -0.89pp] | 0/4 | 1.00 | 未建立差异 |
| single − independent-pool | 14/0 | -21.43pp | [-53.38pp, 16.56pp] | 2/5 | 1.00 | 未建立差异 |
| single − native-team | 14/0 | -35.71pp | [-61.24pp, -6.49pp] | 0/5 | 0.625 | 未建立差异 |
| single − atn-adaptive | 14/0 | -7.14pp | [-42.15pp, 29.94pp] | 3/4 | 1.00 | 未建立差异 |
| single-scaffolded − independent-pool | 14/0 | 7.14pp | [-21.64pp, 35.36pp] | 2/1 | 1.00 | 未建立差异 |
| single-scaffolded − native-team | 14/0 | -7.14pp | [-31.47pp, 15.93pp] | 0/1 | 1.00 | 未建立差异 |
| single-scaffolded − atn-adaptive | 14/0 | 21.43pp | [-11.71pp, 50.55pp] | 4/1 | 1.00 | 未建立差异 |
| independent-pool − native-team | 14/0 | -14.29pp | [-39.94pp, 10.32pp] | 0/2 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | 14/0 | 14.29pp | [-16.70pp, 43.27pp] | 3/1 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | 14/0 | 28.57pp | [0.89pp, 54.65pp] | 4/0 | 1.00 | 未建立差异 |

**正确率不可区分的臂对：** single ≈ single-scaffolded；single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；single-scaffolded ≈ independent-pool；single-scaffolded ≈ native-team；single-scaffolded ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。≈ 表示未建立差异，不是等效证明，不能把宽区间或小样本写成没有贡献。

## 三条预登记解读与本轮实际区间

下列“预登记解读”是事先规定的条件性解释；实际状态逐条根据同 seed 正确率差、完整配对、名义 95% 区间及 Holm p<0.05 判定。没有预登记等效界限，CI 包含零不能证明等效。“与模式相容”不证明提示或架构的因果归因，也不证明 ATN 独立贡献为零。

### 1. single-scaffolded ≈ 三个分布式臂

预登记解读：第 10 轮信号是提示结构，不是架构效应；ATN 无独立贡献。

**实际状态：观察与模式相容（非等效或因果证明）。** 本轮观察与该模式相容；≈仅为未建立差异，未做等效检验，不能据此证明零效应或因果归因。

| 实际对比 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | Holm p | 实际方向 |
|---|---|---|---|---:|---|
| single-scaffolded − independent-pool | 14/0 | 7.14pp | [-21.64pp, 35.36pp] | 1.00 | 未建立差异 |
| single-scaffolded − native-team | 14/0 | -7.14pp | [-31.47pp, 15.93pp] | 1.00 | 未建立差异 |
| single-scaffolded − atn-adaptive | 14/0 | 21.43pp | [-11.71pp, 50.55pp] | 1.00 | 未建立差异 |

### 2. single-scaffolded ≈ single，且两者明显低于三个分布式臂

预登记解读：分解指令不足以救单智能体，分布式结构有独立贡献。

**实际状态：未观察到完整模式。** 本轮未观察到该规则要求的完整差异模式；下列方向与区间明确显示哪些差异未建立。

| 实际对比 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | Holm p | 实际方向 |
|---|---|---|---|---:|---|
| single-scaffolded − single | 14/0 | 28.57pp | [0.89pp, 54.65pp] | 1.00 | 未建立差异 |
| single-scaffolded − independent-pool | 14/0 | 7.14pp | [-21.64pp, 35.36pp] | 1.00 | 未建立差异 |
| single-scaffolded − native-team | 14/0 | -7.14pp | [-31.47pp, 15.93pp] | 1.00 | 未建立差异 |
| single-scaffolded − atn-adaptive | 14/0 | 21.43pp | [-11.71pp, 50.55pp] | 1.00 | 未建立差异 |
| single − independent-pool | 14/0 | -21.43pp | [-53.38pp, 16.56pp] | 1.00 | 未建立差异 |
| single − native-team | 14/0 | -35.71pp | [-61.24pp, -6.49pp] | 0.625 | 未建立差异 |
| single − atn-adaptive | 14/0 | -7.14pp | [-42.15pp, 29.94pp] | 1.00 | 未建立差异 |

### 3. single-scaffolded 明显优于 single，但仍低于三个分布式臂

预登记解读：部分来自指令、部分来自结构。

**实际状态：未观察到完整模式。** 本轮未观察到该规则要求的完整差异模式；下列方向与区间明确显示哪些差异未建立。

| 实际对比 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | Holm p | 实际方向 |
|---|---|---|---|---:|---|
| single-scaffolded − single | 14/0 | 28.57pp | [0.89pp, 54.65pp] | 1.00 | 未建立差异 |
| single-scaffolded − independent-pool | 14/0 | 7.14pp | [-21.64pp, 35.36pp] | 1.00 | 未建立差异 |
| single-scaffolded − native-team | 14/0 | -7.14pp | [-31.47pp, 15.93pp] | 1.00 | 未建立差异 |
| single-scaffolded − atn-adaptive | 14/0 | 21.43pp | [-11.71pp, 50.55pp] | 1.00 | 未建立差异 |

single 的失败本身不能写成 ATN 收益。分布式三臂之间的优势还须查阅其直接配对区间；架构差异不能仅由更短墙钟、成功条件下的成本或审计缺口推出。

## 墙钟、峰值上下文与消耗

连续指标报告中位数、Q1/Q3、保守二项顺序统计中位数 95% 区间和已知/未知数。少于 6 个已知值时有限 95% 区间不可估计；未知值不补零。配对差是逐 seed 的 A−B 中位数，区别于两个边际中位数之差。全部样本、完成和失败分别报告。

### 墙钟 ms

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 106,075.5；IQR [99,892, 111,993.25]；[96,924, 115,778]；已知/未知 14/0 |
| single/完成 | 9 | 107,780；IQR [99,305, 112,798]；[96,924, 115,778]；已知/未知 9/0 |
| single/失败 | 5 | 105,659；IQR [102,079, 106,492]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 119,833.5；IQR [105,855, 125,168]；[101,255, 143,349]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 119,064；IQR [104,583, 125,646]；[101,255, 143,349]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 121,586；IQR [121,586, 121,586]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 107,953.5；IQR [99,141.75, 120,082.5]；[98,091, 125,399]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 106,531；IQR [98,334, 118,357.5]；[98,091, 120,945]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 122,686；IQR [119,355, 126,017]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 204,374.5；IQR [175,405, 276,016]；[151,815, 334,780]；已知/未知 14/0 |
| native-team/完成 | 14 | 204,374.5；IQR [175,405, 276,016]；[151,815, 334,780]；已知/未知 14/0 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 156,955；IQR [137,429, 176,490.75]；[131,179, 199,185]；已知/未知 14/0 |
| atn-adaptive/完成 | 10 | 166,091；IQR [147,216.25, 176,490.75]；[137,816, 212,038]；已知/未知 10/0 |
| atn-adaptive/失败 | 4 | 132,138.5；IQR [126,602, 152,771.25]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | -11,398.5；IQR [-21,029.75, -4,672]；[-36,417, -4,331]；已知/未知 14/0 | 0.0647 | 未建立差异 |
| single − independent-pool | -4,665；IQR [-13,468.75, 6,968.5]；[-26,094, 10,720]；已知/未知 14/0 | 0.791 | 未建立差异 |
| single − native-team | -106,032；IQR [-196,844.5, -52,829]；[-235,475, -38,655]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − atn-adaptive | -64,680.5；IQR [-72,131.75, -37,446.75]；[-93,526, -24,687]；已知/未知 14/0 | 0.0146 | 是（负值表示 A 更少） |
| single-scaffolded − independent-pool | 6,590.5；IQR [1,837.75, 23,790]；[-20,816, 30,385]；已知/未知 14/0 | 0.172 | 未建立差异 |
| single-scaffolded − native-team | -97,141；IQR [-168,449, -38,944.75]；[-226,251, -29,417]；已知/未知 14/0 | 0.0146 | 是（负值表示 A 更少） |
| single-scaffolded − atn-adaptive | -54,163；IQR [-65,916.5, -21,477]；[-77,388, -5,533]；已知/未知 14/0 | 0.0647 | 未建立差异 |
| independent-pool − native-team | -89,485；IQR [-170,999, -57,949]；[-209,381, -56,678]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − atn-adaptive | -43,249.5；IQR [-58,675.75, -29,684.5]；[-101,094, -29,582]；已知/未知 14/0 | 0.0146 | 是（负值表示 A 更少） |
| native-team − atn-adaptive | 39,486；IQR [16,685.5, 134,131.5]；[-21,608, 162,418]；已知/未知 14/0 | 0.172 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ single-scaffolded；single ≈ independent-pool；single-scaffolded ≈ independent-pool；single-scaffolded ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 峰值输入 token

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 9,271.5；IQR [7,765, 10,029]；[6,011, 11,035]；已知/未知 14/0 |
| single/完成 | 9 | 9,059；IQR [6,011, 9,671]；[5,552, 9,954]；已知/未知 9/0 |
| single/失败 | 5 | 10,054；IQR [8,402, 11,035]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 3,122；IQR [2,987, 3,394.25]；[2,813, 3,506]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 3,127；IQR [3,035, 3,438]；[2,971, 3,506]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 2,813；IQR [2,813, 2,813]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 10,300；IQR [8,690, 11,419]；[7,735, 11,746]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 10,590.5；IQR [10,082, 11,621.5]；[9,974, 11,746]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 7,998.5；IQR [7,866.75, 8,130.25]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 11,114.5；IQR [9,010.25, 13,202]；[8,690, 14,651]；已知/未知 12/2 |
| native-team/完成 | 14 | 11,114.5；IQR [9,010.25, 13,202]；[8,690, 14,651]；已知/未知 12/2 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 14,737；IQR [13,305.75, 17,739.5]；[12,992, 33,126]；已知/未知 10/4 |
| atn-adaptive/完成 | 10 | 15,016；IQR [13,489.5, 17,739.5]；[9,835, 44,266]；已知/未知 6/4 |
| atn-adaptive/失败 | 4 | 14,300.5；IQR [13,841.25, 19,150.5]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | 6,035；IQR [4,734, 6,790]；[2,581, 7,899]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − independent-pool | -1,584；IQR [-2,759.25, 1,980.25]；[-6,194, 3,638]；已知/未知 14/0 | 0.539 | 未建立差异 |
| single − native-team | -2,825；IQR [-6,122, -1,125.25]；[-6,959, -715]；已知/未知 12/2 | 0.154 | 未建立差异 |
| single − atn-adaptive | -7,794；IQR [-10,332.25, -2,842.25]；[-17,908, -868]；已知/未知 10/4 | 0.107 | 未建立差异 |
| single-scaffolded − independent-pool | -7,270；IQR [-8,214.25, -5,443.5]；[-8,775, -4,756]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − native-team | -8,164.5；IQR [-10,194.5, -6,036.5]；[-11,534, -5,234]；已知/未知 12/2 | 0.00391 | 未建立差异 |
| single-scaffolded − atn-adaptive | -11,532.5；IQR [-14,760, -10,454.5]；[-29,999, -9,856]；已知/未知 10/4 | 0.0137 | 未建立差异 |
| independent-pool − native-team | -119；IQR [-4,404.75, 1,120]；[-4,869, 1,477]；已知/未知 12/2 | 1.00 | 未建立差异 |
| independent-pool − atn-adaptive | -5,117.5；IQR [-8,025, -4,068.25]；[-21,546, -2,891]；已知/未知 10/4 | 0.0137 | 未建立差异 |
| native-team − atn-adaptive | -4,924；IQR [-9,912.75, -835.25]；[-29,615, 3,886]；已知/未知 8/6 | 0.578 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single ≈ native-team；single ≈ atn-adaptive；single-scaffolded ≈ native-team；single-scaffolded ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 完整 input+output token

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 61,678；IQR [57,835.25, 63,865.25]；[56,601, 64,117]；已知/未知 14/0 |
| single/完成 | 9 | 60,756；IQR [57,790, 63,266]；[56,601, 64,065]；已知/未知 9/0 |
| single/失败 | 5 | 62,600；IQR [58,778, 64,117]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 60,129；IQR [56,545.25, 61,100.5]；[56,325, 61,867]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 59,751；IQR [56,544, 60,868]；[56,325, 61,178]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 63,123；IQR [63,123, 63,123]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 146,152.5；IQR [142,750.75, 147,853.25]；[140,729, 149,790]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 146,051；IQR [141,811.25, 147,539.75]；[140,729, 148,010]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 149,523；IQR [148,242.5, 150,803.5]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 273,407；IQR [259,829.75, 296,557.75]；[249,728, 302,140]；已知/未知 12/2 |
| native-team/完成 | 14 | 273,407；IQR [259,829.75, 296,557.75]；[249,728, 302,140]；已知/未知 12/2 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 201,362；IQR [169,380.5, 251,323]；[163,848, 277,558]；已知/未知 10/4 |
| atn-adaptive/完成 | 10 | 245,972；IQR [196,698.25, 272,337]；[179,795, 370,418]；已知/未知 6/4 |
| atn-adaptive/失败 | 4 | 164,878.5；IQR [163,810.25, 179,152.5]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | 2,457；IQR [-1,466.25, 4,675.5]；[-2,714, 5,339]；已知/未知 14/0 | 0.180 | 未建立差异 |
| single − independent-pool | -83,365；IQR [-90,954.5, -80,052.25]；[-94,113, -79,572]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − native-team | -214,213；IQR [-236,382, -196,825.25]；[-250,950, -188,972]；已知/未知 12/2 | 0.00391 | 未建立差异 |
| single − atn-adaptive | -143,388.5；IQR [-191,423, -110,008.75]；[-211,351, -105,726]；已知/未知 10/4 | 0.00977 | 未建立差异 |
| single-scaffolded − independent-pool | -85,749；IQR [-91,360.25, -82,959.5]；[-93,955, -80,978]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − native-team | -213,323；IQR [-237,537.25, -200,687.75]；[-239,017, -197,672]；已知/未知 12/2 | 0.00391 | 未建立差异 |
| single-scaffolded − atn-adaptive | -142,498.5；IQR [-196,752.25, -109,100.5]；[-216,690, -105,744]；已知/未知 10/4 | 0.00977 | 未建立差异 |
| independent-pool − native-team | -133,121.5；IQR [-149,844.75, -114,250.75]；[-156,174, -111,442]；已知/未知 12/2 | 0.00391 | 未建立差异 |
| independent-pool − atn-adaptive | -55,113.5；IQR [-101,355.75, -29,229.5]；[-131,422, -25,180]；已知/未知 10/4 | 0.00977 | 未建立差异 |
| native-team − atn-adaptive | 71,257.5；IQR [61,299.25, 80,458.25]；[-68,278, 101,790]；已知/未知 8/6 | 0.141 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ single-scaffolded；single ≈ native-team；single ≈ atn-adaptive；single-scaffolded ≈ native-team；single-scaffolded ≈ atn-adaptive；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 模型调用

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 7；IQR [6, 7]；[6, 10]；已知/未知 14/0 |
| single/完成 | 9 | 7；IQR [6, 10]；[6, 10]；已知/未知 9/0 |
| single/失败 | 5 | 7；IQR [6, 7]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 18；IQR [17, 18]；[17, 18]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 18；IQR [17, 18]；[17, 18]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 18；IQR [18, 18]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 36.5；IQR [36, 37]；[35, 40]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 36；IQR [35.75, 37]；[35, 37]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 38.5；IQR [37.75, 39.25]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 71.5；IQR [60.25, 80.25]；[58, 90]；已知/未知 14/0 |
| native-team/完成 | 14 | 71.5；IQR [60.25, 80.25]；[58, 90]；已知/未知 14/0 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 40.5；IQR [33.75, 53.25]；[32, 54]；已知/未知 14/0 |
| atn-adaptive/完成 | 10 | 49.5；IQR [40.25, 54]；[36, 75]；已知/未知 10/0 |
| atn-adaptive/失败 | 4 | 32.5；IQR [29.5, 34.75]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | -11；IQR [-11, -10]；[-12, -8]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − independent-pool | -29.5；IQR [-30.75, -27.25]；[-33, -27]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − native-team | -65.5；IQR [-73.25, -49.75]；[-83, -47]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − atn-adaptive | -33.5；IQR [-46.5, -27.75]；[-47, -21]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − independent-pool | -18.5；IQR [-20, -18]；[-22, -18]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − native-team | -54；IQR [-62.5, -42.25]；[-72, -40]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − atn-adaptive | -22.5；IQR [-35.25, -16]；[-37, -14]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − native-team | -33；IQR [-43.75, -24]；[-54, -22]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − atn-adaptive | -5.5；IQR [-16.5, 3.25]；[-19, 7]；已知/未知 14/0 | 0.424 | 未建立差异 |
| native-team − atn-adaptive | 21；IQR [11.25, 38.5]；[10, 42]；已知/未知 14/0 | 0.00366 | 是（负值表示 A 更少） |

未观察到可区分差异的臂对：independent-pool ≈ atn-adaptive。

### 协议交互

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 |
| single/完成 | 9 | 0；IQR [0, 0]；[0, 0]；已知/未知 9/0 |
| single/失败 | 5 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 0；IQR [0, 0]；[0, 0]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 15；IQR [15, 15]；[15, 15]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 15；IQR [15, 15]；[15, 15]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 15；IQR [15, 15]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 10.5；IQR [8.5, 14]；[8, 15]；已知/未知 14/0 |
| native-team/完成 | 14 | 10.5；IQR [8.5, 14]；[8, 15]；已知/未知 14/0 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 18.5；IQR [12.5, 29.75]；[11, 43]；已知/未知 14/0 |
| atn-adaptive/完成 | 10 | 23.5；IQR [17.75, 40]；[11, 44]；已知/未知 10/0 |
| atn-adaptive/失败 | 4 | 13；IQR [11.25, 14]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 | 1.00 | 未建立差异 |
| single − independent-pool | -15；IQR [-15, -15]；[-15, -15]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − native-team | -10.5；IQR [-14, -8.5]；[-15, -8]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − atn-adaptive | -18.5；IQR [-29.75, -12.5]；[-43, -11]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − independent-pool | -15；IQR [-15, -15]；[-15, -15]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − native-team | -10.5；IQR [-14, -8.5]；[-15, -8]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − atn-adaptive | -18.5；IQR [-29.75, -12.5]；[-43, -11]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − native-team | 4.5；IQR [1, 6.5]；[0, 7]；已知/未知 14/0 | 0.0674 | 未建立差异 |
| independent-pool − atn-adaptive | -3.5；IQR [-14.75, 2.5]；[-28, 4]；已知/未知 14/0 | 1.00 | 未建立差异 |
| native-team − atn-adaptive | -9.5；IQR [-15.75, -1]；[-30, -1]；已知/未知 14/0 | 0.0518 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ single-scaffolded；independent-pool ≈ native-team；independent-pool ≈ atn-adaptive；native-team ≈ atn-adaptive。

### 传输字节

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 |
| single/完成 | 9 | 0；IQR [0, 0]；[0, 0]；已知/未知 9/0 |
| single/失败 | 5 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 0；IQR [0, 0]；[0, 0]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 0；IQR [0, 0]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 3,523；IQR [3,414.5, 3,931.75]；[3,328, 4,666]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 3,633.5；IQR [3,476, 4,159]；[3,437, 4,666]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 3,367.5；IQR [3,347.75, 3,387.25]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 13,552.5；IQR [11,666.5, 17,582.75]；[7,889, 20,008]；已知/未知 14/0 |
| native-team/完成 | 14 | 13,552.5；IQR [11,666.5, 17,582.75]；[7,889, 20,008]；已知/未知 14/0 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 25,422.5；IQR [15,397, 36,389]；[14,101, 47,461]；已知/未知 14/0 |
| atn-adaptive/完成 | 10 | 34,476.5；IQR [21,892.75, 44,786.75]；[15,658, 57,398]；已知/未知 10/0 |
| atn-adaptive/失败 | 4 | 14,705.5；IQR [12,673.25, 16,370.25]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 | 1.00 | 未建立差异 |
| single − independent-pool | -3,523；IQR [-3,931.75, -3,414.5]；[-4,666, -3,328]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − native-team | -13,552.5；IQR [-17,582.75, -11,666.5]；[-20,008, -7,889]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − atn-adaptive | -25,422.5；IQR [-36,389, -15,397]；[-47,461, -14,101]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − independent-pool | -3,523；IQR [-3,931.75, -3,414.5]；[-4,666, -3,328]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − native-team | -13,552.5；IQR [-17,582.75, -11,666.5]；[-20,008, -7,889]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − atn-adaptive | -25,422.5；IQR [-36,389, -15,397]；[-47,461, -14,101]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − native-team | -9,535；IQR [-13,933, -7,670.5]；[-16,367, -2,619]；已知/未知 14/0 | 0.00549 | 是（负值表示 A 更少） |
| independent-pool − atn-adaptive | -21,033.5；IQR [-32,537.25, -12,070]；[-42,096, -10,563]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| native-team − atn-adaptive | -14,396.5；IQR [-28,278.5, -331.5]；[-33,797, 3,923]；已知/未知 14/0 | 0.359 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ single-scaffolded；native-team ≈ atn-adaptive。

### 入口步数

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 7；IQR [6, 7]；[6, 10]；已知/未知 14/0 |
| single/完成 | 9 | 7；IQR [6, 10]；[6, 10]；已知/未知 9/0 |
| single/失败 | 5 | 7；IQR [6, 7]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 18；IQR [17, 18]；[17, 18]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 18；IQR [17, 18]；[17, 18]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 18；IQR [18, 18]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 6；IQR [5.25, 7]；[5, 7]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 6；IQR [5, 7]；[5, 7]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 7；IQR [7, 7]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 15.5；IQR [14, 18.5]；[14, 19]；已知/未知 14/0 |
| native-team/完成 | 14 | 15.5；IQR [14, 18.5]；[14, 19]；已知/未知 14/0 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 12；IQR [9.25, 14]；[8, 14]；已知/未知 14/0 |
| atn-adaptive/完成 | 10 | 14；IQR [12, 14]；[10, 18]；已知/未知 10/0 |
| atn-adaptive/失败 | 4 | 7.5；IQR [7, 8.75]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | -11；IQR [-11, -10]；[-12, -8]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − independent-pool | 1；IQR [0, 2.75]；[-1, 3]；已知/未知 14/0 | 0.453 | 未建立差异 |
| single − native-team | -8；IQR [-11.5, -7]；[-12, -5]；已知/未知 14/0 | 0.0110 | 是（负值表示 A 更少） |
| single − atn-adaptive | -4；IQR [-7.75, -2]；[-8, -1]；已知/未知 14/0 | 0.0110 | 是（负值表示 A 更少） |
| single-scaffolded − independent-pool | 12；IQR [10.25, 12]；[10, 13]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − native-team | 2；IQR [-0.75, 3.75]；[-1, 4]；已知/未知 14/0 | 0.453 | 未建立差异 |
| single-scaffolded − atn-adaptive | 5.5；IQR [3.25, 8]；[3, 10]；已知/未知 14/0 | 0.0137 | 是（负值表示 A 更少） |
| independent-pool − native-team | -9.5；IQR [-12.5, -7.25]；[-15, -7]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − atn-adaptive | -6.5；IQR [-8, -3]；[-9, -1]；已知/未知 14/0 | 0.00342 | 是（负值表示 A 更少） |
| native-team − atn-adaptive | 4；IQR [1.25, 6.75]；[0, 7]；已知/未知 14/0 | 0.0674 | 未建立差异 |

未观察到可区分差异的臂对：single ≈ independent-pool；single-scaffolded ≈ native-team；native-team ≈ atn-adaptive。

### 全部工具启动次数（补充测量）

| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |
|---|---:|---|
| single/全部 | 14 | 50；IQR [50, 50]；[49, 50]；已知/未知 14/0 |
| single/完成 | 9 | 50；IQR [50, 50]；[50, 50]；已知/未知 9/0 |
| single/失败 | 5 | 49；IQR [49, 50]；95% CI 不可估计；已知/未知 5/0 |
| single-scaffolded/全部 | 14 | 50；IQR [50, 50]；[50, 50]；已知/未知 14/0 |
| single-scaffolded/完成 | 13 | 50；IQR [50, 50]；[50, 50]；已知/未知 13/0 |
| single-scaffolded/失败 | 1 | 50；IQR [50, 50]；95% CI 不可估计；已知/未知 1/0 |
| independent-pool/全部 | 14 | 110；IQR [110, 111]；[110, 112]；已知/未知 14/0 |
| independent-pool/完成 | 12 | 110；IQR [110, 111]；[110, 111]；已知/未知 12/0 |
| independent-pool/失败 | 2 | 111.5；IQR [110.75, 112.25]；95% CI 不可估计；已知/未知 2/0 |
| native-team/全部 | 14 | 211.5；IQR [185.25, 229]；[182, 235]；已知/未知 14/0 |
| native-team/完成 | 14 | 211.5；IQR [185.25, 229]；[182, 235]；已知/未知 14/0 |
| native-team/失败 | 0 | 未知；IQR [未知, 未知]；95% CI 不可估计；已知/未知 0/0 |
| atn-adaptive/全部 | 14 | 158.5；IQR [127.5, 177]；[124, 182]；已知/未知 14/0 |
| atn-adaptive/完成 | 10 | 170；IQR [137.25, 181]；[126, 207]；已知/未知 10/0 |
| atn-adaptive/失败 | 4 | 141；IQR [121, 158.25]；95% CI 不可估计；已知/未知 4/0 |

| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |
|---|---|---:|---|
| single − single-scaffolded | 0；IQR [0, 0]；[-1, 0]；已知/未知 14/0 | 0.625 | 未建立差异 |
| single − independent-pool | -60.5；IQR [-61, -60]；[-63, -60]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − native-team | -162；IQR [-179, -135.5]；[-184, -132]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single − atn-adaptive | -108.5；IQR [-127, -78.25]；[-132, -74]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − independent-pool | -60；IQR [-61, -60]；[-62, -60]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − native-team | -161.5；IQR [-179, -135.25]；[-185, -132]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| single-scaffolded − atn-adaptive | -108.5；IQR [-127, -77.5]；[-132, -74]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − native-team | -101；IQR [-119, -74.75]；[-125, -72]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| independent-pool − atn-adaptive | -46.5；IQR [-67, -15.75]；[-68, -14]；已知/未知 14/0 | 0.00122 | 是（负值表示 A 更少） |
| native-team − atn-adaptive | 52；IQR [9.25, 84]；[8, 97]；已知/未知 14/0 | 0.00366 | 是（负值表示 A 更少） |

未观察到可区分差异的臂对：single ≈ single-scaffolded。

### 已知 token 部分与未知覆盖

| 臂/分组 | input+output 已知部分 | 完整/不完整运行 | 输入已知/未知调用 | 输出已知/未知调用 | 未结算调用 | 缺失遥测运行 |
|---|---:|---|---|---|---:|---:|
| single/全部 | 843,012 | 14/0 | 109/0 | 109/0 | 0 | 0 |
| single/完成 | 541,709 | 9/0 | 76/0 | 76/0 | 0 | 0 |
| single/失败 | 301,303 | 5/0 | 33/0 | 33/0 | 0 | 0 |
| single-scaffolded/全部 | 826,459 | 14/0 | 247/0 | 247/0 | 0 | 0 |
| single-scaffolded/完成 | 763,336 | 13/0 | 229/0 | 229/0 | 0 | 0 |
| single-scaffolded/失败 | 63,123 | 1/0 | 18/0 | 18/0 | 0 | 0 |
| independent-pool/全部 | 2,034,757 | 14/0 | 517/0 | 517/0 | 0 | 0 |
| independent-pool/完成 | 1,735,711 | 12/0 | 440/0 | 440/0 | 0 | 0 |
| independent-pool/失败 | 299,046 | 2/0 | 77/0 | 77/0 | 0 | 0 |
| native-team/全部 | 4,131,263 | 12/2 | 1009/2 | 1009/2 | 0 | 0 |
| native-team/完成 | 4,131,263 | 12/2 | 1009/2 | 1009/2 | 0 | 0 |
| native-team/失败 | 未知 | 0/0 | 0/0 | 0/0 | 0 | 0 |
| atn-adaptive/全部 | 3,642,154 | 10/4 | 665/6 | 665/6 | 0 | 0 |
| atn-adaptive/完成 | 2,929,817 | 6/4 | 538/6 | 538/6 | 0 | 0 |
| atn-adaptive/失败 | 712,337 | 4/0 | 127/0 | 127/0 | 0 | 0 |

已知部分不是完整总量；完全缺失遥测运行的调用数未知，表中已记录未知调用数不代表完整覆盖。inputTokens 不含 cacheRead/cacheWrite；reasoning 已包含在 output，不重复相加。provider totalTokens 不替代此口径。峰值取单次 inputTokens，已知下界不是完整峰值，不能据此声称上下文充足。

## 截断与单次输出余量（仅报告）

| 臂 | 截断调用/涉及运行（已观察下界） | 最大单次输出完整值/已知下界 | 完整余量 | 输出已知/未知调用 | 截断未知调用/不完整运行 | 调用覆盖未知运行 |
|---|---|---|---|---|---|---:|
| single | 1/1 | 8,192/8,192 | 0.00% | 109/0 | 0/0 | 0 |
| single-scaffolded | 0/0 | 6,580/6,580 | 19.68% | 247/0 | 0/0 | 0 |
| independent-pool | 0/0 | 8,037/8,037 | 1.89% | 517/0 | 0/0 | 0 |
| native-team | 5/4 | 未知/8,192 | 未知 | 1009/2 | 3/3 | 0 |
| atn-adaptive | 6/4 | 未知/8,192 | 未知 | 665/6 | 8/6 | 0 |

| 臂 | 每运行截断数中位数/IQR/95%/已知未知 | 每运行最大输出中位数/IQR/95%/已知未知 | 每运行余量比例中位数/IQR/95%/已知未知 | 涉及运行比例 Wilson 95%（已知/未知） |
|---|---|---|---|---|
| single | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 | 5,050；IQR [3,580, 6,478.25]；[2,856, 6,644]；已知/未知 14/0 | 0.38；IQR [0.21, 0.56]；[0.19, 0.65]；已知/未知 14/0 | 7.14% [1.27%, 31.47%]（14/0） |
| single-scaffolded | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 | 2,405；IQR [2,148, 2,880.75]；[1,870, 4,036]；已知/未知 14/0 | 0.71；IQR [0.65, 0.74]；[0.51, 0.77]；已知/未知 14/0 | 0.00% [0.00%, 21.53%]（14/0） |
| independent-pool | 0；IQR [0, 0]；[0, 0]；已知/未知 14/0 | 5,331；IQR [4,544.5, 5,935.75]；[4,048, 6,096]；已知/未知 14/0 | 0.35；IQR [0.28, 0.45]；[0.26, 0.51]；已知/未知 14/0 | 0.00% [0.00%, 21.53%]（14/0） |
| native-team | 0；IQR [0, 1]；[0, 1]；已知/未知 11/3 | 6,998；IQR [6,428, 8,192]；[6,383, 8,192]；已知/未知 12/2 | 0.15；IQR [0, 0.22]；[0, 0.22]；已知/未知 12/2 | 36.36% [15.17%, 64.62%]（11/3） |
| atn-adaptive | 0；IQR [0, 1]；[0, 2]；已知/未知 8/6 | 7,286；IQR [5,992, 8,192]；[5,082, 8,192]；已知/未知 10/4 | 0.11；IQR [0, 0.27]；[0, 0.38]；已知/未知 10/4 | 44.44% [18.88%, 73.33%]（9/5） |

截断按 finishReason=max-tokens/length 或 outputTokens≥8192，每调用只计一次。有未知覆盖时计数仅是已观察下界；截断比例的区间只覆盖状态已知运行，未知数另列。余量=1−该运行最大单次输出/8192；余量比例表的单位为 0–1。输出、终止原因与调用覆盖未知均保留，已知输出下界不能证明余量充足。没有截断率或余量放行阈值。

## 正向事实流审计缺口（仅报告）

| 臂 | 通过/缺口/审计未知运行 | 无提交运行 | 正向完成证据/该字段未知运行 | 提交事实已知合计/未知运行 | 审计事实已知合计/未知运行 | 发送边界未知已知合计/未知运行 |
|---|---|---:|---|---|---|---|
| single | 14/0/0 | 2 | 12/0 | 192/0 | 192/0 | 0/0 |
| single-scaffolded | 14/0/0 | 0 | 14/0 | 224/0 | 224/0 | 0/0 |
| independent-pool | 14/0/0 | 0 | 14/0 | 224/0 | 224/0 | 0/0 |
| native-team | 9/5/0 | 0 | 9/0 | 224/0 | 173/0 | 0/0 |
| atn-adaptive | 11/3/0 | 3 | 8/0 | 176/0 | 145/0 | 0/0 |

审计缺口意味着来源证据未建立，按未知保留，不补零，不记成作弊或模型推理失败。无提交运行的审计通过不等于存在正向完成证据。全部真实运行仍执行审计，缺口不作为主批次闸门。

## 每运行保留记录

| 臂 | seed | 精确通过 | stopReason | 调用/入口步 | 墙钟 ms | 完整峰值/已知下界 | 截断调用/未知调用 | 审计通过/缺口 |
|---|---:|---|---|---|---:|---|---|---|
| single | 2026100801 | true | submitted | 6/6 | 115,778 | 12,170/12,170 | 0/0 | true； |
| single | 2026100802 | false | submitted | 7/7 | 95,021 | 7,692/7,692 | 0/0 | true； |
| single | 2026100803 | false | submitted | 7/7 | 106,492 | 10,054/10,054 | 0/0 | true； |
| single | 2026100804 | true | submitted | 6/6 | 99,305 | 9,671/9,671 | 0/0 | true； |
| single | 2026100805 | true | submitted | 10/10 | 109,579 | 6,011/6,011 | 0/0 | true； |
| single | 2026100806 | true | submitted | 7/7 | 107,780 | 9,954/9,954 | 0/0 | true； |
| single | 2026100807 | false | quiescent-without-submission | 7/7 | 128,215 | 8,402/8,402 | 0/0 | true； |
| single | 2026100808 | true | submitted | 17/17 | 139,709 | 3,525/3,525 | 0/0 | true； |
| single | 2026100809 | true | submitted | 7/7 | 96,924 | 7,984/7,984 | 0/0 | true； |
| single | 2026100810 | false | final-text | 6/6 | 102,079 | 11,035/11,035 | 0/0 | true； |
| single | 2026100811 | true | submitted | 6/6 | 73,254 | 9,484/9,484 | 0/0 | true； |
| single | 2026100812 | true | submitted | 7/7 | 112,798 | 9,059/9,059 | 0/0 | true； |
| single | 2026100813 | true | submitted | 10/10 | 101,653 | 5,552/5,552 | 0/0 | true； |
| single | 2026100814 | false | quiescent-without-submission | 6/6 | 105,659 | 15,218/15,218 | 1/0 | true； |
| single-scaffolded | 2026100801 | true | submitted | 18/18 | 159,733 | 2,714/2,714 | 0/0 | true； |
| single-scaffolded | 2026100802 | true | submitted | 18/18 | 99,491 | 3,117/3,117 | 0/0 | true； |
| single-scaffolded | 2026100803 | true | submitted | 17/17 | 125,646 | 3,522/3,522 | 0/0 | true； |
| single-scaffolded | 2026100804 | true | submitted | 18/18 | 104,583 | 3,524/3,524 | 0/0 | true； |
| single-scaffolded | 2026100805 | true | submitted | 17/17 | 119,064 | 3,506/3,506 | 0/0 | true； |
| single-scaffolded | 2026100806 | true | submitted | 17/17 | 99,748 | 3,078/3,078 | 0/0 | true； |
| single-scaffolded | 2026100807 | false | submitted | 18/18 | 121,586 | 2,813/2,813 | 0/0 | true； |
| single-scaffolded | 2026100808 | true | submitted | 18/18 | 156,407 | 3,263/3,263 | 0/0 | true； |
| single-scaffolded | 2026100809 | true | submitted | 18/18 | 101,255 | 2,773/2,773 | 0/0 | true； |
| single-scaffolded | 2026100810 | true | submitted | 17/17 | 123,734 | 3,136/3,136 | 0/0 | true； |
| single-scaffolded | 2026100811 | true | submitted | 17/17 | 109,671 | 3,438/3,438 | 0/0 | true； |
| single-scaffolded | 2026100812 | true | submitted | 18/18 | 120,603 | 3,035/3,035 | 0/0 | true； |
| single-scaffolded | 2026100813 | true | submitted | 18/18 | 114,965 | 2,971/2,971 | 0/0 | true； |
| single-scaffolded | 2026100814 | true | submitted | 18/18 | 143,349 | 3,127/3,127 | 0/0 | true； |
| independent-pool | 2026100801 | false | submitted | 40/7 | 129,348 | 7,735/7,735 | 0/0 | true； |
| independent-pool | 2026100802 | true | submitted | 37/7 | 139,238 | 10,401/10,401 | 0/0 | true； |
| independent-pool | 2026100803 | true | submitted | 35/5 | 101,322 | 12,830/12,830 | 0/0 | true； |
| independent-pool | 2026100804 | true | submitted | 36/6 | 125,399 | 10,780/10,780 | 0/0 | true； |
| independent-pool | 2026100805 | false | submitted | 37/7 | 116,024 | 8,262/8,262 | 0/0 | true； |
| independent-pool | 2026100806 | true | submitted | 40/7 | 120,945 | 6,944/6,944 | 0/0 | true； |
| independent-pool | 2026100807 | true | submitted | 36/6 | 117,495 | 10,118/10,118 | 0/0 | true； |
| independent-pool | 2026100808 | true | submitted | 36/6 | 95,137 | 9,974/9,974 | 0/0 | true； |
| independent-pool | 2026100809 | true | submitted | 34/4 | 95,366 | 17,161/17,161 | 0/0 | true； |
| independent-pool | 2026100810 | true | submitted | 41/9 | 105,389 | 6,203/6,203 | 0/0 | true； |
| independent-pool | 2026100811 | true | submitted | 37/7 | 108,234 | 10,936/10,936 | 0/0 | true； |
| independent-pool | 2026100812 | true | submitted | 37/6 | 98,415 | 10,199/10,199 | 0/0 | true； |
| independent-pool | 2026100813 | true | submitted | 36/5 | 107,673 | 11,746/11,746 | 0/0 | true； |
| independent-pool | 2026100814 | true | submitted | 35/5 | 98,091 | 11,580/11,580 | 0/0 | true； |
| native-team | 2026100801 | true | submitted | 108/23 | 565,691 | 未知/52,967 | 0/1 | true； |
| native-team | 2026100802 | true | submitted | 82/12 | 199,476 | 14,651/14,651 | 0/0 | true； |
| native-team | 2026100803 | true | submitted | 75/21 | 145,147 | 7,314/7,314 | 0/0 | false；missing-positive-source-path:shard-04; missing-positive-source-path:shard-05; missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-08; missing-positive-source-path:shard-09; missing-positive-source-path:shard-10; missing-positive-source-path:shard-11; missing-positive-source-path:shard-12; missing-positive-source-path:shard-13; missing-positive-source-path:shard-14; missing-positive-source-path:shard-15; missing-positive-source-path:shard-16 |
| native-team | 2026100804 | true | submitted | 61/13 | 334,780 | 66,209/66,209 | 1/0 | true； |
| native-team | 2026100805 | true | submitted | 93/17 | 199,487 | 8,690/8,690 | 0/1 | false；missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-08; missing-positive-source-path:shard-10; missing-positive-source-path:shard-11; missing-positive-source-path:shard-12; missing-positive-source-path:shard-15; missing-positive-source-path:shard-16 |
| native-team | 2026100806 | true | submitted | 54/15 | 216,452 | 11,813/11,813 | 1/0 | true； |
| native-team | 2026100807 | true | submitted | 90/17 | 174,681 | 9,117/9,117 | 0/0 | false；missing-positive-source-path:shard-03; missing-positive-source-path:shard-04; missing-positive-source-path:shard-05; missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-08; missing-positive-source-path:shard-09; missing-positive-source-path:shard-10; missing-positive-source-path:shard-11; missing-positive-source-path:shard-12; missing-positive-source-path:shard-13; missing-positive-source-path:shard-14 |
| native-team | 2026100808 | true | submitted | 60/16 | 151,815 | 8,497/8,497 | 0/0 | true； |
| native-team | 2026100809 | true | submitted | 51/19 | 257,665 | 10,955/10,955 | 2/0 | true； |
| native-team | 2026100810 | true | submitted | 69/14 | 349,985 | 16,878/16,878 | 1/0 | false；missing-positive-source-path:shard-02; missing-positive-source-path:shard-03; missing-positive-source-path:shard-04; missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-11; missing-positive-source-path:shard-13; missing-positive-source-path:shard-15 |
| native-team | 2026100811 | true | submitted | 61/14 | 282,133 | 10,746/10,746 | 0/0 | true； |
| native-team | 2026100812 | true | submitted | 75/19 | 150,020 | 未知/4,504 | 0/1 | false；missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-08; missing-positive-source-path:shard-10; missing-positive-source-path:shard-11; missing-positive-source-path:shard-12; missing-positive-source-path:shard-13; missing-positive-source-path:shard-14; missing-positive-source-path:shard-15; missing-positive-source-path:shard-16 |
| native-team | 2026100813 | true | submitted | 58/14 | 209,262 | 12,719/12,719 | 0/0 | true； |
| native-team | 2026100814 | true | submitted | 74/14 | 177,577 | 11,274/11,274 | 0/0 | true； |
| atn-adaptive | 2026100801 | false | quiescent-without-submission | 33/7 | 125,477 | 13,038/13,038 | 0/0 | true； |
| atn-adaptive | 2026100802 | true | submitted | 40/10 | 159,820 | 44,266/44,266 | 0/0 | true； |
| atn-adaptive | 2026100803 | true | submitted | 54/14 | 131,179 | 未知/7,798 | 0/1 | true； |
| atn-adaptive | 2026100804 | true | submitted | 51/14 | 172,362 | 未知/40,485 | 0/1 | true； |
| atn-adaptive | 2026100805 | true | submitted | 118/12 | 174,555 | 未知/38,203 | 0/2 | false；missing-positive-source-path:shard-05; missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-08; missing-positive-source-path:shard-09; missing-positive-source-path:shard-10; missing-positive-source-path:shard-11; missing-positive-source-path:shard-12; missing-positive-source-path:shard-13; missing-positive-source-path:shard-14; missing-positive-source-path:shard-15; missing-positive-source-path:shard-16 |
| atn-adaptive | 2026100806 | true | submitted | 48/31 | 177,136 | 9,835/9,835 | 2/1 | true； |
| atn-adaptive | 2026100807 | true | submitted | 75/14 | 235,937 | 15,050/15,050 | 0/0 | false；missing-positive-source-path:shard-03; missing-positive-source-path:shard-04; missing-positive-source-path:shard-05; missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-08; missing-positive-source-path:shard-11; missing-positive-source-path:shard-12; missing-positive-source-path:shard-13; missing-positive-source-path:shard-14; missing-positive-source-path:shard-16 |
| atn-adaptive | 2026100808 | false | quiescent-without-submission | 32/7 | 126,977 | 14,109/14,109 | 2/0 | true； |
| atn-adaptive | 2026100809 | true | submitted | 41/12 | 154,090 | 未知/18,427 | 0/2 | true； |
| atn-adaptive | 2026100810 | true | submitted | 27/9 | 144,925 | 12,992/12,992 | 0/0 | true； |
| atn-adaptive | 2026100811 | true | submitted | 36/14 | 137,816 | 14,982/14,982 | 0/0 | true； |
| atn-adaptive | 2026100812 | true | submitted | 54/18 | 212,038 | 18,636/18,636 | 1/0 | false；missing-positive-source-path:shard-03; missing-positive-source-path:shard-04; missing-positive-source-path:shard-05; missing-positive-source-path:shard-06; missing-positive-source-path:shard-07; missing-positive-source-path:shard-08; missing-positive-source-path:shard-13; missing-positive-source-path:shard-14 |
| atn-adaptive | 2026100813 | false | submitted | 40/11 | 137,300 | 14,492/14,492 | 0/1 | true； |
| atn-adaptive | 2026100814 | false | quiescent-without-submission | 22/8 | 199,185 | 33,126/33,126 | 1/0 | true； |

| 臂 | seed | 每 Agent 映射完整 | 每 Agent 完整峰值（已知下界） |
|---|---:|---|---|
| single | 2026100801 | true | agent-1: 12,170（12,170） |
| single | 2026100802 | true | agent-1: 7,692（7,692） |
| single | 2026100803 | true | agent-1: 10,054（10,054） |
| single | 2026100804 | true | agent-1: 9,671（9,671） |
| single | 2026100805 | true | agent-1: 6,011（6,011） |
| single | 2026100806 | true | agent-1: 9,954（9,954） |
| single | 2026100807 | true | agent-1: 8,402（8,402） |
| single | 2026100808 | true | agent-1: 3,525（3,525） |
| single | 2026100809 | true | agent-1: 7,984（7,984） |
| single | 2026100810 | true | agent-1: 11,035（11,035） |
| single | 2026100811 | true | agent-1: 9,484（9,484） |
| single | 2026100812 | true | agent-1: 9,059（9,059） |
| single | 2026100813 | true | agent-1: 5,552（5,552） |
| single | 2026100814 | true | agent-1: 15,218（15,218） |
| single-scaffolded | 2026100801 | true | agent-1: 2,714（2,714） |
| single-scaffolded | 2026100802 | true | agent-1: 3,117（3,117） |
| single-scaffolded | 2026100803 | true | agent-1: 3,522（3,522） |
| single-scaffolded | 2026100804 | true | agent-1: 3,524（3,524） |
| single-scaffolded | 2026100805 | true | agent-1: 3,506（3,506） |
| single-scaffolded | 2026100806 | true | agent-1: 3,078（3,078） |
| single-scaffolded | 2026100807 | true | agent-1: 2,813（2,813） |
| single-scaffolded | 2026100808 | true | agent-1: 3,263（3,263） |
| single-scaffolded | 2026100809 | true | agent-1: 2,773（2,773） |
| single-scaffolded | 2026100810 | true | agent-1: 3,136（3,136） |
| single-scaffolded | 2026100811 | true | agent-1: 3,438（3,438） |
| single-scaffolded | 2026100812 | true | agent-1: 3,035（3,035） |
| single-scaffolded | 2026100813 | true | agent-1: 2,971（2,971） |
| single-scaffolded | 2026100814 | true | agent-1: 3,127（3,127） |
| independent-pool | 2026100801 | true | agent-1: 7,735（7,735）；agent-2: 2,082（2,082）；agent-3: 2,182（2,182）；agent-4: 2,180（2,180）；agent-5: 2,191（2,191）；agent-6: 2,197（2,197）；agent-7: 2,207（2,207）；agent-8: 2,197（2,197）；agent-9: 2,183（2,183）；agent-10: 2,184（2,184）；agent-11: 2,182（2,182）；agent-12: 2,195（2,195）；agent-13: 2,226（2,226）；agent-14: 2,215（2,215）；agent-15: 2,221（2,221）；agent-16: 2,182（2,182） |
| independent-pool | 2026100802 | true | agent-1: 10,401（10,401）；agent-2: 2,227（2,227）；agent-3: 2,271（2,271）；agent-4: 2,223（2,223）；agent-5: 2,182（2,182）；agent-6: 2,187（2,187）；agent-7: 2,180（2,180）；agent-8: 2,182（2,182）；agent-9: 2,182（2,182）；agent-10: 2,202（2,202）；agent-11: 2,218（2,218）；agent-12: 2,195（2,195）；agent-13: 2,182（2,182）；agent-14: 2,215（2,215）；agent-15: 2,186（2,186）；agent-16: 2,195（2,195） |
| independent-pool | 2026100803 | true | agent-1: 12,830（12,830）；agent-2: 2,183（2,183）；agent-3: 2,187（2,187）；agent-4: 2,187（2,187）；agent-5: 2,204（2,204）；agent-6: 2,221（2,221）；agent-7: 2,182（2,182）；agent-8: 2,188（2,188）；agent-9: 2,182（2,182）；agent-10: 2,186（2,186）；agent-11: 2,228（2,228）；agent-12: 2,189（2,189）；agent-13: 2,231（2,231）；agent-14: 2,203（2,203）；agent-15: 2,302（2,302）；agent-16: 2,201（2,201） |
| independent-pool | 2026100804 | true | agent-1: 10,780（10,780）；agent-2: 2,216（2,216）；agent-3: 2,203（2,203）；agent-4: 2,237（2,237）；agent-5: 2,213（2,213）；agent-6: 2,187（2,187）；agent-7: 2,210（2,210）；agent-8: 2,219（2,219）；agent-9: 2,227（2,227）；agent-10: 2,220（2,220）；agent-11: 2,215（2,215）；agent-12: 2,217（2,217）；agent-13: 2,186（2,186）；agent-14: 2,191（2,191）；agent-15: 2,182（2,182）；agent-16: 2,226（2,226） |
| independent-pool | 2026100805 | true | agent-1: 8,262（8,262）；agent-2: 2,203（2,203）；agent-3: 2,182（2,182）；agent-4: 2,182（2,182）；agent-5: 2,187（2,187）；agent-6: 2,182（2,182）；agent-7: 2,206（2,206）；agent-8: 2,183（2,183）；agent-9: 2,183（2,183）；agent-10: 2,180（2,180）；agent-11: 2,203（2,203）；agent-12: 2,179（2,179）；agent-13: 2,179（2,179）；agent-14: 2,182（2,182）；agent-15: 2,187（2,187）；agent-16: 2,182（2,182） |
| independent-pool | 2026100806 | true | agent-1: 6,944（6,944）；agent-2: 2,186（2,186）；agent-3: 2,204（2,204）；agent-4: 2,182（2,182）；agent-5: 2,205（2,205）；agent-6: 2,196（2,196）；agent-7: 3,414（3,414）；agent-8: 2,186（2,186）；agent-9: 2,195（2,195）；agent-10: 2,215（2,215）；agent-11: 2,182（2,182）；agent-12: 2,187（2,187）；agent-13: 2,183（2,183）；agent-14: 2,183（2,183）；agent-15: 2,182（2,182）；agent-16: 2,234（2,234） |
| independent-pool | 2026100807 | true | agent-1: 10,118（10,118）；agent-2: 2,215（2,215）；agent-3: 2,183（2,183）；agent-4: 2,212（2,212）；agent-5: 2,264（2,264）；agent-6: 2,196（2,196）；agent-7: 2,206（2,206）；agent-8: 2,210（2,210）；agent-9: 2,183（2,183）；agent-10: 2,212（2,212）；agent-11: 2,187（2,187）；agent-12: 2,192（2,192）；agent-13: 2,206（2,206）；agent-14: 2,182（2,182）；agent-15: 2,195（2,195）；agent-16: 2,227（2,227） |
| independent-pool | 2026100808 | true | agent-1: 9,974（9,974）；agent-2: 2,191（2,191）；agent-3: 2,182（2,182）；agent-4: 2,182（2,182）；agent-5: 2,202（2,202）；agent-6: 2,216（2,216）；agent-7: 2,182（2,182）；agent-8: 2,180（2,180）；agent-9: 2,220（2,220）；agent-10: 2,248（2,248）；agent-11: 2,183（2,183）；agent-12: 2,190（2,190）；agent-13: 2,190（2,190）；agent-14: 2,178（2,178）；agent-15: 2,212（2,212）；agent-16: 2,182（2,182） |
| independent-pool | 2026100809 | true | agent-1: 17,161（17,161）；agent-2: 2,241（2,241）；agent-3: 2,203（2,203）；agent-4: 2,196（2,196）；agent-5: 2,182（2,182）；agent-6: 2,200（2,200）；agent-7: 2,196（2,196）；agent-8: 2,202（2,202）；agent-9: 2,180（2,180）；agent-10: 2,196（2,196）；agent-11: 2,215（2,215）；agent-12: 2,208（2,208）；agent-13: 2,225（2,225）；agent-14: 2,190（2,190）；agent-15: 2,183（2,183）；agent-16: 2,207（2,207） |
| independent-pool | 2026100810 | true | agent-1: 6,203（6,203）；agent-2: 2,186（2,186）；agent-3: 2,190（2,190）；agent-4: 2,214（2,214）；agent-5: 2,183（2,183）；agent-6: 2,182（2,182）；agent-7: 2,204（2,204）；agent-8: 2,186（2,186）；agent-9: 2,200（2,200）；agent-10: 2,183（2,183）；agent-11: 2,199（2,199）；agent-12: 2,182（2,182）；agent-13: 2,195（2,195）；agent-14: 2,183（2,183）；agent-15: 2,180（2,180）；agent-16: 3,669（3,669） |
| independent-pool | 2026100811 | true | agent-1: 10,936（10,936）；agent-2: 2,190（2,190）；agent-3: 2,183（2,183）；agent-4: 2,182（2,182）；agent-5: 2,183（2,183）；agent-6: 2,182（2,182）；agent-7: 2,195（2,195）；agent-8: 2,216（2,216）；agent-9: 2,199（2,199）；agent-10: 2,183（2,183）；agent-11: 2,191（2,191）；agent-12: 2,200（2,200）；agent-13: 2,201（2,201）；agent-14: 2,186（2,186）；agent-15: 2,194（2,194）；agent-16: 2,206（2,206） |
| independent-pool | 2026100812 | true | agent-1: 10,199（10,199）；agent-2: 2,205（2,205）；agent-3: 2,216（2,216）；agent-4: 2,186（2,186）；agent-5: 2,179（2,179）；agent-6: 2,185（2,185）；agent-7: 2,211（2,211）；agent-8: 2,187（2,187）；agent-9: 2,187（2,187）；agent-10: 2,182（2,182）；agent-11: 2,209（2,209）；agent-12: 2,195（2,195）；agent-13: 2,210（2,210）；agent-14: 2,195（2,195）；agent-15: 2,195（2,195）；agent-16: 2,205（2,205） |
| independent-pool | 2026100813 | true | agent-1: 11,746（11,746）；agent-2: 3,514（3,514）；agent-3: 2,185（2,185）；agent-4: 2,186（2,186）；agent-5: 2,196（2,196）；agent-6: 2,213（2,213）；agent-7: 2,187（2,187）；agent-8: 2,186（2,186）；agent-9: 2,197（2,197）；agent-10: 2,215（2,215）；agent-11: 2,182（2,182）；agent-12: 2,195（2,195）；agent-13: 2,187（2,187）；agent-14: 2,187（2,187）；agent-15: 2,203（2,203）；agent-16: 2,219（2,219） |
| independent-pool | 2026100814 | true | agent-1: 11,580（11,580）；agent-2: 2,181（2,181）；agent-3: 2,202（2,202）；agent-4: 2,188（2,188）；agent-5: 2,222（2,222）；agent-6: 2,187（2,187）；agent-7: 2,185（2,185）；agent-8: 2,231（2,231）；agent-9: 2,183（2,183）；agent-10: 2,189（2,189）；agent-11: 2,195（2,195）；agent-12: 2,206（2,206）；agent-13: 2,294（2,294）；agent-14: 2,180（2,180）；agent-15: 2,182（2,182）；agent-16: 2,212（2,212） |
| native-team | 2026100801 | true | agent-1: 52,967（52,967）；agent-2: 3,128（3,128）；agent-3: 3,313（3,313）；agent-4: 2,881（2,881）；agent-5: 3,948（3,948）；agent-6: 2,970（2,970）；agent-7: 3,135（3,135）；agent-8: 11,040（11,040）；agent-9: 未知（46,491）；agent-10: 20,809（20,809）；agent-11: 2,839（2,839） |
| native-team | 2026100802 | true | agent-1: 14,651（14,651）；agent-2: 7,057（7,057）；agent-3: 5,048（5,048）；agent-4: 7,967（7,967）；agent-5: 7,804（7,804）；agent-6: 7,388（7,388）；agent-7: 4,626（4,626）；agent-8: 5,926（5,926）；agent-9: 3,351（3,351） |
| native-team | 2026100803 | true | agent-1: 6,054（6,054）；agent-2: 7,314（7,314）；agent-3: 6,455（6,455）；agent-4: 6,383（6,383）；agent-5: 5,081（5,081）；agent-6: 6,892（6,892）；agent-7: 2,838（2,838） |
| native-team | 2026100804 | true | agent-1: 66,209（66,209）；agent-2: 6,438（6,438）；agent-3: 6,642（6,642）；agent-4: 5,713（5,713）；agent-5: 6,340（6,340）；agent-6: 9,846（9,846）；agent-7: 7,089（7,089）；agent-8: 8,129（8,129） |
| native-team | 2026100805 | true | agent-1: 8,690（8,690）；agent-2: 4,435（4,435）；agent-3: 4,589（4,589）；agent-4: 4,622（4,622）；agent-5: 6,360（6,360）；agent-6: 5,616（5,616）；agent-7: 6,531（6,531）；agent-8: 4,652（4,652）；agent-9: 6,535（6,535）；agent-10: 4,839（4,839）；agent-11: 6,061（6,061） |
| native-team | 2026100806 | true | agent-1: 11,813（11,813）；agent-2: 5,805（5,805）；agent-3: 6,467（6,467）；agent-4: 6,182（6,182）；agent-5: 5,866（5,866）；agent-6: 8,248（8,248）；agent-7: 10,779（10,779） |
| native-team | 2026100807 | true | agent-1: 9,117（9,117）；agent-2: 4,254（4,254）；agent-3: 4,255（4,255）；agent-4: 3,970（3,970）；agent-5: 4,883（4,883）；agent-6: 3,974（3,974）；agent-7: 3,970（3,970）；agent-8: 4,036（4,036）；agent-9: 4,254（4,254）；agent-10: 3,311（3,311）；agent-11: 6,707（6,707）；agent-12: 7,955（7,955）；agent-13: 7,035（7,035） |
| native-team | 2026100808 | true | agent-1: 5,433（5,433）；agent-2: 5,614（5,614）；agent-3: 5,653（5,653）；agent-4: 5,651（5,651）；agent-5: 6,523（6,523）；agent-6: 8,497（8,497）；agent-7: 7,218（7,218） |
| native-team | 2026100809 | true | agent-1: 7,671（7,671）；agent-2: 7,488（7,488）；agent-3: 7,691（7,691）；agent-4: 8,207（8,207）；agent-5: 7,332（7,332）；agent-6: 10,955（10,955） |
| native-team | 2026100810 | true | agent-1: 16,878（16,878）；agent-2: 4,049（4,049）；agent-3: 4,036（4,036）；agent-4: 4,037（4,037）；agent-5: 4,036（4,036）；agent-6: 4,036（4,036）；agent-7: 4,036（4,036）；agent-8: 7,487（7,487）；agent-9: 2,202（2,202）；agent-10: 9,918（9,918）；agent-11: 8,814（8,814） |
| native-team | 2026100811 | true | agent-1: 10,746（10,746）；agent-2: 7,714（7,714）；agent-3: 8,105（8,105）；agent-4: 7,445（7,445）；agent-5: 7,664（7,664）；agent-6: 7,704（7,704）；agent-7: 7,505（7,505）；agent-8: 7,502（7,502）；agent-9: 7,703（7,703） |
| native-team | 2026100812 | true | agent-1: 4,504（4,504）；agent-2: 3,080（3,080）；agent-3: 4,164（4,164）；agent-4: 2,883（2,883）；agent-5: 未知（3,205） |
| native-team | 2026100813 | true | agent-1: 12,719（12,719）；agent-2: 7,312（7,312）；agent-3: 7,053（7,053）；agent-4: 7,293（7,293）；agent-5: 7,343（7,343）；agent-6: 11,034（11,034）；agent-7: 10,370（10,370）；agent-8: 2,464（2,464） |
| native-team | 2026100814 | true | agent-1: 11,274（11,274）；agent-2: 6,766（6,766）；agent-3: 5,445（5,445）；agent-4: 4,782（4,782）；agent-5: 7,367（7,367）；agent-6: 2,917（2,917）；agent-7: 3,359（3,359）；agent-8: 4,481（4,481）；agent-9: 3,092（3,092） |
| atn-adaptive | 2026100801 | true | agent-1: 13,038（13,038）；agent-2: 4,919（4,919）；agent-3: 5,807（5,807）；agent-4: 6,484（6,484）；agent-5: 7,224（7,224） |
| atn-adaptive | 2026100802 | true | agent-1: 44,266（44,266）；agent-2: 5,736（5,736）；agent-3: 6,603（6,603）；agent-4: 4,853（4,853）；agent-5: 9,413（9,413）；agent-6: 5,446（5,446）；agent-7: 6,242（6,242）；agent-8: 4,625（4,625） |
| atn-adaptive | 2026100803 | true | agent-1: 6,890（6,890）；agent-2: 7,263（7,263）；agent-3: 6,964（6,964）；agent-4: 未知（5,731）；agent-5: 7,798（7,798） |
| atn-adaptive | 2026100804 | true | agent-1: 18,392（18,392）；agent-2: 40,485（40,485）；agent-3: 6,485（6,485）；agent-4: 未知（7,735） |
| atn-adaptive | 2026100805 | true | agent-1: 38,203（38,203）；agent-2: 3,460（3,460）；agent-3: 6,250（6,250）；agent-4: 未知（10,788）；agent-5: 未知（11,057）；agent-6: 6,401（6,401）；agent-7: 6,678（6,678）；agent-8: 7,721（7,721）；agent-9: 6,283（6,283）；agent-10: 7,666（7,666）；agent-11: 4,542（4,542）；agent-12: 4,533（4,533） |
| atn-adaptive | 2026100806 | true | agent-1: 9,835（9,835）；agent-2: 7,483（7,483）；agent-3: 8,941（8,941）；agent-4: 8,841（8,841） |
| atn-adaptive | 2026100807 | true | agent-1: 15,050（15,050）；agent-2: 7,783（7,783）；agent-3: 5,368（5,368）；agent-4: 5,132（5,132）；agent-5: 2,767（2,767）；agent-6: 3,924（3,924）；agent-7: 4,722（4,722）；agent-8: 3,796（3,796）；agent-9: 6,042（6,042）；agent-10: 6,032（6,032）；agent-11: 6,639（6,639）；agent-12: 6,206（6,206） |
| atn-adaptive | 2026100808 | true | agent-1: 14,109（14,109）；agent-2: 5,797（5,797）；agent-3: 6,493（6,493）；agent-4: 5,232（5,232）；agent-5: 3,926（3,926） |
| atn-adaptive | 2026100809 | true | agent-1: 18,427（18,427）；agent-2: 未知（8,055）；agent-3: 6,430（6,430）；agent-4: 8,891（8,891）；agent-5: 未知（2,292） |
| atn-adaptive | 2026100810 | true | agent-1: 12,992（12,992）；agent-2: 8,991（8,991）；agent-3: 7,528（7,528）；agent-4: 9,801（9,801） |
| atn-adaptive | 2026100811 | true | agent-1: 14,982（14,982）；agent-2: 6,393（6,393）；agent-3: 4,454（4,454）；agent-4: 6,464（6,464） |
| atn-adaptive | 2026100812 | true | agent-1: 18,636（18,636）；agent-2: 5,773（5,773）；agent-3: 6,722（6,722）；agent-4: 8,043（8,043）；agent-5: 4,138（4,138）；agent-6: 3,976（3,976）；agent-7: 5,812（5,812）；agent-8: 7,328（7,328） |
| atn-adaptive | 2026100813 | true | agent-1: 14,492（14,492）；agent-2: 5,223（5,223）；agent-3: 5,254（5,254）；agent-4: 6,178（6,178） |
| atn-adaptive | 2026100814 | true | agent-1: 33,126（33,126）；agent-2: 6,799（6,799）；agent-3: 8,804（8,804） |

## single-scaffolded 提示全文与哈希

single-scaffolded 与 single 使用相同模型、工具、预算、文档权限和 fixture，唯一差别为下列逐分片要求。各 seed 的完整提示在此全文给出；SHA-256 对 UTF-8 提示正文计算，生成报告时逐条核验。

新增指令全文：

```text
Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
```

完整提示覆盖：14/14 个登记 seed。

### seed 2026100801

落盘路径：`prompts/single-scaffolded-seed-2026100801.txt`；SHA-256：`cdd842f66fa725b5c8812c19666c5e872bff8bf2f83edaa2425f980446cc61ab`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100801): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100802

落盘路径：`prompts/single-scaffolded-seed-2026100802.txt`；SHA-256：`ddf3412c4e2a462236f09bd7b363142feb334127285c6f9524bc8187817b385c`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100802): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100803

落盘路径：`prompts/single-scaffolded-seed-2026100803.txt`；SHA-256：`2a88c191241ce14e45ea2915e2cc4a29a9c4824859f1bd414e32d62a6201dfd7`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100803): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100804

落盘路径：`prompts/single-scaffolded-seed-2026100804.txt`；SHA-256：`0378d82496fdb2a42555f41d4dd3f3b5445e8d72acc6a6de571227628c4d8aa6`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100804): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100805

落盘路径：`prompts/single-scaffolded-seed-2026100805.txt`；SHA-256：`3861c40a4454f66a0a86538f0db225fc86b40321261b06ddd11ae2857e210e43`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100805): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100806

落盘路径：`prompts/single-scaffolded-seed-2026100806.txt`；SHA-256：`7bdc6ad89e29f2e410a9ec9ab01f6771d28f8b41e60c60bd669e6a3a34d58157`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100806): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100807

落盘路径：`prompts/single-scaffolded-seed-2026100807.txt`；SHA-256：`18ac9b36e08d1fd9a7f1cba7b9d6282273e0036debb2a67b86324f38f39390d1`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100807): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100808

落盘路径：`prompts/single-scaffolded-seed-2026100808.txt`；SHA-256：`43acd1705b4bc308588d2efc73cacbf32ee66d77fa890fc0c9600067e30b1772`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100808): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100809

落盘路径：`prompts/single-scaffolded-seed-2026100809.txt`；SHA-256：`f5865a6786d38d1499d08d872fa8ca2bad7c63a18702c7c8fe0fbb82a9ea2630`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100809): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100810

落盘路径：`prompts/single-scaffolded-seed-2026100810.txt`；SHA-256：`af9250c67ea0852e49e1c9c1bd972e4993903e2aa92b5ea84622b6adeea4f9bf`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100810): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100811

落盘路径：`prompts/single-scaffolded-seed-2026100811.txt`；SHA-256：`4bf13886af362e55f9eb7d1ae65147757db91e66ad980e467805eb6fee8ca0c8`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100811): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100812

落盘路径：`prompts/single-scaffolded-seed-2026100812.txt`；SHA-256：`62a624a8f3d935d36f034e5582774261740bd662d49b6c396da502059f572b4f`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100812): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100813

落盘路径：`prompts/single-scaffolded-seed-2026100813.txt`；SHA-256：`f14eca3fd85f0a8e8ebed75fa9bd18f869fc3806a6324f3a014100162600f6fd`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100813): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

### seed 2026100814

落盘路径：`prompts/single-scaffolded-seed-2026100814.txt`；SHA-256：`52a588f6718b00b8f87826ff50dfe946ec33af47997b7f70936c39fbb5143ea4`。

````text
Equal-budget ledger task (revision 2, fixture seed 2026100814): Reconcile independent settlement ledgers and consolidate accounts

Reconcile all 16 independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.

Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.

Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.

Each shard contains 10 orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all 16 shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.

Document ids:
policy
shard-01/orders
shard-01/events
shard-01/corrections
shard-02/orders
shard-02/events
shard-02/corrections
shard-03/orders
shard-03/events
shard-03/corrections
shard-04/orders
shard-04/events
shard-04/corrections
shard-05/orders
shard-05/events
shard-05/corrections
shard-06/orders
shard-06/events
shard-06/corrections
shard-07/orders
shard-07/events
shard-07/corrections
shard-08/orders
shard-08/events
shard-08/corrections
shard-09/orders
shard-09/events
shard-09/corrections
shard-10/orders
shard-10/events
shard-10/corrections
shard-11/orders
shard-11/events
shard-11/corrections
shard-12/orders
shard-12/events
shard-12/corrections
shard-13/orders
shard-13/events
shard-13/corrections
shard-14/orders
shard-14/events
shard-14/corrections
shard-15/orders
shard-15/events
shard-15/corrections
shard-16/orders
shard-16/events
shard-16/corrections

Return one JSON object as the final answer, with this format:
{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.

A statement that work is completed is not an answer. Do not include prose outside the JSON object.

Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
````

## 方法与限制

- Wilson 95%; paired Tango nominal 95% score interval plus two-sided exact McNemar。Tango 是名义渐近配对区间，不是有限样本精确覆盖；零不一致对也保留非零区间宽度。
- 各指标内 10 个登记臂对分别做 Holm 校正；区间仍为名义 95%，不是同时区间，也没有跨指标家族错误率保证。可区分要求完整配对、区间排除零且校正 p<0.05。
- 连续指标用二项顺序统计中位数区间；配对差只在两臂该 seed 都已知时计算。未知和未运行必须区别，不能补零。完成条件下的成本不能证明无条件效率。
- 墙钟包含宿主初始化和结束清理，并受共享 API 延迟与限流影响；更短墙钟不能单独证明效率优势。峰值上下文不是质量指标。
- native-team 使用 Harness 自带传输，ATN 使用邮件/白板；协议成本覆盖不同。native 未包含 task/member metadata、fork 继承上下文；independent-pool 含候选交付；single 与 single-scaffolded 为零。另列工具启动数仍不能补全传输成本，也不等于 HTTP 字节或账单。
- 失败、异常、零调用与未知 usage 全部保留。审计缺口作为证据限制明确列出，不作为可行性闸门。未经比较的架构、任务规模或等效性不得写成已验证。全部 causalClaim=false。

**终轮收束：** 无论结果如何，等预算比较线在第 11 轮结束，不设计第 12 轮换任务或缩小规模。本报告只陈述实际保留结果；测试、构建、打包与 smoke 的实际执行结果另见实施记录。
