import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { DOC_CSS, DocRender } from '../components/DocRender';
import { Field, PageHead, useSettings } from '../components/ui';
import { db, DEFAULT_DOC_STYLE } from '../db';
import type { Doc, DocStyle, DocTemplates, DocType, DocTypeTemplate } from '../types';
import { DOC_LABELS } from '../types';

const VARIABLES = ['client', 'contact', 'projet', 'numero_projet', 'numero', 'date', 'lieu', 'debut', 'fin', 'total', 'echeance', 'validite', 'societe'];
const TYPES = Object.keys(DOC_LABELS) as DocType[];

const TOGGLES: [keyof DocStyle, string][] = [
  ['showGroups', 'Titres des groupes de matériel'],
  ['showCode', 'Références des articles'],
  ['showFactor', 'Colonne coefficient / jours'],
  ['showDiscount', 'Colonne remise'],
  ['showPeriods', 'Horaires des salles'],
  ['showSubtotals', 'Sous-total par salle'],
  ['hideZero', 'Masquer les lignes à 0 € (accessoires gratuits…)'],
  ['hideEquipmentDetail', 'Devis / factures : un total par salle au lieu du détail du matériel'],
  ['showSignature', 'Cadre « Bon pour accord » sur les devis'],
];

/** Document d'exemple pour l'aperçu quand aucun document de ce type n'existe encore. */
function sampleDoc(type: DocType, company: Doc['snapshot']['company']): Doc {
  const now = new Date().toISOString();
  const line = (name: string, qty: number, unitPrice: number, group: string, code?: string) =>
    ({ name, code, qty, unitPrice, days: 2, factor: 1.5, discount: 0, total: qty * unitPrice * 1.5, group, unit: 'jour' as const });
  const equipment = [line('Enceinte X12', 4, 45, 'Son', 'X12'), line('Câble NL4 15 m', 4, 0, 'Son', 'NL4'), line('Projecteur PAR LED', 12, 8.5, 'Lumière', 'PAR')];
  const subtotal = equipment.reduce((a, l) => a + l.total, 0);
  const hide = type === 'bon_sortie' || type === 'feuille_route';
  return {
    id: 'exemple', createdAt: now, updatedAt: now, projectId: '', type, number: 'X-2026-001', version: 1, status: 'brouillon', contactPerson: 'Julie Martin',
    snapshot: {
      company, client: { id: 'c', createdAt: now, updatedAt: now, type: 'client', company: 'Client exemple SA', address: 'Rue de la Gare 1', postalCode: '5000', city: 'Namur' },
      project: { number: 'P-2026-001', name: 'Projet exemple', venue: 'Salle des fêtes', start: now.slice(0, 16), end: now.slice(0, 16), discount: 0 },
      subprojects: [{
        name: 'Salle 1', start: now.slice(0, 16), end: now.slice(0, 16), equipment,
        periods: [{ name: 'Montage', kind: 'montage', start: now.slice(0, 16), end: now.slice(0, 16) }, { name: 'Prestation J1', kind: 'prestation', start: now.slice(0, 16), end: now.slice(0, 16) }],
        crew: [{ function: 'Technicien son', person: 'Hugo', start: now.slice(0, 16), end: now.slice(0, 16), days: 1, rate: 300, total: 300, billable: true }],
        vehicles: [], subtotal: subtotal + 300,
      }],
      totalHT: subtotal + 300, discountAmount: 0, vatRate: 21, vat: (subtotal + 300) * 0.21, totalTTC: (subtotal + 300) * 1.21,
      issuedAt: now, validUntil: type === 'devis' ? now : undefined, dueDate: type === 'facture' ? now : undefined, hidePrices: hide,
    },
  };
}

