# dsh-ATN 残余验证缺口修复说明

这份文档交给实现代理执行。上一轮（A/B/C/声明审计/D）已分阶段落地并通过最终验收；本轮**不新增功能**，只收口复核中发现的**验证与可追溯性缺口**：把已经写好的 better-sidebar 检查接进门禁、把「已声明但未验证」的兼容范围对齐、并补上两处绕过动态出度的**未说明**用法。

本轮的性质是**收紧既有承诺的证据**，不是扩大范围。除第 4 节明确列出的条目外，**不得改变任何运行时行为**。

实现代理在动手前必须先完整阅读本文件，并按第 8 节完成标准交付。

---

## 1. 基线（已独立复核）

- 工作区：`D:\dsh-ATN`，分支 `codex/release-ready`。
- `npm test` 为 **551 项 runtime／集成 + 14 项 UI，全部通过，0 跳过，退出码 0**（复核时实测重跑）。
- `scripts/degree-table.ts` 实测：N=8 → 4，N=32 → 6，单调。
- `scripts/compare-degree-proofs.ts` 实测：五个 seed 两种配置**零翻转**，前后哈希相同。
- `package.json` 的 `dsh-better-sidebar` 为 **`peerDependencies` 且 `optional: true`**，范围为 **`^0.26.0`**（`:98` 声明，`:176` optional）。
- `.github/workflows/ci.yml` 只有**一个** `verify` job（矩阵 `ubuntu-latest` + `windows-latest`），步骤为：`npm ci --ignore-scripts` → `typecheck` → `test` → `build` → `pack:tarball` → 上传 artifact。
- 两个检查脚本**均未**出现在 `package.json` 的 `scripts` 中，也**均未**被 CI 或任何测试调用；两者都要求手动设置环境变量 `SIDEBAR_PACKAGE_DIR`。
- better-sidebar 0.26.0 的已发布 npm 包 `files` **包含 `src`** 与 `lib/types/**/*.d.ts`，并导出 `./src/*`。因此两个检查脚本**可以**对 npm 安装副本运行，不必依赖 git 检出。

---

## 2. 发现清单

严重度为本轮复核的判定，括号内为可复核的证据位置。

### F1 两个 better-sidebar 检查未接入任何门禁 —— **中**

`scripts/verify-sidebar-contract.mjs` 与 `scripts/verify-sidebar-registry.mjs` 都已实现且质量良好：

- `verify-sidebar-contract.mjs` 用 TypeScript 编译器 API 断言消费者的 `TabDescriptor` 投影**可赋值给已发布声明**，并打印该声明的 sha256。
- `verify-sidebar-registry.mjs` 更强：它加载**provider 真实随包发布的** `createBetterSidebarService` / `createSidebarStore`，在真实 Cordis `Context` 上装载本插件，断言 `getTabs().length === 1`、`getTab('atn-network')`、重复注册抛 `/already registered/`、卸载后回到 0、重挂后回到 1。

**缺口不在检查本身，而在于没有任何自动机制运行它们。** `src/client/better-sidebar-contract.d.ts` 是**手写的**类型投影（其头部注释自称 "Source: src/client/service.ts:149-292"），它唯一的防漂移手段就是这两个脚本。当前它们只靠人工执行与留档（见上一轮 `execution-evidence/FINAL-sidebar-contract.txt`、`FINAL-sidebar-registry.txt`）。

后果是：better-sidebar 后续版本若改动 `TabDescriptor`，本插件的 `typecheck` 会**继续通过**（因为它校验的是自己的投影，不是真实声明），而侧栏 tab 会在运行时静默失效。失效是优雅的（顶栏回退仍可用），但这正是本项目规范所禁止的「静默失败」。

**该缺口已在上一轮 D 记录中被识别并排入下一轮范围**（见 `docs/NEXT_SCOPE_DECISION_RECORD.md` 选定范围第 4 项，及「consumer-owned 类型投影需要 published API 漂移门」）。本轮把它落地。

### F2 声明的 peer 范围宽于已验证的范围 —— **中**

`package.json` 声明 `dsh-better-sidebar: ^0.26.0`，即声称兼容**整个 0.26.x**。但 `verify-sidebar-registry.mjs` 内部硬性要求：

```js
if (manifest.version !== '0.26.0') throw new Error('This published-source check is pinned to the reviewed 0.26.0 contract')
```

也就是说：只有 **0.26.0** 被实际验证过，而 0.26.1 会让该脚本**抛错**而不是「验证通过」。于是存在两个问题：

