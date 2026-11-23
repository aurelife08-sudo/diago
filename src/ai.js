// Agent n°2 : lit la transcription et range l'appel (résumé, urgence, action, RDV).
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';

const TYPES = ['devis', 'rendez_vous', 'urgence', 'information', 'suivi', 'autre'];
const URG = ['haute', 'moyenne', 'basse'];

const SYSTEM = `Tu ranges les appels reçus par l'agent téléphonique d'un professionnel (souvent un cabinet de diagnostic immobilier, parfois un artisan).
Lis la transcription et réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{
 "caller_name": "nom de l'appelant tel qu'il l'a dit, sinon null",
 "summary": "résumé en 1 ou 2 phrases, en français, ce que veut la personne",
 "next_action": "ce que le professionnel doit faire, en une phrase à l'impératif",
 "request_type": "devis | rendez_vous | urgence | information | suivi | autre",
 "urgency": "haute | moyenne | basse",
 "callback_before": "créneau de rappel souhaité en quelques mots (ex: avant 18h, demain matin) sinon null",
 "address": "adresse ou ville du bien si elle est donnée, sinon null",
 "diagnostics": ["liste des diagnostics demandés parmi DPE, Amiante, Plomb, Électricité, Gaz, Termites, Carrez, Boutin, ERP, Audit énergétique ; vide si aucun"],
 "is_spam": false
}
Urgence haute : vente/signature/location imminente (sous une semaine), problème bloquant, client très pressé. Basse : simple question sans délai.
is_spam vaut true pour démarchage commercial, robot ou erreur de numéro.`;

export async function classify(evt) {
  const text = (evt.transcript || '').trim();
  if (KEY && text) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 600,
          system: SYSTEM,
          messages: [{ role: 'user', content: `Numéro appelant : ${evt.fromNumber || 'inconnu'}\nRésumé fourni par la plateforme : ${evt.providerSummary || 'aucun'}\n\nTranscription :\n${text.slice(0, 12000)}` }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      const data = await res.json();
      const raw = data.content?.map((c) => c.text || '').join('') || '';
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      return clean(json, evt);
    } catch (err) {
      console.warn('[ai] tri IA impossible, règles simples utilisées :', err.message);
    }
  }
  return rules(evt);
}

function clean(j, evt) {
  const diag = Array.isArray(j.diagnostics) ? j.diagnostics.filter(Boolean).map(String).slice(0, 10) : [];
  return {
    caller_name: j.caller_name || evt.callerName || null,
    summary: String(j.summary || evt.providerSummary || 'Appel reçu.').slice(0, 600),
    next_action: String(j.next_action || 'Rappeler le client.').slice(0, 300),
    request_type: TYPES.includes(j.request_type) ? j.request_type : 'autre',
    urgency: URG.includes(j.urgency) ? j.urgency : 'moyenne',
    callback_before: j.callback_before || null,
    address: j.address || null,
    diagnostics: diag.join(', ') || null,
    is_spam: j.is_spam === true,
  };
}

// Sans clé IA : quelques règles pour que l'app reste utilisable.
function rules(evt) {
  const t = `${evt.transcript || ''} ${evt.providerSummary || ''}`.toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  const type = has('urgent', 'fuite', 'panne') ? 'urgence'
    : has('devis', 'tarif', 'prix', 'combien') ? 'devis'
    : has('rendez-vous', 'rdv', 'passer', 'visite') ? 'rendez_vous'
    : has('rapport', 'dossier', 'suivi') ? 'suivi'
    : has('?', 'est-ce que', 'savoir') ? 'information' : 'autre';
  const urgency = has('urgent', 'compromis', 'signature', 'demain', 'cette semaine', 'vite') ? 'haute'
    : type === 'information' ? 'basse' : 'moyenne';
  const DIAGS = { dpe: 'DPE', amiante: 'Amiante', plomb: 'Plomb', 'électricité': 'Électricité', electricite: 'Électricité', gaz: 'Gaz', termite: 'Termites', carrez: 'Carrez', boutin: 'Boutin' };
  const diagnostics = [...new Set(Object.entries(DIAGS).filter(([k]) => t.includes(k)).map(([, v]) => v))].join(', ') || null;
  const userLines = (evt.transcript || '').split('\n').filter((l) => /^\s*(user|client|caller)\s*:/i.test(l)).map((l) => l.replace(/^[^:]+:\s*/, ''));
  const summary = evt.providerSummary || (userLines.join(' ').slice(0, 220) || 'Appel reçu, pas de transcription.');
  return {
    caller_name: evt.callerName || null,
    summary,
    next_action: type === 'devis' ? 'Envoyer un devis.' : type === 'rendez_vous' ? 'Rappeler pour fixer le rendez-vous.' : 'Rappeler le client.',
    request_type: type,
    urgency,
    callback_before: null,
    address: null,
    diagnostics,
    is_spam: false,
  };
}
