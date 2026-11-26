/**
 * Info-bulles automatiques : au survol prolongé d'un bouton, d'une case à cocher ou d'une liste déroulante,
 * le navigateur affiche ce que fait le contrôle (attribut title).
 * Un title écrit dans le composant reste prioritaire ; sinon on le déduit du libellé visible
 * à l'aide du dictionnaire et des règles ci-dessous. Un MutationObserver suit les pages qui changent.
 */

/** libellé visible exact → explication */
const EXACT: Record<string, string> = {
  '+': 'Ajouter un élément',
  '+ Ajouter': 'Ajouter un élément à cette liste',
  '+ Ajouter les postes': 'Créer les postes saisis ci-dessus sur ce créneau',
  '+ Ajouter un sous-projet': 'Ajouter une salle, une scène, une zone ou un jour à ce projet',
  '+ Bon de sortie': 'Créer un bon de sortie (liste du matériel à charger)',
  '+ Champ': 'Ajouter un champ personnalisé (texte, oui/non, nombre, date, liste)',
  '+ Devis': 'Générer un nouveau devis à partir du contenu actuel du projet',
  '+ Dépôt': 'Ajouter un dépôt (entrepôt) où stocker du matériel',
  '+ Facture': 'Générer une facture pour ce projet',
  "+ Facture d'acompte": "Générer une facture d'acompte (pourcentage du total)",
  "+ Facture d'un sous-projet": "Facturer un seul sous-projet ; il sera exclu de la facture finale",
  '+ Feuille de route': "Générer la feuille de route pour les techniciens (horaires, lieu, contacts)",
  '+ Fonction': 'Ajouter une fonction (rigger, régisseur…) avec son tarif',
  '+ Groupe': "Ajouter un groupe pour classer le matériel (son, lumière…)",
  '+ Ligne libre': "Ajouter une ligne qui n'est pas un article du catalogue (texte et prix libres)",
  '+ Matériel': 'Ouvrir le catalogue avec filtres pour ajouter du matériel',
  '+ Moment': 'Ajouter une échéance de facturation',
  '+ Note pour les documents': 'Ajouter une note imprimée sur les documents de ce projet',
  '+ Nouveau contact': 'Créer un client, un fournisseur ou un autre contact',
  '+ Nouveau lieu': 'Créer un lieu (salle, adresse, accès, électricité…)',
  '+ Nouveau modèle': 'Créer un modèle de document',
  '+ Nouveau projet': 'Créer un projet vide',
  '+ Nouveau transfert': "Déplacer du matériel d'un dépôt à un autre",
  '+ Nouveau véhicule': 'Ajouter un véhicule à réserver sur les projets',
  '+ Nouvel article': 'Ajouter un article au catalogue du matériel',
  '+ Nouvelle checklist': 'Créer une checklist libre (sans projet), par exemple à partir d\'un bon collé',
  '+ Nouvelle personne': 'Ajouter un technicien ou un membre du personnel',
  '+ Rendez-vous': 'Ajouter un rendez-vous au planning (repérage, réunion…)',
  '+ Type': 'Ajouter un type de projet',
  '+ Véhicule': 'Réserver un véhicule pour ce projet',
  "+ À partir d'un modèle": 'Créer un projet à partir d\'un modèle enregistré (matériel, postes, horaires)',
  'Activer': 'Activer cette option',
  'Afficher aussi les projets tout facturés': 'Montrer aussi les projets déjà entièrement facturés',
  'Afficher aussi les échéances à venir': 'Montrer aussi les factures qui ne sont pas encore à émettre',
  'Afficher les réparations terminées': 'Montrer aussi les réparations clôturées',
  'Agenda .ics': "Télécharger les horaires au format agenda (Google, Outlook, iPhone)",
  'Ajouter cette liste': 'Créer tous les postes de cette liste préétablie',
  'Ajouter le commentaire': 'Enregistrer ce commentaire sur le lieu',
  'Archivés': 'Montrer aussi les articles archivés (plus utilisés)',
  "Aujourd'hui": "Revenir à la date d'aujourd'hui",
  'Avoir': 'Générer une note de crédit (avoir) qui annule tout ou partie d\'une facture',
  'Bon de commande': 'Générer un bon de commande pour le fournisseur ou le sous-traitant',
  'Bon de sortie': 'Ouvrir le bon de sortie du matériel',
  'Bon de sortie / livraison': 'Ouvrir le bon de sortie / de livraison',
  'CSS': 'Modifier la feuille de style (apparence) du modèle',
  'Calculer': "Calculer la distance et le temps de trajet depuis le dépôt",
  'Caméra': "Scanner un code avec l'appareil photo",
  'Catégorie': 'Choisir la catégorie',
  'Catégories': 'Gérer les catégories et sous-catégories du matériel',
  'Coller du texte': 'Coller une liste (bon, mail…) : les articles sont reconnus automatiquement',
  'Contrôlé': 'Noter le contrôle périodique comme effectué aujourd\'hui',
  'Créer et ouvrir': 'Créer puis ouvrir la fiche',
  'Créneau des postes': 'Choisir le créneau horaire des postes à créer',
  'Demander les dispos': 'Envoyer un lien aux techniciens pour qu\'ils indiquent leurs disponibilités',
  'Documents': 'Documents de la personne (contrat, certificats) et leurs dates de validité',
  'Dupliquer': 'Créer une copie',
  'Dupliquer et modifier': 'Créer une copie modifiable de ce modèle',
  'Décaler le projet…': 'Avancer ou reculer toutes les dates du projet (créneaux et postes suivent)',
  'Dépôt': 'Choisir le dépôt',
  'Endroit': 'Choisir l\'endroit du lieu',
  'Enregistrer': 'Enregistrer les modifications',
  'Enregistrer ces postes comme liste': 'Garder ces postes comme liste préétablie réutilisable',
  'Enregistrer comme modèle': 'Garder ce projet comme modèle pour en créer d\'autres',
  'Exporter': 'Télécharger',
  'Exporter (CSV)': 'Télécharger la liste au format CSV (Excel)',
  'Exporter vers mon agenda (.ics)': 'Télécharger le planning au format agenda (Google, Outlook, iPhone)',
  'Facture': 'Générer une facture',
  "Facture d'acompte": "Générer une facture d'acompte",
  'Facturer': 'Générer la facture de cette échéance',
  'Facturer le solde': 'Générer la facture du montant restant à facturer',
  'Facturé en dehors de FabEvent (ne plus le rappeler)': 'Cocher si la facture a été faite ailleurs : le projet sort de « À facturer »',
  'Feuille de route': 'Générer la feuille de route',
  "Feuille de route / d'appel": "Générer la feuille de route / d'appel des techniciens",
  'Filtrer par dépôt': 'Ne montrer que le matériel de ce dépôt',
  "Format d'étiquette": "Choisir la taille et la mise en page de l'étiquette",
  'Gérer le planning': 'Ouvrir le planning des sous-projets (créneaux, horaires)',
  'Important (alerte sur les projets)': 'Afficher ce commentaire en alerte sur chaque projet dans ce lieu',
  'Importer': 'Importer le fichier choisi',
  'Imprimer aussi les conditions générales sur les factures': 'Ajouter les conditions générales à la fin des factures',
  'Imprimer étiquette(s)': 'Imprimer les étiquettes sélectionnées',
  'Indispos': 'Périodes où la personne n\'est pas disponible',
  'Interlocuteur': 'Choisir la personne de contact chez le client',
  'Inventaire': 'Compter le stock réel et corriger les écarts',
  'Journal des ventes (CSV)': 'Télécharger le journal des ventes pour la comptabilité',
  'Liste de postes préétablie': 'Choisir une liste de postes enregistrée',
  'Mails': 'Modèles de mails',
  'Marquer chargé': 'Noter que ce matériel est chargé dans le véhicule',
  'Marquer préparé': 'Noter que ce matériel est préparé',
  'Masquer annulés': 'Cacher les projets annulés',
  'Masquer le catalogue': 'Fermer le catalogue de matériel',
  'Mention de TVA': 'Choisir la mention de TVA imprimée (normale, autoliquidation, exonération)',
  'Mise en page': "Choisir la mise en page de l'étiquette",
  'Modifier': 'Modifier',
  'Modifier les horaires': 'Changer les heures de ce créneau',
  'Ne plus imprimer': 'Retirer de la liste à imprimer',
  'Nouvelle base pour une autre société…': 'Créer une base séparée (données, comptes et synchro isolés)',
  'Ordre par défaut': 'Remettre les sections dans leur ordre d\'origine',
  'Oui': 'Confirmer',
  'Payé': 'Noter la facture comme payée',
  'Planification finale': 'Les postes deviennent visibles des techniciens (agenda, planning envoyé)',
  'Pour une IA': 'Fiche à donner à une IA pour qu\'elle écrive un modèle HTML + CSS',
  'Projet offert (gratuit)': 'Projet gratuit : les documents sont générés à 0 € avec la mention « offert »',
  'Précédent': 'Période précédente',
  'Suivant': 'Période suivante',
  'Préparer / scanner': 'Ouvrir la checklist de sortie et de retour avec scan',
  'Rappel 1': 'Générer le premier rappel de paiement',
  'Rappel de paiement': 'Générer un rappel pour une facture échue',
  'Retirer': 'Retirer cet élément',
  "Retirer l'alerte": "Ne plus afficher l'alerte",
  'Revenir à ma base principale': 'Quitter cette base et revenir à la base principale',
  'Réinitialiser les données de démo': 'Effacer les changements et recharger les données de démonstration',
  'Répéter…': 'Créer des copies de ce projet à intervalle régulier',
  'Rétablir par défaut': 'Revenir aux réglages d\'origine',
  'Rôle du nouvel utilisateur': 'Admin : tout ; entrepôt : sans les prix ; sous-traitant : son planning seulement',
  'Seulement les sous-projets prêts pour la préparation': 'Cacher les sous-projets qui ne sont pas encore à préparer',
  'Sous-louer': 'Créer une sous-location pour combler le manque',
  'Supprimer': 'Supprimer définitivement (Ctrl+Z ou le bouton Annuler pour revenir en arrière)',
  'Supprimer le commentaire': 'Supprimer ce commentaire',
  'Sur la feuille de route': 'Imprimer cette information sur la feuille de route',
  'Technicien': 'Choisir le technicien',
  'Texte libre': 'Ajouter un bloc de texte libre',
  'Tout': 'Tout sélectionner',
  'Tout cocher (1 par article / unité)': 'Marquer toutes les lignes comme comptées',
  'Tout décocher': 'Remettre toutes les lignes à zéro',
  'Tout sélectionner': 'Sélectionner toutes les lignes visibles',
  'Tout voir': 'Afficher la liste complète',
  'Toutes les factures en PDF': 'Télécharger toutes les factures de la période en un PDF',
  'Télécharger une sauvegarde (.json)': 'Télécharger une copie complète des données (fichiers joints compris)',
  'À compter': 'Montrer seulement ce qui reste à compter',
  'Écarts': 'Montrer seulement les articles dont le compte diffère du stock',
  'Étiquettes': 'Imprimer des étiquettes',
  'Étiquettes QR': 'Imprimer des étiquettes QR pour le matériel',
  'Général': 'Infos du projet : client, lieu, dates, statut',
  'Planning': 'Sous-projets et créneaux horaires',
  'Équipement': 'Matériel réservé pour le projet',
  'Équipe & transport': 'Postes, techniciens et véhicules',
  'Sous-locations & commandes': 'Matériel loué ailleurs et commandes fournisseurs',
  'Coûts supplémentaires': 'Frais (hôtel, location, transport) refacturés ou non',
  'Finances & documents': 'Totaux, marge, devis, factures et autres documents',
  'Registre': 'Historique des modifications du projet',
  'Checklists libres (bons importés)': 'Checklists sans projet : bons collés ou importés en PDF',
  'Devis': 'Ouvrir ou générer le devis',
  'Matériel': 'Matériel',
  'Projets': 'Projets',
};

