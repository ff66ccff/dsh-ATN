# 阶段 1：网络命名空间补证

纯补证，无生产代码改动。`red-control.tap` 是显式的错误网络解析器负对照，不冒称发现了生产漏洞；同一断言用真实本地解析运行的 `green.tap` 全绿。完整闸门见 gates.json。

## 业务分区判定

| 标识／路径 | 结构层 | live Agent／RPC 层 | 结论 |
|---|---|---|---|
| 同号 A 节点、same task、msg:1 | 两份 record 同号但内容不同 | 两个真实 Agent 的 session 绑定自己的 record，真实 atn_visit 驱动 | 各自命中本地，不误拒 |
| msg 外网独有／未知 | alpha 拒绝 beta 独有 msg:2 | alpha 拒绝 beta 独有 msg:3，与未知 msg:99 同码 | ref-unresolved，无外网查询 |
| task 外网独有／本地不可见 | foreign / hidden | 同名分区与实际 publish | ref-unresolved / ref-not-visible，按既有优先级 |
| artifact 同名／外网独有 | 本网 custody same 放行 | 两网策略各自拥有 same；beta-only foreign 不授给 alpha | 本地放行；foreign 为 ref-not-owned（保持既有 custody 契约，不改成 ref-unresolved） |
| exportSubstrate(beta) | 宿主信任前提 | alpha 的宿主直接读取 beta 成功 | B-HOST-EXPORT 预期，不主张 caller 隔离 |

## 读取授权判定

| 调用 | 真实 Gateway 结果 | 前提 |
|---|---|---|
| alpha 主体读 alpha-A；beta 主体读 beta-A | 返回自己的网络 | 真实 Peer 由可信 fixture 创建，资源/action 绑定 |
| 两主体交叉指名／未知 session | remote-access/denied | 授权先于网络查找；未知与未授权目标不可区分 |
| 两个已授权未知 alias | network=null | 不激活 Agent，不推断其他网络 |

网络仅为业务分区键。未证明外部 IAM、宿主插件、凭据或框架外存储隔离。零真实模型请求；脚本工具调用只证明运行结构。
