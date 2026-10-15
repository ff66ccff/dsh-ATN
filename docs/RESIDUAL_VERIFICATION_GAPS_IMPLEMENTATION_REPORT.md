# 残余验证缺口实施报告

日期：2026-10-15。工作区 `D:\dsh-ATN`，分支 `codex/release-ready`，实现前 HEAD 为 `334673ada126d5da91eab5a465659091d9cf7b88`。按 [实施说明](RESIDUAL_VERIFICATION_GAPS_BRIEF.md) 收口门禁、版本声明、冻结实验说明与重复求值；没有调用真实模型，没有模型实验费用。工作区原有的 brief 与索引编辑保留。

## 1. 实施结果与范围

- **F1/G1**：新增单一入口 `npm run verify:sidebar`，用 `&&` 依次运行声明检查与真实注册服务检查。新增独立 `sidebar-contract` job，Ubuntu/Windows 双矩阵；原有 `verify` job 的解析后配置逐项保持一致。
- **F2/G2/G3**：选择 **方案 (a)：收窄声明**。manifest 与 lockfile 的可选 peer 均为精确 `0.26.0`；验证集合也只有该版本。相比承诺尚未验证、可能尚未发布的补丁版本，这一范围与现有证据严格一致。没有将 provider 加入任何安装依赖段。
- 两个检查共用 `scripts/sidebar-compatibility.mjs`：核对 manifest、lockfile、精确验证版本及 optional 属性；不允许 provider 成为安装依赖。范围或安装版本不一致时输出 `SIDEBAR_CONTRACT_REJECTED`、安装版本、声明范围、验证集合与原因，并退出 1。
- **F3/G4**：两处文件各增加一段说明，覆盖全部 6+2 个调用。保持二参数调用和固定天花板 4；没有传入曲线值。注释确实改变原始哈希，应对见第 4 节。
- **F4/G5**：`topologyFeedbackMessage` 用局部 `limit` 复用纯函数结果。`src/` 的运行时代码改动只有这项重构；投影文件恢复原样，没有运行时 provider import。
- **F5/4.5：未实施**。它是可选精度补充，原缺陷已撤回；没有修改稀疏度声明或曲线。

## 2. npm 安装副本与版本实测

provider 在 `.scratch/residual-sidebar` 单独安装，范围外样本在 `.scratch/residual-sidebar-outside` 安装。使用固定版本、`--ignore-scripts --legacy-peer-deps --package-lock=false --save=false`；隔离 provider 的旧 peer 图，不改变 ATN 的依赖安装语义。[0.26.0 安装输出](execution-evidence/residual/install-sidebar-0.26.0.txt)、[0.25.0 安装输出](execution-evidence/residual/install-sidebar-0.25.0.txt)。

| 样本 | 声明内 | 实测结论 | 原始输出 |
| --- | --- | --- | --- |
| npm `0.26.0` | 是，集合唯一成员 | 双检查退出 0；字段存在且可赋值；真实注册、唯一 ID、重复拒绝、卸载、重挂通过，模型调用 0 | [完整入口](execution-evidence/residual/sidebar-0.26.0.txt) |
| npm `0.25.0` | 否 | 两个检查均在加载实现前明确拒绝，退出 1；不宣称测试了其 API 兼容性 | [声明](execution-evidence/residual/published-0.25.0-contract-rejected.txt)、[注册](execution-evidence/residual/published-0.25.0-registry-rejected.txt) |
| 合成 manifest `0.26.1` | 否 | 暂改安装副本的版本元数据，两个检查均明确拒绝，退出 1；不是实际发布的 0.26.1 包 | [声明](execution-evidence/residual/synthetic-0.26.1-contract-rejected.txt)、[注册](execution-evidence/residual/synthetic-0.26.1-registry-rejected.txt) |

范围外输出示例：

```text
SIDEBAR_CONTRACT_REJECTED {"package":"dsh-better-sidebar","installedVersion":"0.25.0","declaredRange":"0.26.0","verifiedVersions":["0.26.0"],"message":"该包或版本未被验证，不在声明的兼容范围内；拒绝执行契约检查。"}
EXIT_CODE=1
```

修复前裸抛错的原始记录保留：[修改代码前的合成范围外样本](execution-evidence/residual/before-unverified-version.txt)；另从基线 Git 源码重放了实际 npm `0.25.0` 的旧检查，[输出](execution-evidence/residual/before-published-0.25.0-rejected.txt)。后者是基线代码重放，不冒充修改前现场日志。

