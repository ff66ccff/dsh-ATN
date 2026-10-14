# 阶段 A 修复前记录

源代码基线为 `260a82b`，用户已有的执行 brief 与索引改动保持原样。

在依赖或 patch 修改之前执行：

```powershell
node --import tsx/esm --test --test-reporter=tap tests/unit/harness-adaptation.test.ts
node --import tsx/esm scripts/measure-atn-context.ts
```

`A-pre-fix.tap`：退出码 1，2 tests / 0 pass / 2 fail / 0 skipped。
HARNESS-01 实际版本是 0.2.0-rc.2；HARNESS-02 实际存在已删除的 invariants 依赖。
二者均为断言失败，非导入或基础设施失败。HARNESS-02 的 cwd 断言因前面的断言失败尚未执行，不能宣称已经失败留档。

`A-context-before.json`：systemPromptBytes=1161，toolSchemaBytes=4749，fixedContextBytes=5910。
测量通过实际工具注册表，无付费模型调用。
