/** Real browser fixture for the existing panel partition carrier. Host authorization stays in the Gateway. */
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ObserverHost } from '../../src/client/NetworkAction.tsx'
import { fleetSnapshotSchema } from '../../src/observer-schema.ts'
import { zh } from '../../src/client/locales.ts'
import { styles } from '../../src/client/styles.ts'
function Preview() {
 const [operator, setOperator] = useState('all')
 const readFleet = useMemo(() => async (signal: AbortSignal) => {
  const response = await fetch(`/fleet?operator=${operator}`, { signal })
  if (!response.ok) throw new Error('Fleet access denied')
  return fleetSnapshotSchema.parse(await response.json())
 }, [operator])
 return <><style>{styles}</style><header className="fixture-head"><h1>ATN 舰队观察验证</h1><p>脚本宿主 · 真实 Gateway 授权 · 不调用外部模型</p>
  <label>测试主体 <select aria-label="测试主体" value={operator} onChange={event => setOperator(event.target.value)}>
   <option value="all">运营者：两个网络</option><option value="a">主体 A：仅网络 A</option><option value="b">主体 B：仅网络 B</option><option value="none">未授权主体</option>
  </select></label></header>
  <main><ObserverHost key={operator} sessionId="fixture-session" visible readFleet={readFleet}
   readSnapshot={async () => ({ observedAt: 0, network: null })} t={key => zh[key]} /></main></>
}
createRoot(document.getElementById('root')!).render(<Preview />)
