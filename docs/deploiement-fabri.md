# Mettre FabEvent en production sur FABRI.live

FabEvent remplace l'Inventaire et la Checklist (qui passaient par l'API Rentman) : le matériel, les unités,
les checklists et les inventaires sont maintenant dans FabEvent, et se synchronisent entre tous les appareils
grâce à quelques fichiers PHP posés sur l'hébergement.

**FabEvent est autonome** : il ne dépend d'aucune autre partie du site (ni `interne/`, ni `inventaire/`, ni `checklist/`).
On se connecte au serveur avec les **comptes FabEvent** eux-mêmes (écran de connexion de l'application, Paramètres → Utilisateurs).
Le dossier `fabevent/` peut être déposé seul sur n'importe quel hébergement PHP.

## Ce qu'il faut sur l'hébergement

- PHP 8 avec l'extension **pdo_sqlite** (présente chez la plupart des hébergeurs).
- Rien d'autre.

## Installation

1. Récupère le paquet : GitHub → dépôt FabEvent → onglet **Actions** → « Paquet pour l'hébergement FABRI.live »
   → dernière exécution → **Artifacts** → `fabevent-fabri.zip`.
   (Ou en local : `npm run build`, puis copie `dist/` dans `fabevent/` et les fichiers de `server/` dans `fabevent/api/`.)
2. Dépose le dossier `fabevent/` à la racine du site :

   ```
   /fabevent/index.html
   /fabevent/sw.js
   /fabevent/assets/…
   /fabevent/api/_fabevent.php (bibliothèque commune : connexion, données — ne s'ouvre pas dans un navigateur)
   /fabevent/api/auth.php      (connexion avec les comptes FabEvent)
   /fabevent/api/sync.php
   /fabevent/api/mail.php      (envoi des mails depuis FabEvent)
   /fabevent/api/public.php    (liens des techniciens : réponse de disponibilité, formulaire d'inscription, mot de passe oublié)
   /fabevent/api/oauth.php     (connexion Google / Microsoft / Apple — optionnel, variables d'env, voir README)
   /fabevent/api/diag.php      (diagnostic : ouvre-le dans un navigateur, il doit répondre en JSON)
   /fabevent/api/mail-config.php   (à créer, voir ci-dessous — jamais dans Git)
   ```

   **Vérifie tout de suite** : ouvre `https://fabri.live/fabevent/api/diag.php` dans un navigateur.
   Il doit répondre en **JSON** (version PHP, extensions, fichiers vus dans `api/`, dossier de données, bases et nombre de comptes).
   Si c'est la page HTML de l'application qui s'affiche, le dossier `api/` n'est pas atteint par le serveur :
   dépose `api-htaccess.example` renommé en `.htaccess` dans `api/` (réécriture SPA), et vérifie qu'aucun
   `ErrorDocument 404` ne renvoie vers l'application pour ce dossier.

3. Ouvre `https://fabri.live/fabevent/`. La synchronisation s'active toute seule (adresse `api/sync.php` à côté
   de l'application) ; son état s'affiche en bas du menu. Il faut **se connecter avec un compte FabEvent** :
   - les comptes déjà créés dans FabEvent (Paramètres → Utilisateurs) et déjà synchronisés fonctionnent tels quels ;
   - serveur sans aucun compte : l'écran de connexion propose de créer le compte administrateur.
     Si le serveur contient déjà des données, il demande un **code d'installation**, au choix :
     - celui du fichier `code-installation.txt` du dossier de données (voir `diag.php`, champ `data_dir`) ;
     - ou un code que tu choisis : copie `fabevent-config.example.php` en `fabevent/api/fabevent-config.php` par FTP
       et mets `'setup_code' => 'TON-CODE'` (8 caractères min.). Retire-le une fois le compte créé.
4. **Une seule fois**, depuis l'appareil qui contient les bonnes données :
   Paramètres → Synchronisation → « Envoyer toutes les données de cet appareil ».
   Les autres appareils les reçoivent automatiquement.

### Données et reprise de l'ancienne base

Les données sont dans `fabevent-sync.sqlite`, dans un dossier privé choisi dans cet ordre :
1. `data_dir` de `fabevent/api/fabevent-config.php` s'il existe (`<?php return ['data_dir' => '/chemin/prive'];`) ;
2. `fabevent-prive/`, à côté du dossier du site (hors du web) — sur FABRI.live : `/home/fabrilc/fabevent-prive` ;
3. sinon `fabevent/api/_donnees/` (protégé par un `.htaccess`).

À la première ouverture, si ce dossier n'a pas encore de base, l'**ancienne base** (dossier privé des pages internes,
`fabri-prive/fabevent-sync.sqlite`) y est **copiée une fois** : rien n'est perdu, et FabEvent n'utilise plus
l'ancien emplacement ensuite. `diag.php` indique si cette reprise a eu lieu (`reprise_ancienne_base`).

### Connexion au serveur

- Session de 60 jours par appareil, prolongée à chaque utilisation (cookie limité au dossier `/fabevent/`).
- Si elle disparaît (données du site effacées dans le navigateur, nouvel appareil, mot de passe changé, compte
  désactivé), FabEvent affiche un bandeau « Connexion au serveur FabEvent expirée » avec **Se reconnecter**.
  Les modifications restent sur l'appareil et partent après la reconnexion. En attendant, les mails qui contiennent
  des liens (disponibilités, devis…) ne partent pas, pour que le destinataire ne reçoive jamais un lien « expiré ».
- Rôles : administrateur et entrepôt synchronisent ; un compte sous-traitant ne reçoit pas toute la base.
- MFA : si le compte a activé le code à 6 chiffres, le serveur le demande aussi.

## Envoi des mails depuis FabEvent

Avec `mail.php`, les devis, factures, bons, plannings et demandes de disponibilité partent **directement** de FabEvent,
pièces jointes comprises (bouton « Envoyer »). Les réponses arrivent à l'adresse de ta société (Paramètres → Ma société).

Les mails partent de **noreply@fabri.live** (par défaut : `noreply@` + domaine du site) et les réponses des
destinataires arrivent à l'adresse « Répondre à » réglée dans Paramètres → Ma société → « Réponses aux mails »
(ex. `nicolas@fabri.live` ; vide = email de la société).

1. Crée la boîte `noreply@fabri.live` chez ton hébergeur (le serveur SMTP doit accepter cette adresse comme expéditeur).
2. Copie `mail-config.example.php` (dans le paquet) en `fabevent/api/mail-config.php` et remplis-le :
   adresse d'expédition, serveur SMTP, port, identifiant et mot de passe de la boîte.
   Sans bloc SMTP, la fonction `mail()` de l'hébergement est utilisée (les mails arrivent moins bien : préfère le SMTP).
3. Vérifie : ouvre un devis → « Envoyer par email » → le bouton « Envoyer » apparaît.

Sans `mail.php` (ou hors connexion), FabEvent propose toujours les autres façons : partage, brouillon .eml, messagerie.

## Dépannage : la synchro ou les mails ne répondent pas

L'état de la synchro et son message d'erreur exact s'affichent en bas du menu et dans Paramètres → Synchronisation. Pour tester l'API à la main (après connexion à FabEvent dans le même navigateur) :

```
https://fabri.live/fabevent/api/diag.php                           → JSON : PHP, extensions, fichiers de api/, données, bases
https://fabri.live/fabevent/api/auth.php?action=status&ws=principal  → {"session":true|false,"users":true|false,…}
https://fabri.live/fabevent/api/sync.php?action=ping&ws=principal    → {"ok":true,"user":"…","ws":"…"}
https://fabri.live/fabevent/api/mail.php?action=status  → {"ok":true,"mode":"smtp|mail|outbox","from":"…"}
```

- **L'URL de l'API renvoie la page HTML de FabEvent** (et pas du JSON) : c'est la réécriture SPA (ou un `ErrorDocument 404`) qui répond — le dossier `api/` n'est pas atteint à cette adresse. `diag.php` dit en JSON quels fichiers PHP voient réellement dans `api/` ; s'il répond aussi en HTML, le problème est la réécriture elle-même (voir `api-htaccess.example`). FabEvent affiche ce diagnostic (« API non atteinte… ») dans Paramètres → Synchronisation.
- **404** : le dossier `fabevent/api/` n'est pas (ou plus) déposé — reprendre le paquet de l'onglet Actions.
- **Erreur 500 sur tous les scripts** : `_fabevent.php` manque dans `api/` (il est dans le paquet).
- **401** : pas de session FabEvent sur ce navigateur pour cette base — FabEvent affiche « Se reconnecter » ; se connecter avec son compte FabEvent.
- **403** : le compte connecté est un sous-traitant : il ne synchronise pas la base.
- **{"error":"storage"}** : `pdo_sqlite` absent, ou le dossier de données (`data_dir` dans `diag.php`) non écrivable par PHP.
- **diag.php en JSON mais une extension à `false`** (`pdo_sqlite`, `curl`, `openssl`…) ou `data_writable: false` : activer l'extension / rendre le dossier écrivable chez l'hébergeur.
- **Mail** : `?action=status` doit répondre ok ; sinon crée `api/mail-config.php` (SMTP recommandé, voir `mail-config.example.php`). Sans SMTP, la fonction `mail()` de l'hébergement est utilisée (livraison moins fiable).
- **App servie depuis une autre origine que l'API** (ex. GitHub Pages + API sur fabri.live) : il faut des en-têtes CORS côté API, en tête de `fabevent/api/.htaccess` :
  `Access-Control-Allow-Origin: <origine exacte de l'app>`, `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Headers: Content-Type`, et répondre **204** aux requêtes `OPTIONS`. En hébergement direct (`fabri.live/fabevent/`), même origine : rien à faire.
- PHP 8 recommandé, avec `pdo_sqlite`, `curl` et `openssl`.

## Liens des techniciens

`public.php` sert ces pages **sans connexion**, protégées par une clé secrète dans le lien :

- **Demande de disponibilité** : chaque technicien reçoit son lien et répond « disponible / pas disponible », poste par poste.
  La réponse arrive dans FabEvent (pastilles « disponible / pas disponible / en attente » sur le poste).
- **Formulaire d'inscription** : Équipe → « Ouvrir le formulaire d'inscription » donne un lien à envoyer ou à mettre sur ton site.
  Les fiches remplies arrivent dans « Inscriptions à valider ». « Fermer le formulaire » désactive le lien.
- **Agenda en ligne** : Équipe → « Lien agenda » sur une personne copie son lien. Elle s'abonne en un clic
  (Google Agenda, iPhone/Mac, Outlook, ou toute appli qui accepte un agenda « par URL ») : ses postes y arrivent
  tout seuls et se mettent à jour (horaires, lieu, trajet compris). Projet en demande / brouillon / option :
  « [Option] … » (provisoire) ; confirmé : événement confirmé ; annulé ou planning provisoire non communiqué : absent.
  Google actualise les agendas abonnés toutes les quelques heures ; iPhone/Mac selon le réglage de l'abonnement.
  « Désactiver le lien d'agenda » (fiche de la personne) coupe l'ancien lien.
- **Mot de passe oublié** : sur l'écran de connexion de FabEvent, « Mot de passe oublié ? » envoie à l'email du compte
  un lien `public.php?pw=…` (jeton à usage unique, valable 2 h, stocké en SQLite). Le nouveau mot de passe y est haché
  comme dans l'application (SHA-256 `sel:motdepasse`) et écrit dans la table `users` synchronisée : il arrive sur tous
  les appareils à la prochaine synchronisation. Sans serveur, un administrateur redéfinit le mot de passe d'un compte
  dans Paramètres → Utilisateurs (« Mot de passe… »).

## Comment ça marche

- Chaque appareil garde toutes les données et fonctionne **hors ligne** (dépôt sans réseau, camion…).
- Les modifications partent 2 secondes après avoir été faites, puis toutes les 20 secondes, et dès que le réseau revient.
- Si deux appareils modifient la même fiche, la modification la plus récente l'emporte.
- Les numéros (factures, devis, projets) sont attribués par le serveur quand il est joignable : pas de doublon.
  Hors ligne, la numérotation locale prend le relais.
- Chaque base FabEvent (« principal », bases de société…) a ses propres comptes et ses propres données sur le serveur.
- Les données sont dans `fabevent-sync.sqlite`, dans le dossier privé de FabEvent (voir plus haut).
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

Une fois FabEvent en place, les dossiers `inventaire/` et `checklist/` et le jeton Rentman ne sont plus nécessaires,
et FabEvent ne dépend pas non plus de `interne/`.
