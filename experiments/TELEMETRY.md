# Experimental telemetry

`telemetry.ts` is a content-free measurement module, independent of the production observer UI. It installs listeners on the public Harness `llm/stream`, `session/event`, and ATN `atn/network-updated` events. It does not create agents, change prompts, inject messages, invoke models, or mutate the network.

```ts
import { installTelemetry } from './telemetry.ts'

const telemetry = await installTelemetry(ctx, {
  directory: '/absolute/path/to/one-new-run',
  runId: 'task-001-atn-repeat-01',
})
// Install before creating the entry Session and sending its first prompt.
// Run the benchmark in this isolated Context, then wait for or cancel its work.
const progress = telemetry.snapshot()
console.log(progress.totals.attempts, progress.totals.tokens.totalTokens)
const final = await telemetry.close()
```

The default scope includes every model stream in the supplied Context: entry, workers, and auxiliary calls such as compaction and title generation. `includeSession(sessionId)` can narrow the scope, but excluding the entry or unattributed auxiliary calls makes the experiment incomplete. Calls without a Session appear under `sessions.unattributed`. Install before execution; this module does not replay pre-installation history. Separate benchmark arms should use separate Contexts and output directories.

`snapshot()` returns a detached in-memory summary. `flush()` waits for queued writes and synchronizes the file; `close()` detaches listeners, flushes/synchronizes the event file, and writes `summary.json`. Closing is idempotent. If streams remain active at close, `coverage.closedWithInFlight` and `totals.inFlight` explicitly mark the unfinished measurement window; the module does not wait for or cancel them. A write failure makes `flush()`/`close()` reject and invalidates the run. The event file is opened exclusively, so a previous run is never appended to or overwritten. Await close before disposing the Context.

## Accounting

- `totals.attempts` counts actual `llm/stream` iterations, including repeated visible attempts. It does not count steps denied before dispatch. `settledAttempts` and `inFlight` distinguish finished requests from outstanding requests. `errors`, `aborted`, and `incomplete` describe observed stream settlement. A rejected model route before dispatch has no model invocation; its Session turn boundary may still be recorded.
- Each token category is `{ known, unknownCalls }`. Missing or invalid usage stays unknown, including optional cache/reasoning fields. A request with no usage contributes an unknown observation, not zero tokens. Contradictory provider totals or reasoning counts invalidate that usage record. The last usage chunk within a stream is used once; `assistant/message` is not counted again.
- Harness `TokenUsage.inputTokens` contains **uncached input only**. `cacheReadTokens` and `cacheWriteTokens` are disjoint input categories. `reasoningTokens` is part of output and must not be added to `outputTokens`; `totalTokens` is a separate full-call total and must not be added to the component buckets. An absent total remains unknown even when partial component counts exist.
- `modelDurationMs` is summed invocation duration, so concurrent streams can make it exceed `elapsedMs`. The latter is elapsed experiment wall time. Tool starts, results, failures, and paired durations are counted from Session events; no tool payload is exported.
- The `llm/stream` hook surrounds observable Harness invocations/retries. An adapter can perform internal HTTP retries without exposing another hook invocation or usage record. Such wire request count and unreported retry consumption remain **unknown**. Direct SDK/subprocess/external API calls that bypass Harness are not observed. No snapshot can certify a hard provider bill or token ceiling for these invisible calls.
- A runner can gate new work on `attempts` or known token totals. Usage arrives after execution and concurrent calls can overshoot; unknown token observations prevent claims of a strict total-token bound. This module is an observer, not an admission controller.

## Reference prices, not invoices

No price is fetched or assumed. Without an explicit `PriceTable`, model cost is `null`, accompanied by `knownAmount` and `unknownCalls`. A supplied tariff estimates only the observed model streams; it is not an invoice, subscription allowance, or OpenCode Go quota measurement. Keep subscription consumption in a separate field with its own authoritative source.

```ts
const prices = {
  id: 'my-reviewed-tariff-version',
  currency: 'USD',
  reasoningIncludedInOutput: true,
  routes: [{
    provider: 'exact-provider-route', model: 'exact-model-id',
    inputPerMillion: 1, outputPerMillion: 2,
    cacheReadPerMillion: 0.1, cacheWritePerMillion: 1,
  }],
} satisfies import('./telemetry.ts').PriceTable
```

These numbers are illustrative, not current model prices. Exact provider/model matching is required. Unknown priced categories make the estimate unknown. A missing category with an explicitly zero tariff cannot affect the estimated amount, but its token count still remains unknown. Model families that do not match the declared disjoint-input/reasoning-in-output accounting need a different pricing adapter; do not force their bill into this table.

