# DeepSeek 实现交接入口

## 你的任务

实现当前仓库的最小正式 `dsh-atn` bundle，完成实际测试和 profile 安装验证，然后交回 Claude review。不要再次从零访谈已经确认的设计，也不要把当前原型包装成产品后直接发布。

用户最新分工：**Claude 写文档并暂停 → DeepSeek V4 Flash 具体实现 → Claude review → 用户决定发布。**

## 先读这些文件

1. [最小版本实现规格](MINIMAL_BUNDLE_SPEC.md)：正式目标和默认边界，以此安排实现。
2. [实施顺序与验收清单](MINIMAL_BUNDLE_ACCEPTANCE.md)：M0–M5 阶段和必须提供的证据。
3. [原型验证报告](atn-prototype-validation.md)：已有结果及明确未验证的部分。
4. [原型 README](../prototype/README.md)：运行已验证行为，按需查看对应源码。

详细决策和上游源码链接已经在上述文档中，不在此重复。

## 开始前确认实际状态

- 当前已知分支：`prototype/atn-validation`，最近提交仍是初始提交，文档和原型尚未提交。
- 正式根目录包、正式源码和 bundle 尚未创建。
- 已有原型可运行；不要删除或覆盖其中用于对照的工作，也不要操作用户其他未提交修改。
- 已知环境：Node.js 24，原型锁定 Harness `0.2.0-rc.2` 和 Cordis `4.0.4`。
- 没有配置 Git remote；检查时没有可调用的 `gh`。不要把发布条件当作已经满足。
- 开始时重新检查这些事实；它们是交接时状态，不是永久事实。

## 工作方式

按验收清单从 M0 开始，一段一段实现。先写失败验证，再实现对应行为；定期运行相关单项和类型检查，交付前跑完整测试及真实打包/profile smoke。

复用固定版本 Harness 的公开能力。若发现源码接口与文档不一致，先核实固定版本，把差异和处理方式写入实现报告，不静默改变用户已确认的产品规则。

仅在真正需要用户选择的行为变化上暂停询问；文件拆分、测试组织和常规实现细节自行处理。对于暂定默认，保留清晰注释、测试和 README 限制。

测试使用确定性模型 adapter 和临时数据，不调用用户付费模型，不使用真实凭据，不为跑通测试放宽 sandbox。

## Suggested skills / 建议工作流

如果当前 DeepSeek 环境实际提供对应技能，可以使用：

- TDD / 测试驱动开发：先验证具体行为，再实现。
- Harness 插件开发：核对 bundle、Loader、preset、权限和生命周期。
- 类型检查与依赖/打包检查：确认真实可安装产物，不依赖本机源码路径。
- 代码审查准备：整理差异、验收映射与限制，供后续 Claude review。

这些是工作流建议，不是假定存在的 slash command。不要调用不存在的技能，也不需要依赖 Claude 专属工具。

## 完成时交回什么

按验收清单末尾的要求，写 `docs/MINIMAL_BUNDLE_IMPLEMENTATION_REPORT.md`，提供实际执行证据、未完成项和规格偏差。更新 README，但不能把未测能力写成已支持。

保留可供 review 的代码差异和测试。**不要自行创建 GitHub 仓库、推送、发布 release 或 npm，也不要声称 Claude 已经完成 review。** 后续用户会让 Claude 接手。
