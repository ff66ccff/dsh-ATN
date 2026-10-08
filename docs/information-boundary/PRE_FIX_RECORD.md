# 0.5.0 修复前失败证据

源代码基线：`a69d4b4276a727a490ab76bffd2a909f5661ce4a`，在已有未提交的等预算研究改动上运行；这些改动保持不动。

在任何边界实现修改之前运行：

```powershell
node --import tsx/esm --test --test-reporter=tap tests/integration/information-boundary.test.ts
node --import tsx/esm scripts/record-binding-refusals.ts docs/information-boundary/binding-before.json
```

`pre-fix-failures.tap` 保存两条真正的断言失败：`review.summary` 转发未持有文档、agent 通过白板虚报发现元数据，都得到 `Missing expected rejection`。退出码 1，2 tests / 0 pass / 2 fail；不是编译、导入或基础设施错误。

`binding-before.json` 保存现有实验策略八种邮件拒绝的名称、码和有序拒绝记录，用同一脚本在重写后对比。所有执行均为零真实模型调用，`causalClaim=false`。

本记录先于实现提交。后续回归测试会随移除白板而迁移到五工具面和宿主保管元数据断言；本 TAP、JSON 和 Git 中的原始测试保留。
