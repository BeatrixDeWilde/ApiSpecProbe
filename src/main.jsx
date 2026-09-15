import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const REQUEST_TIMEOUT = 20000;

// --- helpers ---------------------------------------------------------------

// Fetch the target lock config (spec URL + base URL) from our backend.
async function loadTarget() {
  const res = await fetch('/api/target');
  if (!res.ok) throw new Error('Could not read target configuration.');
  return res.json();
}

// Load the Swagger spec. Try the live locked target first (this is the "upload"
// for the demo); fall back to the bundled copy served by the backend so the
// tool still works if the browser cannot reach the live service.
async function loadSpec(specUrl) {
  try {
    const res = await fetch(specUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { spec: await res.json(), source: 'live' };
  } catch (err) {
    const res = await fetch('/api/spec');
    if (!res.ok) throw new Error('Could not load the API spec.');
    return { spec: await res.json(), source: 'bundled', liveError: err.message };
  }
}

async function generateProbes(spec) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Generation failed.');
  return data;
}

// Execute one probe live against the (locked) target API from the browser.
async function runProbe(probe) {
  const started = performance.now();
  const opts = { method: probe.method, headers: { ...probe.headers } };
  if (probe.body != null) {
    opts.body = typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body);
  }
  const res = await fetch(probe.url, { ...opts, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  const text = await res.text();
  return {
    status: res.status,
    statusText: res.statusText,
    body: text,
    elapsedMs: Math.round(performance.now() - started),
  };
}

// Decide whether the live response is what a well-behaved API *should* return.
function evaluate(probe, response) {
  const { status } = response;
  if (probe.expectedStatuses.includes(status)) {
    return { tone: 'ok', label: 'Expected', note: 'The API rejected the probe, as a secure service should.' };
  }
  if (status >= 500) {
    return { tone: 'bad', label: 'Unexpected · server error', note: 'The malicious input triggered a server-side failure (5xx).' };
  }
  if (status >= 200 && status < 300) {
    return { tone: 'bad', label: 'Unexpected · accepted', note: 'The API accepted the malicious or malformed input instead of rejecting it.' };
  }
  return {
    tone: 'warn',
    label: 'Unexpected',
    note: `Status ${status} is outside the expected range (${probe.expectedStatuses.join(', ')}).`,
  };
}

function prettyBody(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// --- panels ----------------------------------------------------------------

function SpecPanel({ target, spec, source, liveError, status, error, onLoad }) {
  const info = spec?.info;
  const operationCount = spec
    ? Object.values(spec.paths || {}).reduce(
        (n, ops) => n + Object.keys(ops).filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m)).length,
        0,
      )
    : 0;

  return (
    <section className="panel" aria-labelledby="spec-heading">
      <div className="panel-head">
        <h2 id="spec-heading">1 · API Spec</h2>
        <span className="badge badge-lock" title="Locked to a single target for this demo">🔒 demo-locked</span>
      </div>
      <div className="panel-body">
        <label className="field-label" htmlFor="spec-url">Swagger / OpenAPI spec URL</label>
        <input
          id="spec-url"
          className="spec-url"
          type="text"
          value={target ? target.specUrl : 'Loading…'}
          readOnly
          aria-readonly="true"
        />
        <p className="hint">
          Upload is locked to <strong>petstore.swagger.io</strong> for this demo. All generated
          requests will only ever target this host.
        </p>
        <button className="btn btn-primary" onClick={onLoad} disabled={!target || status === 'loading'}>
          {status === 'loading' ? 'Loading spec…' : spec ? 'Reload spec' : 'Load spec'}
        </button>

        {error && <p className="alert" role="alert">{error}</p>}

        {spec && (
          <div className="loaded-spec">
            <div className="kv"><span>Loaded from</span><strong>{source === 'live' ? 'live service' : 'bundled fallback'}</strong></div>
            {source === 'bundled' && liveError && (
              <p className="hint hint-warn">Live fetch failed ({liveError}); using the bundled copy.</p>
            )}
            <div className="kv"><span>Title</span><strong>{info?.title}</strong></div>
            <div className="kv"><span>Version</span><strong>{info?.version}</strong></div>
            <div className="kv"><span>Base URL</span><strong>{target?.baseUrl}</strong></div>
            <div className="kv"><span>Operations</span><strong>{operationCount}</strong></div>
          </div>
        )}
      </div>
    </section>
  );
}

