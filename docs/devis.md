# Devis

Après chaque appel qui concerne des diagnostics, Diago prépare un devis avec les tarifs du cabinet. Il arrive dans l'onglet **Devis**, statut « À valider ». Rien ne part chez le client sans l'accord du diagnostiqueur.

## Comment le devis est construit

1. L'IA lit la transcription : nom, email (dit à l'oral, reconstitué), adresse, type de bien, surface, année, vente ou location, diagnostics cités.
2. Si le client a cité ses diagnostics, ce sont ceux-là. Sinon, Diago propose la liste habituelle (marquée « à confirmer ») :
   - vente : DPE, ERP, électricité (logement de plus de 15 ans ou année inconnue), plomb (avant 1949), amiante (avant 1997), Carrez (appartement) ;
   - location : DPE, ERP, électricité, plomb (avant 1949), Boutin.
   Gaz, termites et audit énergétique ne sont ajoutés que si le client les demande.
3. Prix = tarif du cabinet (appartement ou maison), majoré au-delà d'une surface, remise dès N diagnostics, frais de déplacement, TVA.

Les tarifs se saisissent dans Devis → **Mes tarifs** (avec l'en-tête du devis : raison sociale, SIRET, adresse, mentions). Tant qu'ils ne sont pas saisis, des tarifs d'exemple sont utilisés et un bandeau le signale.

## Ce que fait le diagnostiqueur

- Modifier : client, email, bien, diagnostics (« Recalculer avec mes tarifs »), lignes, remise, TVA, note.
- Supprimer.
- **Valider et envoyer** : email au client (via Resend) avec un lien vers la page du devis, où il peut l'**accepter** en un clic et l'enregistrer en PDF. Sans email ou si l'envoi échoue : envoi par SMS ou lien copié.
- Suivre : Envoyé, Accepté (par le client ou à la main), Refusé.

## À configurer

- `RESEND_API_KEY` sur Render, et idéalement `EMAIL_FROM` avec un domaine vérifié dans Resend (sinon les emails risquent le spam).
- Le prompt de l'agent Telnyx : voir `prise-de-rdv-telnyx.md` (il demande maintenant le type de bien, la surface, l'année et l'email).