export default function Templates() {
  const settings = useSettings();
  const [tpl, setTpl] = useState<DocTemplates | null>(null);
  const [type, setType] = useState<DocType>('devis');
  const [saved, setSaved] = useState('');
  const lastDoc = useLiveQuery(async () => (await db.docs.where('type').equals(type).reverse().sortBy('createdAt'))[0], [type]);

  useEffect(() => {
    db.settings.get('main').then((s) => setTpl({ style: { ...DEFAULT_DOC_STYLE, ...s?.templates?.style }, types: { ...s?.templates?.types } }));
  }, []);
  if (!tpl) return <p>Chargement…</p>;

  const style = tpl.style;
  const cur: DocTypeTemplate = tpl.types[type] || {};
  const setStyle = (patch: Partial<DocStyle>) => setTpl({ ...tpl, style: { ...style, ...patch } });
  const setCur = (patch: Partial<DocTypeTemplate>) => setTpl({ ...tpl, types: { ...tpl.types, [type]: { ...cur, ...patch } } });
  const base = lastDoc || sampleDoc(type, settings.company);
  // aperçu : le document récent (ou l'exemple) avec le modèle en cours d'édition
  const preview: Doc = { ...base, snapshot: { ...base.snapshot, company: lastDoc ? base.snapshot.company : settings.company, template: { style, ...cur } } };

  const saveAll = async () => {
    const s = await db.settings.get('main');
    await db.settings.put({ ...(s || { ...settings }), templates: tpl });
    setSaved('Modèles enregistrés. Ils s\'appliquent aux prochains documents générés.');
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
            <h2>Style commun</h2>
            <div className="form">
              <Field label="Couleur principale"><input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} style={{ height: 36, padding: 2 }} /></Field>
              <Field label="Police">
                <select value={style.font} onChange={(e) => setStyle({ font: e.target.value as DocStyle['font'] })}>
                  <option value="sans">Moderne</option><option value="serif">Classique</option><option value="arrondie">Arrondie</option>
                </select>
              </Field>
              <Field label="Position du logo">
                <select value={style.logoPosition} onChange={(e) => setStyle({ logoPosition: e.target.value as DocStyle['logoPosition'] })}>
                  <option value="gauche">À gauche</option><option value="droite">À droite</option><option value="centre">Centré en haut</option>
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
            <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>Logo, coordonnées et pied de page : Paramètres → Ma société.</p>
          </div>
          <div className="card">
            <h2>Textes par document</h2>
            <div className="tabs">
              {TYPES.map((t) => <button key={t} type="button" className={t === type ? 'on' : ''} onClick={() => setType(t)}>{DOC_LABELS[t]}</button>)}
            </div>
            <div className="form">
              <Field label="Titre du document" full><input value={cur.title || ''} placeholder={DOC_LABELS[type]} onChange={(e) => setCur({ title: e.target.value })} /></Field>
              <Field label="Texte d'introduction (sous l'en-tête)" full>
                <textarea value={cur.intro || ''} onChange={(e) => setCur({ intro: e.target.value })} placeholder={type === 'devis' ? 'Madame, Monsieur,\nSuite à votre demande, nous avons le plaisir de vous proposer notre offre pour {projet} du {debut}.' : ''} />
              </Field>
              <Field label="Texte de fin (avant le pied de page)" full>
                <textarea value={cur.outro || ''} onChange={(e) => setCur({ outro: e.target.value })} placeholder={type === 'facture' ? 'Merci de régler la somme de {total} avant le {echeance}.' : ''} />
              </Field>
            </div>
            <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>Variables : {VARIABLES.map((v) => `{${v}}`).join(' ')}</p>
          </div>
        </div>
        <div>
          <p className="muted" style={{ marginTop: 0 }}>Aperçu {lastDoc ? `sur le dernier ${DOC_LABELS[type].toLowerCase()} (${lastDoc.number})` : 'sur un document d\'exemple'}</p>
          <div className="doc-wrap tpl-preview"><DocRender doc={preview} /></div>
        </div>
      </div>
    </>
  );
}
