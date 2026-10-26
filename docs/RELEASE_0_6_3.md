# 0.6.3 适配与发布记录

日期：2026-10-26（Asia/Shanghai）。从 0.6.2 递增一个补丁版本。

## 兼容目标与改动

| 组件 | 声明范围 | 验证基准 |
|---|---|---|
| DeepSeek Harness | `>=0.2.1-rc.3` | npm rc.3 与 upstream `22ddee3792` |
| Node.js | `>=24.9.0` | 本机 24.19.0；最低版本对齐 upstream |
| Cordis / schemastery | 4.0.5 / 3.18.5 | npm 包；源码核验使用 upstream vendored Cordis |
| Better Sidebar（可选） | 0.28.0 | npm 包与 upstream `83faf70940160e5cd4c5332f5400aa8f4dbbb6d6` |

`engines.dsh` 与全部 Harness peer 依赖改为最低版本范围；开发依赖及实验 provider overrides 固定 rc.3，以锁文件复现测试环境。范围声明不代表所有未来版本均已实测。rc.2 用户使用 ATN 0.6.2，rc.1 用户使用 ATN 0.6.1。

本地 upstream 的版本字段仍为 rc.3，但源码比 npm rc.3 更靠前，已经引入 `Agent.model.current()/select()`、投影注册生命周期及独立工具执行器。新执行器包尚未在 npm 发布，因此分别验证发布包和本地源码，避免把同名版本当作同一源码。所消费包的源码变化列表及完整提交号见[上游复核清单](execution-evidence/release-0.6.3/upstream-review.json)。

ATN 启动和创建子节点现在优先读取上游当前模型选择；npm rc.3 没有该 accessor，继续读取其现有 options。省略 effort 表示使用模型默认值，不再错误继承过时的 effort。新增回归在旧实现上失败，修复后在 npm rc.3 与本地 upstream 实际模型选择 API 上均通过。八工具协议、保管边界与观察授权行为保持。

## 验证

- 正常解析锁文件及 `npm ci --ignore-scripts` 通过，不使用 legacy peer 解析。
- `npm run prepublishOnly` 通过：类型检查、608 项 runtime/集成测试、17 项 UI 测试、构建；零失败、零跳过。回归测试最后改为优先调用真实上游 `model.select()` 后，额外重跑了两套 effort 用例，各四项通过。
- 本地 upstream 源码共 73 项通过：Agent、spawn、恢复、preset、14 条出站保管通道、观察 RPC、舰队授权、substrate 读策略、固定上下文及模型选择。测试直接解析 upstream DSH 与 vendored Cordis 源码，向测试 kernel 挂载上游 native executor；未执行完整 upstream CLI/Web 构建。
- Better Sidebar npm 包与 upstream 声明图、真实 registry 注册、重复拒绝、卸载与重挂载全部通过；声明 SHA-256 均为 `e49c026e599e38d4f47a78418dc1edd6977979d4b68bdfc13ca61b74b99099cf`。
- npm rc.3 独立 CLI 的临时 Web Profile 安装 tarball 通过：八工具、子节点 preset 继承、substrate 发布/读取及原配置保持。
- rc.3 + Better Sidebar 0.28.0 联合启动通过：双方客户端产物、未认证拒绝、六节点状态和显式授权舰队读取。未执行完整浏览器交互巡检；UI 由 17 项测试覆盖。
- 八工具固定上下文保持 7,956 字节，关闭 substrate 时为 5,910 字节；本轮零外部模型调用。

见[验证汇总](execution-evidence/release-0.6.3/validation.json)、[完整发布检查](execution-evidence/release-0.6.3/gates.txt)、[源码运行](execution-evidence/release-0.6.3/upstream-runtime.txt)、[真实模型选择](execution-evidence/release-0.6.3/upstream-selection.txt)、[旧实现失败](execution-evidence/release-0.6.3/selection-before.txt)、[Profile](execution-evidence/release-0.6.3/profile.txt)和[侧栏联合启动](execution-evidence/release-0.6.3/visualization-sidebar.txt)。

源码检查可复现：在仓库根目录运行 `npm install --prefix .scratch/upstream-check --ignore-scripts --no-audit --no-fund @js-temporal/polyfill@0.5.1`，然后运行 `node docs/execution-evidence/release-0.6.3/check-upstream.mjs tests/integration/effort.test.ts`（末尾可列出其他上述集成测试文件）。该依赖是上游 `dsh-util-time` 的正式依赖，仅装入隔离测试目录。检查器保留源文件的 `import.meta.url`，并仅为测试 kernel 添加上游已拆出的 native executor，与新上游基础 profile 的装配一致。

## 发布状态

发布产物和远端版本确认后补充。
