# 逐 seed 工具映射、持有者与步数证据

此文件由 scripts/recompute-probe-gate.ts 生成，零模型调用。节点和任务使用 telemetry 匿名别名；protocol.stepUse 原始节点 ID 另有命名空间，不能按数字直接相连。所有 seq 是各 seed events.jsonl 的 sequence。

## seed 17

| 匿名工具 | 真实工具 | 互证依据 |
| --- | --- | --- |
| tool-1 | read_evidence | 逐次 session tool/call 与 event 113 对应（source seq 12）；15 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-2 | atn_status | 逐次 session tool/call 与 event 123 对应（source seq 15）；16 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-3 | atn_send | 逐次 session tool/call 与 event 228 对应（source seq 25）；4 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-4 | submit_checkpoint | 逐次 session tool/call 与 event 352 对应（source seq 73）；1 次命名证据，详见 tool-identities.json 及 recomputation.json |

未完成任务（含已不可达但未完成者）：

| 任务 | holder | requester | status | 创建步数 | 停止 lifecycle | 已用/剩余 | 持有者判定 | 证据 task/node/turn seq |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task-1 | node-1 | node-1 | unreachable | 0 | retired | 12/0 | 持有者不可达 | 410/406/412 |
| task-2 | node-2 | node-1 | open | 0 | active | 6/6 | 持有者存活（未运行） | 12/418/475 |
| task-3 | node-3 | node-2 | open | 0 | active | 4/8 | 持有者存活（未运行） | 20/426/478 |
| task-4 | node-4 | node-3 | open | 0 | active | 4/8 | 持有者存活（未运行） | 27/434/481 |
| task-5 | node-5 | node-4 | open | 0 | active | 7/5 | 持有者存活（未运行） | 34/442/484 |
| task-6 | node-6 | node-5 | open | 0 | active | 4/8 | 持有者存活（未运行） | 41/453/487 |
| task-7 | node-7 | node-6 | open | 0 | active | 4/8 | 持有者存活（未运行） | 48/461/490 |
| task-8 | node-8 | node-7 | open | 0 | active | 5/7 | 持有者存活（未运行） | 55/469/493 |
| task-11 | node-1 | node-1 | unreachable | 12 | retired | 12/0 | 持有者不可达 | 411/406/412 |

入口逐步：

| turn:step | 类别 | 工具（类别） | step/start sequence |
| --- | --- | --- | --- |
| 1:1 | other | read_evidence(other) | 75 |
| 1:2 | discovery | atn_status(discovery) | 118 |
| 1:3 | protocol | atn_send(protocol) | 194 |
| 1:4 | discovery | atn_status(discovery) | 240 |
| 1:5 | protocol | atn_status(protocol) | 265 |
| 1:6 | rewire | atn_status(rewire) | 278 |
| 1:7 | protocol | atn_send(protocol) | 289 |
| 1:8 | discovery | atn_status(discovery) | 306 |
| 1:9 | protocol | atn_status(protocol) | 327 |
| 1:10 | discovery | atn_status(discovery) | 341 |
| 1:11 | protocol | submit_checkpoint(protocol) | 349 |
| 1:12 | other | 无工具 | 372 |

其它节点：

| 节点/session | 已用步 | 只读发现 | 协议 | 换边 | 其余 | 只读 status 次数 | 发现步占比 | 最后 turn 原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node-2/session-2 | 6 | 1 | 1 | 0 | 4 | 1 | 16.7% | completed |
| node-3/session-3 | 4 | 1 | 0 | 0 | 3 | 1 | 25.0% | completed |
| node-4/session-4 | 4 | 1 | 0 | 0 | 3 | 1 | 25.0% | completed |
| node-5/session-5 | 7 | 1 | 1 | 0 | 5 | 1 | 14.3% | completed |
| node-6/session-6 | 4 | 2 | 0 | 0 | 2 | 2 | 50.0% | completed |
| node-7/session-7 | 4 | 1 | 0 | 0 | 3 | 1 | 25.0% | completed |
| node-8/session-8 | 5 | 2 | 0 | 0 | 3 | 2 | 40.0% | completed |

## seed 31

| 匿名工具 | 真实工具 | 互证依据 |
| --- | --- | --- |
| tool-1 | read_evidence | 逐次 session tool/call 与 event 113 对应（source seq 12）；8 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-2 | atn_status | 逐次 session tool/call 与 event 115 对应（source seq 14）；14 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-3 | atn_send | 逐次 session tool/call 与 event 235 对应（source seq 27）；4 次命名证据，详见 tool-identities.json 及 recomputation.json |

