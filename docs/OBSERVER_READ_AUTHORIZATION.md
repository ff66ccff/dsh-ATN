# 观察读取授权接入

2026-10-16，ROADMAP V2 §4。先读 [威胁模型 B-OBSERVE/B-HOST-EXPORT](THREAT_MODEL.md)。

## 授权语义

观察 RPC 使用 alpha.4 的 `@Remote({ resources })`、Peer principal 与 `remoteAccess` 策略。`InvocationDescriptor` 保留 direct invocation 与严格参数/结果 codec；该协议的资源 reader 在方法元数据上，没有可写入描述符的 resources/principal 字段。

ATN 声明 `atn-observation` 资源（ID 为 sessionId），reader 从经过 codec 校验的参数读取 ID。无授权请求在网络查找前拒绝；不会为验证 sessionId 激活 Agent。owner 按上游协议直接放行。非 owner 必须同时匹配资源和 action，缺省拒绝；global 权限不匹配命名会话。

**重要的授予单位**：sessionId 在此是“观察此会话所属整网”的能力别名。snapshot 可以显示整网其他节点的 sessionId、任务、作者和有界文本。宿主必须在授予时核验整网的披露权限；不能把普通单会话阅读权限自动升级为 ATN 观察权限。别名不自动互相授权，networkId 也不是会话别名。网络关联不可由不可信请求改写。

| action / 公开角色常量 | 字段范围 |
|---|---|
| `atnObserver/snapshot` / `ATN_CONTENT_READER` | 原有完整有界观察投影：目标、节点、会话 ID、邻接、任务、事件、substrate 子任务/作者/权重/引用计数/证据链 |
| `atnObserver/metadata` / `ATN_METADATA_READER` | observedAt；network 的 id、status、stepsUsed、stepBudget、nodes 数量、tasks 数量；可选 substrate 消息数/字节数/容量上限 |

两种 action 独立，不隐式继承。元数据会暴露网络 ID、规模和活动量，仍需授权；它不是匿名公共健康接口。metadata 直接从记录投影计数，不生成内容快照再删除字段，不读取 Agent 会话历史。

## 宿主配置示例

认证载体负责创建不可由 RPC 参数改写的 Peer。宿主拥有 principal kind 和唯一对应策略；以下为集成示意，真实 grants 来自宿主权限底座。ATN 不自行注册 operator principal 或默认策略，不接管其他插件的策略。

```ts
import { ATN_CONTENT_READER, ATN_METADATA_READER } from 'dsh-atn'
import type { RemoteAccessBinding } from '@deepseek-ai/dsh-api-remote-access'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'business-operator': { readonly kind: 'business-operator'; readonly id: string }
  }
}

// 在启动时由可信业务授权；session-alpha 必须属于该主体可观察的整网。
const grants = new Map<string, readonly RemoteAccessBinding[]>([
  ['content-user', [{ role: ATN_CONTENT_READER,
    resource: { kind: 'atn-observation', id: 'session-alpha' } }]],
  ['health-user', [{ role: ATN_METADATA_READER,
    resource: { kind: 'atn-observation', id: 'session-alpha' } }]],
])
const dispose = ctx.remoteAccess.registerPolicy('business-operator', {
  bindings: principal => grants.get(principal.id) ?? [],
})

// 撤销：决策每次读取 bindings；invalidate 同步通知已打开的授权快照。
grants.delete('content-user')
ctx.remoteAccess.invalidate({ kind: 'business-operator', id: 'content-user' })
```

调用端通过现有认证连接调用 `atnObserver/snapshot` 或 `atnObserver/metadata`，参数严格为 `{ sessionId }`；取消信号由载体注入。不得添加 principal、networkId、role、allNetworks 等参数。新 metadata endpoint 可供宿主客户端使用；现有面板继续请求 snapshot，元数据授权不使其自动降级显示。

资源声明不注册默认 `sessionId` 字段：全局默认字段会对其他服务同名参数产生附带约束，本实现只在两个 ATN Remote 方法上声明 reader。启动检查资源 API 和方法 reader 能力，缺失则观察服务不注册端点；不按版本号放宽。语义兼容性另由真实网关测试确认。

## 完整导出：书面决策

选择路线图允许的**宿主信任假设**，保留 `ctx.atn.exportSubstrate(networkId)`：无 caller 参数、无主体校验、可读取任意网络完整四字段、作者、权重、引用/被引与交付证据链。`network`、`findBySessionId`、进程内直接 `atnObserver.snapshot/metadata` 等也属于可信宿主读取，不是安全代理。

不得把上述宿主 API 直接包装为未授权 HTTP/RPC/工具。需要外部完整导出时，应先设计相应 action/resource 和严格投影，再由同一 remoteAccess 模型授权；本轮没有新增远程导出入口。只给 exportSubstrate 加一个自报 operator 参数不能构成隔离，因为持有 ctx.atn 的插件已有其他原始读取入口。

## 复核与证据

`node --import tsx/esm --test tests/integration/observer.test.ts` 覆盖原有 6 项观察契约及 READ-AUTH 的 global 负例、双主体会话隔离、撤销、额外参数伪造、纯元数据、缺省/抛错策略、冷记录、启动能力缺失。红灯和全量验证见 [实施报告](READ_BOUNDARY_IMPLEMENTATION_REPORT.md)。

ATN 层：live 节点身份、网络分区、严格结果投影；Gateway 层：非 owner 资源/action 授权；宿主前提：Peer 身份、权限表、存储和进程内插件可信。未证明框架外存储/凭据/模型路由隔离，未实现节点 need-to-know、跨网络聚合或完整导出授权。
