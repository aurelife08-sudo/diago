# Agent téléphonique Diago sur Telnyx

Telnyx décroche, parle au client, puis envoie l'appel à Diago (`/webhooks/telnyx`).
Diago récupère la conversation, la trie (résumé, urgence, diagnostics, rappel) et envoie l'email au cabinet.

```
Client appelle ──► numéro Telnyx (ou renvoi d'appel du cabinet) ──► Assistant IA Telnyx
                                                                        │ fin d'appel
                                                                        ▼
                                  Diago /webhooks/telnyx ──► tri IA ──► appli + email
```

## 1. Côté Render (une seule fois)

Dans le service `diago` → Environment, ajouter :

| Variable | Valeur |
|---|---|
| `TELNYX_API_KEY` | Portail Telnyx → Account → Keys & Credentials → API Keys → Create (clé V2) |
| `TELNYX_PUBLIC_KEY` | Même page, onglet **Public Key** (sert à vérifier que les webhooks viennent bien de Telnyx) |

`WEBHOOK_SECRET` existe déjà : on le met aussi dans l'URL, en secours.

**URL du webhook à coller dans Telnyx :**

```
https://diago-apx8.onrender.com/webhooks/telnyx?secret=VOTRE_WEBHOOK_SECRET
```

## 2. Côté Telnyx

1. **Numéro** : Numbers → Buy Numbers → France. Pour un numéro géographique (04…), Telnyx demande une adresse en France et un justificatif : à faire une seule fois au nom de la société, pas par client.
2. **Assistant** : AI → AI Assistants → Create → modèle vierge.
   - *Instructions* : coller le prompt de la section 3 (remplacer `NOM_DU_CABINET`, `PRENOM_DU_DIAGNOSTIQUEUR`, la zone).
   - *Greeting* : `Bonjour, vous êtes bien au cabinet NOM_DU_CABINET. Je suis l'assistante, je prends votre demande. Cet appel peut être enregistré. Que puis-je faire pour vous ?`
   - *Voice* : choisir une voix **française** (tester 2 ou 3 voix à l'oreille). *Transcription* : langue **fr** (Deepgram ou Whisper).
   - *Tools* : garder **Hangup**.
3. **Brancher Diago** (le plus important) :
   - Analysis → Insights → créer un Insight Group « Diago » avec **Webhook URL = l'URL ci-dessus** et une insight « Résumé » : *« Résume l'appel en une phrase : qui appelle, pour quel bien, quels diagnostics, quand rappeler. »*
   - Si l'assistant propose aussi un webhook d'événements d'appel (Call Control / TeXML app de l'assistant), mettre la même URL : Diago reconnaît `call.conversation.ended`, `call.analyzed` et les insights, et ne crée qu'un seul appel.
4. **Numéro → assistant** : dans l'assistant, onglet Telephony / Numbers, assigner le numéro.
5. **Recording** (facultatif) : activer l'enregistrement. Le lien arrive dans Diago avec `call.analyzed`.

## 3. Prompt de l'assistant (Instructions)

```
Tu es l'assistante téléphonique du cabinet de diagnostic immobilier NOM_DU_CABINET, situé en Haute-Savoie.
Le diagnostiqueur, PRENOM_DU_DIAGNOSTIQUEUR, est en rendez-vous et ne peut pas répondre. Ton rôle : prendre la demande complète pour qu'il rappelle la personne. Tu ne fixes pas toi-même de rendez-vous et tu ne donnes jamais de prix.

Date et heure actuelles : {{telnyx_current_time_Europe/Paris}}. Numéro de l'appelant : {{telnyx_end_user_target}}.

Style : français naturel, phrases courtes (une ou deux), une seule question à la fois, vouvoiement, ton chaleureux et professionnel. N'utilise jamais de listes, d'émojis ou de symboles : tout ce que tu écris est lu à voix haute.

Informations à obtenir, dans cet ordre, en sautant ce que la personne a déjà dit :
1. Son nom.
2. Particulier, ou professionnel (agence immobilière, notaire, syndic, artisan).
3. Le projet : vente, location, travaux, ou autre.
4. Le bien : type (appartement, maison, local), ville et adresse si possible, surface approximative, année de construction approximative (avant 1949, avant 1997, plus récent).
5. Les diagnostics souhaités s'ils les connaissent (DPE, amiante, plomb, électricité, gaz, termites, Carrez, Boutin, ERP, audit énergétique). S'ils ne savent pas, dis que le diagnostiqueur leur indiquera lesquels sont obligatoires.
6. Le délai : une date de compromis, de signature ou d'entrée dans les lieux.
7. Le meilleur moment pour rappeler. Vérifie le numéro de rappel : si le numéro de l'appelant est connu, demande si c'est le bon ; sinon, demande-le et relis-le chiffre par chiffre.

Règles :
- Si on te demande un prix ou un tarif : « Le tarif dépend du bien et des diagnostics, PRENOM_DU_DIAGNOSTIQUEUR vous le donnera en vous rappelant. »
- Si la personne est pressée : prends seulement son nom, son numéro et l'objet en une phrase, puis termine.
- Si la personne demande si tu es un robot : réponds honnêtement que tu es l'assistante automatique du cabinet et que le diagnostiqueur la rappellera personnellement.
- Démarchage commercial : « Merci, nous ne sommes pas intéressés, bonne journée », puis raccroche.
- Rapport, facture ou dossier en cours : note le nom, l'adresse du bien et la question, sans rien promettre.
- Ne promets jamais de délai d'intervention. Ne donne aucun conseil juridique.
- Hors sujet ou mauvais numéro : indique poliment que c'est un cabinet de diagnostic immobilier et termine.

Fin d'appel : résume en une phrase ce que tu as noté (« C'est noté : DPE et amiante pour la vente de votre appartement à Annecy, PRENOM_DU_DIAGNOSTIQUEUR vous rappelle demain matin »), demande s'il y a autre chose, puis dis au revoir et raccroche avec l'outil hangup.
```

## 4. Tester

1. Admin Diago (`/admin`) : créer ou modifier le cabinet, **numéro de l'agent = le numéro Telnyx** (format libre, `04 50…` ou `+33 4 50…`).
2. Appeler le numéro avec son portable. Raccrocher, attendre ~30 s : l'appel apparaît dans l'appli et l'email part.
3. Checklist rapide : demande normale, « c'est combien ? », « vous êtes un robot ? », numéro masqué (`#31#`), démarchage, raccrocher au bout de 3 s, appel d'agence qui dit tout d'un coup.
4. Si rien n'arrive : Render → Logs. `Secret invalide` = mauvais `?secret=` ; `aucun cabinet pour le numéro` = numéro de l'agent pas renseigné dans l'admin (ou différent).

## 5. Un cabinet de plus

- Un assistant par cabinet (le nom du cabinet est dans le prompt) : Dupliquer l'assistant, changer les noms, assigner un nouveau numéro, renseigner ce numéro dans l'admin Diago.
- Le cabinet garde son numéro habituel : il active un **renvoi d'appel** (sur non-réponse ou permanent) vers son numéro Telnyx. Rien à changer côté Diago.
