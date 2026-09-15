import React from 'react';

const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

export default function SpecPanel({ target, spec, source, liveError, status, error, onLoad }) {
  const info = spec?.info;
  const operationCount = spec
    ? Object.values(spec.paths || {}).reduce(
        (n, ops) => n + Object.keys(ops).filter((m) => METHODS.includes(m)).length,
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
