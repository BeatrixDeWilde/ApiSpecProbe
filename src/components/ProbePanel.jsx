import React, { useMemo } from 'react';

const catClass = (category) => `cat-${category.replace(/\s+/g, '-').toLowerCase()}`;

export default function ProbePanel({
  specLoaded, result, status, error, onGenerate, onLoadCached, selectedId, onSelect, responses,
}) {
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
            {status === 'generating' ? 'Generating…' : 'Generate requests'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={onLoadCached} disabled={status !== 'idle'}
                  title="Use pre-generated probes if live generation fails">
            {status === 'cached' ? 'Loading…' : 'Load cached probes'}
          </button>
        </div>
        <p className="hint">
          Proposed probes generated from the API spec that inject attack payloads (SQLi, XSS,
          traversal, malformed / oversized bodies, auth abuse) into real endpoints. If there is an issue with the API then you can load cached responses. Click a probe to inspect it, then send it
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
                      <span className={`cat-dot ${catClass(t.category)}`} aria-hidden="true" />
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
