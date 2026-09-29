import React from 'react';
import { createRoot } from 'react-dom/client';
import Landing from './landing';
import './globals.css';
const App = React.lazy(() => import('./page'));
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname === '/' &&
    !new URLSearchParams(location.hash.slice(1)).has('activate') ? (
      <Landing />
    ) : (
      <React.Suspense
        fallback={<div className="auth-screen">Opening OpenFrame...</div>}
      >
        <App />
      </React.Suspense>
    )}
  </React.StrictMode>,
);
