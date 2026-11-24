# Diago

Agent téléphonique IA + appli pour cabinets (appels résumés et triés, tournée du jour optimisée avec Waze).

## Ce que contient le projet

- `src/server.js` : le serveur (webhooks de l'agent vocal, API de l'app, admin).
- `src/ai.js` : l'agent n°2 qui lit la transcription et range l'appel (Claude). Sans clé, des règles simples prennent le relais.
- `src/geo.js` : adresses → coordonnées (Géoplateforme IGN), temps de route réels (OSRM) et ordre de tournée optimal avec créneaux.
- `src/telnyx.js` : branchement de l'agent Telnyx (`/webhooks/telnyx`), voir `docs/agent-telnyx.md`.
- `src/email.js` : email de résumé après chaque appel (Resend).
- `public/` : l'app (`/`), la page admin (`/admin`).

## Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | Base Postgres |
| `ADMIN_KEY` | oui | Mot de passe de la page `/admin` |
| `WEBHOOK_SECRET` | conseillé | Secret attendu dans l'en-tête `x-webhook-secret` (ou `x-vapi-secret`, ou `?secret=`) |
| `PUBLIC_URL` | conseillé | Adresse publique de l'app, pour le lien dans les emails |
| `ANTHROPIC_API_KEY` | conseillé | Résumés et tri par l'IA |
| `AI_MODEL` | non | Modèle Claude (par défaut `claude-haiku-5-5`) |
| `RESEND_API_KEY` | conseillé | Envoi des emails |
| `TELNYX_API_KEY` | pour Telnyx | Récupère la conversation dans l'API Telnyx quand le webhook ne la contient pas |
| `TELNYX_PUBLIC_KEY` | pour Telnyx | Vérifie la signature Ed25519 des webhooks Telnyx |
| `EMAIL_FROM` | non | Expéditeur, ex. `Diago <appels@votre-domaine.fr>` (domaine vérifié dans Resend) |
| `OSRM_URL` | non | Serveur de calcul d'itinéraire (par défaut le serveur public OSRM) |

## Brancher l'agent téléphonique

À la fin de chaque appel, l'agent envoie un POST JSON :

- Vapi : Server URL = `https://VOTRE-APP/webhooks/vapi` (événement `end-of-call-report`), secret dans `x-vapi-secret`.
- Retell : Webhook URL = `https://VOTRE-APP/webhooks/retell?secret=...` (événement `call_analyzed`).
- Agent fait maison : `https://VOTRE-APP/webhooks/generic` avec l'en-tête `x-webhook-secret` :

```json
{
  "call_id": "identifiant-unique",
  "to_number": "+33450000000",
  "from_number": "+33612345678",
  "started_at": "2026-11-23T14:05:00Z",
  "duration_sec": 74,
  "transcript": "AI: Bonjour…\nUser: Bonjour, je vends…",
  "summary": "facultatif",
  "recording_url": "facultatif"
}
```

`to_number` est le numéro de l'agent appelé : il sert à retrouver le cabinet (renseigné dans `/admin`). À défaut, ajoutez `?client=JETON_DU_CABINET` à l'adresse.
La transcription peut aussi être une liste `[{"role":"assistant","text":"…"},{"role":"user","text":"…"}]`.

## Mettre un cabinet en place

1. `/admin` → « Nouveau cabinet » (nom, email, numéro de l'agent, adresse du cabinet).
2. « Copier son lien » → l'envoyer au cabinet. Sur iPhone : Safari → Partager → « Sur l'écran d'accueil ».
3. « Appel de test » pour vérifier que tout arrive (app + email).
4. Le cabinet renvoie ses appels manqués vers le numéro de l'agent.

## Lancer en local

```bash
npm install
DATABASE_URL=postgres://... ADMIN_KEY=... npm start
```
