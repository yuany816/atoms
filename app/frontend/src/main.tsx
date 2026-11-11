import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AppErrorBoundary } from './components/prototype/app-error-boundary.tsx';
import { loadRuntimeConfig } from './lib/config.ts';

const RELOAD_FLAG = 'atoms-boot-auto-reload';

/** 首屏兜底文案：模块加载失败时替换骨架，避免长时间空白。 */
function renderBootFailure(message: string): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fbfbfa;color:#37352f;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;padding:24px;">
      <div style="max-width:420px;text-align:center;">
        <h1 style="font-size:16px;font-weight:600;margin:0 0 8px;">页面资源加载失败</h1>
        <p style="font-size:13px;line-height:1.7;color:#787774;margin:0 0 20px;">${message}</p>
        <button id="atoms-boot-retry" style="background:#37352f;color:#fff;border:none;border-radius:6px;padding:9px 20px;font-size:13px;cursor:pointer;">重新加载</button>
      </div>
    </div>`;
  document.getElementById('atoms-boot-retry')?.addEventListener('click', () => {
    window.sessionStorage.removeItem(RELOAD_FLAG);
    window.location.reload();
  });
}

/**
 * 动态资源加载失败自愈：Vite 在预先加载的模块请求失败时派发 vite:preloadError。
 * 预览环境（dev server 按需编译）偶发中断时，自动重载一次即可恢复；
 * 用 sessionStorage 标记避免异常情况下反复刷新。
 */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (window.sessionStorage.getItem(RELOAD_FLAG)) return;
  window.sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
});

async function initializeApp() {
  // Prerendered blog pages are served as pure static HTML for SEO.
  // Intentionally skip React mounting so the crawler-facing markup stays
  // lightweight and self-contained — no client-side hydration needed.
  if (
    document
      .querySelector('meta[name="prerender-static-page"]')
      ?.getAttribute('content') === 'blog'
  ) {
    return;
  }

  const container = document.getElementById('root');
  if (!container) {
    renderBootFailure('页面根节点缺失，请重新加载页面后重试。');
    return;
  }

  try {
    await loadRuntimeConfig();
    console.log('Runtime configuration loaded successfully');
  } catch (error) {
    console.warn(
      'Failed to load runtime configuration, using defaults:',
      error
    );
  }

  try {
    createRoot(container).render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    );
  } catch (error) {
    console.error('[app] 首屏渲染失败', error);
    renderBootFailure('应用初始化未能完成，请重新加载页面后重试。');
  }
}

void initializeApp();