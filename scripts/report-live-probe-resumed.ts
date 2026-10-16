/** Derive a report from retained artifacts; no model or network access. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(process.argv[2] ?? '.artifacts/live-probe-resumed/20261015')
const evidence = resolve('docs/execution-evidence/live-probe-resumed-20261015')
await mkdir(evidence, { recursive: true })
const batch = JSON.parse(await readFile(join(root, 'batch/batch.json'), 'utf8'))
const feasibility = JSON.parse(await readFile(join(root, 'feasibility.json'), 'utf8'))
const old = JSON.parse(await readFile('docs/execution-evidence/agy-model-20261015/plan.json', 'utf8'))
assert.equal(batch.route.model, old.model.id)
assert.equal(batch.route.reasoningEffort, old.reasoningEffort)
assert.deepEqual(batch.seeds, old.seeds)
assert.deepEqual(Object.keys(batch.conditions).filter(key => batch.conditions[key] !== old.conditions[key]), ['timeoutMs'])
assert.equal(batch.conditions.timeoutMs, 600000)
assert.equal(batch.maxConcurrentProviderStreams, old.maxConcurrentProviderStreams)
assert.deepEqual(batch.sourceHashes, old.sourceHashes)
const completed: any[] = batch.completed
const summary = completed.map(report => {
  const rows: any[] = batch.timingBySeed[report.seed]
  assert.equal(rows.length, report.metrics.totals.attempts)
  assert(rows.every(row => row.queueMs + row.serviceMs + row.cleanupMs === row.totalMs))
  const sum = (field: string) => rows.reduce((total, row) => total + row[field], 0)
  const tokens = report.metrics.totals.tokens
  const successfulServices = rows.filter(row => row.dispatchAt !== null && ['stop', 'tool-calls', 'max-tokens'].includes(row.status))
  return { seed: report.seed, passed: report.passed, phase1: report.phase1Correct, phase2: report.phase2Correct,
    phase1Submitted: report.phase1Submitted, phase2Submitted: report.phase2Submitted,
    issuedCalls: report.issuedModelCalls, dispatches: rows.filter(row => row.dispatchAt !== null).length,
    aborted: rows.filter(row => row.status === 'aborted').length,
    elapsedMs: report.elapsedMs, stopReason: report.stopReason, cleanup: report.cleanup,
    maxNodeSteps: Math.max(...report.protocol.stepUse.map((node: any) => node.stepsUsed)),
    entrySteps: report.entrySteps,
    checkpointShapes: report.attempts.map((attempt: any) => {
      try { const answer = JSON.parse(attempt.answer); return { phase: attempt.phase,
        chainLength: Array.isArray(answer.chain) ? answer.chain.length : null, terminalIsString: typeof answer.terminal === 'string' } }
      catch { return { phase: attempt.phase, chainLength: null, terminalIsString: false } }
    }),
    budget: report.budget, errors: report.metrics.totals.errors, toolErrors: report.metrics.totals.toolErrors,
    failures: report.failures, tokens,
    timing: { queueMs: sum('queueMs'), serviceMs: sum('serviceMs'), cleanupMs: sum('cleanupMs'),
      attemptTotalMs: sum('totalMs'), legacyModelDurationMs: report.metrics.totals.modelDurationMs,
      successfulServiceCount: successfulServices.length,
      successfulServiceMeanMs: successfulServices.length ? successfulServices.reduce((n, row) => n + row.serviceMs, 0) / successfulServices.length : null,
      boundaryDeltaMs: report.metrics.totals.modelDurationMs - sum('totalMs') } }
})
const successful = summary.filter(row => row.passed).length
const notStarted = (batch.seeds as number[]).filter(seed => !summary.some(row => row.seed === seed))
const formatTokens = (bucket: { known: number; unknownCalls: number }) => `${bucket.known}（${bucket.unknownCalls} 次未知）`
const table = summary.map(row => `| ${row.seed} | ${row.phase1 ? '通过' : row.phase1Submitted ? '已提交未通过' : '未提交'} | ${row.phase2 ? '通过' : row.phase2Submitted ? '已提交未通过' : '未提交'} | ${row.issuedCalls} / ${row.dispatches} | ${(row.elapsedMs / 1000).toFixed(3)} | ${row.maxNodeSteps}/12 | ${row.stopReason} | ${row.cleanup} |`).join('\n')
const usageTable = summary.map(row => `| ${row.seed} | ${formatTokens(row.tokens.inputTokens)} | ${formatTokens(row.tokens.outputTokens)} | ${formatTokens(row.tokens.cacheReadTokens)} | ${row.tokens.totalTokens.unknownCalls} 次未知 |`).join('\n')
const timingTable = summary.map(row => `| ${row.seed} | ${row.timing.queueMs} | ${row.timing.serviceMs} | ${row.timing.cleanupMs} | ${row.timing.attemptTotalMs} | ${row.timing.legacyModelDurationMs} | ${row.timing.boundaryDeltaMs} |`).join('\n')
const allReleased = summary.every(row => row.cleanup === 'released')
const noErrors = summary.every(row => row.errors === 0 && row.toolErrors === 0)
const noRate = summary.every(row => !row.failures.some((failure: any) => /RATE_LIMIT/.test(failure.code) || failure.status === 429))
const failureNotes = summary.filter(row => !row.passed).map(row => {
  const notes = []
  if (row.maxNodeSteps >= 12) notes.push('至少一个节点到达 12 步；参考策略最多 8 步加余量得到的 9 步规划低估了真实局部需求，严格下界 2 不能替代需求估计')
  if (row.entrySteps >= 12) notes.push('入口本身用满 12 步')
  for (const shape of row.checkpointShapes) if (shape.chainLength !== 2) notes.push(`phase ${shape.phase} 实际提交链长 ${shape.chainLength ?? '无有效数组'}，冻结目标为 2`)
  if (row.stopReason === 'timeout') notes.push('仍触及 600 秒墙钟；历史幸存调用均值及工作量估计不能保证当前批次完成')
  if (row.stopReason.includes('quiescence')) notes.push('网络静默时未完成两阶段；加长墙钟不能保证协议继续推进')
  if (row.timing.successfulServiceMeanMs !== null && row.timing.successfulServiceMeanMs > 8144) notes.push(`成功调用服务均值 ${row.timing.successfulServiceMeanMs.toFixed(1)} ms，高于规划输入 8144 ms；历史均值也偏乐观，但这不单独证明失败由延迟造成`)
  if (row.errors || row.toolErrors) notes.push(`记录模型错误 ${row.errors}、工具错误 ${row.toolErrors}，须连同原始报告解释`)
  for (const failure of row.failures) notes.push(`实际错误码 ${failure.code}，HTTP status ${failure.status ?? '未知'}；不把上游错误归因为模型能力或唯一预算瓶颈`)
  if (!notes.length) notes.push('停止原因和实际观测不足以单独归因，未推断模型能力或唯一瓶颈')
  return `- seed ${row.seed}：${notes.join('；')}。`
}).join('\n')
const totalInput = summary.reduce((n, row) => n + row.tokens.inputTokens.known, 0)
const totalOutput = summary.reduce((n, row) => n + row.tokens.outputTokens.known, 0)
const derived = { route: batch.route, conditions: batch.conditions, planned: batch.seeds.length, completed: summary.length,
  successful, notStarted, stopped: batch.stopped, actualProviderDispatches: batch.actualProviderDispatches,
  totalIssuedCalls: summary.reduce((n, row) => n + row.issuedCalls, 0), totalKnownInput: totalInput,
  totalKnownOutput: totalOutput, summary,
  caveat: 'Strict evidence-causal bound is necessary, planning gate is conditional; no performance or topology claim.' }
await writeFile(join(evidence, 'summary.json'), JSON.stringify(derived, null, 2) + '\n')
const copies = ['feasibility.json', 'feasibility-output.txt', 'timing-proof.json', 'targeted-tests.txt', 'test.txt',
  'typecheck.txt', 'script-typecheck.txt', 'driver-dry-run.json', 'execution.txt', 'build.txt', 'pack-tarball.txt']
for (const file of copies) await copyFile(join(root, file), join(evidence, file))
for (const file of ['plan.json', 'discovery.json', 'provider-calls.jsonl']) await copyFile(join(root, 'batch', file), join(evidence, file))
for (const row of summary) for (const file of ['report.json', 'manifest.json', 'timing.json', 'events.jsonl']) {
  await copyFile(join(root, 'batch', `seed-${row.seed}`, file), join(evidence, `seed-${row.seed}-${file}`))
}
const documents = completed.map(report => `- seed ${report.seed}：[report](execution-evidence/live-probe-resumed-20261015/seed-${report.seed}-report.json)、[timing](execution-evidence/live-probe-resumed-20261015/seed-${report.seed}-timing.json)、[events](execution-evidence/live-probe-resumed-20261015/seed-${report.seed}-events.jsonl)。`).join('\n')
const doc = `# 真实探针恢复实施报告（2026-10-15）

用户要求在停止核验后推导严格下界并继续实验。本轮已完成条件化严格下界推导、真实 Harness 零网络延迟口径实测、带余量的离线规划门，以及指定 **dsh-agy / Gemini 3.8 Flash medium** 真实批次。计划 ${batch.seeds.length} 个原 seed，实际完成 ${summary.length} 个，两阶段答案通过 **${successful}/${summary.length}**。未启动 seed：${notStarted.length ? notStarted.join('、') : '无'}；批次停止标记：${batch.stopped ?? '无'}。没有替换失败 seed。

## 下界与门的含义

完整证明、假设、源码入口和三组门输出见 [严格下界推导](LIVE_PROBE_STRICT_BOUND_DERIVATION.md)。冻结任务有 4 个不同的非入口当前证据持有者。在不猜测、不硬编码隐藏 proof、经本地读取和实际 mail 因果取证的假设下，每个至少一次读取决策、一次之后的证据返回决策，再加入口两阶段 checkpoint，得 **N ≥ 4×2+2=10**，最大单节点步数至少 2。这不是紧确最小值或充足预算。若不约束信息来源，验证器不能排除猜中答案，普遍下界只能保守写为至少 1 个模型响应。

60/8 保留为参考策略计数，**不再称为严格下界**。历史均值也不作为时间硬下界；本轮不声称 120 秒数学不可能完成。规划门在独立层面采用显式来源和余量：

~~~text
历史成功调用延迟：71 个 dispatch→finish 区间，均值 ${feasibility.history.meanMs} ms，向上取整 8144 ms
调用规划：max(10, ceil(60×1.125)) = 68
节点规划：max(2, ceil(8×1.125)) = 9
所需期限：ceil(68×8144/1 + 30000) = 583792 ms
~~~

原 120000 ms 条件在该规划下只缺期限；583792 ms 的充足对照被放行；选定并发作为调整轴的边界对照指出需并发 7。期限／并发是可替代调整轴，**标签是明确的修复策略，不是算术识别的唯一物理原因**。新 600000 ms 条件通过，余 16208 ms；调用上限余 28、节点步数余 3。原始算术见 [feasibility.json](execution-evidence/live-probe-resumed-20261015/feasibility.json)。

历史延迟来自上一批同路由、medium、输出 4096 的实际配对时间，排除 5 个取消调用，有幸存偏差；不包含全部准备／收尾，且当前负载可变。12.5% 动作／节点余量与 30 秒宿主预留为事先冻结的工程选择，不保证完成。新增标定调用 0。

## 冻结条件与派发保护

| 条件 | 上一批 | 本轮 |
| --- | --- | --- |
| provider / 插件 | agy / dsh-agy@0.4.4 | 相同 |
| 模型 / 档位 | gemini-3.8-flash-tiered / medium | 相同 |
| seed | 17 / 31 / 45 / 59 / 73 | 相同 |
| 节点 / 链长 | 8 / 2 | 相同 |
| 每节点步数 / 调用上限 | 12 / 96 | 相同 |
| 输出 / 已观测 token 准入阈值 | 4096 / 400000 | 相同 |
| provider 并发 / 阶段推进 | 1 / checkpoint-only | 相同 |
| 期限 | 120000 ms | **600000 ms** |

只改变期限，没有为了结果同时放宽并发、步数或调用上限。历史五臂是 48 步／节点、384 调用、600 秒，虽然期限相同，其预算仍不同，未并入同一比较。新 [plan.json](execution-evidence/live-probe-resumed-20261015/plan.json) 与原 plan 的差异由脚本逐项断言。

默认入口不执行模型，--execute 分支先过门才加载 provider／读取插件账户。缺少延迟来源、路由不符、规划不通过均在 mount 前拒绝。全部节点请求、prepared config 和逐次 dispatch 核对 agy／指定模型／medium／4096。插件自行读取原账户，无直接 HTTP 推理。实际调用证据见 [逐次派发](execution-evidence/live-probe-resumed-20261015/provider-calls.jsonl) 和 [执行日志](execution-evidence/live-probe-resumed-20261015/execution.txt)；元数据发现本身不冒充推理证据。

## 逐 seed 真实结果

| seed | phase 1 | phase 2 | runner / provider 调用 | 秒 | 最大节点步数 | 停止原因 | 清理 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
${table}

合计 runner 准入 ${derived.totalIssuedCalls} 次、实际插件派发 ${batch.actualProviderDispatches} 次。${derived.totalIssuedCalls === batch.actualProviderDispatches ? '本批两者相等，没有派发前取消的 attempt。' : '两者差异包含排队后取消的 attempt。'}这些计数不等于底层 HTTP 请求精确计数，插件内部路由和重试不由此穷尽。清理全部 released：${allReleased ? '是' : '否'}；errors 与 toolErrors 全为 0：${noErrors ? '是' : '否'}；未记录 RATE_LIMIT：${noRate ? '是' : '否'}。逐 seed 错误码和错误数在 [summary.json](execution-evidence/live-probe-resumed-20261015/summary.json) 保留。

本批 seed 59 的最后一次入口调用记录 UPSTREAM、status=null，随后入口 turn/end=error，再进入 phase-1-quiescence。这是上游错误伴随的失败，不能只写成协议静默。其余 seed 的模型错误为 0；所有 seed 工具错误为 0，未记录限流，均释放资源。上一批 AGY 的 errors=0 正向记录仍保留，不冒充本批也全为 0。

${documents}

## 延迟口径与真实分解

确定性实测中，两个 attempt 的服务分别为 [0,100]、[100,200] ms，排队分别为 0、90，收尾均为 0；旧 modelDurationMs 为 290，服务和墙钟为 200。原 telemetry **累加已 settle attempt 的生命周期，包含排队／准备及收尾**；并行 attempt 的等待重叠使累计值可超过墙钟。成功、失败、取消只要在遥测关闭前 settle 均纳入，关闭后的未完成调用不回填。[实测输出](execution-evidence/live-probe-resumed-20261015/timing-proof.json)、[定向测试](execution-evidence/live-probe-resumed-20261015/targeted-tests.txt)。

新模块分开记录 entered、provider dispatch、provider settle 和 kernel settle，逐 attempt 精确断言 queue+service+cleanup=total。queue 包含派发前解析／准备及 FIFO 等待；取消前未派发的服务为 0。两层 wrapper 的观测边界可能相差毫秒，以下保留差值，不篡改旧度量口径。

| seed | queue ms | service ms | cleanup ms | 新 attempt 总和 ms | 旧 modelDurationMs | 边界差 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${timingTable}

每个 seed 的服务区间均断言不重叠。本批 aborted attempt 为 0；service 总和仍包括失败调用已等待的区间，不将失败区间纳入成功调用服务均值。

## 逐 seed usage 与解释边界

括号为缺少该字段的调用数，known 只是部分观测：

| seed | input known（未知） | output known（未知） | cacheRead known（未知） | totalTokens |
| --- | ---: | ---: | ---: | --- |
${usageTable}

已知 input 合计 ${totalInput}、output 合计 ${totalOutput}。完整 total、reasoning 和 cacheWrite 按原始未知字段保留，**没有把 known=0 写成实际消耗 0**。400000 是已观测 totalTokens 准入阈值；若插件不完整上报 totalTokens，它不能代表精确 token 或费用硬上限。stepBudget 仍是单节点步数，不是 token、HTTP 或费用上限。费用与实际订阅消耗未测量。

seed 45 与 73 的已知输入已分别超过 400000。由于准入按上报 totalTokens 而其字段始终未知，该阈值没有阻止这些调用；不能宣称本批匹配了精确 400000 token 消耗预算。

上一批的逐 seed token 表、正向错误／释放记录和 Step 5 对照保留于 [停止报告第 4 节](LIVE_PROBE_FEASIBILITY_IMPLEMENTATION_REPORT.md)。两个不同 provider／模型在同样紧预算 12/96/4096/400000/120000 ms 下都失败，支持不能简单归因于选了一个弱模型；Step 5 还出现过 RATE_LIMIT，AGY 旧批没有记录到该错误。并发、入口与推理设置不同，不能证明预算是唯一原因或作受控能力比较。

原 runner report 的“五 arms”段落仍是通用模板，本轮实际只跑 adaptive。0/N 不作为模型能力、拓扑收益或速度结论。

## 门通过后的失败分析

${failureNotes || '本批两阶段答案均通过。规划门准入仍不等于普遍成功保证；没有据此声称性能或拓扑收益。'}

没有替换、重跑失败 seed 或在运行中改变模型、档位和预算。必要下界成立不意味着实际需求等于下界；门通过后失败应回到上述实际步数、服务、协议和停止原因分析，不能把更多预算的需求再当作未经证明的唯一原因。

## 哈希与工程交付

固定的 **37 个旧源码哈希与 AGY 历史 plan 全部一致**；每个 seed 前复核。src/、旧 telemetry、旧设计参数与 sourceHashes 均未改写。新度量和门在新增模块内，其源码哈希以 extensionHashes 单独冻结并逐 seed 复核。旧失败对照副本仍可重放。原观察通道保持只读，参考运行仍为零模型。

新实验 wrapper 增加四时刻观测和可取消的 FIFO 排队，保留 provider 并发 1 及取消后不派发的约束；排队取消的 settle 记账时机可能与旧 tail 队列不同，不能把新旧延迟直接当作受控速度比较。本批没有派发前取消，此差异未产生额外真实派发。

- npm test：**558 runtime／集成 + 14 UI，全通过，零跳过**；新增 5 个有必要性的下界前提、门双向控制、派发前拒绝、排队分解和取消测试。未删除用例或降低既有断言。[test.txt](execution-evidence/live-probe-resumed-20261015/test.txt)
- npm run typecheck：退出 0；新增脚本另做显式 TypeScript 检查，退出 0。[typecheck.txt](execution-evidence/live-probe-resumed-20261015/typecheck.txt)、[script-typecheck.txt](execution-evidence/live-probe-resumed-20261015/script-typecheck.txt)
- npm run build：退出 0。[build.txt](execution-evidence/live-probe-resumed-20261015/build.txt)
- npm run pack:tarball：退出 0。[pack-tarball.txt](execution-evidence/live-probe-resumed-20261015/pack-tarball.txt)

README 与 docs/README 已链接推导及本报告。源码、测试和证据可本地复核；没有发布或推送。
`
await writeFile(resolve('docs/LIVE_PROBE_RESUMED_IMPLEMENTATION_REPORT.md'), doc)
const hashes: Record<string, string> = {}
for (const file of [...copies, 'summary.json', 'plan.json', 'discovery.json', 'provider-calls.jsonl',
  ...summary.flatMap(row => ['report.json', 'manifest.json', 'timing.json', 'events.jsonl'].map(file => `seed-${row.seed}-${file}`))]) {
  hashes[basename(file)] = createHash('sha256').update(await readFile(join(evidence, file))).digest('hex')
}
await writeFile(join(evidence, 'manifest.json'), JSON.stringify({ ...derived, sha256: hashes }, null, 2) + '\n')
console.log(JSON.stringify({ successful, completed: summary.length, planned: batch.seeds.length, stopped: batch.stopped,
  report: resolve('docs/LIVE_PROBE_RESUMED_IMPLEMENTATION_REPORT.md'), evidence }, null, 2))