1. **声明大于证据**：`^0.26.0` 声称兼容 0.26.1/0.26.2，但没有任何证据支持，且投影是按 0.26.0 手写的。
2. **门禁的失败形态是「脚本报错」而不是「契约不匹配」**，一旦接入 CI，0.26.1 发布会表现为一个难以归因的红灯，而不是一条可读的契约结论。

### F3 两处绕过动态出度且**未作说明** —— **低**

以下调用点省略了第三个参数，因而落到 `collaborationPeers` 的默认值 `LEGACY_COLLABORATION_CEILING`（= 4），**不经过** `collaborationPeerLimit` 的曲线：

- `experiments/reference-policy.ts:106, 213, 244, 290, 299, 314`（6 处）
- `experiments/topology-host.ts:52, 54`（2 处）

`collaborationPeers` 的默认参数**有**注释说明，`experiments/topology-binding-proof.ts` 也**有**显式注释，但**这两个文件的这些调用点没有**。上一轮 brief 明确要求「不得让结构证明悄悄继续使用旧的常量 4 而不作说明」——现在的问题正是**静默**。

需要澄清一点，以免实现代理误改：**对这些文件而言，保持固定额度很可能是正确的**。理由：

- `topology-host.ts` 是等预算实验的组成部分，其源码哈希被写进 `.artifacts/equal-budget/20261007/design.json` 的 `sourceHashes`，而 `scripts/continue-simplification.mjs:22,54` 会**比对** `sourceHashes`。改动该文件的行为会使已归档实验的设计校验失败。
- 这些实验在 8 节点规模运行，而曲线在 N=8 恰好给出 4——与固定值 4 **数值相同**，因此当前无行为差异。

所以本项的正确修复是**补说明**（并指明该冻结是有意的、及其原因），**不是改行为**。

### F4 `topology-feedback.ts` 重复求值 —— **极低**

`src/topology-feedback.ts:74-75` 连续两次调用 `collaborationPeerLimit(record)`。该函数是纯函数，无正确性影响，属可读性/效率小瑕。

### F5 我上一轮提出的「稀疏度声明」不成立 —— **已撤回**

我在复核中曾指出 README 的稀疏度措辞在 N≤5 时不成立。**重新计算后该发现不成立，特此撤回**，并如实记录分析过程，以免实现代理照做无用功：

- 当前 README:65 的措辞是「全网出边保持 **O(N log N)**」，不是模糊的「维持拓扑稀疏度」——上一轮已改精确。
- 出边上界为 `N × min(N−1, ⌈log₂N⌉+1)`。当 N 足够大时 `min` 取曲线值，得 `N(⌈log₂N⌉+1) ≤ N(log₂N+2) = O(N log N)`。**该声明作为渐近界是正确的。**
- N≤5 时 `min` 取 `N−1`，图为全连接（`degree-table.ts` 中 ratio = 1.000000）；但该区间绝对边数 ≤ 20，且大 O 本就描述渐近行为。

**结论：这不是缺陷，本轮不要求改动。** 唯一可选的收益是在度数说明后加一句「N≤5 时曲线尚未生效，此时为全连接」以省去读者自行推导；此项列为**可选**（见 4.5），不做也不算未完成。

---

## 3. 目标

- **G1 门禁**：两个 better-sidebar 检查由 CI 自动执行，缺一即红，不再依赖人工。
- **G2 对齐**：`dsh-better-sidebar` 声明的兼容范围与**实际被验证**的范围一致；未验证的版本不得被默许。
- **G3 可读的失败**：版本超出已验证范围时，检查给出**明确的契约结论**，而不是不可归因的脚本抛错。
- **G4 可追溯**：F3 的 8 个调用点有就地说明，读者无需外部知识即可判断「固定 4 是有意的」。
- **G5 零行为变更**：除门禁本身外，`src/` 的运行行为逐位不变；`npm test` 仍为 551 + 14 全绿。
- **G6 诚实**：F5 已撤回，不得为凑满清单而实施它。

---

## 4. 必须实施的项目

### 4.1 把两个检查接入门禁（G1、G3）

要求：

- 在 `package.json` 的 `scripts` 中新增**单一**入口脚本（建议名 `verify:sidebar`），依次运行 `verify-sidebar-contract.mjs` 与 `verify-sidebar-registry.mjs`。
- 在 `.github/workflows/ci.yml` 中新增**独立 job**（不要塞进现有 `verify` job）：
  - 该 job 需要把 better-sidebar 装到独立目录，并设置 `SIDEBAR_PACKAGE_DIR` 指向它。
  - 安装版本必须**固定**（见 4.2），不得用浮动范围解析，否则门禁结果不可复现。
  - 建议矩阵沿用 `ubuntu-latest`；若在 `windows-latest` 上运行，必须确认 `SIDEBAR_PACKAGE_DIR` 的路径分隔与 `.replaceAll('\\','/')` 处理仍然正确（脚本已有该处理，但需实测）。