未完成任务（含已不可达但未完成者）：

| 任务 | holder | requester | status | 创建步数 | 停止 lifecycle | 已用/剩余 | 持有者判定 | 证据 task/node/turn seq |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task-1 | node-1 | node-1 | open | 0 | active | 11/1 | 持有者存活（未运行） | 5/362/367 |
| task-2 | node-2 | node-1 | open | 0 | active | 5/7 | 持有者存活（未运行） | 12/278/292 |
| task-3 | node-3 | node-2 | open | 0 | active | 2/10 | 持有者存活（未运行） | 20/137/198 |
| task-4 | node-4 | node-3 | open | 0 | active | 3/9 | 持有者存活（未运行） | 27/204/253 |
| task-5 | node-5 | node-4 | open | 0 | active | 2/10 | 持有者存活（未运行） | 34/153/209 |
| task-6 | node-6 | node-5 | open | 0 | active | 3/9 | 持有者存活（未运行） | 41/215/256 |
| task-7 | node-7 | node-6 | open | 0 | active | 5/7 | 持有者存活（未运行） | 48/339/354 |
| task-8 | node-8 | node-7 | open | 0 | active | 3/9 | 持有者存活（未运行） | 55/231/262 |

入口逐步：

| turn:step | 类别 | 工具（类别） | step/start sequence |
| --- | --- | --- | --- |
| 1:1 | discovery | read_evidence(other), atn_status(discovery) | 75 |
| 1:2 | discovery | atn_status(discovery) | 120 |
| 1:3 | protocol | atn_send(protocol) | 186 |
| 1:4 | discovery | atn_status(discovery) | 242 |
| 1:5 | discovery | atn_status(discovery) | 269 |
| 1:6 | protocol | atn_status(protocol) | 287 |
| 1:7 | rewire | atn_status(rewire) | 300 |
| 1:8 | protocol | atn_send(protocol) | 311 |
| 1:9 | discovery | atn_status(discovery) | 328 |
| 1:10 | protocol | atn_status(protocol) | 349 |
| 1:11 | other | 无工具 | 363 |

其它节点：

| 节点/session | 已用步 | 只读发现 | 协议 | 换边 | 其余 | 只读 status 次数 | 发现步占比 | 最后 turn 原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node-2/session-2 | 5 | 1 | 1 | 0 | 3 | 1 | 20.0% | completed |
| node-3/session-3 | 2 | 1 | 0 | 0 | 1 | 1 | 50.0% | completed |
| node-4/session-4 | 3 | 1 | 0 | 0 | 2 | 1 | 33.3% | completed |
| node-5/session-5 | 2 | 0 | 0 | 0 | 2 | 0 | 0.0% | completed |
| node-6/session-6 | 3 | 1 | 0 | 0 | 2 | 1 | 33.3% | completed |
| node-7/session-7 | 5 | 1 | 1 | 0 | 3 | 1 | 20.0% | completed |
| node-8/session-8 | 3 | 1 | 0 | 0 | 2 | 1 | 33.3% | completed |

## seed 45

| 匿名工具 | 真实工具 | 互证依据 |
| --- | --- | --- |
| tool-1 | read_evidence | 逐次 session tool/call 与 event 113 对应（source seq 12）；16 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-2 | atn_status | 逐次 session tool/call 与 event 115 对应（source seq 14）；17 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-3 | atn_send | 逐次 session tool/call 与 event 245 对应（source seq 27）；8 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-4 | submit_checkpoint | 逐次 session tool/call 与 event 406 对应（source seq 66）；1 次命名证据，详见 tool-identities.json 及 recomputation.json |

未完成任务（含已不可达但未完成者）：

| 任务 | holder | requester | status | 创建步数 | 停止 lifecycle | 已用/剩余 | 持有者判定 | 证据 task/node/turn seq |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task-1 | node-1 | node-1 | unreachable | 0 | retired | 12/0 | 持有者不可达 | 576/572/571 |
| task-2 | node-2 | node-1 | open | 0 | active | 7/5 | 持有者存活（未运行） | 12/472/538 |
| task-3 | node-3 | node-2 | open | 0 | active | 7/5 | 持有者存活（未运行） | 20/480/541 |
| task-4 | node-4 | node-3 | open | 0 | active | 6/6 | 持有者存活（未运行） | 27/547/580 |
| task-5 | node-5 | node-4 | open | 0 | active | 5/7 | 持有者存活（未运行） | 34/497/552 |
| task-6 | node-6 | node-5 | open | 0 | active | 6/6 | 持有者存活（未运行） | 41/505/555 |
| task-12 | node-1 | node-1 | unreachable | 12 | retired | 12/0 | 持有者不可达 | 577/572/571 |