## Export and privacy

`events.jsonl` has one monotonic sequence per experiment. Events include model/tool boundaries, usage, durations, network status, node lifecycle, effective outgoing peer lists, task states, mail states, and proposal votes. The first topology observation is labeled `initial`; later events contain the new peer list. Reconstruct before/after graphs by replaying these events. Identical projections are suppressed; all changed projections during the installed observation window are appended without the UI's event-count cap. Full snapshots are not written on every model token.

ATN task validation and explicit rewiring add these structural facts:

| Event | Additional fields and meaning |
|---|---|
| `node.state` | `stepsUsed` is the node's own admitted-step counter (null for unknown legacy counters); `stepBudget` is the per-node limit, including entry nodes. `network.state.stepsUsed` remains an aggregate for reporting, not the enforcement scope. |
| `task.state` | `dependsOn` and `retryOf` contain task aliases; an absent legacy dependency list becomes `[]`. `acceptance` is `passed`, `failed`, or `unverified`, independently of submission `status`. `holderStepsAtCreation` and `holderStepsAtSettlement` give the observed holder counter window; overlapping tasks share steps, so this is not exclusive task cost. A completed submission without host acceptance remains unverified. |
| `task.acceptance` | One projection of a persisted host verdict: task alias, effective `status`, `resultBound`, `checkedAt`, validator alias, evidence count, and observed `latencyMs`/`cost`. Comparison keys, cost units and information keys use aliases. An invalid submission binding yields `status=unverified` and excludes the stale validator metrics. No result digest, verdict summary or evidence content is exported. |
| `topology.rewire` | One projection per committed explicit rewire: rewire/node aliases, `committedAt`, aliased `previousPeers`/`nextPeers`, `intent`, observed `verdict`, `causalClaim=false`, aliased `baselineTasks`/`candidateTasks`, comparison/validator/cost-unit aliases, and numerical `delta` fields. Birth connections and failed-node repair remain topology changes without an explicit rewire event. |
| `topology.rewire-observations` | Separate changing before/current local observations for a committed rewire, with peer/task aliases, timestamps, latency, holder steps, task outcomes and retries. These require no host validator. Do not count these snapshot updates as extra rewire actions. Completion is a submission declaration, and all observations have `causalClaim=false`. |

Acceptance latency is submission time minus creation time, including queueing; it excludes later validation delay. Missing host costs, units or comparison keys remain `null`. Rewire deltas are candidate minus baseline for pass rate, mean submission latency and mean host-measured cost; unknown or incomparable deltas remain `null`. These measurements are separate from whole-run model tariff estimates. The host comparison key declares matching work and budgets; its alias permits within-run equality checks without disclosing its contents. A recorded improvement is an observation about the cited samples, not evidence of a causal improvement after rewiring. Failed rewiring or validation mutations produce no committed-domain event and change no recorded task or topology; if attempted through a model tool, the existing tool boundary records its error without payloads.

Raw prompts, completions, tool arguments/results, error messages, goal/task text, evidence paths, and permission data never enter the export. Session/node/task/mail/proposal/tool/route identifiers use run-local aliases; their reverse mapping is not saved. Only public run and tariff IDs are accepted as experiment labels. The runner's separate manifest may record reviewed public model/provider names and configuration. Graph changes alone do not identify the model's motivation or prove causal benefit: use predeclared experimental interventions and ablations.

The `atn/network-updated` stream records ATN facts. The native Agent Team adapter consumes the public version-2 Session events `team/member`, `team/task`, `team/message/queued`, and `team/message/delivered`. It records member lifecycle, task revision/status/owner/dependencies, aliased write scopes, and mailbox endpoints/acknowledgements. It excludes member names, descriptions, task text, file paths, prompts, mailbox content, and error messages. Team facts keep distinct `team.*` event kinds; no ATN edges are fabricated for that baseline. The same Session aliases join domain events to model/tool accounting.

Native Team continuation also requires the public `sessionQuery` service to resume an inactive member. `ExperimentSessionQuery` in `session-query.ts` inherits Harness's concrete exact live/persisted reads and explicitly declines the unused full-text search methods. Load this service in a composed pilot kernel before exercising Team mail. Without it, a message to an inactive teammate can remain queued, which would unfairly weaken the native Team baseline. The native Team telemetry test exercises a real resumed member and its durable mailbox acknowledgement.

## Budget middleware ordering

