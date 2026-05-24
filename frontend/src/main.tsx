import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';
import { initTelemetry } from './services/telemetry';

// Initialise Application Insights before rendering so the first page view is
// captured.  Safe to call when VITE_APPLICATIONINSIGHTS_CONNECTION_STRING is
// blank or absent – becomes a no-op in that case (local dev default).
initTelemetry();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
