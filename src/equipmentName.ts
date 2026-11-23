/*
 * Désignation d'un article : marque + modèle + description courte entre parenthèses,
 * ex. « Shure SM58s (Micro dynamique Switch) ». La désignation reste le nom affiché partout
 * (projets, devis, étiquettes) ; elle est composée automatiquement tant qu'elle n'est pas écrite à la main.
 */

/** « Shure » + « SM58s » + « Micro dynamique Switch » → « Shure SM58s (Micro dynamique Switch) » */
export function composeName(brand?: string, model?: string, summary?: string): string {
  const head = [brand?.trim(), model?.trim()].filter(Boolean).join(' ');
  const s = summary?.trim();
  return head && s ? `${head} (${s})` : head || s || '';
}

/**
 * Découpe une désignation existante : « Shure SM58s (Micro dynamique Switch) » → marque « Shure »,
 * modèle « SM58s », description « Micro dynamique Switch ». Le premier mot est pris comme marque.
 */
/** marques courantes en plusieurs mots (en plus de celles déjà saisies sur d'autres articles) */
const MULTI_WORD_BRANDS = ['Allen & Heath', 'L-Acoustics', 'd&b audiotechnik', 'Electro-Voice', 'Martin Professional', 'Robe Lighting', 'Chauvet Professional', 'Blackmagic Design', 'Audio-Technica', 'Sound Craft', 'Global Truss', 'Prolyte'];

export function splitName(name: string, knownBrands: string[] = []): { brand: string; model: string; summary: string } {
  const m = name.trim().match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  const head = (m ? m[1] : name).trim();
  const summary = m ? m[2].trim() : '';
  // marque connue (la plus longue qui commence la désignation)
  const known = [...knownBrands, ...MULTI_WORD_BRANDS].filter(Boolean).sort((a, b) => b.length - a.length)
    .find((b) => head.toLowerCase().startsWith(b.toLowerCase() + ' '));
  if (known) return { brand: head.slice(0, known.length), model: head.slice(known.length).trim(), summary };
  const sp = head.indexOf(' ');
  return sp < 0 ? { brand: '', model: head, summary } : { brand: head.slice(0, sp), model: head.slice(sp + 1).trim(), summary };
}