`tests/unit/sidebar-contract.test.ts` 保留原测试及全部旧安全断言，将旧范围断言改为精确版本，并实际导入验证集合，核对 manifest/lockfile。共享前置检查也会在每次 CI 双检查时核对这一关系。[将声明临时改回 `^0.26.0` 的拒绝证据](execution-evidence/residual/peer-range-drift-rejected.txt)。

`0.26.0` 的发布声明 SHA256 为 `404cbe44621280ad3109b8849ab01fd9284ed306260d78bc341c51a906025ac9`。真实 npm 副本的源码及其传递依赖已成功解析、打包、运行。检查只覆盖发布的 Tab API 与注册服务生命周期；不代表完整 provider host 激活。

## 3. 漂移红灯与 CI 阻断证据

实测发现原检查还有一个盲点：单向结构赋值允许新增可选字段，故把 `single?: boolean` 改名为 `singleDrifted?: boolean` 时，旧检查仍退出 0。[修改实现前的真实输出](execution-evidence/residual/before-optional-field-drift-undetected.txt)。没有将该绿色结果补写为失败。

因此保留原赋值检查，并增加 `Pick<Published, keyof Projected>` 的字段名约束。用同一漂移再次实测，TypeScript 报 `TS2344`、指出 `singleDrifted` 不属于发布字段，退出 1；恢复投影后退出 0。

| 故障注入 | 预期及实测 | 原始记录 |
| --- | --- | --- |
| 投影字段改名，直接检查 | 退出 1 | [漂移失败](execution-evidence/residual/optional-field-drift-rejected.txt) |
| 同一漂移，通过统一入口 | 退出 1，未运行真实注册检查 | [入口第一关阻断](execution-evidence/residual/entrypoint-contract-drift-rejected.txt) |
| 恢复原投影 | 退出 0 | [恢复通过](execution-evidence/residual/restored-sidebar-contract.txt) |
| 安装副本 service 暂加顶层哨兵异常 | 声明通过，真实注册检查失败，统一入口退出 1 | [入口第二关阻断](execution-evidence/residual/entrypoint-registry-failure-rejected.txt) |

注入均以 `try/finally` 恢复原字节，之后再次运行完整入口并通过。投影与 provider 没有留下故障注入。

CI YAML 使用 `js-yaml` 成功解析，并断言：独立 job 存在、旧 job 不变、双 OS 矩阵、安装 pin 与验证版本相同、独立 provider 路径、顺序入口、无 `continue-on-error`。[断言汇总](execution-evidence/residual/gate-checks.json)。Windows 本地实际使用 `D:\...` 的 `SIDEBAR_PACKAGE_DIR` 跑过两个检查，覆盖反斜杠到正斜杠的路径处理。新 job 保留 Windows，同时覆盖 Ubuntu；**未执行 GitHub 托管 runner，也未在本机运行 Ubuntu**，不能将配置和本地验证写成托管 CI 已绿。

## 4. 固定出度说明、行为与原始哈希

`experiments/reference-policy.ts` 的文件级新增文本：

```text
All six collaborationPeers calls intentionally freeze the legacy ceiling at 4,
rather than using collaborationPeerLimit. These policies support archived
experiments whose raw sources are pinned by sourceHashes; changing behavior
invalidates the registered design. At the default eight nodes the curve is
also 4. Even this comment changes the raw hash: replay from the frozen checkout,
never rewrite the archived hashes to admit a changed checkout.
```

`experiments/topology-host.ts` 的文件级新增文本：

```text
Both collaborationPeers calls intentionally freeze the legacy ceiling at 4,
rather than using collaborationPeerLimit. This host supports archived
experiments whose raw sources are pinned by sourceHashes; changing behavior
invalidates the registered design. At the default eight nodes the curve is
also 4. Even this comment changes the raw hash: replay from the frozen checkout,
never rewrite the archived hashes to admit a changed checkout.
```

两处均明确“有意固定”旧天花板、归档设计原因及默认 N=8 时曲线同为 4。[diff](execution-evidence/residual/experiment-comments.diff) 仅增加注释。TypeScript AST 核对全部 6+2 个调用的参数文本、参数个数都与修改前一致；esbuild 去注释后 JS 的 SHA256 也逐文件完全一致。[实测与完整哈希](execution-evidence/residual/after-metrics.json)。

**哈希口径实测：原始字节，包含注释。** `equalBudgetSourceHashes()` 的真实返回值与当前文件原始 SHA256 一致。`.artifacts/equal-budget/20261007/design.json` 中这两个文件的冻结值均匹配修改前文件，均不匹配修改后文件：

