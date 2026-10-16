# V2 可复核明细

完整历史重算依赖 audit.json.replay 列出的未跟踪 session 与 network 文件（方案 4.6(b)）。表内序号均为遥测 sequence，source seq 单列保存在 JSON。

## Seed 17

no-wake-eligible-work；飞行中节点：无；attempts=46；open=7；全部未完成=9。

| 邮件/任务 | queued | session:turn/step | model start→end | delivered | 类别 |
| --- | ---: | --- | --- | ---: | --- |
| mail-1/task-2 | 13 | session-2:1/1 | 80→120 | 105 | normal-receipt |
| mail-2/task-3 | 21 | session-3:1/1 | 84→130 | 106 | normal-receipt |
| mail-3/task-4 | 28 | session-4:1/1 | 88→140 | 107 | normal-receipt |
| mail-4/task-5 | 35 | session-5:1/1 | 92→150 | 108 | normal-receipt |
| mail-5/task-6 | 42 | session-6:1/1 | 96→158 | 109 | normal-receipt |
| mail-6/task-7 | 49 | session-7:1/1 | 100→168 | 110 | normal-receipt |
| mail-7/task-8 | 56 | session-8:1/1 | 104→178 | 111 | normal-receipt |
| mail-8/task-9 | 230 | session-2:2/1 | 237→249 | 242 | normal-receipt |
| mail-9/task-9 | 252 | session-1:1/5 | 266→271 | 267 | normal-receipt |
| mail-10/task-10 | 295 | session-5:2/1 | 303→309 | 308 | normal-receipt |
| mail-11/task-10 | 313 | session-1:1/9 | 328→333 | 329 | normal-receipt |

| 节点/session | 最后 step seq (turn/step) | model.end seq/outcome | turn.end seq/reason | 工具 | 随后关联事件数 | 未处理邮件 | attempts |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| node-1/session-1 | 372 (1/12) | 404/completed | 412/blocked | 无 | 0 | 无 | 12 |
| node-2/session-2 | 419 (3/2) | 473/completed | 475/completed | 无 | 0 | 无 | 6 |
| node-3/session-3 | 427 (2/2) | 476/completed | 478/completed | 无 | 0 | 无 | 4 |
| node-4/session-4 | 435 (2/2) | 479/completed | 481/completed | 无 | 0 | 无 | 4 |
| node-5/session-5 | 444 (3/2) | 482/completed | 484/completed | 无 | 0 | 无 | 7 |
| node-6/session-6 | 454 (2/2) | 485/completed | 487/completed | 无 | 0 | 无 | 4 |
| node-7/session-7 | 462 (2/2) | 488/completed | 490/completed | 无 | 0 | 无 | 4 |
| node-8/session-8 | 471 (2/2) | 491/completed | 493/completed | 无 | 0 | 无 | 5 |

预置角色义务（不独立唤醒）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-1 | node-1/node-1 | unreachable | 5/1792051032789/0 | 410 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-2 | node-2/node-1 | open | 12/1792051032817/0 | 12 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-3 | node-3/node-2 | open | 20/1792051032835/0 | 20 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-4 | node-4/node-3 | open | 27/1792051032853/0 | 27 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-5 | node-5/node-4 | open | 34/1792051032868/0 | 34 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-6 | node-6/node-5 | open | 41/1792051032883/0 | 41 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-7 | node-7/node-6 | open | 48/1792051032899/0 | 48 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-8 | node-8/node-7 | open | 55/1792051032917/0 | 55 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |

运行期义务（本批均为拉取式 delivery）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-11 | node-1/node-1 | unreachable | 411/1792051372131/12 | 411 | delivery | src/tasks.ts:278 materializes unreachable delivery obligation without mail; src/runtime.ts:1647 requires explicit claimTaskId; no unclaimed obligation pushes a wake |

## Seed 31

no-wake-eligible-work；飞行中节点：无；attempts=34；open=8；全部未完成=8。

