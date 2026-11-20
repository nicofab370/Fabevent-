# FabEvent

Gestion de location de matériel et de prestation technique, inspirée de Rentman mais plus simple.
Application web installable (PWA) qui **fonctionne hors ligne** : les données sont stockées dans le navigateur.

## Lancer

```bash
npm install
npm run dev       # développement : http://localhost:5173
npm run build     # version de production dans dist/ (hébergeable sur n'importe quel hébergement statique)
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

**Équipe et véhicules** : postes, tarif facturé / coût, indisponibilités, conflits, agenda personnel `.ics`.

**Planning** mensuel et export `.ics` avec lien direct vers chaque projet.

**Comptabilité et rapports**
- Toutes les factures d'une période en un seul PDF, journal des ventes en CSV.
- Chiffre d'affaires par mois, meilleurs clients, matériel le plus rentable et taux d'utilisation.

**Démo** : Paramètres → « Ouvrir la base de démo » crée une base séparée avec des clients, du matériel, une équipe et 8 projets fictifs (réinitialisable).

**Données** : import CSV (exports Rentman), plusieurs bases, sauvegarde et restauration.

## Feuille de route

1. Serveur de synchronisation : plusieurs appareils, collègues avec droits, agenda en abonnement automatique,
   liens de partage pour sous-traitants, acceptation de devis en ligne.
