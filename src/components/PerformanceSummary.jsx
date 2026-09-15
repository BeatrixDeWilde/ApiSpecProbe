import React from 'react';

// Aggregate "how the API performed" scoreboard shown at the top of step 3.
export default function PerformanceSummary({ summary }) {
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