function ProbePanel({ specLoaded, result, status, error, onGenerate, selectedId, onSelect, responses }) {
  const grouped = useMemo(() => {
    const map = new Map();
    for (const t of result?.tests || []) {
      if (!map.has(t.operationId)) map.set(t.operationId, { summary: t.summary, method: t.method, path: t.path, tests: [] });
      map.get(t.operationId).tests.push(t);
    }
    return [...map.entries()];
  }, [result]);

  return (
    <section className="panel" aria-labelledby="probe-heading">
      <div className="panel-head">
        <h2 id="probe-heading">2 · Generated requests</h2>
        {result && <span className="badge">{result.count} probes</span>}
      </div>
      <div className="panel-body">
        <button className="btn btn-primary" onClick={onGenerate} disabled={!specLoaded || status === 'loading'}>
          {status === 'loading' ? 'Generating…' : 'Generate malicious requests'}
        </button>
        <p className="hint">
          Gemini reads the spec and proposes probes that inject attack payloads (SQLi, XSS,
          traversal, malformed / oversized bodies, auth abuse) into real endpoints. Generation
          can take a few seconds. Click a probe to send it and inspect the response.
        </p>

        {error && <p className="alert" role="alert">{error}</p>}

        {!result && !error && <p className="empty">{specLoaded ? 'Ready to generate.' : 'Load a spec first.'}</p>}

        {grouped.map(([opId, group]) => (
          <div className="op-group" key={opId}>
            <div className="op-head">
              <span className={`method method-${group.method.toLowerCase()}`}>{group.method}</span>
              <code className="op-path">{group.path}</code>
            </div>
            {group.summary && <p className="op-summary">{group.summary}</p>}
            <ul className="probe-list">
              {group.tests.map((t) => {
                const resp = responses[t.id];
                return (
                  <li key={t.id}>
                    <button
                      className={`probe-item${selectedId === t.id ? ' is-selected' : ''}`}
                      onClick={() => onSelect(t)}
                      aria-pressed={selectedId === t.id}
                    >
                      <span className={`cat-dot cat-${t.category.replace(/\s+/g, '-').toLowerCase()}`} aria-hidden="true" />
                      <span className="probe-name">{t.name}</span>
                      {resp && (
                        <span className={`mini-verdict ${resp.state === 'done' ? resp.verdict.tone : resp.state}`}>
                          {resp.state === 'running' && '…'}
                          {resp.state === 'error' && 'err'}
                          {resp.state === 'done' && resp.response.status}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResponsePanel({ probe, entry, onRun }) {
  return (
    <section className="panel" aria-labelledby="resp-heading">
      <div className="panel-head">
        <h2 id="resp-heading">3 · Response</h2>
        {entry?.state === 'done' && (
          <span className={`badge verdict-${entry.verdict.tone}`}>{entry.verdict.label}</span>
        )}
      </div>
      <div className="panel-body">
        {!probe && <p className="empty">Select a request in the middle panel to send it and see the response here.</p>}

        {probe && (
          <>
            <div className="req-card">
              <div className="req-top">
                <span className={`method method-${probe.method.toLowerCase()}`}>{probe.method}</span>
                <span className={`cat-tag cat-${probe.category.replace(/\s+/g, '-').toLowerCase()}`}>{probe.category}</span>
              </div>
              <code className="req-url">{probe.url}</code>
              <dl className="req-meta">
                <div><dt>Target</dt><dd>{probe.target}</dd></div>
                <div><dt>Payload</dt><dd><code>{probe.payload}</code></dd></div>
                <div><dt>Why</dt><dd>{probe.rationale}</dd></div>
                <div><dt>Expected</dt><dd>{probe.expectedBehavior}</dd></div>
              </dl>
              {probe.headers && Object.keys(probe.headers).length > 0 && (
                <pre className="code-block" aria-label="Request headers">{Object.entries(probe.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
              )}
              {probe.body != null && (
                <pre className="code-block" aria-label="Request body">{typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body, null, 2)}</pre>
              )}
              <button className="btn btn-ghost" onClick={() => onRun(probe)} disabled={entry?.state === 'running'}>
                {entry?.state === 'running' ? 'Sending…' : 'Re-send request'}
              </button>
            </div>

            <div className="resp-card" aria-live="polite">
              {!entry && <p className="empty">Sending…</p>}
              {entry?.state === 'running' && <p className="empty">Sending request…</p>}
              {entry?.state === 'error' && (
                <div>
                  <p className="alert" role="alert">Request could not be sent: {entry.error}</p>
                  <p className="hint">This is often a CORS or network restriction rather than an API result.</p>
                </div>
              )}
              {entry?.state === 'done' && (
                <>
                  <div className={`verdict verdict-${entry.verdict.tone}`}>
                    <strong>{entry.verdict.label}</strong>
                    <span>{entry.verdict.note}</span>
                  </div>
                  <div className="resp-stats">
                    <span className="status-code">{entry.response.status} {entry.response.statusText}</span>
                    <span className="latency">{entry.response.elapsedMs} ms</span>
                  </div>
                  <pre className="code-block resp-body">{prettyBody(entry.response.body) || '(empty response body)'}</pre>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// --- app -------------------------------------------------------------------

function App() {
  const [target, setTarget] = useState(null);
  const [spec, setSpec] = useState(null);
  const [specSource, setSpecSource] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [specStatus, setSpecStatus] = useState('idle');
  const [specError, setSpecError] = useState('');

  const [probeResult, setProbeResult] = useState(null);
  const [probeStatus, setProbeStatus] = useState('idle');
  const [probeError, setProbeError] = useState('');

  const [selected, setSelected] = useState(null);
  const [responses, setResponses] = useState({}); // id -> { state, response|error, verdict }

  useEffect(() => {
    loadTarget().then(setTarget).catch(() => setSpecError('Could not reach the backend.'));
  }, []);

  async function handleLoadSpec() {
    if (!target) return;
    setSpecStatus('loading');
    setSpecError('');
    setProbeResult(null);
    setSelected(null);
    setResponses({});
    try {
      const { spec: loaded, source, liveError: le } = await loadSpec(target.specUrl);
      setSpec(loaded);
      setSpecSource(source);
      setLiveError(le || null);
    } catch (err) {
      setSpecError(err.message);
    } finally {
      setSpecStatus('idle');
    }
  }

  async function handleGenerate() {
    if (!spec) return;
    setProbeStatus('loading');
    setProbeError('');
    setSelected(null);
    setResponses({});
    try {
      setProbeResult(await generateProbes(spec));
    } catch (err) {
      setProbeError(err.message);
    } finally {
      setProbeStatus('idle');
    }
  }

  async function execute(probe) {
    setResponses((r) => ({ ...r, [probe.id]: { state: 'running' } }));
    try {
      const response = await runProbe(probe);
      const verdict = evaluate(probe, response);
      setResponses((r) => ({ ...r, [probe.id]: { state: 'done', response, verdict } }));
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'Request timed out.' : err.message;
      setResponses((r) => ({ ...r, [probe.id]: { state: 'error', error: msg } }));
    }
  }

  function handleSelect(probe) {
    setSelected(probe);
    if (!responses[probe.id]) execute(probe); // auto-send on first click
  }

  return (
    <div className="app">
      <header className="app-head">
        <h1>ApiSpecProbe</h1>
        <p>Upload a Swagger spec, generate potentially malicious requests, and inspect whether the live API responds as it should.</p>
      </header>
      <main className="grid">
        <SpecPanel
          target={target}
          spec={spec}
          source={specSource}
          liveError={liveError}
          status={specStatus}
          error={specError}
          onLoad={handleLoadSpec}
        />
        <ProbePanel
          specLoaded={!!spec}
          result={probeResult}
          status={probeStatus}
          error={probeError}
          selectedId={selected?.id}
          onSelect={handleSelect}
          onGenerate={handleGenerate}
          responses={responses}
        />
        <ResponsePanel probe={selected} entry={selected ? responses[selected.id] : null} onRun={execute} />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
