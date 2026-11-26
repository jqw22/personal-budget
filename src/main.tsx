import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { IS_TEST_COPY, STORAGE_PREFIX } from './lib/env';
import { watchNegatives } from './lib/negatives';

if (IS_TEST_COPY) document.title = 'Personal Budget (test copy)';

// After a new version is published, a page opened earlier asks for files that no longer exist.
// Reload to pick up the new version, at most once a minute so a real outage can't loop.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(`${STORAGE_PREFIX}reloaded`) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(`${STORAGE_PREFIX}reloaded`, String(Date.now()));
  } catch {
    // Without session storage, still reload once; the next failure shows its error.
  }
  event.preventDefault();
  window.location.reload();
});

const root = document.getElementById('root')!;
watchNegatives(root);
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
