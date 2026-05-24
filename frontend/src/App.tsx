import { useState, useEffect } from 'react';

// Shape returned by GET /api/health
interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
}

type ApiStatus = 'checking' | 'ok' | 'error';

function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    // Vite dev-server proxies /api → http://localhost:7071
    // SWA CLI does the same in integration mode.
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then(() => setApiStatus('ok'))
      .catch((err) => {
        console.error('Health check failed:', err);
        setApiStatus('error');
      });
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 640, margin: '3rem auto', padding: '0 1.5rem' }}>
      <h1>🍽️ Restaurant Reviews</h1>
      <p style={{ color: '#555' }}>
        Phase 1 — project foundation. Data access and review features come in later phases.
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2>API Status</h2>
        {apiStatus === 'checking' && <p>⏳ Checking API…</p>}
        {apiStatus === 'ok' && (
          <p style={{ color: 'green' }}>✅ API is reachable.</p>
        )}
        {apiStatus === 'error' && (
          <p style={{ color: 'red' }}>
            ❌ API unreachable.{' '}
            <span style={{ color: '#555' }}>
              Make sure <code>func start</code> is running in <code>api/</code>.
            </span>
          </p>
        )}
      </section>
    </div>
  );
}

export default App;
