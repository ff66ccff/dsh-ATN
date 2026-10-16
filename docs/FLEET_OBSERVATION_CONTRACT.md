# V2 阶段 4：舰队读取与计数口径（实现前决策）

授权复用 §4 的 remoteAccess。新资源 `atn-fleet`：`index` 允许调用 `atnObserver/fleet`；各网络需另授 `fleetNetworkResourceId(networkId)`（JSON 二元组）上的同 action。index 不隐含任一网络；单会话 atn-observation 不隐含 index。服务只从当前主体的 remoteAccess.snapshotFor 授予清单派生可读网络，并在加载前后用同一 decide 复核；不枚举未授权网络。新端点无 JSON 参数，不能指名或探测未知网络。单独授予不存在网络只得到空清单，与已移除网络一致。

默认不注册主体或授予；owner 在该端点显式拒绝，不能利用上游 owner bypass 拼出跨网读取。宿主需通过可信认证载体建立显式授权的非 owner 运营主体。最多返回 32 个授权网络，按资源 ID 稳定排序并报告截断。加载失败只标记已授权条目的 unavailable，不回传异常文本。

快照仅列网络 id/status、节点健康计数、stepsUsed 与每节点 stepBudget、substrate 容量、按固定公开拒绝码分桶的有界计数。无目标、任务、会话、作者或消息内容；严格 schema。UI 复用 atn-network 与顶栏回退内部的分区切换，不新增 tab 注册项；隐藏时不轮询、串行、可取消、错误保留旧快照并可重试。

计数是**观察服务存活期内的易失遥测**，不是审计 journal。每网络固定 16 公开码 + other 桶，各上限 65535；最多保留 64 个网络桶，超出淘汰最早桶。只记经真实网络 mutation 抛出的结构化 AtnRefusal，及关闭归档读取的结构化拒绝；不记被拒内容、异常文本或载荷片段，不记没有网络的 start/身份拒绝，不记网关认证拒绝或非结构化存储异常。服务重启/桶淘汰清零，必须向运营者标明。

为保留 B-ATOMIC 的整份业务记录/写次数不变，本阶段不为计数执行存储写入，也不往 NetworkRecord 加字段；domain 保持 1，旧记录无需迁移。将来如要求持久拒绝日志，须由阶段 5 另行设计事务/崩溃语义，不能把本计数冒充持久审计。计数不度量模型成本，预算字段仅报告已准入步数。
