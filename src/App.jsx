import React, { useEffect, useMemo, useState } from 'react';
import SpecPanel from './components/SpecPanel.jsx';
import ProbePanel from './components/ProbePanel.jsx';
import ResponsePanel from './components/ResponsePanel.jsx';
import { evaluate } from './evaluate.js';
import { loadTarget, loadSpec, generateProbes, loadCachedProbes, sendProbe } from './api.js';

export default function App() {
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

  // Step 3: the backend sends the selected probe live; we evaluate the response.
  async function execute(probe) {
    setResponses((r) => ({ ...r, [probe.id]: { state: 'running' } }));
    try {
      const response = await sendProbe(probe);
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
