# 阶段 4：舰队观察

先写 FLEET_OBSERVATION_CONTRACT，再留 red.tap、red-counters.tap、red-ui.txt，随后实现。green.tap 为授权矩阵/冷加载/计数边界；green-ui.txt 为 17 UI。全部闸门见 gates.json。

| 主体与绑定 | 结果 |
|---|---|
| 默认无策略、仅逐网络无 index | 加载前拒绝 remote-access/denied；存储屏障未触发 |
| 只有 index | 空清单 |
| 主体 A：index + A 网络 | 只见 A |
| 主体 B：index + B 网络 | 只见 B |
| owner 或额外 networkId 参数 | 明确拒绝／严格参数失败 |
| 授权未知名称／加载中撤销 | 空清单／返回前删除已撤销条目 |
| 冷记录 40 网 | 返回前 32 项、truncated=true；无 Agent/模型/存储写入 |

计数只存观察期桶、不是 journal；65535 饱和、64 网络淘汰、任意宿主码归 other。domain 1；没有持久 NetworkRecord 字段或拒绝写入，旧记录无迁移。明确缩限：不统计无网络身份拒绝、网关拒绝或非结构化存储故障，重启/淘汰清零。

真实浏览器使用 tests/smoke/fleet-preview.ts：真实 kernel + Peer + Gateway + 同一 ObserverHost/FleetView，测试主体选择器仅属于一次性 loopback fixture，不是产品认证载体。browser-all.png 显示双授权网络，browser-a/b.txt 分别仅显示各自网络，browser-denied.png 显示未授权失败且无网络条目。截图不是完整 sidebar provider 激活证明。实际 tarball Web/profile smoke 另验证真实 HTTP owner 拒绝、显式非 owner 两网只读 Gateway 和原有 UI bundle 载入。

保留两次环境/夹具红灯：npm-ci-preview-lock.txt 为预览持有 esbuild.exe 的 Windows EPERM；关闭临时预览后 ci 通过。smoke-before-inject.txt 为真实 Cordis 拦截测试插件缺少 remoteAccess inject；补充测试插件声明后 Web smoke 通过，未放宽生产授权。gates.json 保留所有成功前置命令的实际时间，--resume 仅重跑修正后的失败 smoke 与未执行闸门。