- **不得**把 `dsh-better-sidebar` 加入 `dependencies` / `devDependencies` / `optionalDependencies`——它必须保持可选 peer，独立 job 用临时安装满足即可（可用 `npm i --no-save dsh-better-sidebar@<pin>` 或安装到独立目录）。
- 门禁必须**阻断**：任一检查失败，CI 即红。

验收测试：

- 本地运行新增的 `npm run verify:sidebar`（在 `SIDEBAR_PACKAGE_DIR` 已设置的前提下）通过。
- **故意制造漂移**：临时把 `src/client/better-sidebar-contract.d.ts` 的某个字段（例如把 `single?: boolean` 改名）改坏，确认 `verify-sidebar-contract.mjs` **失败**；改回后通过。此项必须留修复前失败记录。
- 确认 CI 配置语法有效，且新 job 与现有 `verify` job 的步骤不互相干扰。

### 4.2 对齐 peer 范围与已验证范围（G2、G3）

要求：

- **必须解决 `^0.26.0` 与实际只验证 `0.26.0` 的不一致。** 两种解法都可接受，但必须择一并说明理由：
  - **(a) 收窄声明**：把 `package.json` 的 peer 范围改为与实际验证一致（例如精确 `0.26.0`）。
  - **(b) 扩大验证**：让 `verify-sidebar-registry.mjs` 接受声明范围内的版本，并对**每一个**被接受的版本实际运行验证；任何未实际验证的版本都不得落在声明范围内。
- **不论选哪种，都必须消除「静默抛错」这一失败形态。** 当安装到的版本不在已验证集合内时，检查必须给出**可读的契约结论**（例如明确输出「该版本未被验证，声明范围与验证范围不一致」并失败），而不是抛一个 `pinned to the reviewed 0.26.0 contract` 的裸错误。
- 选择 (b) 时，必须实测声明范围内**全部**版本；不得只测最新一个就宣称覆盖整段。
- 选择 (a) 时，必须同步核对 `docs/` 与 README 中任何描述该兼容范围的文字。

验收测试：

- 对**声明范围内的每一个**版本，检查实际运行过并留档（原始输出）。
- 对**范围外的**版本，检查给出可读的契约结论并失败；此项留修复前失败记录。
- 断言 `package.json` 的 peer 范围与被验证版本集合**一致**（可用测试或 CI 断言固化）。

### 4.3 为 F3 的 8 个调用点补就地说明（G4）

要求：

- 在 `experiments/reference-policy.ts` 与 `experiments/topology-host.ts` 中，为省略第三个参数的调用添加说明，使读者无需外部知识即可判断该冻结**是有意的**。说明至少覆盖：
  - 这里**有意**使用固定的旧天花板，而非 `collaborationPeerLimit` 的曲线值；
  - 原因是这些文件承载已归档实验，其源码哈希被 `sourceHashes` 固定，改行为会使归档设计校验失败；
  - 并指明在默认 8 节点规模下曲线值恰为 4，因此当前与固定值一致。
- 说明放在**函数或文件层面**即可，不必在 8 个调用点逐一重复；但每个文件都必须有。
- **不得**改动这些调用点的行为（不得改为传入 `collaborationPeerLimit(...)`）。理由见第 2 节 F3。
- `experiments/topology-host.ts` 是等预算实验的一部分：改动其**行为**会破坏 `sourceHashes` 校验。**纯注释改动不改变源码哈希的前提是实现代理确认哈希口径为行为相关**；若不确认，则必须在报告中说明并给出应对（例如仅在报告中记录而不改文件）。**不得**为了让门禁变绿而跳过该文件。

验收测试：

- 两个文件各自有一段说明，明确写出「有意固定」及原因。
- 断言**没有**任何调用点被改为传入曲线值（可 diff 校验）。
- 若改动导致 `sourceHashes` 相关校验失败，如实报告并给出应对，不得静默绕过。

### 4.4 消除 `topology-feedback.ts` 的重复求值（G5）

要求：

- 把 `src/topology-feedback.ts:74-75` 的两次 `collaborationPeerLimit(record)` 求值提升为一个局部变量，两处复用。
- **纯重构，不得改变行为。**

验收测试：

- 该文件的相关既有测试继续通过，断言强度不降低。

