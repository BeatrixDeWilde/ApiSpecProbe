// Network layer: every backend/API call the app makes lives here.

export const REQUEST_TIMEOUT = 20000;
export const GENERATE_TIMEOUT = 60000; // Gemini generation can take a while.

// Fetch JSON with defensive parsing (a non-JSON body such as a plain
// "Internal Server Error" 500 becomes a readable error, not a parse crash) and
// at least one retry on server errors / network failures.
export async function requestJSON(url, { method = 'GET', body, timeout = REQUEST_TIMEOUT, retries = 0 } = {}) {
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

// Fetch the target config (spec URL + base URL) from our backend.
export function loadTarget() {
  return requestJSON('/api/target');
}

// Load the Swagger spec. Try the live target first (this is the "upload" for the
// demo); fall back to the bundled copy served by the backend so the tool still
// works if the browser cannot reach the live service.
export async function loadSpec(specUrl) {
  try {
    return { spec: await requestJSON(specUrl), source: 'live' };
  } catch (err) {
    return { spec: await requestJSON('/api/spec'), source: 'bundled', liveError: err.message };
  }
}

export function generateProbes(spec) {
  return requestJSON('/api/generate', {
    method: 'POST',
    body: { spec },
    timeout: GENERATE_TIMEOUT,
    retries: 1,
  });
}

// Cached, pre-generated probes for the demo when live generation is unavailable.
export function loadCachedProbes() {
  return requestJSON('/api/cached', { retries: 1 });
}

// Send one probe. The request is executed server-side by the backend (avoids
// browser CORS limits); this returns { status, statusText, body, elapsedMs }.
export function sendProbe(probe) {
  const body = probe.body == null
    ? null
    : (typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body));
  return requestJSON('/api/execute', {
    method: 'POST',
    body: { method: probe.method, url: probe.url, headers: probe.headers || {}, body },
  });
}
