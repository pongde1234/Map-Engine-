import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import '@faclon-labs/fds/styles.css';
import '@faclon-labs/fds/fonts';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@me/map/map.css';
import '@me/ui/styles.css';
import './app.css';
import { App } from './App.tsx';

setWorkerUrl(maplibreWorkerUrl);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