### 4.5 （可选）稀疏度说明的一句精度补充

要求：

- 若实施，在 README 的度数说明附近补一句：曲线在 N≤5 时尚未生效，此时图为全连接（绝对边数 ≤ 20）。
- **这是精度补充，不是缺陷修复**（见 F5）。**不做也算本轮完成**，且不得因此改动任何结论性措辞或调整曲线参数。

验收测试：

- 若实施：新措辞与 `scripts/degree-table.ts` 的输出一致（可对照 ratio 列）。

---

## 5. 必须保留的既有语义

- 不新增、不删除、不重命名任何模型工具；不改任何工具 schema。
- 不改出度曲线、天花板默认值、配置语义或持久化 domain 版本（保持 1）。
- `dsh-better-sidebar` 保持**可选** peer：不得因本轮而变成硬依赖或安装依赖。
- `src/client/better-sidebar-contract.d.ts` 保持**只读投影**性质：不得改为运行时依赖 provider 的值，也不得新增运行时 import。
- 顶栏结构化回退在 provider 缺失时必须继续可用。
- 观察通道保持纯只读：不唤醒模型、不写网络状态、不增加 token 成本。
- 不删除已有测试，不降低断言强度。
- **不得把未测试内容写成已通过。**

---

## 6. 不要做的事

1. 不实施 F5（已撤回）；不为凑清单而改稀疏度措辞。
2. 不把 `dsh-better-sidebar` 加入任何安装依赖段。
3. 不把 F3 的调用点改成曲线调用（那是行为变更，会破坏归档实验的哈希校验）。
4. 不改 `src/` 的运行行为（4.4 的纯重构除外）。
5. 不用「只测最新版本」的方式宣称覆盖整段声明范围。
6. 不把门禁做成「失败但允许通过」。
7. 不把门禁塞进现有 `verify` job 里以致与 `npm ci --ignore-scripts` 的可选 peer 约束冲突。
8. 不删除已有测试，不降低断言强度。

---

## 7. 未验证项（实现代理必须自行确认）

1. `SIDEBAR_PACKAGE_DIR` 指向 npm 安装副本时，`verify-sidebar-registry.mjs` 能否解析其 `src/client/service.ts` 的**传递依赖**（该文件可能 import 包内其他源码或第三方模块）。基线已确认 0.26.0 的 `files` 含 `src` 且导出 `./src/*`，但**传递依赖是否完整**未验证。
2. 在 `windows-latest` 上运行该 job 是否稳定（路径分隔、esbuild、jsdom）。若不稳定，可只在 `ubuntu-latest` 运行并**在报告中说明理由**，不得静默省略。
3. `sourceHashes` 的哈希口径是否覆盖注释改动。**这决定 4.3 能否直接改文件**，必须实测确认。

---

## 8. 完成标准

实现代理必须完成以下命令并保留输出摘要：

```text
npm test
npm run typecheck
npm run build
npm run pack:tarball
npm run smoke:profile
npm run verify:sidebar      # 需 SIDEBAR_PACKAGE_DIR
```

并且：

1. `npm test` 仍为 **551 runtime／集成 + 14 UI，fail=0/skipped=0**，断言强度不降低。
2. 4.1 的**故意漂移**实验有可核对的修复前失败记录（无法重放的必须逐项列出，不得补造证据）。
3. 4.2 给出所选方案（a 或 b）及理由，并给出**声明范围内每个版本**的实测留档；给出范围外版本的可读失败输出。
4. 4.3 给出两个文件的说明文本，并给出 diff 证明**没有**调用点行为变更；给出 `sourceHashes` 口径的实测结论。
5. 4.5 若未实施，明确写「未实施」，并注明它是可选精度项而非缺陷。
6. 给出 `lib/client.js` 体积与 `toolSchemaBytes` / `fixedContextBytes` 的前后对比，证明行为未变。
7. 更新 `docs/README.md` 索引与 README 的兼容范围描述（凡涉及本次改动处）。
8. README 与本轮报告同步记录实际通过项与未完成项。**不得把未测试内容写成已通过。**

交付物：

- `package.json`、`.github/workflows/ci.yml` 的改动。
- 两个检查脚本的（必要）改动与实测输出。
- 4.2 的方案说明与版本实测表。
- 4.3 的说明文本与 diff 校验。
- `docs/` 下的一份本轮实施报告。

---

## 9. 一句话提醒

本轮的**全部价值**在于「让已有的证据自动生效」。如果门禁接好了但没人验证过它会**红**，那等于没接。第 8 节第 2 项的**故意漂移实验**是本轮最不可省略的一步。