/** début du libellé → explication (le reste du libellé est repris) */
const PREFIX: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Ajouter (.+)$/, (m) => `Ajouter « ${m[1]} »`],
  [/^Compter (.+)$/, (m) => `Compter une pièce de « ${m[1]} » ici`],
  [/^Monter (.+)$/, (m) => `Placer la section « ${m[1]} » plus haut dans le document`],
  [/^Descendre (.+)$/, (m) => `Placer la section « ${m[1]} » plus bas dans le document`],
  [/^Retirer (.+)$/, (m) => `Retirer « ${m[1]} »`],
  [/^Supprimer (.+)$/, (m) => `Supprimer ${m[1]}`],
  [/^Couleur secondaire (#\w+)$/, (m) => `Deuxième couleur, contrastante, des documents : ${m[1]}`],
  [/^Couleur (#\w+)$/, (m) => `Couleur principale des documents : ${m[1]}`],
  [/^Replier le contenu de (.+)$/, (m) => `Cacher le contenu du kit « ${m[1]} »`],
  [/^Déplier le contenu de (.+)$/, (m) => `Montrer le contenu du kit « ${m[1]} »`],
  [/^Saisie des montants de (.+)$/, (m) => `Choisir si les montants de « ${m[1]} » sont saisis HTVA ou TVA comprise`],
  [/^Sélectionner (.+)$/, (m) => `Sélectionner « ${m[1]} » pour une action groupée`],
  [/^Fermer l'onglet (.+)$/, (m) => `Fermer l'onglet « ${m[1]} »`],
  [/^Indispos \(\d+\)$/, () => "Périodes où la personne n'est pas disponible"],
  [/^Documents \(/, () => 'Documents de la personne (contrat, certificats) et leurs dates de validité'],
  [/^Modèles \(\d+\)$/, () => 'Créer un projet à partir d\'un modèle enregistré'],
  [/^Générer les codes manquants/, () => 'Donner un code F-… aux articles et unités qui n\'en ont pas'],
  [/^Appliquer \d+ écart/, () => 'Corriger le stock avec les quantités comptées'],
  [/^Envoyer le planning/, () => 'Envoyer à chaque technicien ses horaires (un mail chacun ou un mail commun)'],
  [/^\d+\. Postes à prévoir/, () => 'Postes à pourvoir sur ce projet (sans encore choisir les personnes)'],
  [/^\d+\. Attribution des techniciens/, () => 'Choisir qui occupe chaque poste'],
];

/** liste déroulante : explication selon la 1re option ou son étiquette */
const SELECT_FIRST: [RegExp, string][] = [
  [/^Tous statuts/, 'Filtrer la liste par statut'],
  [/^Toutes catégories/, 'Filtrer par catégorie'],
  [/^Toutes étiquettes/, 'Filtrer par étiquette'],
  [/^Tous les types/, 'Filtrer par type de contact'],
  [/^Toutes les fonctions/, 'Filtrer par fonction'],
  [/^Tous les manques/, 'Choisir quels manques afficher'],
  [/^Tout le sous-projet/, 'Limiter à un créneau du sous-projet (sinon tout le sous-projet)'],
  [/^Selon le client \(Français\)/, 'Langue du document'],
  [/^Selon le client \(TVA/, 'Régime de TVA du document'],
  [/^Demande/, 'Statut du projet'],
  [/^Pas de caution/, 'État de la caution'],
  [/^\d+ semaines/, 'Nombre de semaines affichées'],
  [/^Texte/, 'Type du champ personnalisé'],
  [/^À la confirmation/, 'Moment de facturation de cette échéance'],
  [/^Moderne/, 'Thème des documents'],
  [/^Sobre/, 'Thème des documents'],
  [/^Matériel|^Projets|^Contacts/, "Type de données à importer"],
];

const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

function explain(el: HTMLElement): string {
  const aria = norm(el.getAttribute('aria-label'));
  if (el instanceof HTMLSelectElement) {
    const first = norm(el.options[0]?.text);
    for (const [re, t] of SELECT_FIRST) if (re.test(first)) return t;
    const lab = norm(el.closest('label')?.firstChild?.textContent) || norm(el.closest('.field')?.querySelector('label, .field-label')?.textContent);
    if (aria) return EXACT[aria] || `Choisir : ${aria}`;
    return lab ? `Choisir : ${lab}` : 'Choisir une valeur dans la liste';
  }
  if (el instanceof HTMLInputElement) {
    const label = el.closest('label');
    const strong = norm(label?.querySelector('strong')?.textContent), sub = norm(label?.querySelector('.muted')?.textContent);
    if (strong && sub) return `Afficher « ${strong} » : ${sub.charAt(0).toLowerCase()}${sub.slice(1)}`;
    const lab = norm(label?.textContent) || aria;
    if (!lab) return el.closest('tr') ? 'Cocher cette ligne' : '';
    return EXACT[lab] || ruled(lab) || (el.type === 'radio' ? `Choisir « ${lab} »` : `Cocher pour : ${lab.charAt(0).toLowerCase()}${lab.slice(1)}`);
  }
  const text = norm(el.textContent);
  for (const s of [text, aria]) {
    if (!s) continue;
    if (EXACT[s]) return EXACT[s];
    const r = ruled(s);
    if (r) return r;
  }
  // bouton avec un titre et une description (cartes de choix)
  const strong = norm(el.querySelector('strong')?.textContent), sub = norm(el.querySelector('.muted')?.textContent);
  if (strong && sub) return `${strong} : ${sub.charAt(0).toLowerCase()}${sub.slice(1)}`;
  return aria && aria !== text ? aria : '';
}

function ruled(s: string): string {
  for (const [re, f] of PREFIX) { const m = s.match(re); if (m) return f(m); }
  return '';
}

const SEL = 'button, select, input[type=checkbox], input[type=radio], a.btn, [role=tab]';

function apply(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>(SEL)) {
    // un title écrit à la main (sur l'élément ou son étiquette) reste prioritaire
    if (el.title && !el.dataset.autotip) continue;
    if (!el.title && el.closest('label[title]')) continue;
    const t = explain(el);
    if (t && t !== el.title) { el.title = t; el.dataset.autotip = '1'; }
  }
}

let queued = false;
/** à appeler une fois au démarrage */
export function startAutoTooltips() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const run = () => { queued = false; apply(document.body); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  run();
}

