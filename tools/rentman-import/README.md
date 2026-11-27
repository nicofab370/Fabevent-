# Import Rentman → FabEvent

Importe d'un coup tout ton Rentman dans FabEvent :

- clients et lieux, avec leurs contacts ;
- catégories (dossiers) ;
- matériel, avec les kits et les unités numérotées ;
- équipe et véhicules ;
- **projets au complet** : sous-projets avec leur statut et leurs horaires, groupes, lignes de matériel (prix, remises, options, contenu des kits, remarques), postes avec les techniciens affectés, véhicules.

Rentman est **lu seulement** : rien n'y est modifié.

## 1. Produire le fichier d'export (sur GitHub, rien à installer)

1. Dans Rentman, crée une clé API : **Configuration → Extensions → API → Connecter → Créer un jeton**.
2. Sur GitHub, dans le dépôt FabEvent, va dans **Settings → Secrets and variables → Actions → New repository secret**. Nom : `RENTMAN_TOKEN`, valeur : la clé.
3. Va dans l'onglet **Actions**, choisis **« Export Rentman pour FabEvent »**, puis clique sur **Run workflow**.
4. Quand c'est fini, ouvre l'exécution. Dans **Artifacts**, télécharge `fabevent-import-rentman`, puis décompresse le zip. Il contient le fichier `.json`.

Le fichier contient tes données clients : il est gardé 7 jours dans GitHub, puis supprimé. Ne le partage pas.

Tu peux aussi le produire sur ton ordinateur, avec Node 18 ou plus récent :

```
RENTMAN_TOKEN=ta-clé node tools/rentman-import/export.mjs
```

## 2. L'importer dans FabEvent

Dans FabEvent, va dans **Paramètres → « Importer depuis Rentman »** et choisis le fichier. Un aperçu affiche ce qui sera importé, puis tu cliques sur **Importer**.

- **Les données sont ajoutées à la base ouverte, rien n'est effacé.** Pour importer à part, ouvre d'abord une autre base (Paramètres → Bases de données).
- **Chaque fiche garde son lien avec Rentman** (identifiant `rm-…`). Un nouvel import ajoute ce qui manque, sans créer de doublons.
- **Tes modifications dans FabEvent sont gardées.** Une fiche déjà importée n'est mise à jour que si tu coches « Mettre à jour les fiches déjà importées ».
- **Avec la synchronisation**, tout part ensuite au serveur FabEvent et arrive sur tes autres appareils.

## Comment les données sont reprises

| Rentman | FabEvent |
|---|---|
| Contact client du projet | Contact « client », avec ses interlocuteurs |
| Contact lieu du projet | Contact « lieu » |
| Dossier / sous-dossier | Catégorie / sous-catégorie (un seul niveau : les niveaux plus profonds sont rattachés à la catégorie principale) |
| Set (contenu d'un set) | Kit virtuel |
| Numéros de série | Unités numérotées (inactif = hors service) |
| Statut du sous-projet | Demande, brouillon, option, confirmé, en cours, terminé ou annulé (reconnu d'après son nom, FR / NL / EN) |
| Période d'utilisation / de planification | Horaires du sous-projet / préparation et retour |
| Fonction (quantité n) | n postes ; les techniciens affectés y sont placés |
| Remise d'une ligne (0,1) | Remise 10 % |

Les champs absents de ton compte Rentman restent vides, rien n'est inventé. Le rapport de l'export indique les collections que la clé ne peut pas lire, et les liens vers des fiches absentes.
