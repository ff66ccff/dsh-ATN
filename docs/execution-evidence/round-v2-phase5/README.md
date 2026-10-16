# 阶段 5：日志设计，无实现

先以缺失设计文件跑出 red.txt；再提交完整设计与威胁模型/通道审计双向引用，green.txt 核对最终 14/16 词汇、五项设计要求与无源码 diff。审计脚本副本 audit-design.mjs.txt 用于复现，不是产品源码。references.txt 为交叉引用原始 rg 输出，docs-only-stat.txt 为阶段 diff；gates.json 列完整闸门退出码。

复现时把脚本副本复制为仓库根下 `.scratch/audit-v2-log-design.mjs`，从仓库根运行 `node .scratch/audit-v2-log-design.mjs`；其相对 import 指向随包 conformance 的固定词汇。

不新增日志存储、事件 journal、授权资源注册或代码路径。B-REFUSAL-LOG 明确是未来设计判据；计数不是日志，未来崩溃/sink/注入测试未执行也不冒称通过。
