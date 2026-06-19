import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useInstallStore } from './stores/install';
import './tokens.css';

// The API is Worker-routed first-party only on the branded domain. If opened from
// the default *.pages.dev host (e.g. a stale bookmark), /api/* would hit the Pages
// origin (no Worker route) and the first-party cookie wouldn't be sent — so bounce
// to the branded domain, preserving the path/query/hash, before rendering.
const onPagesDev = location.hostname.endsWith('.pages.dev');
if (onPagesDev) {
  location.replace(`https://staff-attendance.ohcsghana.org${location.pathname}${location.search}${location.hash}`);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  const store = useInstallStore.getState();
  store.setDeferredPrompt(e as Parameters<typeof store.setDeferredPrompt>[0]);
});

window.addEventListener('appinstalled', () => {
  useInstallStore.getState().setInstalled(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      setInterval(() => reg.update(), 60_000);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && navigator.serviceWorker.controller) window.location.reload();
        });
      });
      window.addEventListener('online', () => {
        navigator.serviceWorker.controller?.postMessage({ type: 'flush-queue' });
      });
    } catch {}
  });
}
