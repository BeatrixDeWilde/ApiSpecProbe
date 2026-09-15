// Verdict logic: decide whether a response is what a secure API should return.

export function evaluate(probe, response) {
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

export function prettyBody(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
