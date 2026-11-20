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
- *Planning* : tous les sous-projets et leurs créneaux. *Équipement* : groupes (par type, emplacement ou jour) rattachés à des créneaux.
- *Équipe & transport* : postes et véhicules par créneau, disponibilités, envoi du planning à chaque personne.
- *Coûts supplémentaires* (refacturés ou non, bon de commande), *Finances & documents* (marge par catégorie, déjà facturé),
  *Sous-locations & commandes*, *Registre* (historique des modifications).
- Projets découpés en **sous-projets** (une salle, une scène, une zone, un jour…), chacun avec son matériel, son équipe et ses véhicules. Duplication d'un sous-projet.
- **Horaires par sous-projet** : montage, Prestation J1, J2…, démontage. Le matériel est bloqué du premier au dernier créneau ;
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

**Documents en français, néerlandais ou anglais** selon le client ou le projet. **Facture d'un sous-projet** (facture partielle),
la facture finale excluant les sous-projets déjà facturés. **Champs personnalisés** (projets, contacts, matériel) utilisables dans les documents,
**étiquettes** et filtres, **rendez-vous** hors projet dans le planning, **export CSV** de toutes les listes, **modification groupée** du matériel.

**Équipe** : postes à la journée ou à l'heure avec heures supplémentaires majorées, temps de trajet dans les horaires
communiqués, documents du personnel avec date d'expiration.

**Statuts comme Rentman (2026)** : Demande, Brouillon, En attente, Confirmé, En cours, Exécution terminée, Terminé, Annulé.
Un devis émis met le projet « en attente », un devis accepté le confirme, la première sortie d'entrepôt le passe « en cours »
et le retour complet en « exécution terminée ». Tous les projets non annulés comptent dans les disponibilités, mais seuls les
projets confirmés (ou un sous-projet « matériel réservé ») passent en priorité : la page **Pénuries** distingue les manques réels de la
simple concurrence entre options. L'entrepôt voit les sous-projets confirmés et ceux marqués « prêtes pour la préparation ».

**Facturation par moments** : moments paramétrables (ex. 30 % à la confirmation, solde après la prestation), choisis par type
de projet, par client ou par projet ; échéancier dans l'onglet Finances et liste **À facturer** (rouge si en retard) avec
facturation en un clic ou « facturé en externe ». Délai de paiement par client, **caution** (hors total) et **assurance du matériel**
(% de la location), **conditions générales** imprimées après les devis, **coût réel** par catégorie pour la marge réelle.

**Matériel par ligne** : horaire propre à une ligne (l'article n'est bloqué et facturé que sur ses créneaux), remarque pour le
client (devis, facture) et remarque pour l'entrepôt (bon de sortie). **Notes de projet** imprimées sur les documents choisis.
Champs personnalisés en **liste déroulante**, affichables en colonne et en filtre dans la liste des projets.

**Base des lieux** : chaque lieu a ses infos pratiques (accès et déchargement, électricité, contact sur place, dimensions)
et des commentaires datés, ajoutés depuis la fiche du lieu ou depuis un projet (rattachés au projet). Un commentaire peut être
marqué *important* (alerte sur tous les projets de ce lieu) ou *sur la feuille de route* (imprimé, avec les infos pratiques,
sur la feuille de route et le bon de sortie). Recherche dans les commentaires, historique des projets du lieu, export CSV.

**Endroits d'un lieu** : un lieu peut regrouper plusieurs endroits (bâtiments, scènes, salles d'un hôtel…), chacun avec
sa propre adresse et ses infos pratiques. On choisit l'endroit pour tout le projet (adresse, itinéraire et distance suivent)
ou pour chaque sous-projet ; la feuille de route indique l'adresse de chacun.

**Services et interlocuteurs des clients** : une société peut avoir plusieurs services (Communication, Culture…), chacun avec
ses coordonnées (adresse de facturation, email) et ses personnes. Sur un projet, un seul menu propose les personnes rangées
par service, ou un service sans personne précise ; « + » ajoute une personne (et au besoin son service) sans quitter le projet.
Le devis et la facture reprennent le service, son adresse et l'interlocuteur ; la recherche des contacts trouve aussi les personnes.

**Glisser-déposer du matériel** : dans l'onglet Équipement, un catalogue latéral (recherche, catégories, disponibilité) se
glisse vers n'importe quel groupe d'un sous-projet ; une ligne se glisse vers un autre groupe ou un autre sous-projet.
Sur tablette, le bouton « + » ajoute au groupe sélectionné.

**Postes, puis attribution** : on prévoit d'abord les postes du projet (« 3 × Technicien sur le montage », tarif client, transport),
puis on attribue les techniciens à part — dans l'onglet du projet ou, pour tous les projets, dans le menu **Attribution**
(postes jour par jour, techniciens disponibles en premier puis du moins cher au plus cher).

**Champs numériques** : un champ vidé reste vide (plus de « 0 » qui traîne), et son contenu est sélectionné au clic.

**Démo** : Paramètres → « Ouvrir la base de démo » crée une base séparée avec des clients, du matériel, une équipe et 8 projets fictifs (réinitialisable).

**Données** : import CSV (exports Rentman), plusieurs bases, sauvegarde et restauration.

## Feuille de route

1. Serveur de synchronisation : plusieurs appareils, collègues avec droits, agenda en abonnement automatique,
   liens de partage pour sous-traitants, acceptation de devis en ligne.
