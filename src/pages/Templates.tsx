import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { DOC_CSS, DocRender } from '../components/DocRender';
import { Field, PageHead, useSettings } from '../components/ui';
import { db, DEFAULT_DOC_STYLE } from '../db';
import { DEFAULT_HTML, VARIABLE_GROUPS } from '../docTemplate';
import type { Doc, DocHtml, DocStyle, DocTemplates, DocType, DocTypeTemplate } from '../types';
import { DOC_LABELS } from '../types';

const TYPES = Object.keys(DOC_LABELS) as DocType[];
const ZONES: [keyof DocHtml, string, string][] = [
  ['layout', 'Mise en page', "Ordre des blocs sur la page. Déplace, supprime ou entoure les {{bloc.…}} de ton HTML."],
  ['header', 'En-tête', 'Logo, coordonnées, titre, numéro, client.'],
  ['footer', 'Pied de page', 'Mentions légales, coordonnées bancaires…'],
  ['css', 'CSS', 'Styles personnalisés, ex. .doc h2 { text-transform: uppercase; }'],
];
const TOGGLES: [keyof DocStyle, string][] = [
  ['showGroups', 'Titres des groupes de matériel'],
  ['showCode', 'Références des articles'],
  ['showFactor', 'Colonne coefficient / jours'],
  ['showDiscount', 'Colonne remise'],
  ['showPeriods', 'Horaires des salles'],
  ['showSubtotals', 'Sous-total par salle'],
  ['hideZero', 'Masquer les lignes à 0 €'],
  ['hideEquipmentDetail', 'Devis / factures : un total par salle au lieu du détail'],
  ['showSignature', 'Cadre « Bon pour accord » sur les devis'],
];

/** Document d'exemple pour l'aperçu quand aucun document de ce type n'existe encore. */
function sampleDoc(type: DocType, company: Doc['snapshot']['company'], footer: string): Doc {
  const now = new Date().toISOString();
  const d = now.slice(0, 16);
  const line = (name: string, qty: number, unitPrice: number, group: string, code?: string) =>
    ({ name, code, qty, unitPrice, days: 2, factor: 1.5, discount: 0, total: qty * unitPrice * 1.5, group, unit: 'jour' as const });
  const equipment = [line('Enceinte X12', 4, 45, 'Son', 'X12'), line('Câble NL4 15 m', 4, 0, 'Son', 'NL4'), line('Projecteur PAR LED', 12, 8.5, 'Lumière', 'PAR')];
  const ht = equipment.reduce((a, l) => a + l.total, 0) + 300;
  return {
    id: 'exemple', createdAt: now, updatedAt: now, projectId: '', type, number: 'X-2026-001', version: 1, status: 'brouillon', contactPerson: 'Julie Martin',
    snapshot: {
      company, footer, client: { id: 'c', createdAt: now, updatedAt: now, type: 'client', company: 'Client exemple SA', address: 'Rue de la Gare 1', postalCode: '5000', city: 'Namur', vatNumber: 'BE0123456789' },
      project: { number: 'P-2026-001', name: 'Projet exemple', venue: 'Salle des fêtes', start: d, end: d, discount: 0, externalRef: 'BC-123' },
      subprojects: [{
        name: 'Salle 1', start: d, end: d, equipment,
        periods: [{ name: 'Montage', kind: 'montage', start: d, end: d }, { name: 'Prestation J1', kind: 'prestation', start: d, end: d }],
        crew: [{ function: 'Technicien son', person: 'Hugo', start: d, end: d, days: 1, rate: 300, total: 300, billable: true }], vehicles: [], subtotal: ht,
      }],
      totalHT: ht, discountAmount: 0, vatRate: 21, vat: ht * 0.21, totalTTC: ht * 1.21,
      issuedAt: now, validUntil: type === 'devis' ? now : undefined, dueDate: type === 'facture' ? now : undefined, hidePrices: type === 'bon_sortie' || type === 'feuille_route',
    },
  };
}

