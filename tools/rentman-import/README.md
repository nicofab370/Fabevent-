# Import Rentman → FabEvent

Importe d'un coup tout ton Rentman dans FabEvent :

- clients, lieux et fournisseurs, avec leurs interlocuteurs, délai de paiement, langue et remise par défaut ;
- catégories (dossiers), types de projet et dépôts (emplacements de stock) ;
- matériel : kits, accessoires (automatiques ou proposés, gratuits ou facturés), unités numérotées, photos ;
- équipe avec ses indisponibilités, véhicules, rendez-vous ;
- **projets au complet** : sous-projets avec leur statut, leurs horaires et leur planning (montage, show, démontage…), groupes, lignes de matériel (prix, remises, options, contenu des kits, remarques), postes avec les techniciens affectés, véhicules, coûts supplémentaires, sous-locations, remises (globale et par partie) ;
- réparations ;
- devis et factures (numéro, date, montants, état) ;
- fichiers joints aux projets et aux membres de l'équipe (PDF des devis et factures, plans, permis…).

Rentman est **lu seulement** : rien n'y est modifié.

## 1. Produire le fichier d'export (sur GitHub, rien à installer)

1. Dans Rentman, crée une clé API : **Configuration → Extensions → API → Connecter → Créer un jeton**.
2. Sur GitHub, dans le dépôt FabEvent, va dans **Settings → Secrets and variables → Actions → New repository secret**. Nom : `RENTMAN_TOKEN`, valeur : la clé.
3. Va dans l'onglet **Actions**, choisis **« Export Rentman pour FabEvent »**, puis clique sur **Run workflow**.
   Tu peux décocher « Télécharger aussi les fichiers » pour un export plus rapide, ou changer la taille maximale d'un fichier (25 Mo par défaut).
4. Quand c'est fini, ouvre l'exécution. Dans **Artifacts**, télécharge `fabevent-import-rentman`, puis décompresse le zip. Il contient `fabevent-import-rentman.json` et, avec les fichiers, des paquets `fabevent-import-rentman-fichiers-1.json`, `-2`… (environ 40 Mo chacun).

Le fichier contient tes données clients : il est gardé 7 jours dans GitHub, puis supprimé. Ne le partage pas.

Tu peux aussi le produire sur ton ordinateur, avec Node 18 ou plus récent :

```
RENTMAN_TOKEN=ta-clé node tools/rentman-import/export.mjs
```

## 2. L'importer dans FabEvent

Dans FabEvent, va dans **Paramètres → « Importer depuis Rentman »** et choisis **tous les fichiers ensemble** (le principal et les paquets de fichiers). Un aperçu affiche ce qui sera importé, puis tu cliques sur **Importer**.

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
| Bloc de planning du personnel (montage, show, démontage…) | Créneau du sous-projet (montage, prestation, démontage ou autre, d'après son nom) ; les postes y sont rattachés |
| Fonction (quantité n) | n postes ; les techniciens affectés y sont placés |
| Remise d'une ligne (0,1) | Remise 10 % |
| Remise location / personnel / transport / coûts du sous-projet | Remise par partie du projet (matériel, personnel, transport, frais) |
| Accessoire non automatique | Accessoire proposé dans la fenêtre après l'ajout |
| Contact uniquement fournisseur (sous-location, coût) | Contact « fournisseur » |
| Coût (prix d'achat, prix de vente) | Coût supplémentaire (refacturé si un prix de vente existe) |
| Disponibilité « indisponible » | Indisponibilité de la personne |
| Devis, facture | Document importé (montants et état ; le PDF Rentman est dans les fichiers du projet) |
| Image d'un article | Photo de l'article (réduite) |

Les devis et factures importés gardent leur numéro Rentman et ne touchent pas à la numérotation de FabEvent.

Les champs absents de ton compte Rentman restent vides, rien n'est inventé. Le rapport de l'export indique les collections que la clé ne peut pas lire, et les liens vers des fiches absentes.
