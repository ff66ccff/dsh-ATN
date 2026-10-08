import { build } from 'esbuild'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { styles } from '../src/client/styles.ts'

const exec = promisify(execFile)
const root = process.cwd()
const scratch = join(root, '.scratch')
await mkdir(scratch, { recursive: true })
await mkdir(join(root, 'docs', 'assets'), { recursive: true })

const bundlePath = join(scratch, 'screenshot-bundle.js')
const htmlPath = join(scratch, 'screenshot.html')
const outPng = join(root, 'docs', 'assets', 'atn-web-gui.png')

console.log('1. Building React bundle with esbuild...')
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/render-screenshot.tsx'],
  outfile: bundlePath,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: false,
  target: ['chrome110'],
  alias: {
    '@deepseek-ai/dsh-client-ui-primitives': join(root, 'scripts', 'modal-screenshot-fixture.tsx'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})

console.log('2. Reading bundled script...')
const bundleCode = await readFile(bundlePath, 'utf8')

console.log('3. Inlining script into HTML...')
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>DeepSeek Harness - ATN Network Dashboard</title>
  <script>
    window.onerror = function(msg, url, line, col, error) {
      var d = document.createElement('div');
      d.id = 'js-error-flag';
      d.style.cssText = 'color:red;font-size:20px;z-index:9999;position:fixed;top:0;left:0;background:white;padding:20px;';
      d.innerText = 'JS_ERROR: ' + msg + ' at line ' + line + ' col ' + col;
      document.body.appendChild(d);
    };
  </script>
  <style>
    :root {
      --dsw-static-neutral-bluish-950: #0d1117;
      --dsw-static-neutral-bluish-875: #161b22;
      --dsw-static-neutral-bluish-850: #1c2128;
      --dsw-static-neutral-bluish-800: #22272e;
      --dsw-static-neutral-bluish-700: #2d333b;
      --dsw-static-neutral-bluish-100: #cdd9e5;
      --dsw-static-neutral-bluish-50: #f0f6fc;
      --dsw-static-deepseek-450: #1d7dfa;

      --dsw-alias-bg-base: #0d1117;
      --dsw-alias-bg-layer-1: #161b22;
      --dsw-alias-bg-layer-2: #1f242c;
      --dsw-alias-bg-layer-3: #262c36;
      --dsw-alias-border-l1: rgba(255, 255, 255, 0.08);
      --dsw-alias-border-l2: rgba(255, 255, 255, 0.14);
      --dsw-alias-label-primary: #e6edf3;
      --dsw-alias-label-secondary: #8b949e;
      --dsw-alias-label-tertiary: #6e7681;

      --dsw-alias-state-business-primary: #388bfd;
      --dsw-alias-state-success-primary: #3fb950;
      --dsw-alias-state-warn-label: #d29922;
      --dsw-alias-state-warn-tertiary: rgba(187, 128, 9, 0.15);
      --dsw-alias-state-error-primary: #f85149;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* App Shell */
    .dsh-app-shell {
      display: flex;
      width: 100vw;
      height: 100vh;
      background: var(--dsw-alias-bg-base);
      position: relative;
    }

    /* Sidebar */
    .dsh-sidebar {
      width: 250px;
      background: var(--dsw-alias-bg-layer-1);
      border-right: 1px solid var(--dsw-alias-border-l1);
      display: flex;
      flex-direction: column;
      padding: 16px;
      flex-shrink: 0;
    }
    .dsh-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;
    }
    .dsh-logo-icon {
      width: 26px;
      height: 26px;
      background: linear-gradient(135deg, #1d7dfa, #0056b3);
      color: white;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: bold;
    }
    .dsh-brand-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary);
      letter-spacing: -0.2px;
    }
    .dsh-new-btn {
      background: var(--dsw-alias-bg-layer-2);
      border: 1px solid var(--dsw-alias-border-l2);
      color: var(--dsw-alias-label-primary);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      margin-bottom: 16px;
    }
    .dsh-session-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dsh-session-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px;
      border-radius: 6px;
      font-size: 12px;
      color: var(--dsw-alias-label-secondary);
      cursor: pointer;
    }
    .dsh-session-item.active {
      background: var(--dsw-alias-bg-layer-2);
      color: var(--dsw-alias-label-primary);
    }
    .dsh-session-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--dsw-alias-state-success-primary);
      margin-top: 5px;
      flex-shrink: 0;
    }
    .dsh-session-dot.idle {
      background: var(--dsw-alias-label-tertiary);
    }
    .dsh-session-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow: hidden;
    }
    .dsh-session-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    }
    .dsh-session-meta {
      font-size: 11px;
      color: var(--dsw-alias-label-tertiary);
    }

    /* Main Chat */
    .dsh-main-chat {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      background: var(--dsw-alias-bg-base);
    }
    .dsh-chat-header {
      height: 52px;
      border-bottom: 1px solid var(--dsw-alias-border-l1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      flex-shrink: 0;
    }
    .dsh-chat-title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .dsh-chat-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }
    .dsh-preset-badge {
      font-size: 11px;
      background: rgba(56, 139, 253, 0.15);
      color: var(--dsw-alias-state-business-primary);
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 500;
    }
    .dsh-chat-body {
      padding: 28px 48px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      max-width: 900px;
    }
    .dsh-message {
      display: flex;
      gap: 14px;
    }
    .dsh-avatar {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 13px;
      flex-shrink: 0;
    }
    .dsh-avatar.user { background: #30363d; color: #e6edf3; }
    .dsh-avatar.assistant { background: #1f6feb; color: white; }
    .dsh-bubble {
      font-size: 14px;
      line-height: 1.6;
      color: var(--dsw-alias-label-primary);
    }
    .dsh-bubble code {
      background: var(--dsw-alias-bg-layer-2);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      font-family: ui-monospace, monospace;
    }

    /* Modal Overlay */
    .atn-modal-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 24px;
    }
    .atn-modal-window {
      background: var(--dsw-alias-bg-layer-1);
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
      width: 1280px;
      max-width: calc(100vw - 48px);
      max-height: calc(100vh - 48px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ATN Styles */
    ${styles}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    ${bundleCode}
  </script>
</body>
</html>`

await writeFile(htmlPath, html, 'utf8')

console.log('4. Capturing screenshot with Edge headless...')
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/')

const args = [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,920',
  '--run-all-compositor-stages-before-draw',
  `--screenshot=${outPng}`,
  fileUrl,
]

await exec(chrome, args)
console.log(`Screenshot saved successfully to ${outPng}!`)