入口逐步：

| turn:step | 类别 | 工具（类别） | step/start sequence |
| --- | --- | --- | --- |
| 1:1 | discovery | read_evidence(other), atn_status(discovery) | 75 |
| 1:2 | discovery | atn_status(discovery) | 120 |
| 1:3 | protocol | atn_send(protocol) | 186 |
| 1:4 | other | 无工具 | 252 |
| 2:1 | protocol | atn_status(protocol), atn_status(rewire), atn_send(protocol) | 304 |
| 2:2 | other | 无工具 | 353 |
| 2:3 | protocol | atn_status(protocol) | 381 |
| 2:4 | discovery | atn_status(discovery) | 395 |
| 2:5 | protocol | submit_checkpoint(protocol) | 403 |
| 2:6 | discovery | read_evidence(other), atn_status(discovery) | 425 |
| 2:7 | protocol | atn_send(protocol) | 465 |
| 2:8 | other | 无工具 | 534 |

其它节点：

| 节点/session | 已用步 | 只读发现 | 协议 | 换边 | 其余 | 只读 status 次数 | 发现步占比 | 最后 turn 原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node-2/session-2 | 7 | 2 | 1 | 0 | 4 | 2 | 28.6% | completed |
| node-3/session-3 | 7 | 1 | 1 | 0 | 5 | 1 | 14.3% | completed |
| node-4/session-4 | 6 | 2 | 0 | 0 | 4 | 2 | 33.3% | completed |
| node-5/session-5 | 5 | 1 | 0 | 0 | 4 | 1 | 20.0% | completed |
| node-6/session-6 | 6 | 1 | 0 | 0 | 5 | 1 | 16.7% | completed |
| node-7/session-7 | 7 | 1 | 1 | 0 | 5 | 1 | 14.3% | completed |
| node-8/session-8 | 8 | 2 | 2 | 0 | 4 | 2 | 25.0% | completed |

## seed 59

| 匿名工具 | 真实工具 | 互证依据 |
| --- | --- | --- |
| tool-1 | read_evidence | 逐次 session tool/call 与 event 113 对应（source seq 12）；8 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-2 | atn_status | 逐次 session tool/call 与 event 115 对应（source seq 14）；13 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-3 | atn_send | 逐次 session tool/call 与 event 228 对应（source seq 27）；5 次命名证据，详见 tool-identities.json 及 recomputation.json |

未完成任务（含已不可达但未完成者）：

| 任务 | holder | requester | status | 创建步数 | 停止 lifecycle | 已用/剩余 | 持有者判定 | 证据 task/node/turn seq |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task-1 | node-1 | node-1 | open | 0 | active | 9/3 | 持有者存活（未运行） | 5/355/360 |
| task-2 | node-2 | node-1 | open | 0 | active | 5/7 | 持有者存活（未运行） | 12/284/307 |
| task-4 | node-4 | node-3 | open | 0 | active | 4/8 | 持有者存活（未运行） | 27/334/347 |
| task-5 | node-5 | node-4 | open | 0 | active | 3/9 | 持有者存活（未运行） | 34/215/253 |
| task-6 | node-6 | node-5 | open | 0 | active | 2/10 | 持有者存活（未运行） | 41/165/220 |
| task-7 | node-7 | node-6 | open | 0 | active | 2/10 | 持有者存活（未运行） | 48/175/223 |
| task-8 | node-8 | node-7 | open | 0 | active | 2/10 | 持有者存活（未运行） | 55/185/226 |

入口逐步：

| turn:step | 类别 | 工具（类别） | step/start sequence |
| --- | --- | --- | --- |
| 1:1 | discovery | read_evidence(other), atn_status(discovery) | 75 |
| 1:2 | discovery | atn_status(discovery) | 120 |
| 1:3 | protocol | atn_send(protocol) | 194 |
| 1:4 | other | 无工具 | 240 |
| 1:5 | protocol | atn_status(protocol), atn_status(rewire) | 268 |
| 1:6 | protocol | atn_send(protocol) | 300 |
| 1:7 | other | 无工具 | 323 |
| 1:8 | protocol | atn_status(protocol) | 342 |
| 1:9 | other | 无工具 | 356 |

其它节点：

