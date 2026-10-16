# Host custody conformance (V2)

This directory ships in the `dsh-atn` npm tarball. It needs only Node 24; it does not import repository internals, the repository's tests, a model provider, or a test runner. Import `runCustodyConformance` from `dsh-atn/conformance`, or run:

```sh
node node_modules/dsh-atn/conformance/cli.mjs --list
node node_modules/dsh-atn/conformance/cli.mjs ./host-adapter.mjs
```

`host-adapter.mjs` exports a default async factory returning `{ vocabulary, open }`:

```js
import { OUTBOUND_CHANNELS, INFORMATION_BOUNDARY_REFUSAL_CODES } from 'dsh-atn'
export default async function () {
  return {
    vocabulary: { channels: OUTBOUND_CHANNELS, codes: INFORMATION_BOUNDARY_REFUSAL_CODES },
    async open(specification) {
      // Assemble a fresh real host and the preconditions in the table below.
      // Install YOUR actual custody policy and its claim grammar. Return:
      return {
        exercise: () => /* one real public ATN operation */ operation(),
        snapshot: async () => /* actual business state + instrumentation */ capture(),
        close: async () => /* drain and dispose resources */ dispose(),
      }
    },
  }
}
```

The adapter owns real host assembly, identity binding, store instrumentation and claim syntax. It must invoke the actual public `AtnRuntime` methods and cannot substitute precomputed answers. `snapshot()` includes complete durable network state (messages/address cursor/weights/steps/tasks/mail), network inventory, successful store-write count, live Agent inventory and session events, and model-request count. Quiesce precondition mail receipts before taking the baseline. Snapshot must exclude observation-only counters; they are not business mutations. False adapter reports invalidate any conformance conclusion.

| Case | Adapter precondition and operation |
|---|---|
| held/unheld: each of 14 named channels | Valid domain preconditions; encode one owned/unowned artifact in the host's reported claim grammar, then call the named channel. Start uses a new Agent and wildcard outbound policy. Held must reach admission without throwing; unheld must throw evidence-not-owned with identical business snapshot. finish.network admission may still report ordinary unfinished-work blockers. |
| Identifier-only claim/rewire | Use a real orphan/peer ID and a host catalog alias identifying its artifact; do not fabricate an invalid ID. The example host's alias catalog is explicit. |
| transport:messageId/dependsOn/retryOf | Encode the unowned claim only in this field on send.task; body is neutral. |
| msg-existing/future/self | Seed msg:1; cite msg:1, msg:9, or the next address msg:2. |
| task-visible/hidden/missing | Publish task refs to a requester/holder-visible, unrelated, or nonexistent task. |
| artifact-owned/unowned/no-policy | Publish actual custody refs; the last case installs no custody resolver. |
| rationale | Existing msg ref omitted from rationale; expect rationale-missing-ref. |
| capacity | Fill the configured capacity; attempt another publish, expect substrate-full and byte-identical old messages/cursor/weights. |
| read-policy-missing/throw/async/hidden | Seed msg:1. Visit without a policy; with a throwing policy; with an asynchronous policy; with no mapped principal. Expected codes are in `--list`. |

The output names every failed contract and exits 1 on any failure; no skipped case counts as passing. `public-vocabulary` freezes all 16 names in order. Eight host-protocol-specific codes (`not-task-holder` through `invalid-owner-result`) have no universal trigger in arbitrary custody grammars: this portable suite freezes their vocabulary, while a host must retain its own protocol tests for their meaning. The repository's real reference-policy tests cover those meanings; this suite does not falsely claim to reproduce an arbitrary host's protocol. No public API is expanded to create private test backdoors.

Negative fixtures in `negative-fixtures.mjs` deliberately admit unowned input or return an asynchronous decision. Run each against the same adapter. The repository example's expected red contracts are `unheld:start` and `held:start`, respectively; exact complete failure output is in the V2 phase 3 evidence. The repository adapter is `tests/fixtures/conformance-host.ts` and shares `createExampleCustodyPolicy` with `examples/information-boundary.ts`; this host-specific fixture is obtained from the source repository, not required by the portable npm suite.

This validates structural contracts under the host's declared grammar and instrumentation. It does not validate semantic claim extraction, external IAM, arbitrary natural-language confidentiality, model quality, or compliance journals. It never requires a real model call.
