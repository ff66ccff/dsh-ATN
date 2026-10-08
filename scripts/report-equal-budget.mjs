/** Generate reproducible JSON and Markdown from retained equal-budget observations. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { summarizeEqualBudgetRuns } from '../experiments/equal-budget-statistics.ts'

const numeric = value => value == null ? '未知' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
const percent = value => value == null ? '未知' : `${(value * 100).toFixed(2)}%`
const percentagePoints = value => value == null ? '未知' : `${(value * 100).toFixed(2)}pp`
const pValue = value => value == null ? '未知' : value.toPrecision(3)
const interval = (value, format = numeric) => value ? `[${format(value.lower)}, ${format(value.upper)}]` : '95% CI 不可估计'
const distribution = value => `${numeric(value.median)}；IQR [${numeric(value.q1)}, ${numeric(value.q3)}]；${interval(value.interval)}；已知/未知 ${value.knownRuns}/${value.unknownRuns}`
const escaped = value => String(value ?? '未知').replaceAll('|', '\\|').replaceAll('\n', ' ')
const labels = { wallClockMs: '墙钟 ms', peakInputTokens: '峰值输入 token', totalTokens: '完整 input+output token',
  modelCalls: '模型调用', protocolInteractions: '协议交互', protocolTransferBytes: '传输字节', entrySteps: '入口步数', toolCalls: '全部工具启动次数（补充测量）' }

export function renderEqualBudgetReport({ design, summary, generatedAt, resultLink, jsonLink }) {
  if (design.version === 3 || design.round === 11) return renderRound11Report({ design, summary, generatedAt, resultLink, jsonLink })
  const isV2 = design.version === 2 || design.round === 10
  const preflight = summary.preflight
  const lines = ['# 等预算四臂基准实施报告', '',
    `生成时间：${generatedAt}。状态：**${summary.stoppedPerRule ? '按真实模型预检规则停止' : summary.evidenceReady ? '登记矩阵与正向事实流审计齐全' : '证据尚不完整'}**。全部 \`causalClaim=false\`；不自动生成总体收益主张。`, '',
    `${summary.conclusion} ${!isV2 && summary.sizeEvidence.status === 'all-single-runs-below-half' ? '**single 的所有已知峰值低于上下文上限的一半，本轮规模诊断未达到预设标准，不能据此认定协作无用。**' : ''}`, '',
    ...(isV2 ? ['**本轮只测协调开销与并行的权衡，不是上下文压力实验。输入上下文规模不再是本轮判据，不得推广为“协作有用”或“协作无用”的通用结论。**', '',
      '## 真实模型预检与停止规则', '',
      preflight ? `输入文件保留的预检决策：\`${escaped(preflight.status)}\`；已保留 ${preflight.observedRuns}/${preflight.requiredRuns} 次尝试，精确通过 ${preflight.passedRuns} 次。主批次获准：${preflight.mainBatchAllowed}；研究线终止：${preflight.researchLineTerminated}。`
        : '真实模型预检评估缺失；不能宣称可行性已验证或批准主批次。', '',
      '此处展示输入文件保存的决策，不改写冻结结果；下文根据逐运行计数重新核验实际模型调用覆盖。尝试记录齐全不等于真实模型预检完成。', '',
      preflight ? `诊断类别：\`${escaped(preflight.diagnosis.category)}\`。${escaped(preflight.diagnosis.reason)}` : '诊断尚未提供。', '',
      `预登记预检 seed：${design.preflight?.seeds.join(', ') ?? '未知'}；要求至少 ${design.preflight?.seedsRequired ?? '未知'} 个 seed × 四臂，至少一次精确通过；大面积截断阈值为运行占比 ${percent(design.preflight?.widespreadTruncationRunFraction)}。该阈值是可行性判断，不是正确率统计闸门。`, '',
      `全部预检样本计入本报告，失败、异常、未知 usage 不删除、不替换。${summary.stoppedPerRule ? `本轮依规则停止，实际保留 ${summary.observedRuns}/${summary.plannedRuns} 次；未运行的主批次不计为失败或已执行样本。` : '只有预检放行后才执行剩余登记样本。'}零调用构造性参考只证明任务可计算，不能替代真实模型预检。`, ''] : []),
    `[保留的原始结果](${resultLink})；[统计 JSON（含每运行、每智能体峰值与全部配对指标）](${jsonLink})。`, '',
    '## 预登记、预算与样本', '',
    `模型：${escaped(design.model)}；冻结时间：${escaped(design.frozenAt)}；配对 seed：${design.seeds.join(', ')}。计划 ${summary.plannedRuns} 次，保留 ${summary.observedRuns} 次（失败 ${summary.failedRunsRetained} 次），每臂至少 14 个配对 seed 的矩阵${summary.completeMatrix ? '齐全' : '未齐全'}。未替换失败样本。`, '',
    `四臂配置总步数相等：${summary.budgetEqual}；实际配置与登记匹配：${summary.allocationMatched}；全部保留尝试均有实际模型调用证据：${summary.liveRuns}；模型一致：${summary.modelsMatch}；全部正向事实流审计通过：${summary.auditsPassed}。stepBudget 只计 Agent 步数，不是 token、HTTP 请求或费用上限。`, '',
    `配置为 live-provider 的尝试 ${summary.liveCoverage.configuredRuns}/${summary.observedRuns} 次；实际调用运行 ${summary.liveCoverage.dispatchedRuns} 次，已知零调用 ${summary.liveCoverage.zeroCallRuns} 次，调用证据未知或矛盾 ${summary.liveCoverage.unknownDispatchRuns} 次。零调用尝试不是已完成的真实模型运行，仍保留在正确率分母和失败消耗中。`, '',
    '| 臂 | 配置为 live-provider 的尝试 | 实际调用运行 | 已知零调用 | 调用证据未知或矛盾 |',
    '|---|---:|---:|---:|---:|',
    ...summary.arms.map(arm => `| ${arm.mode} | ${arm.liveCoverage.configuredRuns} | ${arm.liveCoverage.dispatchedRuns} | ${arm.liveCoverage.zeroCallRuns} | ${arm.liveCoverage.unknownDispatchRuns} |`), '',
    '实际调用要求 live-provider 配置、issuedModelCalls 与遥测 attempts 均为正整数且一致；两项都为零才计已知零调用。缺失或矛盾计数不补零，也不以配置标签证明调用已发生；非 live-provider 样本不能证明真实模型覆盖。零调用失败的短墙钟和零 token 消耗不能视为解题效率优势。', '',
    '| 臂 | 配置智能体数 | 各智能体步数分配 | 总步数 | 已记录/计划 | 缺失 seed |',
    '|---|---:|---|---:|---:|---|',
    ...summary.arms.map(arm => `| ${arm.mode} | ${arm.allocation?.agents ?? '未知'} | ${arm.allocation?.perAgentSteps.join(' + ') ?? '未知'} | ${arm.allocation?.totalSteps ?? '未知'} | ${arm.observedRuns}/${design.seeds.length} | ${arm.missingSeeds.join(', ') || '无'} |`), '',
    '实际消耗逐运行列出；未创建的节点额度是未使用预算。调用数与步数单独计量，不能用前者冒充后者。', '',
    '| 臂 | seed | 精确通过 | 实际智能体/空闲配额 | 模型调用 | 入口步 | 所有已记录 Agent 步数 | stopReason |',
    '|---|---:|---|---|---:|---:|---:|---|',
    ...summary.arms.flatMap(arm => arm.runs.map(run => `| ${arm.mode} | ${run.seed} | ${run.passed} | ${numeric(run.totalAgents)}/${numeric(run.uncreatedAgentSlots)} | ${numeric(run.modelCalls)} | ${numeric(run.entrySteps)} | ${run.agentSteps ? numeric(Object.values(run.agentSteps).reduce((sum, count) => sum + count, 0)) : '未知'} | ${escaped(run.stopReason)} |`)), '',
    '## 正确率', '', '完成定义为宿主按 fixture 精确校验通过；宿主异常、未提交和错误答案均保留在分母，失败原因在上表中列出。', '',
    '| 臂 | 正确/已记录 | 正确率 | Wilson 95% |', '|---|---:|---:|---|',
    ...summary.arms.map(arm => `| ${arm.mode} | ${arm.correctness.successes}/${arm.correctness.n} | ${percent(arm.correctness.estimate)} | ${interval(arm.correctness.interval, percent)} |`), '',
    '| 配对 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | 不一致对 A赢/B赢 | Holm p | 可区分 |',
    '|---|---|---|---|---|---:|---|',
    ...summary.pairs.map(pair => `| ${pair.a} − ${pair.b} | ${pair.pairedSeeds}/${pair.missingPairs} | ${percentagePoints(pair.correctness.estimate)} | ${interval(pair.correctness.interval, percentagePoints)} | ${pair.correctness.gains}/${pair.correctness.losses} | ${pValue(pair.correctness.adjustedPValue)} | ${pair.correctness.distinguishable ? '是（检查方向）' : '未建立差异'} |`), '',
    `**正确率未区分的臂对：** ${summary.indistinguishablePairs.map(pair => `${pair.a} ≈ ${pair.b}${pair.reason === 'missing-paired-seeds' ? '（配对不全）' : ''}`).join('；') || '无'}。≈ 仅表示此样本下未建立差异，不是等效证明，也不是零效应。`, '',
    '## 墙钟、上下文与消耗', '',
    '所有连续指标均为中位数、Q1/Q3 和中位数 95% 区间，单位见表头；不使用墙钟均值。全部样本、完成与失败分别列出。CI 在少于 6 个已知样本时不可有限估计，未知值不记零。', '']
  for (const [name, label] of Object.entries(labels)) {
    lines.push(`### ${label}`, '', '| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |', '|---|---:|---|',
      ...summary.arms.flatMap(arm => [['全部', arm.allConsumption], ['完成', arm.completedConsumption], ['失败', arm.failedConsumption]]
        .map(([group, cost]) => `| ${arm.mode}/${group} | ${cost.runs} | ${distribution(cost[name])} |`)), '',
      '| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |', '|---|---|---:|---|',
      ...summary.pairs.map(pair => `| ${pair.a} − ${pair.b} | ${distribution(pair.differences[name])} | ${pValue(pair.differences[name].adjustedPValue)} | ${pair.differences[name].distinguishable ? '是（负值表示 A 更少）' : '未建立差异'} |`), '',
      `未观察到可区分差异的臂对：${summary.pairs.filter(pair => !pair.differences[name].distinguishable).map(pair => `${pair.a} ≈ ${pair.b}`).join('；') || '无'}。`, '')
  }
  lines.push('### 输入/输出已知部分与未知覆盖', '',
    '| 臂/分组 | input+output 已知部分 | 完整/不完整运行 | 输入已知/未知调用 | 输出已知/未知调用 | 未结算调用 | 缺失遥测运行 |',
    '|---|---:|---|---|---|---:|---:|',
    ...summary.arms.flatMap(arm => [['全部', arm.allConsumption], ['完成', arm.completedConsumption], ['失败', arm.failedConsumption]].map(([group, cost]) => {
      const usage = cost.usage
      return `| ${arm.mode}/${group} | ${numeric(usage.knownInputPlusOutput)} | ${usage.completeRuns}/${usage.incompleteRuns} | ${usage.inputKnownCalls}/${usage.inputUnknownCalls} | ${usage.outputKnownCalls}/${usage.outputUnknownCalls} | ${usage.inFlightCalls} | ${usage.missingTelemetryRuns} |`
    })), '',
    '已知部分合计不等于完整总量；缺失遥测运行的未知调用数也不可确定，单列缺失运行，不能把已记录未知调用数误当完整覆盖。此处严格按 inputTokens + outputTokens 汇总；沿用遥测口径：input 不含 cacheRead/cacheWrite，reasoning 已包含在 output，不能重复相加，也不将 provider totalTokens 替代本指标。', '',
    '### 每运行与每智能体峰值上下文', '',
    isV2 ? '峰值严格取单次 inputTokens，作为描述性成本指标。inputTokens 不含 cacheRead/cacheWrite，可能低估完整上下文。输入上下文不参与本轮可行性判断，也不支持上下文压力结论。'
      : '按方案定义，峰值严格取单次 inputTokens。遥测 inputTokens 不含 cacheRead/cacheWrite，因此它与模型完整上下文容量不是完全相同的口径；缓存命中可能低估真正承载的上下文。规模比率只是此指标对目录上限的诊断，低于一半不得推出模型实际上下文轻松，也不能推出并行无贡献。', '',
    '| 臂 | seed | 完整运行峰值 | 已知下界 | 已知/未知调用 | 每 Agent 映射完整 | 每 Agent 完整峰值（未知保留） |',
    '|---|---:|---:|---:|---|---|---|',
    ...summary.arms.flatMap(arm => arm.runs.map(run => `| ${arm.mode} | ${run.seed} | ${numeric(run.context.peakInputTokens)} | ${numeric(run.context.knownPeakLowerBound)} | ${run.context.knownCalls}/${run.context.unknownCalls}${run.context.missingCalls === null ? '（调用覆盖未知）' : ''} | ${run.context.agentMappingComplete} | ${run.context.perAgent.map(agent => `${escaped(agent.agent)}: ${numeric(agent.peakInputTokens)}（已知下界 ${numeric(agent.knownPeakLowerBound)}）`).join('；') || '未提供 Agent 映射；JSON 保留 session 测量'} |`)), '',
    ...(isV2 ? [
      '### 单次输出余量与第 9 轮截断诊断', '',
      `共同单次输出上限 ${numeric(summary.sizeEvidence.maxOutputTokens)}；预登记最小余量 ${percent(summary.sizeEvidence.minimumOutputHeadroom)}。预检精确完成运行所需最大单次输出完整值 ${numeric(summary.sizeEvidence.maximumOutputTokens)}，已知下界 ${numeric(summary.sizeEvidence.maximumKnownOutput)}，完整余量 ${percent(summary.sizeEvidence.headroomFraction)}；判据状态：\`${summary.sizeEvidence.status}\`。全部预检（包含失败）最大单次输出 ${numeric(summary.preflightOutput.maximumOutputTokens)}，已知下界 ${numeric(summary.preflightOutput.knownMaximumOutput)}。零完成时不存在可用的完成见证，不能把失败运行的输出余量写成可行性确认。`, '',
      '| 臂 | 截断调用/涉及运行 | 最大单次输出完整值/已知下界 | 完整余量 | 输出已知/未知调用 | 截断未知调用/覆盖不完整运行 | 调用覆盖未知运行 |',
      '|---|---|---|---|---|---|---:|',
      ...summary.arms.map(arm => `| ${arm.mode} | ${arm.output.truncatedCalls}/${arm.output.truncatedRuns} | ${numeric(arm.output.maximumOutputTokens)}/${numeric(arm.output.knownMaximumOutput)} | ${percent(arm.output.headroomFraction)} | ${arm.output.outputKnownCalls}/${arm.output.outputUnknownCalls} | ${arm.output.truncationUnknownCalls}/${arm.output.incompleteTruncationRuns} | ${arm.output.unknownCallCoverageRuns} |`), '',
      `第 9 轮共 384 次截断、56/56 次运行涉及截断。本轮保留样本观察到 ${summary.output.truncatedCalls} 次截断、${summary.output.truncatedRuns}/${summary.observedRuns} 次运行涉及截断；${summary.truncationDiagnosis === 'persists' ? '**第 9 轮的截断问题尚未消除。**' : summary.truncationDiagnosis === 'not-observed-in-retained-runs' ? '在这些保留样本中未再观察到截断；不能推广至未执行样本。' : '截断遥测覆盖不完整，不能判定第 9 轮问题已经消除。'}`, '',
      '截断调用按 finishReason=max-tokens/length 或 outputTokens≥共同上限计数，同一调用只计一次；reasoning 已在 outputTokens 中。未知输出、未知终止原因、未结算调用和缺失遥测均保留；有未知覆盖时截断次数是已观察下界，未知调用计数不包含调用总数也未知的运行。已知最大输出是下界，不能据此声称完整余量充足。', '',
      '| 臂 | seed | 截断调用 | 最大输出完整值/已知下界 | 输出已知/未知调用 | 截断未知调用 |',
      '|---|---:|---:|---|---|---|',
      ...summary.arms.flatMap(arm => arm.runs.map(run => `| ${arm.mode} | ${run.seed} | ${run.output.truncatedCalls} | ${numeric(run.output.maximumOutputTokens)}/${numeric(run.output.knownMaximumOutput)} | ${run.output.outputKnownCalls}/${numeric(run.output.outputUnknownCalls)} | ${numeric(run.output.truncationUnknownCalls)} |`)), '',
    ] : [`single 上下文规模诊断：模型可用输入上限 ${numeric(summary.sizeEvidence.modelContextLimit)}，一半为 ${numeric(summary.sizeEvidence.threshold)}；single 已知最大输入 ${numeric(summary.sizeEvidence.maximumKnownInput)}；达到一半的运行 ${numeric(summary.sizeEvidence.reachedHalfRuns)}/${singleCount(summary)}。状态：\`${summary.sizeEvidence.status}\`。模型上限未知时不得宣称已达到规模标准；只有已知下界跨过一半时才能肯定至少该次达到，未跨过且 usage 不完整时仍不能判断。`, '']),
    '## 三类结果如何解释', '',
    isV2 ? '1. 四臂区间均未建立差异：在当前模型、任务和预算下未观察到相对优势，不能认定效果相等。若预检停止，只有可行性诊断，不能将未执行主批次写成完成比较；触发研究线终止时不再设计下一轮或继续缩小任务。'
      : '1. 四臂区间均未建立差异：本次未观察到并行或协调收益；不能认定效果相等。若 single 上下文仍轻松，或区间宽，应先解决规模与功效问题。',
    '2. independent-pool 相对 single 有质量与成本联合支持，而 ATN 相对 pool 未建立差异：观察更符合并行有帮助，尚无 ATN 协调层的额外贡献证据；不能仅凭墙钟更短作此判断，也不能把未区分写成已证明无贡献。',
    '3. ATN 相对 native-team 的正向差异获区间支持、质量未被失败偏差替代且成本可比较：可报告该模型、fixture、预算下的额外关联收益；本实验仍不作因果机制主张。single/native-team 失败本身不能独立证明 ATN 优势。', '',
    '## 方法与限制', '',
    `- ${summary.methods.correctness}。Tango 为名义渐近配对区间，不是有限样本精确覆盖；零不一致对也有非零宽度。`,
    '- 墙钟与其他连续指标使用二项顺序统计中位数区间，Q1/Q3 使用线性插值。配对量是每 seed 的 A−B 差值的中位数，不是两个边际中位数之差。',
    '- 各指标内六个臂对的精确 McNemar/符号检验使用 Holm 校正；区间仍为名义 95%，不是同时区间，也未保证跨指标家族错误率。可区分要求完整配对、CI 排除零且校正 p<0.05。',
    '- 墙钟受共享 API 服务延迟与限流影响，并行可能被限流，不能单独当作效率证明。完成条件下的短耗时也不能代表无条件效率。',
    '- 墙钟按宿主 completedAt−startedAt 计算，包含运行初始化和结束清理；不是仅模型推理或仅解题时间。',
    '- 峰值上下文只说明每个智能体承受多少单次输入，不说明答案质量；已知下界不是完整峰值。模型可用上限与 input 遥测的 cache 口径需要一并考虑。',
    '- native-team 使用 Harness 自带传输，ATN 使用邮件/白板，传输结构是固有差异。ATN 统计已提交 mail+board；native 仅统计唯一排队 team/message 与 JSON 信封字节，未包含 task metadata、member 元数据和 fork 继承上下文；independent-pool 统计候选向合并入口的交付（包括空候选），single 为零。此覆盖差异不能支持无条件同口径的协议成本优劣结论。',
    '- 另列全部工具启动次数辅助观察，包含文档工具与协作工具，不能替代遗漏传输成本；协议次数与字节不等同于 HTTP 字节或真实账单。',
    '- 失败、异常和未知 usage 全部保留；未完成登记矩阵或审计时不作等预算收益判断。全部 causalClaim=false。', '',
    '本报告仅陈述输入文件中实际保留的结果；测试、构建、打包与 smoke 验证由实施记录另行列出，未执行项目不得写为通过。', '')
  return lines.join('\n')
}
const singleCount = summary => summary.arms.find(arm => arm.mode === 'single')?.observedRuns ?? 0

function renderRound11Report({ design, summary, generatedAt, resultLink, jsonLink }) {
  const preflight = summary.preflight
  const statusLabel = { 'not-assessable': '无法判定', 'observed-pattern-compatible': '观察与模式相容（非等效或因果证明）', 'pattern-not-observed': '未观察到完整模式' }
  const contrastLabel = { 'arm-not-registered': '未登记此臂', 'incomplete-pairs': '配对不全', 'difference-not-established': '未建立差异', higher: 'A 明显高于 B', lower: 'A 明显低于 B' }
  const prompts = design.scaffoldPrompt?.prompts ?? []
  for (const prompt of prompts) {
    if (createHash('sha256').update(prompt.text).digest('hex') !== prompt.sha256) throw new Error(`Scaffold prompt hash mismatch for seed ${prompt.seed}`)
  }
  const lines = ['# 第 11 轮等预算分解指令对照报告（终轮）', '',
    `生成时间：${generatedAt}。全部 \`causalClaim=false\`。${summary.conclusion}`, '',
    '**问题：在同等分解指令下，分布式结构是否仍有优势？** 第 10 轮的 16 分片 × 10 订单与 16 分片 × 8 订单两组历史样本分别冻结，均不混入本轮统计。本轮在 16 分片 × 10 订单、每次输出上限 8192、各臂 512 次可见调用预算下比较。stepBudget 只计 Agent 步数，不是 token、HTTP 请求或费用上限。', '',
    `[保留的原始结果](${resultLink})；[统计 JSON（含每运行、每智能体与全部配对指标）](${jsonLink})。`, '',
    '## 可行性与执行位置', '',
    '闸门仅两条：① 至少一次宿主精确完成；② 全部预检真实模型调用覆盖，issuedModelCalls 与 metrics.totals.attempts 一致为正整数。截断、单次输出余量、审计缺口均只报告，不设阈值、不阻止主批次。零调用尝试单列、保留分母，不记为模型推理失败。开跑前的只读模型目录检查是基础设施先决条件。', '',
    preflight ? `保存的预检状态：\`${escaped(preflight.status)}\`；保留 ${preflight.observedRuns}/${preflight.requiredRuns} 次，精确通过 ${preflight.passedRuns} 次；主批次获准：${preflight.mainBatchAllowed}。诊断：\`${escaped(preflight.diagnosis.category)}\`，${escaped(preflight.diagnosis.reason)}`
      : '未提供真实模型预检决策；不能宣称主批次获准。', '',
    `模型：${escaped(design.model)}；冻结时间：${escaped(design.frozenAt)}；登记配对 seed：${design.seeds.join(', ')}。登记 ${design.modes.length} 臂 × ${design.seeds.length} seeds = ${summary.plannedRuns} 次，实际保留 ${summary.observedRuns} 次（未精确通过 ${summary.failedRunsRetained} 次）；完整矩阵：${summary.completeMatrix}。未执行样本不是失败样本；失败、异常、零调用、未知 usage 均不删除或替换。`, '',
    `总步数相等：${summary.budgetEqual}；运行配置与登记匹配：${summary.allocationMatched}；模型一致：${summary.modelsMatch}；真实调用覆盖齐全：${summary.liveRuns}；正向事实流审计全部通过：${summary.auditsPassed}（报告项）。比较资料齐全：${summary.evidenceReady}。`, '',
    '| 臂 | 智能体数 | 各智能体步数 | 总步数 | 已记录/计划 | 缺失 seed | 实际调用运行 | 零调用 | 调用证据未知/矛盾 |',
    '|---|---:|---|---:|---|---|---:|---:|---:|',
    ...summary.arms.map(arm => `| ${arm.mode} | ${arm.allocation.agents} | ${arm.allocation.perAgentSteps.join(' + ')} | ${arm.allocation.totalSteps} | ${arm.observedRuns}/${design.seeds.length} | ${arm.missingSeeds.join(', ') || '无'} | ${arm.liveCoverage.dispatchedRuns} | ${arm.liveCoverage.zeroCallRuns} | ${arm.liveCoverage.unknownDispatchRuns} |`), '',
    `配置为 live-provider 的尝试 ${summary.liveCoverage.configuredRuns}/${summary.observedRuns} 次；实际调用运行 ${summary.liveCoverage.dispatchedRuns} 次，已知零调用 ${summary.liveCoverage.zeroCallRuns} 次，调用证据未知或矛盾 ${summary.liveCoverage.unknownDispatchRuns} 次。零调用基础设施失败仍保留在正确率分母和失败消耗中，不能归因于模型推理或架构能力，短墙钟/零 token 也不是效率优势。`, '',
    '## 正确率与同 seed 配对区间', '',
    '| 臂 | 精确通过/已记录 | 正确率 | Wilson 95% |', '|---|---:|---:|---|',
    ...summary.arms.map(arm => `| ${arm.mode} | ${arm.correctness.successes}/${arm.correctness.n} | ${percent(arm.correctness.estimate)} | ${interval(arm.correctness.interval, percent)} |`), '',
    '| 配对 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | A赢/B赢 | Holm p | 可区分 |', '|---|---|---|---|---|---:|---|',
    ...summary.pairs.map(pair => `| ${pair.a} − ${pair.b} | ${pair.pairedSeeds}/${pair.missingPairs} | ${percentagePoints(pair.correctness.estimate)} | ${interval(pair.correctness.interval, percentagePoints)} | ${pair.correctness.gains}/${pair.correctness.losses} | ${pValue(pair.correctness.adjustedPValue)} | ${pair.correctness.distinguishable ? '是（按区间方向）' : '未建立差异'} |`), '',
    `**正确率不可区分的臂对：** ${summary.indistinguishablePairs.map(pair => `${pair.a} ≈ ${pair.b}${pair.reason === 'missing-paired-seeds' ? '（配对不全）' : ''}`).join('；') || '无'}。≈ 表示未建立差异，不是等效证明，不能把宽区间或小样本写成没有贡献。`, '',
    '## 三条预登记解读与本轮实际区间', '',
    '下列“预登记解读”是事先规定的条件性解释；实际状态逐条根据同 seed 正确率差、完整配对、名义 95% 区间及 Holm p<0.05 判定。没有预登记等效界限，CI 包含零不能证明等效。“与模式相容”不证明提示或架构的因果归因，也不证明 ATN 独立贡献为零。', '']
  for (const [index, rule] of summary.interpretations.entries()) {
    lines.push(`### ${index + 1}. ${rule.observation}`, '', `预登记解读：${rule.interpretation}`, '',
      `**实际状态：${statusLabel[rule.status]}。** ${rule.actual}`, '',
      '| 实际对比 A−B | 配对数/缺失 | 正确率差 | Tango 名义 95% | Holm p | 实际方向 |', '|---|---|---|---|---:|---|',
      ...rule.contrasts.map(row => `| ${row.a} − ${row.b} | ${row.pairedSeeds}/${numeric(row.missingPairs)} | ${percentagePoints(row.estimate)} | ${interval(row.interval, percentagePoints)} | ${pValue(row.adjustedPValue)} | ${contrastLabel[row.status]} |`), '')
  }
  lines.push('single 的失败本身不能写成 ATN 收益。分布式三臂之间的优势还须查阅其直接配对区间；架构差异不能仅由更短墙钟、成功条件下的成本或审计缺口推出。', '',
    '## 墙钟、峰值上下文与消耗', '',
    '连续指标报告中位数、Q1/Q3、保守二项顺序统计中位数 95% 区间和已知/未知数。少于 6 个已知值时有限 95% 区间不可估计；未知值不补零。配对差是逐 seed 的 A−B 中位数，区别于两个边际中位数之差。全部样本、完成和失败分别报告。', '')
  for (const [name, label] of Object.entries(labels)) {
    lines.push(`### ${label}`, '', '| 臂/分组 | 样本数 | 中位数；IQR；95% CI；已知/未知 |', '|---|---:|---|',
      ...summary.arms.flatMap(arm => [['全部', arm.allConsumption], ['完成', arm.completedConsumption], ['失败', arm.failedConsumption]]
        .map(([group, cost]) => `| ${arm.mode}/${group} | ${cost.runs} | ${distribution(cost[name])} |`)), '',
      '| 配对 A−B | 配对差中位数；IQR；95% CI；已知/未知 | Holm p | 可区分 |', '|---|---|---:|---|',
      ...summary.pairs.map(pair => `| ${pair.a} − ${pair.b} | ${distribution(pair.differences[name])} | ${pValue(pair.differences[name].adjustedPValue)} | ${pair.differences[name].distinguishable ? '是（负值表示 A 更少）' : '未建立差异'} |`), '',
      `未观察到可区分差异的臂对：${summary.pairs.filter(pair => !pair.differences[name].distinguishable).map(pair => `${pair.a} ≈ ${pair.b}`).join('；') || '无'}。`, '')
  }
  lines.push('### 已知 token 部分与未知覆盖', '',
    '| 臂/分组 | input+output 已知部分 | 完整/不完整运行 | 输入已知/未知调用 | 输出已知/未知调用 | 未结算调用 | 缺失遥测运行 |', '|---|---:|---|---|---|---:|---:|',
    ...summary.arms.flatMap(arm => [['全部', arm.allConsumption], ['完成', arm.completedConsumption], ['失败', arm.failedConsumption]].map(([group, cost]) => {
      const usage = cost.usage
      return `| ${arm.mode}/${group} | ${numeric(usage.knownInputPlusOutput)} | ${usage.completeRuns}/${usage.incompleteRuns} | ${usage.inputKnownCalls}/${usage.inputUnknownCalls} | ${usage.outputKnownCalls}/${usage.outputUnknownCalls} | ${usage.inFlightCalls} | ${usage.missingTelemetryRuns} |`
    })), '',
    '已知部分不是完整总量；完全缺失遥测运行的调用数未知，表中已记录未知调用数不代表完整覆盖。inputTokens 不含 cacheRead/cacheWrite；reasoning 已包含在 output，不重复相加。provider totalTokens 不替代此口径。峰值取单次 inputTokens，已知下界不是完整峰值，不能据此声称上下文充足。', '',
    '## 截断与单次输出余量（仅报告）', '',
    '| 臂 | 截断调用/涉及运行（已观察下界） | 最大单次输出完整值/已知下界 | 完整余量 | 输出已知/未知调用 | 截断未知调用/不完整运行 | 调用覆盖未知运行 |', '|---|---|---|---|---|---|---:|',
    ...summary.arms.map(arm => `| ${arm.mode} | ${arm.output.truncatedCalls}/${arm.output.truncatedRuns} | ${numeric(arm.output.maximumOutputTokens)}/${numeric(arm.output.knownMaximumOutput)} | ${percent(arm.output.headroomFraction)} | ${arm.output.outputKnownCalls}/${arm.output.outputUnknownCalls} | ${arm.output.truncationUnknownCalls}/${arm.output.incompleteTruncationRuns} | ${arm.output.unknownCallCoverageRuns} |`), '',
    '| 臂 | 每运行截断数中位数/IQR/95%/已知未知 | 每运行最大输出中位数/IQR/95%/已知未知 | 每运行余量比例中位数/IQR/95%/已知未知 | 涉及运行比例 Wilson 95%（已知/未知） |', '|---|---|---|---|---|',
    ...summary.arms.map(arm => { const out = arm.outputIntervals, rate = out.truncatedRunFraction
      return `| ${arm.mode} | ${distribution(out.truncatedCalls)} | ${distribution(out.maximumOutputTokens)} | ${distribution(out.headroomFraction)} | ${percent(rate.estimate)} ${interval(rate.interval, percent)}（${rate.n}/${rate.unknownRuns}） |`
    }), '',
    '截断按 finishReason=max-tokens/length 或 outputTokens≥8192，每调用只计一次。有未知覆盖时计数仅是已观察下界；截断比例的区间只覆盖状态已知运行，未知数另列。余量=1−该运行最大单次输出/8192；余量比例表的单位为 0–1。输出、终止原因与调用覆盖未知均保留，已知输出下界不能证明余量充足。没有截断率或余量放行阈值。', '',
    '## 正向事实流审计缺口（仅报告）', '',
    '| 臂 | 通过/缺口/审计未知运行 | 无提交运行 | 正向完成证据/该字段未知运行 | 提交事实已知合计/未知运行 | 审计事实已知合计/未知运行 | 发送边界未知已知合计/未知运行 |', '|---|---|---:|---|---|---|---|',
    ...summary.arms.map(arm => { const audit = arm.auditCoverage
      return `| ${arm.mode} | ${audit.passedRuns}/${audit.gapRuns}/${audit.unknownRuns} | ${audit.noSubmissionRuns} | ${audit.positiveCompletionEvidenceRuns}/${audit.positiveCompletionEvidenceUnknownRuns} | ${numeric(audit.submittedFacts.knownTotal)}/${audit.submittedFacts.unknownRuns} | ${numeric(audit.auditedFacts.knownTotal)}/${audit.auditedFacts.unknownRuns} | ${numeric(audit.transportSendBoundaryUnknown.knownTotal)}/${audit.transportSendBoundaryUnknown.unknownRuns} |`
    }), '',
    '审计缺口意味着来源证据未建立，按未知保留，不补零，不记成作弊或模型推理失败。无提交运行的审计通过不等于存在正向完成证据。全部真实运行仍执行审计，缺口不作为主批次闸门。', '',
    '## 每运行保留记录', '',
    '| 臂 | seed | 精确通过 | stopReason | 调用/入口步 | 墙钟 ms | 完整峰值/已知下界 | 截断调用/未知调用 | 审计通过/缺口 |', '|---|---:|---|---|---|---:|---|---|---|',
    ...summary.arms.flatMap(arm => arm.runs.map(run => `| ${arm.mode} | ${run.seed} | ${run.passed} | ${escaped(run.stopReason)} | ${numeric(run.modelCalls)}/${numeric(run.entrySteps)} | ${numeric(run.wallClockMs)} | ${numeric(run.context.peakInputTokens)}/${numeric(run.context.knownPeakLowerBound)} | ${run.output.truncatedCalls}/${numeric(run.output.truncationUnknownCalls)} | ${run.factFlowAudit?.unknown === true ? '未知' : run.factFlowAudit?.passed ?? '未知'}；${escaped(run.factFlowAudit?.violations?.join('; ') ?? '审计缺口明细未知')} |`)), '',
    '| 臂 | seed | 每 Agent 映射完整 | 每 Agent 完整峰值（已知下界） |', '|---|---:|---|---|',
    ...summary.arms.flatMap(arm => arm.runs.map(run => `| ${arm.mode} | ${run.seed} | ${run.context.agentMappingComplete} | ${run.context.perAgent.map(agent => `${escaped(agent.agent)}: ${numeric(agent.peakInputTokens)}（${numeric(agent.knownPeakLowerBound)}）`).join('；') || '未知；JSON 保留 session 测量'} |`)), '',
    '## single-scaffolded 提示全文与哈希', '',
    'single-scaffolded 与 single 使用相同模型、工具、预算、文档权限和 fixture，唯一差别为下列逐分片要求。各 seed 的完整提示在此全文给出；SHA-256 对 UTF-8 提示正文计算，生成报告时逐条核验。', '',
    '新增指令全文：', '', '```text', design.scaffoldPrompt?.instruction ?? '未知：未提供提示清单', '```', '',
    `完整提示覆盖：${new Set(prompts.filter(prompt => design.seeds.includes(prompt.seed)).map(prompt => prompt.seed)).size}/${design.seeds.length} 个登记 seed。`, '')
  for (const prompt of prompts) lines.push(`### seed ${prompt.seed}`, '', `落盘路径：\`${prompt.path}\`；SHA-256：\`${prompt.sha256}\`。`, '', '````text', prompt.text, '````', '')
  lines.push('## 方法与限制', '',
    `- ${summary.methods.correctness}。Tango 是名义渐近配对区间，不是有限样本精确覆盖；零不一致对也保留非零区间宽度。`,
    `- 各指标内 ${summary.pairs.length} 个登记臂对分别做 Holm 校正；区间仍为名义 95%，不是同时区间，也没有跨指标家族错误率保证。可区分要求完整配对、区间排除零且校正 p<0.05。`,
    '- 连续指标用二项顺序统计中位数区间；配对差只在两臂该 seed 都已知时计算。未知和未运行必须区别，不能补零。完成条件下的成本不能证明无条件效率。',
    '- 墙钟包含宿主初始化和结束清理，并受共享 API 延迟与限流影响；更短墙钟不能单独证明效率优势。峰值上下文不是质量指标。',
    '- native-team 使用 Harness 自带传输，ATN 使用邮件/白板；协议成本覆盖不同。native 未包含 task/member metadata、fork 继承上下文；independent-pool 含候选交付；single 与 single-scaffolded 为零。另列工具启动数仍不能补全传输成本，也不等于 HTTP 字节或账单。',
    '- 失败、异常、零调用与未知 usage 全部保留。审计缺口作为证据限制明确列出，不作为可行性闸门。未经比较的架构、任务规模或等效性不得写成已验证。全部 causalClaim=false。', '',
    '**终轮收束：** 无论结果如何，等预算比较线在第 11 轮结束，不设计第 12 轮换任务或缩小规模。本报告只陈述实际保留结果；测试、构建、打包与 smoke 的实际执行结果另见实施记录。', '')
  return lines.join('\n')
}

async function main() {
  const { values } = parseArgs({ options: { results: { type: 'string', default: '.artifacts/equal-budget/20261008-v3/batch.json' },
    design: { type: 'string', default: '.artifacts/equal-budget/20261008-v3/design.json' },
    out: { type: 'string', default: 'docs/EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md' },
    json: { type: 'string', default: 'experiments/results/equal-budget-report-v3-20261008.json' } } })
  const input = JSON.parse(await readFile(resolve(values.results), 'utf8'))
  const design = input.design && typeof input.design === 'object' ? input.design
    : JSON.parse(await readFile(resolve(typeof input.design === 'string' ? input.design : values.design), 'utf8'))
  const runs = Array.isArray(input) ? input : input.runs ?? input.completed
  if (!Array.isArray(runs)) throw new Error('Results must be an array or an object containing runs/completed')
  const summary = summarizeEqualBudgetRuns(runs, design, input.preflight), generatedAt = new Date().toISOString()
  const output = { generatedAt, sourceResults: values.results, design, summary }
  const link = path => relative(dirname(resolve(values.out)), resolve(path)).replaceAll('\\', '/')
  const markdown = renderEqualBudgetReport({ ...output, resultLink: link(values.results), jsonLink: link(values.json) })
  await mkdir(dirname(resolve(values.json)), { recursive: true })
  await mkdir(dirname(resolve(values.out)), { recursive: true })
  await writeFile(resolve(values.json), JSON.stringify(output, null, 2) + '\n')
  await writeFile(resolve(values.out), markdown)
  console.log(JSON.stringify({ report: values.out, json: values.json, observedRuns: summary.observedRuns,
    plannedRuns: summary.plannedRuns, evidenceReady: summary.evidenceReady, conclusion: summary.conclusion }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Equal-budget report failed'); process.exitCode = 1 })
}