| 邮件/任务 | queued | session:turn/step | model start→end | delivered | 类别 |
| --- | ---: | --- | --- | ---: | --- |
| mail-1/task-2 | 13 | session-2:1/1 | 80→122 | 105 | normal-receipt |
| mail-2/task-3 | 21 | session-3:1/1 | 84→130 | 106 | normal-receipt |
| mail-3/task-4 | 28 | session-4:1/1 | 88→140 | 107 | normal-receipt |
| mail-4/task-5 | 35 | session-5:1/1 | 92→148 | 108 | normal-receipt |
| mail-5/task-6 | 42 | session-6:1/1 | 96→156 | 109 | normal-receipt |
| mail-6/task-7 | 49 | session-7:1/1 | 100→164 | 110 | normal-receipt |
| mail-7/task-8 | 56 | session-8:1/1 | 104→172 | 111 | normal-receipt |
| mail-8/task-9 | 237 | session-2:1/4 | 249→271 | 250 | normal-receipt |
| mail-9/task-9 | 274 | session-1:1/6 | 288→293 | 289 | normal-receipt |
| mail-10/task-10 | 317 | session-7:2/1 | 325→331 | 330 | normal-receipt |
| mail-11/task-10 | 335 | session-1:1/10 | 350→355 | 351 | normal-receipt |

| 节点/session | 最后 step seq (turn/step) | model.end seq/outcome | turn.end seq/reason | 工具 | 随后关联事件数 | 未处理邮件 | attempts |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| node-1/session-1 | 363 (1/11) | 365/max-tokens | 367/max-tokens | 无 | 0 | 无 | 11 |
| node-2/session-2 | 279 (1/5) | 290/completed | 292/completed | 无 | 0 | 无 | 5 |
| node-3/session-3 | 138 (1/2) | 196/completed | 198/completed | 无 | 0 | 无 | 2 |
| node-4/session-4 | 205 (1/3) | 251/completed | 253/completed | 无 | 0 | 无 | 3 |
| node-5/session-5 | 154 (1/2) | 207/completed | 209/completed | 无 | 0 | 无 | 2 |
| node-6/session-6 | 216 (1/3) | 254/completed | 256/completed | 无 | 0 | 无 | 3 |
| node-7/session-7 | 341 (2/2) | 352/completed | 354/completed | 无 | 0 | 无 | 5 |
| node-8/session-8 | 232 (1/3) | 260/completed | 262/completed | 无 | 0 | 无 | 3 |

预置角色义务（不独立唤醒）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-1 | node-1/node-1 | open | 5/1792051432196/0 | 5 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-2 | node-2/node-1 | open | 12/1792051432221/0 | 12 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-3 | node-3/node-2 | open | 20/1792051432240/0 | 20 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-4 | node-4/node-3 | open | 27/1792051432259/0 | 27 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-5 | node-5/node-4 | open | 34/1792051432278/0 | 34 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-6 | node-6/node-5 | open | 41/1792051432297/0 | 41 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-7 | node-7/node-6 | open | 48/1792051432316/0 | 48 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-8 | node-8/node-7 | open | 55/1792051432339/0 | 55 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |

运行期义务（本批均为拉取式 delivery）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |

## Seed 45

no-wake-eligible-work；飞行中节点：无；attempts=58；open=5；全部未完成=7。

| 邮件/任务 | queued | session:turn/step | model start→end | delivered | 类别 |
| --- | ---: | --- | --- | ---: | --- |
| mail-1/task-2 | 13 | session-2:1/1 | 80→122 | 105 | normal-receipt |
| mail-2/task-3 | 21 | session-3:1/1 | 84→132 | 106 | normal-receipt |
| mail-3/task-4 | 28 | session-4:1/1 | 88→140 | 107 | normal-receipt |
| mail-4/task-5 | 35 | session-5:1/1 | 92→148 | 108 | normal-receipt |
| mail-5/task-6 | 42 | session-6:1/1 | 96→156 | 109 | normal-receipt |
| mail-6/task-7 | 49 | session-7:1/1 | 100→164 | 110 | normal-receipt |
| mail-7/task-8 | 56 | session-8:1/1 | 104→172 | 111 | normal-receipt |
| mail-8/task-9 | 247 | session-2:1/4 | 259→295 | 260 | normal-receipt |
| mail-9/task-8 | 279 | session-7:2/1 | 286→311 | 291 | normal-receipt |
| mail-10/task-9 | 298 | session-1:2/1 | 305→330 | 310 | normal-receipt |
| mail-11/task-7 | 314 | session-6:2/1 | 321→359 | 326 | normal-receipt |
| mail-12/task-10 | 342 | session-3:2/1 | 350→365 | 355 | normal-receipt |
| mail-13/task-10 | 369 | session-1:2/3 | 382→387 | 383 | normal-receipt |
| mail-14/task-11 | 529 | session-8:2/3 | 567→581 | 568 | normal-receipt |
| mail-15/task-11 | 585 | session-1:未进入任何步 |  | - | unreachable |