export default function Templates() {
  const settings = useSettings();
  const [tpl, setTpl] = useState<DocTemplates | null>(null);
  const [type, setType] = useState<DocType>('devis');
  const [zone, setZone] = useState<keyof DocHtml>('layout');
  const [saved, setSaved] = useState('');
  const [filter, setFilter] = useState('');
  /** dernier champ de texte utilisé : c'est là que les variables s'insèrent */
  const target = useRef<{ el: HTMLTextAreaElement | HTMLInputElement; apply: (v: string) => void } | null>(null);
  const lastDoc = useLiveQuery(async () => (await db.docs.where('type').equals(type).reverse().sortBy('createdAt'))[0], [type]);

  useEffect(() => {
    db.settings.get('main').then((s) => setTpl({ style: { ...DEFAULT_DOC_STYLE, ...s?.templates?.style }, html: { ...DEFAULT_HTML, ...s?.templates?.html }, types: { ...s?.templates?.types } }));
  }, []);
  if (!tpl) return <p>Chargement…</p>;

  const style = tpl.style;
  const html = { ...DEFAULT_HTML, ...tpl.html };
  const cur: DocTypeTemplate = tpl.types[type] || {};
  const setStyle = (patch: Partial<DocStyle>) => setTpl({ ...tpl, style: { ...style, ...patch } });
  const setHtml = (patch: Partial<DocHtml>) => setTpl({ ...tpl, html: { ...html, ...patch } });
  const setCur = (patch: Partial<DocTypeTemplate>) => setTpl({ ...tpl, types: { ...tpl.types, [type]: { ...cur, ...patch } } });
  const base = lastDoc || sampleDoc(type, settings.company, settings.footer);
  const preview: Doc = { ...base, snapshot: { ...base.snapshot, company: lastDoc ? base.snapshot.company : settings.company, template: { style, html, ...cur } } };

  /** Mémorise le champ actif et la façon de le mettre à jour. */
  const track = (apply: (v: string) => void) => ({
    onFocus: (e: { currentTarget: HTMLTextAreaElement | HTMLInputElement }) => { target.current = { el: e.currentTarget, apply }; },
  });
  const insert = (key: string) => {
    const t = target.current;
    const token = `{{${key}}}`;
    if (!t) {
      setHtml({ [zone]: html[zone] + token } as Partial<DocHtml>);
      return;
    }
    const { el, apply } = t;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    apply(el.value.slice(0, start) + token + el.value.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const saveAll = async () => {
    const s = await db.settings.get('main');
    await db.settings.put({ ...(s || { ...settings }), templates: tpl });
    setSaved('Enregistré. S\'applique aux prochains documents générés.');
    setTimeout(() => setSaved(''), 3000);
  };

  return (
    <>
      <style>{DOC_CSS}</style>
      <PageHead title="Modèles de documents">
        {saved && <span className="avail ok">{saved}</span>}
        <button onClick={saveAll}>Enregistrer</button>
      </PageHead>
      <div className="tpl-layout">
        <div>
          <div className="card">
            <h2>Style commun (HTML)</h2>
            <div className="tabs">
              {ZONES.map(([k, label]) => <button key={k} type="button" className={zone === k ? 'on' : ''} onClick={() => setZone(k)}>{label}</button>)}
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>{ZONES.find((z) => z[0] === zone)![2]}</p>
            <textarea className="code" spellCheck={false} value={html[zone]}
              onChange={(e) => setHtml({ [zone]: e.target.value } as Partial<DocHtml>)}
              {...track((v) => setHtml({ [zone]: v } as Partial<DocHtml>))} />
            <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
              <button type="button" className="secondary small" onClick={() => setHtml({ [zone]: DEFAULT_HTML[zone] } as Partial<DocHtml>)}>Rétablir par défaut</button>
            </div>
          </div>

          <div className="card">
            <h2>Options d'affichage</h2>
            <div className="form">
              <Field label="Couleur principale (variable CSS --accent)"><input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} style={{ height: 36, padding: 2 }} /></Field>
              <Field label="Police">
                <select value={style.font} onChange={(e) => setStyle({ font: e.target.value as DocStyle['font'] })}>
                  <option value="sans">Moderne</option><option value="serif">Classique</option><option value="arrondie">Arrondie</option>
                </select>
              </Field>
            </div>
            <div style={{ marginTop: 10 }}>
              {TOGGLES.map(([k, label]) => (
                <label key={k} className="check-row" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={!!style[k]} onChange={(e) => setStyle({ [k]: e.target.checked } as Partial<DocStyle>)} /> {label}
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Textes par document</h2>
            <div className="tabs">
              {TYPES.map((t) => <button key={t} type="button" className={t === type ? 'on' : ''} onClick={() => setType(t)}>{DOC_LABELS[t]}</button>)}
            </div>
            <div className="form">
              <Field label="Titre du document ({{document.titre}})" full>
                <input value={cur.title || ''} placeholder={DOC_LABELS[type]} onChange={(e) => setCur({ title: e.target.value })} {...track((v) => setCur({ title: v }))} />
              </Field>
              <Field label="Texte d'introduction ({{bloc.introduction}}) — texte ou HTML" full>
                <textarea value={cur.intro || ''} onChange={(e) => setCur({ intro: e.target.value })} {...track((v) => setCur({ intro: v }))}
                  placeholder={type === 'devis' ? 'Bonjour {{client.contact}},\nVoici notre offre pour {{projet.nom}} du {{projet.debut}}.' : ''} />
              </Field>
              <Field label="Texte de fin ({{bloc.conclusion}}) — texte ou HTML" full>
                <textarea value={cur.outro || ''} onChange={(e) => setCur({ outro: e.target.value })} {...track((v) => setCur({ outro: v }))}
                  placeholder={type === 'facture' ? 'Merci de régler {{total.ttc}} avant le {{document.echeance}}.' : ''} />
              </Field>
            </div>
          </div>
        </div>

        <div className="tpl-side">
          <div className="card vars">
            <h2>Variables</h2>
            <input placeholder="Filtrer…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>Clique pour insérer dans le champ en cours d'édition.</p>
            {VARIABLE_GROUPS.map((g) => {
              const items = g.items.filter(([k, l]) => (k + l).toLowerCase().includes(filter.toLowerCase()));
              if (!items.length) return null;
              return (
                <div key={g.label}>
                  <h3>{g.label}</h3>
                  {items.map(([k, l]) => (
                    <button key={k} type="button" className="var" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k)} title={`{{${k}}}`}>
                      <span>{l}</span><code>{`{{${k}}}`}</code>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div>
            <p className="muted" style={{ margin: '0 0 6px' }}>Aperçu {lastDoc ? `sur le dernier ${DOC_LABELS[type].toLowerCase()} (${lastDoc.number})` : 'sur un exemple'}</p>
            <div className="doc-wrap tpl-preview"><DocRender doc={preview} /></div>
          </div>
        </div>
      </div>
    </>
  );
}
