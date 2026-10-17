# 0.6.2 适配与发布记录

日期：2026-10-18（Asia/Shanghai）。本次从 0.6.1 递增一个补丁版本，适配本地 upstream 并发布 GitHub / npm。

## 兼容目标

| 组件 | 版本 | 验证基准 |
|---|---|---|
| DeepSeek Harness | 0.2.1-rc.2 | upstream `687f282e8625c6b8d11ff58211a90524be2e4317` 与同版本 npm 包 |
| Cordis / schemastery | 4.0.5 / 3.18.5 | 正式版 npm 包 |
| Better Sidebar（可选） | 0.28.0 | npm 包与 upstream `83faf70940160e5cd4c5332f5400aa8f4dbbb6d6` |

Harness 相比 0.6.1 的目标提交 `1600d8a1e140dcde43a1a0941940a0480712c011` 共变化 456 个文件，新增 DeepSeek Search / Fetch API、Web 搜索设置切换和模型标签，搜索辅助请求显式关闭 thinking。ATN 直接消费的 43 个 Harness 包除版本号及 preset 内一份参考文档外没有源码变化；上述 Web provider 的配置变化不需要改写 ATN。完整包映射见 [上游复核清单](execution-evidence/release-0.6.2/upstream-review.json)。

全部直接宿主依赖、`dsh-opencode-go` overrides 与 `engines.dsh` 精确同步 rc.2；Node.js 仍要求 24 及以上。锁文件从独立空目录正常解析，不使用 legacy peer 选项。Harness rc.1 用户继续使用 ATN 0.6.1。

Better Sidebar 本地 upstream 仍是 0.28.0，同 0.6.1 的固定提交一致。继续声明精确 optional peer，检查 npm 声明图与 upstream 真实源码声明图，以及 service/state 的注册、重复拒绝、卸载和重挂载。CI 保留 Ubuntu / Windows 与 published / upstream 矩阵。

## 验证与发布状态

本地普通依赖解析、`npm ci --ignore-scripts`、最终 `npm run prepublishOnly`（typecheck、607 项 runtime/集成 + 17 项 UI、build）均通过，零失败、零跳过。八工具固定上下文保持启用 7,956 / 关闭 5,910 字节。

两套 Better Sidebar 检查均通过，声明 SHA-256 同为 `e49c026e599e38d4f47a78418dc1edd6977979d4b68bdfc13ca61b74b99099cf`；真实 registry 的注册、重复拒绝、卸载和重挂载全部通过。独立 rc.2 CLI 在临时 Web Profile 正常安装 tarball，验证八工具、子节点 preset 继承、substrate 读写，190 条既有配置保持。联合安装 Better Sidebar 0.28.0 后启动通过，覆盖双方客户端产物下发、认证/未认证请求、六节点状态和显式授权舰队读取。

上一提交的 [Windows CI](https://github.com/ff66ccff/dsh-ATN/actions/runs/39013472634) 曾因 `KNOWLEDGE-02` 把旧消息从 queued 到 delivered 的异步收据写入误认为反馈副作用而失败。[原始失败摘录](execution-evidence/release-0.6.2/prior-windows-race.txt)。测试提交辅助函数现在等待 scheduler pass 并断言收据完成，再建立反馈基线；八项相关测试在写入延迟夹具下通过，最终全量测试通过。生产运行代码保持。

证据见 [验证汇总](execution-evidence/release-0.6.2/validation.json)、[Profile](execution-evidence/release-0.6.2/profile.txt)及[侧栏联合启动](execution-evidence/release-0.6.2/visualization-sidebar.txt)。本轮未执行完整浏览器侧栏交互巡检；客户端可见性、取消、卸载与顶栏回退由 UI 测试覆盖。本轮不调用外部模型、不重跑历史性能实验。

GitHub 托管 CI、GitHub Release 与 npm 发布结果待完成后追加。