| 文件 | 修改前 raw SHA256 | 修改后 raw SHA256 | 去注释 JS |
| --- | --- | --- | --- |
| reference-policy.ts | `54c63dd64e55a8020efd2b1522c40a0bced187c647290c7ac941c62ada8da4ac` | `f5b9403c4a40ad9cf74c5411e7c90d724849d57bfc6cc3e7f2363cf65e9b76f3` | 未变 |
| topology-host.ts | `63ac9cebcc9f92c03c73071e9296dea4b2e85227dcfbc7bf30cba347ea916821` | `8b800533248d0e18894360b1548b01a5fa3e234aa85eb7224b6b105d7d0da190` | 未变 |

因此，不能声称“只改注释所以旧设计哈希门仍通过”。应对是保留严格字节口径和所有归档设计：**旧实验必须从与冻结哈希匹配的原始检出/快照重放，不能用当前 checkout 续跑旧设计；未来若要用新源码实验，应另建新设计。** 本轮没有重写任何归档哈希，没有跳过文件，没有放松比较器，也没有运行旧实验或模型推理。package、lockfile、其他源码的授权修改同样属于设计身份变化。

## 5. 要求命令与体积对比

Windows、Node `v24.19.0`、npm `11.17.0`。profile smoke 显式使用隔离安装的 Harness `0.2.1-alpha.2` CLI：`D:\dsh-ATN\.scratch\harness-alpha\node_modules\.bin\dsh.cmd`。

| 命令 | 实测结果 | 原始输出 |
| --- | --- | --- |
| `npm test` | 退出 0；551 runtime/集成 + 14 UI；fail=0、skipped=0 | [test.txt](execution-evidence/residual/test.txt) |
| `npm run typecheck` | 退出 0 | [typecheck.txt](execution-evidence/residual/typecheck.txt) |
| `npm run build` | 退出 0 | [build.txt](execution-evidence/residual/build.txt) |
| `npm run pack:tarball` | 退出 0 | [pack-tarball.txt](execution-evidence/residual/pack-tarball.txt) |
| `npm run smoke:profile` | 退出 0；真实隔离 profile 安装、preset 与子节点 smoke | [smoke-profile.txt](execution-evidence/residual/smoke-profile.txt) |
| `npm run verify:sidebar` | 退出 0；npm 0.26.0 双检查 | [sidebar-0.26.0.txt](execution-evidence/residual/sidebar-0.26.0.txt) |

全量测试首轮出现一项失败：原测试仍硬编码 `^0.26.0`，实际已收窄到 `0.26.0`。保留[首轮原始失败](execution-evidence/residual/first-test-outdated-expectation.txt)；随后更新并加强版本一致性断言，再次全量通过。没有删测试、减少用例数或降低断言强度；相关 topology feedback 既有测试也在全量通过范围内。

| 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| `lib/client.js` | 479789 bytes | 479789 bytes |
| `toolSchemaBytes` | 4749 | 4749 |
| `fixedContextBytes` | 5910 | 5910 |
| `systemPromptBytes` | 1161 | 1161 |

客户端 SHA256 前后同为 `249aca803c6e0b5db6851b29471c32499c522f36e7a95b342d4a14c543520b9d`。[修复前](execution-evidence/residual/before-metrics.json)、[修复后](execution-evidence/residual/after-metrics.json)。观察通道未增加模型调用、网络状态写入或 token 成本；工具 schema、domain 版本、曲线、provider 缺失时顶栏回退均保留。

## 6. 重放方式与未完成项

在仓库根目录执行（PowerShell）：

```powershell
npm install --prefix .scratch/residual-sidebar --ignore-scripts --legacy-peer-deps --package-lock=false --no-audit --no-fund --save=false dsh-better-sidebar@0.26.0
$env:SIDEBAR_PACKAGE_DIR = (Resolve-Path .scratch/residual-sidebar/node_modules/dsh-better-sidebar).Path
npm run verify:sidebar
```

负向检查的可重放脚本见 [check-gate.mjs](execution-evidence/residual/check-gate.mjs)，运行前同参数独立安装 `dsh-better-sidebar@0.25.0` 到 `.scratch/residual-sidebar-outside`，再在根目录执行 `node docs/execution-evidence/residual/check-gate.mjs`。它会临时注入故障并在 `finally` 中恢复，不能与其他读写同一投影或包的任务并行运行。旧代码重放固定到本轮基线提交，不依赖将来的 HEAD。

未完成或未声明通过的项目：GitHub 托管 Ubuntu/Windows 矩阵的实际运行；完整 better-sidebar provider host/browser 联合激活与视觉验收；从冻结快照实际重跑旧归档实验。这些没有被 API/注册服务检查替代。4.5 可选精度项明确未实施。本轮没有发布、推送或调用真实模型。
