import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const REQUEST_TIMEOUT = 20000;
const GENERATE_TIMEOUT = 60000; // Gemini generation can take a while.

// --- helpers ---------------------------------------------------------------

// Fetch JSON with defensive parsing (a non-JSON body such as a plain
// "Internal Server Error" 500 becomes a readable error, not a parse crash) and
// at least one retry on server errors / network failures.
async function requestJSON(url, { method = 'GET', body, timeout = REQUEST_TIMEOUT, retries = 0 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method,
        headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { detail: text.slice(0, 300) || `${res.status} ${res.statusText}` };
      }
      if (!res.ok) {
        const err = new Error(data.detail || `Request failed (${res.status}).`);
        err.status = res.status;
        if (res.status >= 500 && attempt < retries) {
          lastError = err;
          continue; // transient server error → retry
        }
        throw err;
      }
      return data;
    } catch (err) {
      lastError = err.name === 'TimeoutError' ? new Error('Request timed out.') : err;
      if (attempt < retries) continue; // network/timeout → retry
      throw lastError;
    }
  }
  throw lastError;
}

// Fetch the target lock config (spec URL + base URL) from our backend.
function loadTarget() {
  return requestJSON('/api/target');
}

// Load the Swagger spec. Try the live locked target first (this is the "upload"
// for the demo); fall back to the bundled copy served by the backend so the
// tool still works if the browser cannot reach the live service.
async function loadSpec(specUrl) {
  try {
    return { spec: await requestJSON(specUrl), source: 'live' };
  } catch (err) {
    return { spec: await requestJSON('/api/spec'), source: 'bundled', liveError: err.message };
  }
}

function generateProbes(spec) {
  return requestJSON('/api/generate', {
    method: 'POST',
    body: { spec },
    timeout: GENERATE_TIMEOUT,
    retries: 1,
  });
}