| 节点/session | 最后 step seq (turn/step) | model.end seq/outcome | turn.end seq/reason | 工具 | 随后关联事件数 | 未处理邮件 | attempts |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| node-1/session-1 | 534 (2/8) | 569/completed | 571/completed | 无 | 7 | 无 | 12 |
| node-2/session-2 | 473 (2/2) | 536/completed | 538/completed | 无 | 1 | 无 | 7 |
| node-3/session-3 | 482 (3/2) | 539/completed | 541/completed | 无 | 0 | 无 | 7 |
| node-4/session-4 | 548 (2/3) | 578/completed | 580/completed | 无 | 0 | 无 | 6 |
| node-5/session-5 | 498 (2/2) | 550/completed | 552/completed | 无 | 0 | 无 | 5 |
| node-6/session-6 | 506 (3/2) | 553/completed | 555/completed | 无 | 0 | 无 | 6 |
| node-7/session-7 | 514 (3/2) | 556/completed | 558/completed | 无 | 0 | 无 | 7 |
| node-8/session-8 | 592 (2/4) | 594/completed | 596/completed | 无 | 0 | 无 | 8 |

预置角色义务（不独立唤醒）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-1 | node-1/node-1 | unreachable | 5/1792051782766/0 | 576 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-2 | node-2/node-1 | open | 12/1792051782780/0 | 12 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-3 | node-3/node-2 | open | 20/1792051782797/0 | 20 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-4 | node-4/node-3 | open | 27/1792051782820/0 | 27 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-5 | node-5/node-4 | open | 34/1792051782836/0 | 34 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-6 | node-6/node-5 | open | 41/1792051782853/0 | 41 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |

运行期义务（本批均为拉取式 delivery）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-12 | node-1/node-1 | unreachable | 577/1792052317133/12 | 577 | delivery | src/tasks.ts:278 materializes unreachable delivery obligation without mail; src/runtime.ts:1647 requires explicit claimTaskId; no unclaimed obligation pushes a wake |

## Seed 59

no-wake-eligible-work；飞行中节点：无；attempts=32；open=7；全部未完成=7。

| 邮件/任务 | queued | session:turn/step | model start→end | delivered | 类别 |
| --- | ---: | --- | --- | ---: | --- |
| mail-1/task-2 | 13 | session-2:1/1 | 80→122 | 105 | normal-receipt |
| mail-2/task-3 | 21 | session-3:1/1 | 84→132 | 106 | normal-receipt |
| mail-3/task-4 | 28 | session-4:1/1 | 88→140 | 107 | normal-receipt |
| mail-4/task-5 | 35 | session-5:1/1 | 92→150 | 108 | normal-receipt |
| mail-5/task-6 | 42 | session-6:1/1 | 96→158 | 109 | normal-receipt |
| mail-6/task-7 | 49 | session-7:1/1 | 100→168 | 110 | normal-receipt |
| mail-7/task-8 | 56 | session-8:1/1 | 104→178 | 111 | normal-receipt |
| mail-8/task-9 | 230 | session-2:2/1 | 237→254 | 242 | normal-receipt |
| mail-9/task-9 | 257 | session-1:1/5 | 269→288 | 270 | normal-receipt |
| mail-10/task-3 | 274 | session-2:2/3 | 286→305 | 287 | normal-receipt |
| mail-11/task-10 | 312 | session-4:2/1 | 320→326 | 325 | normal-receipt |
| mail-12/task-10 | 330 | session-1:1/8 | 343→348 | 344 | normal-receipt |

| 节点/session | 最后 step seq (turn/step) | model.end seq/outcome | turn.end seq/reason | 工具 | 随后关联事件数 | 未处理邮件 | attempts |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| node-1/session-1 | 356 (1/9) | 358/error | 360/error | 无 | 0 | 无 | 9 |
| node-2/session-2 | 285 (2/3) | 305/completed | 307/completed | 无 | 0 | 无 | 5 |
| node-3/session-3 | 279 (1/5) | 302/completed | 304/completed | 无 | 0 | 无 | 5 |
| node-4/session-4 | 336 (2/2) | 345/completed | 347/completed | 无 | 0 | 无 | 4 |
| node-5/session-5 | 216 (1/3) | 251/completed | 253/completed | 无 | 0 | 无 | 3 |
| node-6/session-6 | 166 (1/2) | 218/completed | 220/completed | 无 | 0 | 无 | 2 |
| node-7/session-7 | 176 (1/2) | 221/completed | 223/completed | 无 | 0 | 无 | 2 |
| node-8/session-8 | 186 (1/2) | 224/max-tokens | 226/max-tokens | 无 | 0 | 无 | 2 |

