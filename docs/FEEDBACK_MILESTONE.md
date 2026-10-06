# P0/P1 feedback milestone

This milestone tests one falsifiable mechanism: **action → observable requester-local judgement → persisted feedback → a later collaborator choice**. It does not test whether an LLM group outperforms a hub, or whether rewiring causes an improvement.

Run the bounded experiment from the repository root:

```powershell
npm run experiment:feedback-milestone
```

The default output is `experiments/results/feedback-milestone.json`. Use `--out <path>` to retain a separate run. The integration regression is `tests/integration/feedback-milestone.test.ts`.

## Design and falsifier

Both arms use five real Harness agents, ATN task/result mail, the runtime mutation queue, and JSON-backed storage. Only decisions are scripted; no paid model provider is installed. Four workers begin with exactly the same generic assignment. One sibling publishes its document/topic fingerprint for `slot-5`; another publishes an unrelated fingerprint. Before publication the query has no match. After publication it locates the sibling without a central role registry.

The requester sends the same request to the old peer and the discovered peer. Holders themselves submit an obsolete answer, an incomplete answer, and a complete answer. In the treatment arm the requester records `rejected`, `needs-more`, and `accepted`. The incomplete result has a separate comparison key so it is not silently mixed with the complete-answer contract. The subsequent policy reads `requesterFeedback` from `atn_status` and chooses a peer with more locally accepted work than its current peer. The runtime automatically selects comparable local samples for the edge replacement.

The negative control performs the same publication, probes, results, and edge changes but omits requester feedback. It explores the matching candidate without a quality record. **Its rewires must remain `insufficient-evidence`; the treatment must contain a requester-sourced `observed-improvement`.** If both arms remain insufficient, the mechanism has failed. Setup/probe rewires stay in the report and may legitimately be insufficient.

The script asserts the persisted judgement, actual result submitter, discovered fingerprint, selected edge, and both evidence layers. It invokes the stronger independent `verifyTask` check only after the measured decision. Local acceptance alone must not satisfy `isTaskAccepted`; a later host check may. This ordering prevents the host oracle from supplying the treatment signal.

## Reading the report

`explicitRewires[].verdict` is a presentation summary. `evidenceSource`, `hostVerdict`, and `requesterVerdict` identify what supports it. A requester improvement is only an observed difference in local acceptance for a matched task class. It is neither a correctness oracle nor a cost/latency improvement. Every evaluation retains `causalClaim: false`; requester evaluation also has `qualityOnly: true`.

The five-node setup deliberately establishes reachability and feedback plumbing, not topology scarcity. Scripted decisions cannot establish whether models reliably publish accurate fingerprints, judge evidence correctly, or exploit the feedback within budget. The report lists scripted calls separately and makes no token, communication, or cost reduction claim.

## Recorded check: 2026-10-05

[Saved output with source hashes](../experiments/results/feedback-milestone-20261005.json): both arms used five nodes and 12 scripted adapter calls. Of four explicit rewires per arm, the missing-feedback control had four insufficient observations; the treatment had three insufficient setup/probe observations and one requester-sourced `observed-improvement`. Its local records contain one accepted, one rejected and one needs-more result. The measured host verdict remained `insufficient-evidence` in both arms.

Validation passed: `npm run typecheck`, `npm test` (341 runtime/unit/integration tests plus eight client tests), and `npm run build`. A live-model rerun was not performed: the current process did not have the runner's required `OPENCODE_API_KEY`. No efficacy result is inferred from this mechanism check.

## Next experiment

Update after this historical P0/P1 check: P0–P5 are now implemented in the working tree. The existing DPAPI credential wrapper supplies the live runner even when the parent environment has no key. See [the full implementation and live experiment record](FULL_FEEDBACK_EXPERIMENT.md) for current validation and provider results. The proposals below record the plan at the earlier milestone.

P2–P4 remain staged work. P5's behavioral rules are partly integrated with P0/P1; prompt-overhead measurement remains pending. The next meaningful efficacy experiment should use 16–32 nodes with a bounded out-degree of two, hidden and randomized evidence placement, and at least two phases in which the useful source changes. Give all arms the same discovery interface, per-node work budget, answer contract, and message accounting. Keep a hub/reference arm rather than forbidding a potentially efficient solution by construction.

Use a full-feedback adaptive arm, a no-feedback adaptive ablation, a no-fingerprint ablation, and a fixed-topology arm. Predeclare final-answer accuracy and total communication/bytes as the primary measures; retain failed runs and count exploration, control messages, relays, and any future whiteboard reads/writes. Repeat paired seeds before drawing an efficacy conclusion. Independently check held-out answers; keep local judgement and host verification separate in reports.

Add a bounded shared whiteboard (P2) only with retention, ownership, and read/write accounting specified. Enforce topology or message scarcity (P3) before attributing benefits to adaptive edges. Use unknown-location, changing-source tasks (P4) instead of parallel sums. Measure the shorter behavioral prompt policy (P5) against the same task/budget rather than treating token savings as evidence of intelligence.

The current provider runner requires `OPENCODE_API_KEY` in its process environment. The implementation check uses no credentials and makes no provider-readiness or model-efficacy claim.
