# FabEvent

Gestion de location de matériel et de prestation technique, inspirée de Rentman mais plus simple.
Application web installable (PWA) qui **fonctionne hors ligne** : les données sont stockées dans le navigateur.

## Lancer

```bash
npm install
npm run dev       # développement : http://localhost:5173
npm run build     # version de production dans dist/ (hébergeable sur n'importe quel hébergement statique)
npm test          # tests unitaires des calculs (TVA, disponibilités, heures sup., Peppol…)
npm run test:e2e  # parcours complet dans un navigateur (nécessite Playwright et Chromium)
```

## Fonctionnalités

**Projets** — fiche organisée en onglets, sur le modèle du « projet standard » de Rentman :
- *Général* : nom, type (avec couleur), statut, numéro, référence externe, client et personne de contact, lieu (itinéraire),
  avancée du projet, résumé du planning, tâches, notes, fichiers joints, bons de sortie et feuilles de route.
- *Planning* : toutes les salles et leurs créneaux. *Équipement* : groupes (par type, emplacement ou jour) rattachés à des créneaux.
- *Équipe & transport* : postes et véhicules par créneau, disponibilités, envoi du planning à chaque personne.
- *Coûts supplémentaires* (refacturés ou non, bon de commande), *Finances & documents* (marge par catégorie, déjà facturé),
  *Sous-locations & commandes*, *Registre* (historique des modifications).
- Projets découpés en **salles / sous-projets** (Salle 1, Salle 2, scène…), chacun avec son matériel, son équipe et ses véhicules. Duplication d'une salle.
- **Horaires par salle** : montage, Prestation J1, J2…, démontage. Le matériel est bloqué du premier au dernier créneau ;
  seuls les jours de prestation sont facturés (une fin de soirée après minuit compte pour la veille). Les postes de l'équipe se rattachent à un créneau.
- Statuts, duplication de projet, interlocuteur client.
- Onglet Finances : chiffre d'affaires, coûts (personnel, sous-locations, consommables, frais divers), marge.

**Matériel et stock**
- Catalogue, catégories, kits, accessoires ajoutés automatiquement (gratuits ou facturés).
- Location (prix/jour × coefficient de durée) ou consommable (vendu à la pièce, déduit du stock quand le projet est terminé).
- Suivi par numéro de série en option, frise de disponibilité sur 4 semaines, alertes de manque.
- Lignes en option sur le devis (hors total).

**Entrepôt**
- Préparation et retour par scan (douchette USB ou caméra du téléphone sur Chrome Android) ou par comptage.
- Détection des manquants au retour, déclaration de casse (crée une réparation).

**Sous-location** : depuis un manque en un clic, bon de commande, email au fournisseur. Une fois confirmée, elle compte dans les disponibilités.

**Maintenance** : réparations (le matériel est indisponible tant qu'elles sont ouvertes) et contrôles périodiques.

**Documents figés et versionnés** (rien n'est jamais écrasé)
- Devis, facture d'acompte, facture (acomptes déduits automatiquement), avoir, bon de sortie, feuille de route sans prix.
- Impression / PDF, export HTML, email, **export Peppol BIS 3.0 (UBL)** pour les factures et les avoirs.

**Transport chiffré à la distance** : distance dépôt → lieu calculée automatiquement (OpenStreetMap, connexion requise) ou saisie à la main ;
prix d'un véhicule = forfait journalier × jours + km (distance × 2 × allers-retours) × prix au km (par véhicule ou par défaut).

**Dépôts et transferts** : plusieurs dépôts, stock par dépôt, dépôt de départ par projet, transferts définitifs ou temporaires
(proposés automatiquement en cas de manque), bon de transfert.

**Modèles de documents** : style commun éditable en HTML (en-tête, mise en page, pied de page, CSS) avec une liste de variables
cliquables ({{client.nom}}, {{total.ttc}}…) et de blocs générés ({{bloc.salles}}, {{bloc.totaux}}…) ; titre et textes par type de document ;
options d'affichage (couleur, police, colonnes, lignes à 0 €) ; aperçu en direct. Le modèle est figé dans chaque document émis.

**Équipe et véhicules** : postes, tarif facturé / coût, indisponibilités, conflits, agenda personnel `.ics`.

**Planning** mensuel et export `.ics` avec lien direct vers chaque projet.

**Comptabilité et rapports**
- Toutes les factures d'une période en un seul PDF, journal des ventes en CSV.
- Chiffre d'affaires par mois, meilleurs clients, matériel le plus rentable et taux d'utilisation.

**Facturation belge** : régimes de TVA (normal, autoliquidation UE, exonéré, hors UE) par client ou par projet, avec mention légale ;
communication structurée +++…+++ et QR code de virement sur les factures ; factures échues et rappels de paiement (3 niveaux) ;
remises par défaut du client.

**Planning avancé** : décaler un projet (durée ou nouvelle date), modèles de projet, projets récurrents.

**Matériel** : étiquettes QR imprimables (planches A4, rouleau), articles de remplacement proposés en cas de manque,
archivage, photos, inventaire par scan avec mise à jour du stock, valeur du parc.

**Sous-traitants et marge** : le client paie la fonction (catalogue de tarifs dans Paramètres), quel que soit le prestataire ;
chaque technicien ou sous-traitant a son propre coût, qui ne joue que sur la marge (affichée poste par poste, candidats triés par coût).

**Sociétés de sous-traitance** : chaque technicien externe peut être rattaché à sa société ; bons de commande RH regroupés
par fournisseur (impression, email), coûts par fournisseur dans les finances. Planification **provisoire ou finale** des postes
(seuls les postes finals sont envoyés aux techniciens).

**Documents en français, néerlandais ou anglais** selon le client ou le projet. **Facture d'une salle** (facture partielle),
la facture finale excluant les salles déjà facturées. **Champs personnalisés** (projets, contacts, matériel) utilisables dans les documents,
**étiquettes** et filtres, **rendez-vous** hors projet dans le planning, **export CSV** de toutes les listes, **modification groupée** du matériel.

**Équipe** : postes à la journée ou à l'heure avec heures supplémentaires majorées, temps de trajet dans les horaires
communiqués, documents du personnel avec date d'expiration.

**Démo** : Paramètres → « Ouvrir la base de démo » crée une base séparée avec des clients, du matériel, une équipe et 8 projets fictifs (réinitialisable).

**Données** : import CSV (exports Rentman), plusieurs bases, sauvegarde et restauration.

## Feuille de route

1. Serveur de synchronisation : plusieurs appareils, collègues avec droits, agenda en abonnement automatique,
   liens de partage pour sous-traitants, acceptation de devis en ligne.