预置角色义务（不独立唤醒）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-1 | node-1/node-1 | open | 5/1792052335253/0 | 5 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-2 | node-2/node-1 | open | 12/1792052335278/0 | 12 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-4 | node-4/node-3 | open | 27/1792052335325/0 | 27 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-5 | node-5/node-4 | open | 34/1792052335350/0 | 34 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-6 | node-6/node-5 | open | 41/1792052335375/0 | 41 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-7 | node-7/node-6 | open | 48/1792052335399/0 | 48 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-8 | node-8/node-7 | open | 55/1792052335423/0 | 55 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |

运行期义务（本批均为拉取式 delivery）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |

## Seed 73

no-wake-eligible-work；飞行中节点：无；attempts=54；open=6；全部未完成=8。

| 邮件/任务 | queued | session:turn/step | model start→end | delivered | 类别 |
| --- | ---: | --- | --- | ---: | --- |
| mail-1/task-2 | 13 | session-2:1/1 | 80→122 | 105 | normal-receipt |
| mail-2/task-3 | 21 | session-3:1/1 | 84→132 | 106 | normal-receipt |
| mail-3/task-4 | 28 | session-4:1/1 | 88→140 | 107 | normal-receipt |
| mail-4/task-5 | 35 | session-5:1/1 | 92→148 | 108 | normal-receipt |
| mail-5/task-6 | 42 | session-6:1/1 | 96→158 | 109 | normal-receipt |
| mail-6/task-7 | 49 | session-7:1/1 | 100→166 | 110 | normal-receipt |
| mail-7/task-8 | 56 | session-8:1/1 | 104→174 | 111 | normal-receipt |
| mail-8/task-6 | 255 | session-5:2/1 | 262→290 | 267 | normal-receipt |
| mail-9/task-9 | 277 | session-2:2/1 | 284→296 | 289 | normal-receipt |
| mail-10/task-9 | 299 | session-1:1/6 | 311→316 | 312 | normal-receipt |
| mail-11/task-10 | 340 | session-4:2/1 | 348→354 | 353 | normal-receipt |
| mail-12/task-10 | 358 | session-1:1/10 | 371→376 | 372 | normal-receipt |

| 节点/session | 最后 step seq (turn/step) | model.end seq/outcome | turn.end seq/reason | 工具 | 随后关联事件数 | 未处理邮件 | attempts |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| node-1/session-1 | 407 (1/12) | 439/completed | 451/blocked | read_evidence(other),atn_status(discovery) | 0 | 无 | 12 |
| node-2/session-2 | 459 (3/2) | 510/completed | 512/completed | 无 | 0 | 无 | 6 |
| node-3/session-3 | 467 (2/2) | 513/completed | 515/completed | 无 | 0 | 无 | 5 |
| node-4/session-4 | 523 (3/3) | 547/completed | 549/completed | 无 | 0 | 无 | 8 |
| node-5/session-5 | 484 (3/2) | 525/completed | 527/completed | 无 | 0 | 无 | 5 |
| node-6/session-6 | 492 (2/2) | 528/completed | 530/completed | 无 | 0 | 无 | 6 |
| node-7/session-7 | 537 (2/3) | 550/completed | 552/completed | 无 | 0 | 无 | 6 |
| node-8/session-8 | 545 (2/3) | 553/completed | 555/completed | 无 | 0 | 无 | 6 |

预置角色义务（不独立唤醒）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-1 | node-1/node-1 | unreachable | 5/1792052705059/0 | 449 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-2 | node-2/node-1 | open | 12/1792052705084/0 | 12 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-3 | node-3/node-2 | open | 20/1792052705109/0 | 20 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-4 | node-4/node-3 | open | 27/1792052705131/0 | 27 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-5 | node-5/node-4 | open | 34/1792052705156/0 | 34 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-7 | node-7/node-6 | open | 48/1792052705202/0 | 48 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |
| task-8 | node-8/node-7 | open | 55/1792052705225/0 | 55 | work | Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input |

运行期义务（本批均为拉取式 delivery）：

| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |
| --- | --- | --- | --- | ---: | --- | --- |
| task-11 | node-1/node-1 | unreachable | 450/1792053068942/12 | 450 | delivery | src/tasks.ts:278 materializes unreachable delivery obligation without mail; src/runtime.ts:1647 requires explicit claimTaskId; no unclaimed obligation pushes a wake |
