import React from 'react';
import PerformanceSummary from './PerformanceSummary.jsx';
import { prettyBody } from '../evaluate.js';

const catClass = (category) => `cat-${category.replace(/\s+/g, '-').toLowerCase()}`;

export default function ResponsePanel({
  probe, entry, summary, hasProbes, bulk, onRun, onLoadCached, onSendAll, onLoadAllCached,
}) {
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
                <span className={`cat-tag ${catClass(probe.category)}`}>{probe.category}</span>
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
                  <p className="hint">The backend could not reach the target. Try “Load cached response” to evaluate a sample instead.</p>
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
