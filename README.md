# FabEvent

Gestion de location de matériel et de prestation technique, inspirée de Rentman mais plus simple.
Application web installable (PWA) qui **fonctionne hors ligne** : les données sont stockées dans le navigateur.

## Lancer

```bash
npm install
npm run dev       # développement : http://localhost:5173
npm run build     # version de production dans dist/ (hébergeable sur n'importe quel hébergement statique)
```

## Fonctionnalités (v0.1)

- **Projets et sous-projets** (montage, show, démontage, salles…) avec statuts : demande, option, confirmé, en cours, terminé, annulé.
  Seuls « option », « confirmé » et « en cours » bloquent le matériel. Duplication de projet.
- **Matériel** : catalogue, catégories, kits/packs, stock, disponibilité en temps réel sur une période,
  détection des manques, ajout par recherche ou par scan de code-barres (douchette USB = clavier).
- **Tarification** : prix/jour × coefficient selon la durée (réglable), remise par ligne et globale, TVA.
- **Documents figés et versionnés** : devis, facture, bon de sortie (cases sortie/retour), feuille de route sans prix
  pour sous-traitants. Chaque génération crée un nouveau document : rien n'est écrasé.
  Impression/PDF, export HTML, envoi par email.
- **Équipe** (internes et sous-traitants) : postes par sous-projet, détection de double réservation, agenda personnel .ics.
- **Véhicules** : réservation par sous-projet, chauffeur, détection des conflits.
- **Planning** mensuel et export .ics avec lien direct vers chaque projet.
- **Import CSV** (exports Rentman) : matériel, contacts, équipe, projets, avec reconnaissance des colonnes.
- **Plusieurs bases** séparées, sauvegarde/restauration JSON.

## Feuille de route

1. Serveur de synchronisation (multi-appareils, collègues, abonnement agenda automatique, liens de partage pour sous-traitants).
2. Entrepôt : suivi par numéro de série, scan sortie/retour, états.
3. Sous-location fournisseurs, maintenance et réparations.
4. Connexions : comptabilité, envoi d'emails, signature électronique.
