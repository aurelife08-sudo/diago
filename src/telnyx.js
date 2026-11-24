// Telnyx AI Assistant → format commun de Diago.
//
// Diago accepte sur /webhooks/telnyx tous les événements de fin d'appel que Telnyx peut envoyer :
//   - call.conversation.ended         (contient déjà from, to, durée et la conversation)
//   - call.analyzed                   (enregistrement + insights, numéros parfois masqués)
//   - call.conversation_insights.generated / webhook d'Insight Group (résumé seulement)
// Quand la conversation n'est pas dans le webhook, Diago va la chercher dans l'API Telnyx
// (TELNYX_API_KEY). Plusieurs événements du même appel = un seul appel dans Diago (même conversation_id).

const API = process.env.TELNYX_API_URL || 'https://api.telnyx.com/v2';
const KEY = () => process.env.TELNYX_API_KEY || '';

// Événements de suivi d'appel qui ne marquent pas la fin de la conversation : ignorés.
const IGNORED = new Set([
  'call.initiated', 'call.answered', 'call.hangup', 'call.bridged', 'call.conversation.created',
  'call.conversation.start_failed', 'call.recording.saved', 'call.machine.detection.ended',
  'call.speak.started', 'call.speak.ended', 'call.playback.started', 'call.playback.ended',
  'call.ai_gather.partial_results', 'call.ai_gather.message_history_updated', 'call.cost',
]);

const pick = (...v) => v.find((x) => x !== undefined && x !== null && x !== '') ?? null;

/** Numéro utilisable (les numéros masqués « +331****5678 » sont ignorés). */
function cleanNumber(n) {
  if (!n || typeof n !== 'string') return null;
  if (n.includes('*')) return null;
  return n;
}

function messagesToTranscript(messages) {
  if (!Array.isArray(messages)) return '';
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, text: pick(m.content, m.text), at: pick(m.timestamp, m.sent_at, m.created_at) }))
    .filter((m) => typeof m.text === 'string' && m.text.trim())
    .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text.trim()}`)
    .join('\n');
}

function firstLastTime(messages) {
  const times = (Array.isArray(messages) ? messages : [])
    .map((m) => Date.parse(pick(m?.timestamp, m?.sent_at, m?.created_at) || ''))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  return times.length ? { first: times[0], last: times[times.length - 1] } : null;
}

function insightText(p) {
  const out = [];
  const walk = (arr) => {
    for (const r of Array.isArray(arr) ? arr : []) {
      if (Array.isArray(r?.conversation_insights)) walk(r.conversation_insights);
      else if (r?.result != null) out.push(typeof r.result === 'string' ? r.result : JSON.stringify(r.result));
    }
  };
  walk(p.conversation_insights); walk(p.results); walk(p.insights);
  return out.join('\n') || null;
}

/** Lit le webhook Telnyx, sans appel réseau. */
export function readTelnyx(body) {
  if (!body || typeof body !== 'object') return null;
  const d = body.data && typeof body.data === 'object' ? body.data : body;
  const p = d.payload && typeof d.payload === 'object' ? d.payload : d;
  const eventType = pick(d.event_type, body.event_type, p.event_type);
  const messages = Array.isArray(p.messages) ? p.messages : Array.isArray(p.message_history) ? p.message_history : null;
  const rec = Array.isArray(p.recordings) ? p.recordings[0] : null;
  return {
    eventType,
    conversationId: pick(p.conversation_id, d.conversation_id, body.conversation_id),
    callControlId: pick(p.call_control_id, d.call_control_id),
    from: cleanNumber(pick(p.from, p.telnyx_end_user_target, p.metadata?.telnyx_end_user_target)),
    to: cleanNumber(pick(p.to, p.telnyx_agent_target, p.metadata?.telnyx_agent_target)),
    messages,
    durationSec: p.duration_sec != null ? Math.round(Number(p.duration_sec)) : null,
    occurredAt: pick(d.occurred_at, body.occurred_at),
    recordingUrl: pick(rec?.download_urls?.mp3, rec?.download_urls?.wav, rec?.url),
    summary: insightText(p),
  };
}

async function telnyxGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${KEY()}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Telnyx ${path} → HTTP ${res.status}`);
  return res.json();
}

/** Complète l'appel avec l'API Telnyx (conversation, numéros, messages). */
async function enrich(info) {
  let id = info.conversationId;
  let meta = null;
  if (!id && info.callControlId) {
    const r = await telnyxGet(`/ai/conversations?metadata->call_control_id=eq.${encodeURIComponent(info.callControlId)}&limit=1`);
    const c = r?.data?.[0];
    if (c) { id = c.id; meta = c; }
  }
  if (!id) return info;
  if (!meta) meta = (await telnyxGet(`/ai/conversations/${encodeURIComponent(id)}`))?.data ?? null;

  let messages = info.messages;
  if (!messages?.length) {
    messages = [];
    for (let page = 1; page <= 10; page++) {
      const r = await telnyxGet(`/ai/conversations/${encodeURIComponent(id)}/messages?page[size]=100&page[number]=${page}`);
      messages.push(...(r?.data ?? []));
      if (!r?.meta || page >= (r.meta.total_pages ?? 1)) break;
    }
    messages.sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0));
  }
  return {
    ...info,
    conversationId: id,
    messages,
    from: info.from || cleanNumber(meta?.metadata?.telnyx_end_user_target),
    to: info.to || cleanNumber(meta?.metadata?.telnyx_agent_target),
    occurredAt: info.occurredAt || meta?.created_at || null,
  };
}

/** Webhook Telnyx → événement Diago (ou null si l'événement est à ignorer). */
export async function fromTelnyx(body) {
  let info = readTelnyx(body);
  if (!info || (info.eventType && IGNORED.has(info.eventType))) return null;
  if (!info.conversationId && !info.callControlId && !info.messages) return null;

  if ((!info.messages?.length || !info.to) && KEY()) {
    try {
      info = await enrich(info);
    } catch (err) {
      console.warn('[telnyx] conversation introuvable dans l\'API :', err.message);
    }
  }

  const span = firstLastTime(info.messages);
  const duration = info.durationSec ?? (span ? Math.round((span.last - span.first) / 1000) : null);
  const started = span ? new Date(span.first).toISOString()
    : info.occurredAt && duration != null ? new Date(Date.parse(info.occurredAt) - duration * 1000).toISOString()
    : info.occurredAt;

  return {
    provider: 'telnyx',
    providerCallId: info.conversationId || info.callControlId,
    toNumber: info.to,
    fromNumber: info.from,
    callerName: null,
    startedAt: started || null,
    durationSec: duration,
    transcript: messagesToTranscript(info.messages),
    providerSummary: info.summary,
    recordingUrl: info.recordingUrl,
  };
}
