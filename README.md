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
npm run test:parcours  # nouveautés en contexte : import Rentman, catégories, réservations ailleurs, coût et heures des techniciens
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

**Matériel** : étiquettes imprimables (planches A4, rouleau), articles de remplacement proposés en cas de manque,
archivage, photos, inventaire par scan avec mise à jour du stock, valeur du parc.
Dans l'inventaire d'un kit, les articles à numéro de série se comptent aussi à la main (+ / −, ou en touchant le numéro de l'unité).

**Étiquettes** : 11 formats standard (planches A4 de 8 à 65 étiquettes, rouleaux 50 × 25, 62 × 29, 57 × 32, 102 × 51 mm,
drapeau pour câble) et 6 mises en page : QR à gauche, QR au-dessus, QR seul, code-barres Code 128 pour douchette,
texte en grand, drapeau pour câble. Modèles personnels : taille, colonnes, lignes, marges, espaces, champs imprimés et
leur ordre (nom, code, n° de série, catégorie, emplacement, contenu, société), taille du texte, cadre et texte libre, avec un aperçu
à taille réelle. Les modèles sont enregistrés dans les paramètres (synchronisés). « Commencer à l'étiquette n° » réutilise une planche entamée.

**Fichiers** : PDF, images et textes joints s'ouvrent dans FabEvent (aperçu page par page, aussi sur iPhone), sans téléchargement.

**Postes et techniciens** :
- **Listes de postes préétablies** avec leur tarif client prévu (« Enregistrer ces postes comme liste », puis « Ajouter cette liste » dans un autre projet). Le coût client prévu s'affiche par sous-projet.
- Les postes sans technicien sont mis en évidence (bandeau, compteur).
- **Tarifs d'un technicien selon la fonction** (vidéo, son, road…).
- **Envoi du planning à tous**, provisoire compris si souhaité. FabEvent retient ce qui a été envoyé, signale les horaires de début et de fin changés depuis (« à renvoyer »), et le mail les marque « MODIFIÉ ».

**Coûts supplémentaires** : fournisseur en texte libre (absent des documents s'il est vide), montants saisis HTVA ou TVAC.
**Documents du projet** : le plus récent de chaque type, les anciens avec « Plus anciens ».

**Téléphone** : boutons et champs à la taille du doigt, textes sur plusieurs lignes, grands tableaux en fiches.
Audit automatique de chaque page à 390 px : `npm run test:mobile`.

**Icônes** : un seul jeu d'icônes dessinées au trait (SVG, `src/components/Icon.tsx`), à la couleur et à la taille du texte ; aucun emoji dans l'interface.

**Mails depuis la plateforme** : devis, factures, bons, plannings, demandes de dispo partent directement de FabEvent avec leurs
pièces jointes (serveur `mail.php` sur l'hébergement, SMTP). Destinataires depuis le carnet d'adresses (contacts, interlocuteurs,
services, techniciens), copie, **modèles de mail par type** (Modèles → Mails, ou « Enregistrer comme modèle » : les noms, dates
et montants deviennent des variables). Sans serveur : partage, brouillon .eml ou messagerie.

**Équipe** :
- « Demander les dispos » sur un ou plusieurs postes : chaque technicien reçoit un lien et répond en un clic, poste par poste.
  La réponse revient sur le poste (en attente, disponible, pas disponible, avec son mot), et on peut aussi la noter à la main.
- Les personnes disponibles sont proposées en premier.
- « Attribuer » envoie au technicien les détails du poste par mail : lieu, adresse, horaires, contact sur place, agenda .ics.
- « Remplacer » : un technicien confirmé qui n'est plus disponible est noté « pas dispo », prévenu, puis remplacé.
- **Formulaire d'inscription** public pour ajouter des techniciens à la base (fiches à valider).

**Devis** : les options dans une section à part, avec leur total. **Feuille de route** : contacts du client et du lieu.
**Projet** : client et lieu modifiables depuis leur champ (bouton Modifier), distance calculée depuis l'adresse du dépôt, suppression
d'un sous-projet (avec avertissements). **Liste de sortie** libre → « Créer un projet avec cette liste ».

**Étiqueteuse Brother PT-P750W** (Matériel › Étiquettes, format « ruban TZe ») : QR du code interne (ex. `F-S-0010-03`
pour une unité) + code + nom, sur ruban de 6 à 24 mm.
- *Impression directe en USB* (WebUSB : Chrome / Edge sur macOS, Linux, ChromeOS, Android avec câble OTG) : FabEvent
  suit la *Raster Command Reference PT-E550W/P750W/P710BT v1.01* de Brother. Il lit d'abord le statut (largeur du ruban,
  erreurs) et refuse d'imprimer si quelque chose ne va pas. Les étiquettes partent une par une : la suivante n'est envoyée
  qu'après le statut « impression terminée », sinon tout s'arrête.
  - zone imprimable officielle par ruban (12 mm : 70 points centrés) ;
  - marge d'avance de 2 mm et lignes compressées de 17 octets au plus ;
  - coupe de chaque étiquette, avec demi-découpe et impression chaînée en option ;
  - bouton « Étiquette d'essai » ;
  - la machine sort toujours au moins 24,5 mm de ruban (position du coupe-ruban).

  Le bouton Editor Lite doit être éteint.
  Sous Windows, le pilote Brother garde la machine : installer WinUSB avec Zadig, ou utiliser l'impression via le pilote.
- *Depuis l'article* : « Imprimer l'étiquette » sur la fiche, « Étiquette » sur chaque unité, et « Enregistrer et
  imprimer l'étiquette » dans la modification (aussi à la création) : choix des unités et du nombre d'exemplaires.
- *Image PNG au format exact du ruban* (180 dpi) pour l'app Brother iPrint&Label (iPhone, Wi-Fi Direct) ou P-touch Editor.
- *Impression via le pilote Brother* (page au format longueur × largeur du ruban).

**Sous-traitants et marge** : le client paie la fonction (catalogue de tarifs dans Paramètres), quel que soit le prestataire ;
chaque technicien ou sous-traitant a son propre coût, qui ne joue que sur la marge (affichée poste par poste, candidats triés par coût).

**Sociétés de sous-traitance** : chaque technicien externe peut être rattaché à sa société ; bons de commande RH regroupés
par fournisseur (impression, email), coûts par fournisseur dans les finances. Planification **provisoire ou finale** des postes
(seuls les postes finals sont envoyés aux techniciens).

**Documents en français, néerlandais ou anglais** selon le client ou le projet. **Facture d'un sous-projet** (facture partielle),
la facture finale excluant les sous-projets déjà facturés. **Champs personnalisés** (projets, contacts, matériel) utilisables dans les documents,
**étiquettes** et filtres, **rendez-vous** hors projet dans le planning, **export CSV** de toutes les listes, **modification groupée** du matériel (les informations communes aux articles cochés sont pré-remplies, seules celles qu'on change sont appliquées : catégorie, dépôt, type, prix ou variation en %, prix d'achat, valeur de remplacement, poids, contrôle, emplacement, archivage, étiquettes à ajouter ou retirer, photo, contenu fourni, notes, champs personnalisés).
Filtre **par dépôt** dans la liste du matériel et dans « + Matériel » d'un projet (seul le matériel présent dans ce dépôt, disponibilité calculée dans ce dépôt). Les filtres de catégorie regroupent les catégories en double (même nom, créées par deux imports ou deux appareils), rangent un troisième niveau sous sa catégorie principale et proposent « Sans catégorie ».
**Stock par dépôt** : un transfert définitif passé à « Effectué » déplace vraiment le stock (quantité propre de chaque dépôt ; pour un article sérialisé, les unités choisies dans le transfert changent de dépôt) ; un transfert planifié ou temporaire reste une réservation datée. Modifier ou repasser un transfert effectué remet d'abord le stock en place ; à la suppression, FabEvent propose de le remettre. Les transferts définitifs déjà effectués sont convertis une fois au démarrage. À l'inventaire d'un dépôt : l'attendu compte les transferts en cours, « Appliquer les écarts » corrige le stock de la différence (sans écraser les transferts), une unité scannée alors qu'elle est enregistrée dans un autre dépôt est comptée et rangée dans ce dépôt (historique), et une unité d'un dépôt supprimé compte au dépôt principal, comme dans la liste du matériel.
**Étiqueteuses dans les modèles** : support « ruban » (largeur du ruban, longueur au choix) en plus des planches A4 et des rouleaux. Modèles standard pour la **Brother PT-P750W** sur tous les rubans TZe (3,5, 6, 9, 12, 18, 24 mm ; zone imprimable d'après la table Brother), la **Dymo LabelManager** (rubans D1 6 à 24 mm) et la **Dymo LabelWriter** (11355, 11352, 11354, 30332, 99010, 99012, 99014, S0904980). Un modèle PT-P750W s'imprime en USB directement (l'étiquette du modèle est convertie à 180 dpi, aperçu noir et blanc de ce qui sort), en image PNG ou via le pilote ; un modèle Dymo via le pilote Dymo ou en image PNG pour Dymo Connect. Le ruban de 3,5 mm est reconnu par la machine.
**Code automatique d'un article sérialisé** : un article suivi par n° de série sans code interne reçoit un code logique, comme un nouvel article (dépôt-catégorie-numéro, ex. F-S-0042) ; ses unités sans code prennent ce code suivi de leur numéro #x (#3 → F-S-0042-03). Fait au démarrage, après un import, après une synchronisation et avant d'ajouter la première unité ; les codes existants ne changent jamais.
**Marque, modèle, description courte** : sur la fiche d'un article, la désignation se compose toute seule (« Shure SM58s (Micro dynamique Switch) ») tant qu'elle n'est pas écrite à la main (« Recomposer » pour y revenir) ; « Découper » remplit les trois champs à partir d'une désignation existante (marques en plusieurs mots reconnues). Marques déjà saisies proposées, recherche sur la marque, le modèle et la description, colonnes dans l'export CSV et l'import (désignation composée si le fichier n'en a pas), marque et description dans la modification groupée.
**Kits et quantités** : dans la liste du matériel, le contenu de chaque kit s'affiche sous le kit (repliable, case « Contenu des kits »), avec pour chaque élément la quantité par kit, le stock et la dispo sur la période, et le nombre de kits que cela permet ; le kit affiche le nombre de kits complets, et l'élément qui limite le kit est signalé. Sur la fiche d'un kit : tableau du contenu (par kit, en stock, sortis ou réservés aujourd'hui, disponibles, kits possibles) ; sur la fiche d'un élément : « Inclus dans les kits » avec la quantité par kit.
**Modèles d'étiquettes** (Modèles de documents → onglet Étiquettes) : modèles rangés par format (taille, planche A4 ou rouleau), « + Modèle pour ce format », modèle « Par défaut » proposé d'office sur la page Étiquettes, modèles standard inutiles **masqués** (un par un ou « Masquer ce format », réaffichables) et tes modèles supprimés depuis la liste, aperçu sur un vrai article à l'échelle voulue. Réglages : mise en page **libre** (QR, code-barres ou les deux, à gauche, à droite, au-dessus ou en dessous, taille de 30 à 200 % plafonnée à la place disponible, sans bordure blanche perdue : le QR remplit la place laissée par le texte ; avec le code à gauche ou à droite, chaque information va **à côté du code ou dessous** sur toute la largeur, et le texte d'à côté peut être **tourné** d'un quart de tour, lettres couchées), police, taille générale, alignement horizontal et vertical, marge intérieure, espace code / texte, pour chaque information taille, gras, italique, majuscules, sur une ou plusieurs lignes, préfixe (« S/N : »…), textes libres en haut et en bas, cadre (épaisseur), coins arrondis, logo de la société, « Centrer sur la feuille ».
**Étiquette générale d'un article sérialisé** : en plus des étiquettes de chaque unité, l'étiquette au code de l'article (sans numéro d'unité) pour un bac, une étagère ou un flight case, depuis la page Étiquettes (ligne « étiquette générale ») ou la fiche article.
**Numéro d'unité #x** : chaque unité d'un article sérialisé a un numéro fixe dans son article (#1, #2…), attribué à la création (le plus grand + 1, jamais réutilisé ni décalé si une unité est supprimée), modifiable sur la fiche de l'unité (doublon signalé). Les unités existantes, importées ou reçues d'un autre appareil sont numérotées automatiquement. Le numéro s'affiche sur la fiche article, l'inventaire (pastilles), les kits, la checklist, la maintenance et il est imprimé sur l'étiquette (« Lyre wash #3 »).
**Où est le matériel** (projet, lignes de matériel et « + Matériel ») : pastilles sous la disponibilité, avec les quantités sur la période : autre ligne de ce sous-projet, autre sous-projet de ce projet, en option dans un autre projet (projet pas encore confirmé), réservé dans un autre projet (confirmé ou réservé à la main), réparation ou transfert. Un clic ouvre le détail : stock, cette ligne, chaque catégorie, disponible, puis la liste avec un lien vers chaque projet et le nom du sous-projet.

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

**Emails avec pièces jointes** : un lien « mailto: » ne peut pas joindre de fichier ; FabEvent génère donc un vrai PDF
(hors ligne aussi) et propose, selon l'appareil : le **partage** natif (téléphone, tablette, Mac, Windows) vers Mail, Outlook, Gmail… ;
un **brouillon .eml** prêt à envoyer (Outlook, Apple Mail, Thunderbird) avec destinataire, texte et pièces jointes ; ou le
téléchargement des fichiers puis l'ouverture de la messagerie (Gmail web). Devis et factures en PDF (+ XML Peppol pour les
factures), bons de commande de sous-location et RH en PDF, planning du technicien en `.ics`. Un devis ou une facture envoyé
passe au statut « Envoyé ».

**Entrepôt (Checklist FABRI.live reprise)** : checklist de sortie puis de retour par sous-projet.
- Scan à la douchette ou à la caméra (ZXing intégré, fonctionne sur iPhone et hors ligne). Une unité sérialisée ne compte qu'une fois.
- Article en vrac scanné : « combien ? », le reste par défaut (ou « chaque scan compte 1 »).
- Kit scanné : tout son contenu d'un coup. Hors liste : « ajouter en plus », déjà compté.
- Catégories et kits repliables avec leur compteur (« KIT · 3/5 »), filtres Tout / Restant / Fait, recherche.
- On touche une ligne pour la cocher, − / + pour une partie, pour la fiche.
- Au retour :
  - bandeau « N pas encore rentrés » ;
  - une unité non sortie avec le projet est refusée ;
  - bilan avec cases à cocher : ce qui revient plus tard reste déclarable, rien n'est déclaré deux fois ;
  - pertes avec historique daté.
- Menu : tout replier, tout décocher, imprimer A4 (état actuel ou vierge à remplir).

**Checklists libres** importées d'un bon PDF, Word, HTML (export Rentman) ou de texte collé :
- accueil en cartes avec la progression ;
- mode édition (corriger l'import, kits) ;
- renommer, dupliquer à zéro, exporter, supprimer. **Inventaire** repris de l'Inventaire FABRI.live :
- liste par catégorie avec la progression, vues Tout / À compter / Écarts ;
- comptage d'un article en plusieurs endroits (5 au dépôt + 3 dans le camion), « Conforme », « Corriger le total » ;
- unités à numéro de série en pastilles, avec un scan limité à l'article ;
- kits comptés kit par kit (le kit se valide tout seul quand tout y est) ;
- « chaque scan compte 1 » ou bien le scan ouvre l'article pour taper la quantité ;
- scan « Infos » pour tout voir sans rien compter ;
- écarts appliqués article par article, unités non vues déclarées perdues ou en réparation ;
- nouvel article créé sur place, avec les doublons possibles proposés ;
- mouvements de stock datés et fiche article (« où est cet article ? »).

**Codes du matériel** : chaque nouvel article reçoit un code `F-S-0010` (lettre du dépôt de base, lettre de la catégorie —
S son, V vidéo, L lumière, IT informatique, R rigging, K kit… —, numéro unique jamais réutilisé). Chaque unité à numéro de série
reçoit `F-S-0010-03` (au-delà de 99 unités : 0A, 0B… FF). La lettre est demandée à la création d'un dépôt ; les lettres des
catégories et la génération des codes manquants sont dans Paramètres.

**Synchronisation automatique** entre appareils via `server/sync.php` sur l'hébergement (connexion des pages internes
FABRI.live), hors ligne d'abord, numéros de facture sans doublon : voir [docs/deploiement-fabri.md](docs/deploiement-fabri.md).

**Démo** : Paramètres → « Ouvrir la base de démo » crée une base séparée avec des clients, du matériel, une équipe et 8 projets fictifs (réinitialisable).

**Données** : import CSV (exports Rentman), plusieurs bases, sauvegarde et restauration.

## Feuille de route

1. Serveur de synchronisation : plusieurs appareils, collègues avec droits, agenda en abonnement automatique,
   liens de partage pour sous-traitants, acceptation de devis en ligne.