Shared-board operations are exported as `whiteboard.state` with entry count,
generation and cumulative successful reads/writes/readBytes/writeBytes only.
No key, body, topic or author is exported by this event. `atnBoard` reports these
network-wide costs separately; `atnTotalInteractions` and `atnTotalTransferBytes`
add them to mail accounting. Repeated or older snapshots cannot reduce totals,
and deleting entries does not erase prior transfers. `atnMaxContextBytes` remains
mail-only; provider token usage measures the complete model request separately.

`budget.ts` provides `createExperimentBudget(options)`, a synchronous admission check. `admit(request, { ended, knownTotalTokens, unknownUsageCalls })` reserves one call only after checking the exact provider/model, a positive integer output cap, the hard visible-call count, and the observed-total-token threshold. It returns an explicit acceptance or rejection reason. Unknown token calls remain separately visible and do not disable the hard call count. Call the helper immediately before `next()` without awaiting another operation between reservation and dispatch.

Install the admission middleware **after** telemetry, using `{ global: true, prepend: true }`, so it wraps telemetry and refuses requests without entering the measurement stream. Otherwise denied invocations could be counted as failed adapter attempts. This ceiling bounds public Harness invocations; it cannot bound hidden HTTP retries within an adapter. The output cap is a request constraint passed to the provider, not an independent provider-output truncator. Record any provider violation separately.

Use `installExperimentOutputCap(ctx, maxOutputTokens)` before starting any Agents. It sets the cap through the official `agent/request` configuration waterfall, so both the durable request header and the adapter input agree. This also covers ATN workers whose original Agent options lack `maxTokens`. Do not modify `llm/stream` request objects: loop-built requests are already frozen, and changing them would contradict their durable request header. The outer budget gate still checks the final request cap and rejects invalid or disallowed requests without dispatch.

## Final text submission

`extractFinalTextSubmission(events, { afterSeq })` in `submission.ts` implements one fixed rule for models that answer in visible final text rather than calling `submit_answer`. Capture `afterSeq` from the entry Session immediately before the experiment's initial input. On natural quiescence, only inspect this entry Session, and use the helper only if no tool submission was already accepted and the run was not cancelled. The newest started turn must have completed normally; its final step must be closed, with a final non-interrupted assistant message whose stream finished with `stop`. A later empty, failed, aborted or unfinished turn/step cannot revive an earlier answer.

Only visible text is extracted; reasoning is never graded and a message containing tool calls or other non-text content is refused. Reasoning plus visible final text is allowed, with reasoning discarded. Multiple visible text blocks are joined by a newline. No JSON parsing, correctness checks, fallback candidates, or oracle selection occur in extraction. Even invalid JSON from the final eligible message must be passed unchanged to the evaluator, rather than replaced with a more promising earlier answer. Record the returned rule, turn, step and message sequence, or the refusal reason. Final-text extraction is an experiment submission convenience, not proof that ATN protocol obligations were settled.

## Verification

Requester feedback is exported as `task.requester-feedback`, separately from host-produced `task.acceptance`. It includes the recorded opinion `status`, authenticated requester alias, exact-submission binding, comparison alias, and evidence count; review text and evidence strings are excluded. `effectiveStatus`, `hostRejected`, and `eligibleForSelection` expose current validity: a host-rejected local acceptance remains a recorded opinion but loses selection credit. Eligibility here means a valid terminal opinion with a comparison key for matched rewire sampling. The pilot's `localFeedback` separates `recordedOpinions` from `effectiveSelectionEligible` counts. `node.knowledge` records self-reported publications using aliases for document, topic, and contribution text. A publication never becomes verified evidence by being exported.

`topology.rewire.verdict` and the pilot report's `explicitRewires[].verdict` now prefer a sufficient host verdict, then a sufficient requester verdict. Always read `evidenceSource`, `hostVerdict`, and `requesterVerdict` with that summary. The original top-level `baselineTasks`, `candidateTasks`, `delta`, and validator fields remain host measurements. Requester samples and acceptance-rate delta live in the separate `requesterEvaluation` object, which declares `qualityOnly: true` and `causalClaim: false`. No requester opinion fills unknown host cost, latency, or correctness values. Old records without this field retain an insufficient requester verdict.

`node --import tsx/esm --test tests/integration/experiment-telemetry.test.ts tests/unit/experiment-budget.test.ts` runs entirely on deterministic fixtures. It checks entry/worker accounting, visible attempts and auxiliary calls, unknown usage/prices, tariff arithmetic, sensitive-content exclusion, native Team and ATN domain export, host acceptance, dependency/retry links, rewires with both observed improvement and regression, unchanged state after immutable acceptance rejection, close behavior, and synchronous admission. These tests validate measurement plumbing, not real-model quality or subscription billing.
