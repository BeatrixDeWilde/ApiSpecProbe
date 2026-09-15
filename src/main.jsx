import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function sendRequest() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/message', { signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Request failed.');
      setResult(data);
    } catch (err) {
      setError(err.name === 'TimeoutError' ? 'Request timed out.' : err.message);
    } finally {
      setLoading(false);
    }
  }

  return <main>
    <h1>ApiSpecProbe</h1>
    <p>React → FastAPI → Cloudflare secret</p>
    <button onClick={sendRequest} disabled={loading}>{loading ? 'Loading…' : 'Send request'}</button>
    <div aria-live="polite" aria-busy={loading}>
      {error && <p role="alert">{error}</p>}
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
