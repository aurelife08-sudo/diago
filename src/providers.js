// Transforme les webhooks des plateformes vocales en un format unique :
// { provider, providerCallId, toNumber, fromNumber, callerName, startedAt,
//   durationSec, transcript, providerSummary, recordingUrl }

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '') ?? null;

/** Vapi — événement "end-of-call-report" envoyé sur le Server URL. */
export function fromVapi(body) {
  const m = body?.message ?? body;
  if (!m || (m.type && m.type !== 'end-of-call-report')) return null;
  const call = m.call ?? {};
  const started = pick(m.startedAt, call.startedAt);
  const ended = pick(m.endedAt, call.endedAt);
  let duration = pick(m.durationSeconds);
  if (duration == null && started && ended) duration = (new Date(ended) - new Date(started)) / 1000;
  return {
    provider: 'vapi',
    providerCallId: pick(call.id, m.id),
    toNumber: pick(call.phoneNumber?.number, m.phoneNumber?.number),
    fromNumber: pick(call.customer?.number, m.customer?.number),
    callerName: pick(call.customer?.name, m.customer?.name),
    startedAt: started,
    durationSec: duration != null ? Math.round(duration) : null,
    transcript: pick(m.artifact?.transcript, m.transcript) ?? '',
    providerSummary: pick(m.analysis?.summary, m.summary),
    recordingUrl: pick(m.artifact?.recordingUrl, m.recordingUrl, m.artifact?.recording?.mono?.combinedUrl),
  };
}

/** Retell — événement "call_analyzed" (ou "call_ended"). */
export function fromRetell(body) {
  const ev = body?.event;
  if (ev && ev !== 'call_analyzed' && ev !== 'call_ended') return null;
  const c = body?.call ?? body ?? {};
  const started = c.start_timestamp ? new Date(c.start_timestamp).toISOString() : null;
  const duration = c.start_timestamp && c.end_timestamp ? (c.end_timestamp - c.start_timestamp) / 1000 : null;
  return {
    provider: 'retell',
    // call_ended puis call_analyzed : on garde le même id, le doublon sera mis à jour
    providerCallId: c.call_id ?? null,
    toNumber: c.to_number ?? null,
    fromNumber: c.from_number ?? null,
    callerName: null,
    startedAt: started,
    durationSec: duration != null ? Math.round(duration) : null,
    transcript: (c.transcript ?? '').replace(/^Agent:/gm, 'AI:').replace(/^User:/gm, 'User:'),
    providerSummary: c.call_analysis?.call_summary ?? null,
    recordingUrl: c.recording_url ?? null,
  };
}

/** Format générique, pour un agent fait maison (voir README). */
export function fromGeneric(b) {
  if (!b || typeof b !== 'object') return null;
  let transcript = b.transcript ?? '';
  if (Array.isArray(transcript)) {
    transcript = transcript.map((t) => `${/user|client|caller/i.test(t.role) ? 'User' : 'AI'}: ${t.text ?? t.content ?? ''}`).join('\n');
  }
  return {
    provider: b.provider || 'generic',
    providerCallId: pick(b.call_id, b.id),
    toNumber: pick(b.to_number, b.to),
    fromNumber: pick(b.from_number, b.from),
    callerName: pick(b.caller_name),
    startedAt: pick(b.started_at),
    durationSec: b.duration_sec != null ? Math.round(Number(b.duration_sec)) : null,
    transcript: String(transcript),
    providerSummary: pick(b.summary),
    recordingUrl: pick(b.recording_url),
  };
}

/** Numéro au format +33XXXXXXXXX pour comparer. */
export function normNumber(n) {
  if (!n) return null;
  let s = String(n).replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0\d{9}$/.test(s)) s = '+33' + s.slice(1);
  if (/^33\d{9}$/.test(s)) s = '+' + s;
  return s || null;
}
