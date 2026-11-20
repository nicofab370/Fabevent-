# Mettre FabEvent en production sur FABRI.live

FabEvent remplace l'Inventaire et la Checklist (qui passaient par l'API Rentman) : le matériel, les unités,
les checklists et les inventaires sont maintenant dans FabEvent, et se synchronisent entre tous les appareils
grâce à un petit fichier PHP posé sur l'hébergement, protégé par la **même connexion** que les pages internes.

## Ce qu'il faut sur l'hébergement

- PHP 8 avec l'extension **pdo_sqlite** (présente chez la plupart des hébergeurs).
- Les pages internes existantes (`interne/_lib/auth.php`) : FabEvent les utilise pour la connexion.

## Installation

1. Récupère le paquet : GitHub → dépôt FabEvent → onglet **Actions** → « Paquet pour l'hébergement FABRI.live »
   → dernière exécution → **Artifacts** → `fabevent-fabri.zip`.
   (Ou en local : `npm run build`, puis copie `dist/` dans `fabevent/` et `server/sync.php` dans `fabevent/api/`.)
2. Dépose le dossier `fabevent/` à la racine du site, à côté de `interne/`, `inventaire/` et `checklist/` :

   ```
   /interne/            (déjà là : connexion)
   /fabevent/index.html
   /fabevent/assets/…
   /fabevent/api/sync.php
   ```

3. Ouvre `https://fabri.live/fabevent/` en étant connecté aux pages internes.
   La synchronisation s'active toute seule (adresse `api/sync.php` à côté de l'application) ;
   son état s'affiche en bas du menu.
4. **Une seule fois**, depuis l'appareil qui contient les bonnes données :
   Paramètres → Synchronisation → « Envoyer toutes les données de cet appareil ».
   Les autres appareils les reçoivent automatiquement.

Si FabEvent est placé ailleurs que dans `/fabevent/`, adapte le chemin de `auth.php` au début de `sync.php`.

## Comment ça marche

- Chaque appareil garde toutes les données et fonctionne **hors ligne** (dépôt sans réseau, camion…).
- Les modifications partent 2 secondes après avoir été faites, puis toutes les 20 secondes, et dès que le réseau revient.
- Si deux appareils modifient la même fiche, la modification la plus récente l'emporte.
- Les numéros (factures, devis, projets) sont attribués par le serveur quand il est joignable : pas de doublon.
  Hors ligne, la numérotation locale prend le relais.
- Les comptes qui ont accès au Rentman commun partagent le même espace ; un compte « externe » a son propre espace.
- Les données sont dans `fabevent-sync.sqlite`, dans le dossier privé des pages internes (hors du web quand c'est possible).
  Sauvegarde ce fichier avec le reste de l'hébergement.

## Ce qui remplace l'Inventaire et la Checklist

| Avant (Rentman) | Maintenant (FabEvent) |
|---|---|
| Checklist importée d'un projet Rentman | Entrepôt → un sous-projet → sortie / retour |
| Checklist depuis un bon PDF / Word / texte | Entrepôt → **Checklists libres** |
| Déclarer perdu (mouvement de stock Rentman, remarque datée) | Bilan du retour → Déclarer perdu (historique daté dans FabEvent) |
| Inventaire, écarts envoyés à Rentman | Inventaire → Appliquer les écarts |
| Codes en plus (fichier codes-….json) | Codes en plus sur l'article ou l'unité (fiche, ou « Associer » au scan) |
| Unité perdue / à réparer / en réparation (remarque Rentman) | État de l'unité + historique, Maintenance → Unités signalées |
| Scanner ZXing (/assets/zxing) | Scanner intégré à FabEvent (même moteur, hors ligne) |

Une fois FabEvent en place, les dossiers `inventaire/` et `checklist/` et le jeton Rentman ne sont plus nécessaires.