// Cached, pre-generated probes for the demo when live generation is unavailable.
function loadCachedProbes() {
  return requestJSON('/api/cached', { retries: 1 });
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

function ProbePanel({ specLoaded, result, status, error, onGenerate, onLoadCached, selectedId, onSelect, responses }) {
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
        <div className="btn-row">
          <button className="btn btn-primary" onClick={onGenerate} disabled={!specLoaded || status !== 'idle'}>
            {status === 'generating' ? 'Generating…' : 'Generate malicious requests'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={onLoadCached} disabled={status !== 'idle'}
                  title="Use pre-generated probes if live generation fails">
            {status === 'cached' ? 'Loading…' : 'Load cached probes'}
          </button>
        </div>
        <p className="hint">
          Proposed probes generated from the API spec that inject attack payloads (SQLi, XSS,
          traversal, malformed / oversized bodies, auth abuse) into real endpoints. Generation
          can take a few seconds — or load a cached set. Click a probe to inspect it, then send it
          from the response panel.
        </p>

        {error && <p className="alert" role="alert">{error}</p>}

        {!result && !error && <p className="empty">{specLoaded ? 'Ready to generate.' : 'Load a spec first.'}</p>}

        {result?.cached && <p className="hint hint-warn">Showing cached probes (not generated live).</p>}

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

function PerformanceSummary({ summary }) {
  const { total, evaluated, secure, flagged, errors } = summary;
  const rate = evaluated ? Math.round((secure / evaluated) * 100) : 0;
  return (
    <div className="summary-card">
      <div className="summary-head">
        <span className="summary-title">API performance</span>
        <span className="summary-progress">{evaluated} / {total} evaluated</span>
      </div>
      {evaluated === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          Send probes to see how the API holds up. Each is scored “expected” (rejected, secure) or
          “unexpected” (accepted or crashed).
        </p>
      ) : (
        <>
          <div className="meter" role="img" aria-label={`${rate}% of evaluated probes handled securely`}>
            <div className="meter-fill" style={{ width: `${rate}%` }} />
          </div>
          <div className="summary-stats">
            <span className="stat stat-ok"><strong>{secure}</strong> secure</span>
            <span className="stat stat-bad"><strong>{flagged}</strong> flagged</span>
            {errors > 0 && <span className="stat stat-muted"><strong>{errors}</strong> errored</span>}
            <span className="stat stat-rate">{rate}% secure</span>
          </div>
        </>
      )}
    </div>
  );
}

function ResponsePanel({ probe, entry, summary, hasProbes, bulk, onRun, onLoadCached, onSendAll, onLoadAllCached }) {
  const running = entry?.state === 'running';
  return (
    <section className="panel" aria-labelledby="resp-heading">
      <div className="panel-head">
        <h2 id="resp-heading">3 · Response</h2>
        {entry?.state === 'done' && (
          <span className={`badge verdict-${entry.verdict.tone}`}>{entry.verdict.label}</span>
        )}
      </div>
      <div className="panel-body">
        <div className="btn-row">
          <button className="btn btn-primary" onClick={onSendAll} disabled={!hasProbes || bulk.running}>
            {bulk.running ? `Sending all… (${bulk.done}/${bulk.total})` : 'Send all requests & evaluate'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={onLoadAllCached} disabled={!hasProbes || bulk.running}
                  title="Evaluate every probe against its cached sample response">
            Load all cached responses
          </button>
        </div>

        <PerformanceSummary summary={summary} />

        {!probe && <p className="empty">Select a request in the middle panel, then send it to see the response and verdict here.</p>}

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
              <div className="btn-row">
                <button className="btn btn-primary" onClick={() => onRun(probe)} disabled={running}>
                  {running ? 'Sending…' : entry ? 'Re-send & evaluate' : 'Send request and evaluate response'}
                </button>
                <button className="btn btn-ghost btn-block" onClick={() => onLoadCached(probe)}
                        disabled={running || !probe.cachedResponse}
                        title="Evaluate a cached sample response if the live request fails">
                  Load cached response
                </button>
              </div>
            </div>

            <div className="resp-card" aria-live="polite">
              {!entry && <p className="empty">Not sent yet — press “Send request and evaluate response”.</p>}
              {running && <p className="empty">Sending request…</p>}
              {entry?.state === 'error' && (
                <div>
                  <p className="alert" role="alert">Request could not be sent: {entry.error}</p>
                  <p className="hint">This is often a CORS or network restriction rather than an API result. Try “Load cached response” to evaluate a sample instead.</p>
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
                    {entry.cached
                      ? <span className="cached-tag">cached sample</span>
                      : <span className="latency">{entry.response.elapsedMs} ms</span>}
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
  const [bulk, setBulk] = useState({ running: false, done: 0, total: 0 });

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

  async function runProbeSource(loader, statusLabel) {
    if (probeStatus !== 'idle') return;
    setProbeStatus(statusLabel);
    setProbeError('');
    setSelected(null);
    setResponses({});
    try {
      setProbeResult(await loader());
    } catch (err) {
      setProbeError(err.message);
    } finally {
      setProbeStatus('idle');
    }
  }

  const handleGenerate = () => spec && runProbeSource(() => generateProbes(spec), 'generating');
  const handleLoadCachedProbes = () => runProbeSource(loadCachedProbes, 'cached');

  // Step 3: send the selected probe live and evaluate the response.
  async function execute(probe) {
    setResponses((r) => ({ ...r, [probe.id]: { state: 'running' } }));
    try {
      const response = await runProbe(probe);
      const verdict = evaluate(probe, response);
      setResponses((r) => ({ ...r, [probe.id]: { state: 'done', response, verdict, cached: false } }));
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'Request timed out.' : err.message;
      setResponses((r) => ({ ...r, [probe.id]: { state: 'error', error: msg } }));
    }
  }

  function cachedEntry(probe) {
    const c = probe.cachedResponse;
    if (!c) return null;
    const response = {
      status: c.status,
      statusText: c.statusText || '',
      body: typeof c.body === 'string' ? c.body : JSON.stringify(c.body),
      elapsedMs: 0,
    };
    return { state: 'done', response, verdict: evaluate(probe, response), cached: true };
  }

  // Step 3 fallback: evaluate the cached sample response without a live call.
  function loadCachedResponse(probe) {
    const entry = cachedEntry(probe);
    if (entry) setResponses((r) => ({ ...r, [probe.id]: entry }));
  }

  // Bulk: send every probe live, with limited concurrency, updating as they land.
  async function sendAll() {
    const tests = probeResult?.tests || [];
    if (!tests.length || bulk.running) return;
    setBulk({ running: true, done: 0, total: tests.length });
    const queue = [...tests];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        await execute(queue.shift());
        done += 1;
        setBulk((b) => ({ ...b, done }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    setBulk({ running: false, done: 0, total: 0 });
  }

  // Bulk: evaluate every probe's cached response without any live calls.
  function loadAllCached() {
    const tests = probeResult?.tests || [];
    setResponses((r) => {
      const next = { ...r };
      for (const probe of tests) {
        const entry = cachedEntry(probe);
        if (entry) next[probe.id] = entry;
      }
      return next;
    });
  }

  const summary = useMemo(() => {
    const tests = probeResult?.tests || [];
    let evaluated = 0, secure = 0, flagged = 0, errors = 0;
    for (const t of tests) {
      const e = responses[t.id];
      if (!e) continue;
      if (e.state === 'error') { errors += 1; continue; }
      if (e.state === 'done') {
        evaluated += 1;
        if (e.verdict.tone === 'ok') secure += 1; else flagged += 1;
      }
    }
    return { total: tests.length, evaluated, secure, flagged, errors };
  }, [probeResult, responses]);

  function handleSelect(probe) {
    setSelected(probe); // selecting no longer auto-sends; step 3 has an explicit button
  }

  return (
    <div className="app">
      <header className="app-head">
        <h1>API Spec Probe</h1>
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
          onLoadCached={handleLoadCachedProbes}
          responses={responses}
        />
        <ResponsePanel
          probe={selected}
          entry={selected ? responses[selected.id] : null}
          summary={summary}
          hasProbes={!!probeResult?.tests?.length}
          bulk={bulk}
          onRun={execute}
          onLoadCached={loadCachedResponse}
          onSendAll={sendAll}
          onLoadAllCached={loadAllCached}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
