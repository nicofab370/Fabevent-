/**
 * Modèles de documents : export / import d'un fichier HTML complet (en-tête, mise en page, pied, CSS, options)
 * et fiche à coller dans une IA pour qu'elle modifie le modèle.
 */
import { DOC_CSS } from './components/DocRender';
import { DEFAULT_DOC_STYLE } from './db';
import { VARIABLE_GROUPS, withDefaults } from './docTemplate';
import type { DocHtml, DocStyle, DocTemplates, DocType, DocTypeTemplate } from './types';
import { DOC_LABELS } from './types';

const ZONES: (keyof DocHtml)[] = ['header', 'layout', 'footer'];
const ZONE_HELP: Record<string, string> = {
  header: 'En-tête : logo, coordonnées, titre, client, projet ({{bloc.entete}})',
  layout: 'Mise en page : ordre des blocs, un par ligne',
  footer: 'Pied de page ({{bloc.pied}})',
};

/** Fichier HTML autonome : s'ouvre dans un navigateur (sans les données) et se réimporte tel quel. */
export function exportTemplate(tpl: DocTemplates): string {
  const h = withDefaults(tpl.html);
  const options = { style: tpl.style, types: tpl.types };
  const zone = (k: keyof DocHtml) => `<!-- fabevent:${k} — ${ZONE_HELP[k]} -->\n${h[k]}\n<!-- /fabevent:${k} -->`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Modèle de documents FabEvent</title>
<!-- Modèle de documents FabEvent. Modifie les zones entre <!-- fabevent:… --> et <!-- /fabevent:… -->, le CSS « fabevent-css »
     et les options JSON, puis réimporte ce fichier dans Modèles de documents. Les styles « fabevent-base » sont fournis par FabEvent (non importés). -->
<style id="fabevent-base">${DOC_CSS}</style>
<style id="fabevent-css">
${h.css}
</style>
<script type="application/json" id="fabevent-options">
${JSON.stringify(options, null, 2).replace(/</g, '\\u003c')}
</script>
</head>
<body>
<div class="doc t-${tpl.style.theme || 'moderne'}" style="--accent:${tpl.style.color}">
${ZONES.map(zone).join('\n')}
</div>
</body>
</html>
`;
}

/** Lit un fichier exporté (ou modifié par une IA) ; erreur explicite s'il ne contient rien d'utilisable. */
export function importTemplate(text: string, current: DocTemplates): DocTemplates {
  const html: Partial<DocHtml> = {};
  for (const k of ZONES) {
    const m = new RegExp(`<!--\\s*fabevent:${k}\\b[\\s\\S]*?-->([\\s\\S]*?)<!--\\s*/fabevent:${k}\\s*-->`).exec(text);
    if (m) html[k] = m[1].replace(/^\n/, '').replace(/\n$/, '');
  }
  const css = /<style[^>]*id=["']fabevent-css["'][^>]*>([\s\S]*?)<\/style>/i.exec(text);
  if (css) html.css = css[1].trim();
  let style: Partial<DocStyle> = {};
  let types: Partial<Record<DocType, DocTypeTemplate>> = {};
  const opt = /<script[^>]*id=["']fabevent-options["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
  if (opt) {
    try {
      const o = JSON.parse(opt[1]);
      if (o && typeof o === 'object') {
        if (o.style && typeof o.style === 'object') style = o.style;
        if (o.types && typeof o.types === 'object') types = o.types;
      }
    } catch { throw new Error('Les options (JSON « fabevent-options ») sont illisibles.'); }
  }
  if (!Object.keys(html).length && !opt) throw new Error('Aucune zone FabEvent trouvée : utilise un fichier exporté depuis cette page.');
  if (html.layout !== undefined && !/\{\{\s*bloc\./.test(html.layout)) throw new Error('La mise en page importée ne contient aucun bloc {{bloc.…}}.');
  const cleanStyle = Object.fromEntries(Object.entries(style).filter(([k]) => k in DEFAULT_DOC_STYLE || k === 'theme')) as Partial<DocStyle>;
  return {
    style: { ...current.style, ...cleanStyle },
    html: { ...withDefaults(current.html), ...html },
    types: { ...current.types, ...types },
  };
}

/** Fiche à coller dans une IA : règles, variables, blocs, classes CSS et modèle actuel. */
export function aiBrief(tpl: DocTemplates): string {
  const vars = VARIABLE_GROUPS.map((g) => `### ${g.label}\n${g.items.map(([k, l]) => `- \`{{${k}}}\` : ${l}`).join('\n')}`).join('\n\n');
  return `# Modèle de documents FabEvent (devis, factures, bons de sortie, feuilles de route)

Tu vas modifier le modèle HTML/CSS des documents de FabEvent, un logiciel de location de matériel événementiel.
Réponds avec le fichier HTML complet, dans le même format que celui fourni en bas (mêmes commentaires
\`<!-- fabevent:… -->\`, même \`<style id="fabevent-css">\`, même \`<script id="fabevent-options">\`), pour que je puisse le réimporter.

## Règles
- Le document est rendu dans un \`<div class="doc">\` de 820 px de large, imprimé en A4 et converti en PDF (html2canvas) :
  pas de JavaScript (il est retiré), pas de police externe, pas d'image externe sauf le logo ({{societe.logo}}).
- Les variables \`{{groupe.nom}}\` sont remplacées par les données (texte échappé). Les \`{{bloc.xxx}}\` sont des morceaux
  de HTML générés par FabEvent (tableaux de matériel, totaux…) : on peut les déplacer, les entourer ou les retirer, pas les réécrire.
- Zone « layout » : un élément par ligne. Une ligne \`<!--masque:bloc.xxx-->\` masque un bloc qui serait sinon ajouté automatiquement.
- Un texte libre s'écrit sur une ligne : \`<div class="text free">Texte avec {{variables}}<br>deuxième ligne</div>\`.
- CSS : préfixe toujours les sélecteurs par \`.doc\` (ex. \`.doc h2 { … }\`). La couleur principale est \`var(--accent)\`,
  avec \`var(--accent-soft)\` (teinte très claire), \`var(--accent-line)\` (filets) et \`var(--accent-ink)\` (texte sur la couleur).
- Ne change pas les clés des options JSON ; valeurs possibles : theme "moderne" | "sobre", font "sans" | "serif" | "arrondie",
  color "#rrggbb", et les cases à cocher (true / false). Types de documents : ${Object.entries(DOC_LABELS).map(([k, v]) => `${k} (${v})`).join(', ')}.

## Classes CSS utiles (générées par FabEvent)
- En-tête : .head, .d-co, .d-co-name, .d-title, .d-no, .d-cards, .d-card, .d-lbl, .box (ancien en-tête)
- Sections : section (un sous-projet), h2 (titre de sous-projet), h3 (Horaires, Matériel, Personnel…), tr.grp (titre de groupe de matériel),
  tr.opt (ligne en option), .doc-options (section des options), .subtotal, .totals (tr.grand = total TTC), .pay (paiement + QR),
  .sign (cadres de signature), .terms (conditions), .notes, .doc-contacts, .venue-notes, .deposit, .mention, .text (textes), .foot, .muted
- Thèmes : .doc.t-moderne, .doc.t-sobre ; polices : .doc.f-serif, .doc.f-arrondie

## Variables disponibles
${vars}

### Champs personnalisés
- \`{{champ.cle}}\` : un champ personnalisé du projet (clé définie dans Paramètres)

## Modèle actuel
\`\`\`html
${exportTemplate(tpl).replace(/<style id="fabevent-base">[\s\S]*?<\/style>/, '<style id="fabevent-base">/* styles de base FabEvent : voir les classes ci-dessus */</style>')}
\`\`\`

## Ce que je veux changer
(décris ici ta demande)
`;
}
