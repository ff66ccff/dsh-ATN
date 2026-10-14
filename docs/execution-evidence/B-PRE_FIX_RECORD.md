# 阶段 B 修复前记录

基线：阶段 A 提交 `25cf67c`。运行命令：

```powershell
node --import tsx/esm --test --test-reporter=tap tests/unit/dynamic-degree.test.ts tests/integration/dynamic-degree.test.ts
node --import tsx/esm scripts/degree-table.ts
```

`B-pre-fix.tap`：退出码 1，6 tests / 2 pass / 4 fail / 0 skipped。
失败为 DYNAMIC-STATUS（N=2 报 4）、DYNAMIC-01（N=1 报 4）、DYNAMIC-02（硬顶仍为 4）、DYNAMIC-05（codec 留有 max(4)）。
DYNAMIC-03（增长保边）与 DYNAMIC-04（快照确认）在旧常量曲线也通过；后者旧实现会截断输入六边为四边，不能声称已覆盖新六边成功路径，修复后需额外断言实际快照含六边。
稀疏性、单调性、纯函数这些既有性质本来成立，无法诚实写成修复前失败。旧记录兼容子断言在 DYNAMIC-02 首个失败之后未执行，尚无单独失败记录。
度数完整旧输出在 `B-degree-before.csv`。所有脚本和测试均为零付费模型调用。