| 节点/session | 已用步 | 只读发现 | 协议 | 换边 | 其余 | 只读 status 次数 | 发现步占比 | 最后 turn 原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node-2/session-2 | 5 | 1 | 1 | 0 | 3 | 1 | 20.0% | completed |
| node-3/session-3 | 5 | 2 | 1 | 0 | 2 | 2 | 40.0% | completed |
| node-4/session-4 | 4 | 1 | 1 | 0 | 2 | 1 | 25.0% | completed |
| node-5/session-5 | 3 | 1 | 0 | 0 | 2 | 1 | 33.3% | completed |
| node-6/session-6 | 2 | 1 | 0 | 0 | 1 | 1 | 50.0% | completed |
| node-7/session-7 | 2 | 1 | 0 | 0 | 1 | 1 | 50.0% | completed |
| node-8/session-8 | 2 | 1 | 0 | 0 | 1 | 1 | 50.0% | max-tokens |

## seed 73

| 匿名工具 | 真实工具 | 互证依据 |
| --- | --- | --- |
| tool-1 | read_evidence | 逐次 session tool/call 与 event 113 对应（source seq 12）；16 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-2 | atn_status | 逐次 session tool/call 与 event 115 对应（source seq 14）；18 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-3 | atn_send | 逐次 session tool/call 与 event 253 对应（source seq 23）；5 次命名证据，详见 tool-identities.json 及 recomputation.json |
| tool-4 | submit_checkpoint | 逐次 session tool/call 与 event 387 对应（source seq 71）；1 次命名证据，详见 tool-identities.json 及 recomputation.json |

未完成任务（含已不可达但未完成者）：

| 任务 | holder | requester | status | 创建步数 | 停止 lifecycle | 已用/剩余 | 持有者判定 | 证据 task/node/turn seq |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task-1 | node-1 | node-1 | unreachable | 0 | retired | 12/0 | 持有者不可达 | 449/445/451 |
| task-2 | node-2 | node-1 | open | 0 | active | 6/6 | 持有者存活（未运行） | 12/457/512 |
| task-3 | node-3 | node-2 | open | 0 | active | 5/7 | 持有者存活（未运行） | 20/466/515 |
| task-4 | node-4 | node-3 | open | 0 | active | 8/4 | 持有者存活（未运行） | 27/521/549 |
| task-5 | node-5 | node-4 | open | 0 | active | 5/7 | 持有者存活（未运行） | 34/483/527 |
| task-7 | node-7 | node-6 | open | 0 | active | 6/6 | 持有者存活（未运行） | 48/536/552 |
| task-8 | node-8 | node-7 | open | 0 | active | 6/6 | 持有者存活（未运行） | 55/544/555 |
| task-11 | node-1 | node-1 | unreachable | 12 | retired | 12/0 | 持有者不可达 | 450/445/451 |

入口逐步：

| turn:step | 类别 | 工具（类别） | step/start sequence |
| --- | --- | --- | --- |
| 1:1 | discovery | read_evidence(other), atn_status(discovery) | 75 |
| 1:2 | discovery | atn_status(discovery) | 120 |
| 1:3 | discovery | atn_status(discovery) | 190 |
| 1:4 | protocol | atn_send(protocol) | 244 |
| 1:5 | other | 无工具 | 287 |
| 1:6 | protocol | atn_status(protocol) | 310 |
| 1:7 | rewire | atn_status(rewire) | 323 |
| 1:8 | protocol | atn_send(protocol) | 334 |
| 1:9 | other | 无工具 | 351 |
| 1:10 | protocol | atn_status(protocol) | 370 |
| 1:11 | protocol | submit_checkpoint(protocol) | 384 |
| 1:12 | discovery | read_evidence(other), atn_status(discovery) | 407 |

其它节点：

| 节点/session | 已用步 | 只读发现 | 协议 | 换边 | 其余 | 只读 status 次数 | 发现步占比 | 最后 turn 原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node-2/session-2 | 6 | 1 | 1 | 0 | 4 | 1 | 16.7% | completed |
| node-3/session-3 | 5 | 1 | 0 | 0 | 4 | 1 | 20.0% | completed |
| node-4/session-4 | 8 | 2 | 1 | 0 | 5 | 2 | 25.0% | completed |
| node-5/session-5 | 5 | 1 | 0 | 0 | 4 | 1 | 20.0% | completed |
| node-6/session-6 | 6 | 1 | 1 | 0 | 4 | 1 | 16.7% | completed |
| node-7/session-7 | 6 | 2 | 0 | 0 | 4 | 2 | 33.3% | completed |
| node-8/session-8 | 6 | 3 | 0 | 0 | 3 | 3 | 50.0% | completed |
