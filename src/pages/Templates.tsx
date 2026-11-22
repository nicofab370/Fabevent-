import { useSearchParams } from 'react-router-dom';
import MailTemplates from './MailTemplates';
import LabelTemplatesTab from './LabelTemplatesTab';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { DOC_CSS, DocRender } from '../components/DocRender';
import { Icon } from '../components/Icon';
import { Field, Modal, PageHead, useSettings } from '../components/ui';
import { aiBrief, exportTemplate, importTemplate } from '../docTemplateIO';
import { download } from '../utils';
import { db, DEFAULT_DOC_STYLE } from '../db';
import { DEFAULT_HTML, VARIABLE_GROUPS, withDefaults } from '../docTemplate';
import type { Doc, DocHtml, DocStyle, DocTemplates, DocType, DocTypeTemplate } from '../types';
import { DOC_LABELS } from '../types';

const TYPES = Object.keys(DOC_LABELS) as DocType[];
const ZONES: [keyof DocHtml, string, string][] = [
  ['layout', 'Mise en page', "Ordre des blocs sur la page (la liste « Blocs du document » écrit ce texte pour toi)."],
  ['header', 'En-tête', 'Logo, coordonnées, titre, numéro, client.'],
  ['footer', 'Pied de page', 'Mentions légales, coordonnées bancaires…'],
  ['css', 'CSS', 'Styles personnalisés, ex. .doc h2 { text-transform: uppercase; }'],
];
const TOGGLES: [keyof DocStyle, string][] = [
  ['showGroups', 'Titres des groupes de matériel'],
  ['showCode', 'Références des articles'],
  ['showFactor', 'Colonne coefficient / jours'],
  ['showDiscount', 'Colonne remise'],
  ['showPeriods', 'Horaires des sous-projets'],
  ['showSubtotals', 'Sous-total par sous-projet'],
  ['hideZero', 'Masquer les lignes à 0 €'],
  ['hideEquipmentDetail', 'Devis / factures : un total par sous-projet au lieu du détail'],
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
        name: 'Sous-projet 1', start: d, end: d, equipment,
        periods: [{ name: 'Montage', kind: 'montage', start: d, end: d }, { name: 'Prestation J1', kind: 'prestation', start: d, end: d }],
        crew: [{ function: 'Technicien son', person: 'Hugo', start: d, end: d, days: 1, rate: 300, total: 300, billable: true }], vehicles: [], subtotal: ht,
      }],
      totalHT: ht, discountAmount: 0, vatRate: 21, vat: ht * 0.21, totalTTC: ht * 1.21,
      issuedAt: now, validUntil: type === 'devis' ? now : undefined, dueDate: type === 'facture' ? now : undefined, hidePrices: type === 'bon_sortie' || type === 'feuille_route',
    },
  };
}

/** Modèles : documents (devis, factures…), mails et étiquettes, en onglets. */
export default function Templates() {
  const [params, setParams] = useSearchParams();
  const o = params.get('onglet');
  const tab = o === 'mails' || o === 'etiquettes' ? o : 'documents';
  return (
    <>
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        <button role="tab" className={tab === 'documents' ? 'on' : ''} onClick={() => setParams({})}>Documents</button>
        <button role="tab" className={tab === 'mails' ? 'on' : ''} onClick={() => setParams({ onglet: 'mails' })}>Mails</button>
        <button role="tab" className={tab === 'etiquettes' ? 'on' : ''} onClick={() => setParams({ onglet: 'etiquettes' })}>Étiquettes</button>
      </div>
      {tab === 'mails' ? <MailTemplates /> : tab === 'etiquettes' ? <LabelTemplatesTab /> : <DocTemplates />}
    </>
  );
}

/* ---------- Blocs de la mise en page ---------- */

/** description des blocs générés, pour la liste */
const BLOCKS: Record<string, { label: string; help: string }> = {
  entete: { label: 'En-tête', help: 'Logo, coordonnées, titre, client, projet' },
  introduction: { label: "Texte d'introduction", help: 'Propre à chaque type de document' },
  notes: { label: 'Notes et contacts', help: 'Notes du projet, infos du lieu, contacts' },
  salles: { label: 'Sous-projets', help: 'Horaires, matériel, personnel, transport' },
  frais: { label: 'Frais supplémentaires', help: 'Coûts refacturés' },
  lignes_simples: { label: 'Lignes acompte / avoir', help: 'Montants simples' },
  options: { label: 'Total des options', help: 'Options proposées, hors total' },
  totaux: { label: 'Totaux', help: 'HT, TVA, TTC, acomptes' },
  mention_tva: { label: 'Mention de TVA', help: 'Masquée ici : placée sous les totaux' },
  caution: { label: 'Caution', help: 'Montant de la caution à verser' },
  conclusion: { label: 'Texte de fin', help: 'Propre à chaque type de document' },
  signature: { label: 'Signature', help: '« Bon pour accord » sur les devis' },
  paiement: { label: 'Paiement', help: 'IBAN, communication, QR code' },
  conditions: { label: 'Conditions générales', help: 'Texte des Paramètres' },
  pied: { label: 'Pied de page', help: 'Mentions légales' },
};

type Item = { kind: 'bloc'; id: string } | { kind: 'texte'; text: string } | { kind: 'html'; html: string };
const FREE_RE = /^<div class="text free">([\s\S]*)<\/div>$/;
const escHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescHtml = (v: string) => v.replace(/<br>/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parseLayout(layout: string): Item[] {
  return layout.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('<!--masque:')).map((l): Item => {
    const b = /^\{\{\s*bloc\.(\w+)\s*\}\}$/.exec(l);
    if (b) return { kind: 'bloc', id: b[1] };
    const f = FREE_RE.exec(l);
    if (f) return { kind: 'texte', text: unescHtml(f[1]) };
    return { kind: 'html', html: l };
  });
}
/** Les blocs masqués sont notés en commentaire : sinon certains seraient replacés automatiquement (conditions, notes…). */
function writeLayout(items: Item[]): string {
  const present = new Set(items.flatMap((it) => (it.kind === 'bloc' ? [it.id] : [])));
  const markers = Object.keys(BLOCKS).filter((k) => k !== 'mention_tva' && !present.has(k)).map((k) => `<!--masque:bloc.${k}-->`);
  return [...items.map((it) => (it.kind === 'bloc' ? `{{bloc.${it.id}}}` : it.kind === 'texte' ? `<div class="text free">${escHtml(it.text).replace(/\n/g, '<br>')}</div>` : it.html.replace(/\n/g, ' '))), ...markers].join('\n');
}

const SWATCHES = ['#1d4ed8', '#0f766e', '#15803d', '#b45309', '#d97706', '#be123c', '#7c3aed', '#334155', '#111111'];

function DocTemplates() {
  const settings = useSettings();
  const [tpl, setTpl] = useState<DocTemplates | null>(null);
  const [type, setType] = useState<DocType>('devis');
  const [zone, setZone] = useState<keyof DocHtml>('header');
  const [saved, setSaved] = useState('');
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | undefined>();
  const [drag, setDrag] = useState<number | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [io, setIo] = useState<null | 'ia' | 'import'>(null);
  /** dernier champ de texte utilisé : c'est là que les variables s'insèrent */
  const target = useRef<{ el: HTMLTextAreaElement | HTMLInputElement; apply: (v: string) => void } | null>(null);
  const lastDoc = useLiveQuery(async () => (await db.docs.where('type').equals(type).reverse().sortBy('createdAt'))[0], [type]);

  useEffect(() => {
    db.settings.get('main').then((s) => {
      const style = { ...DEFAULT_DOC_STYLE, ...s?.templates?.style };
      if (/^#1{6}$/i.test(style.color) && !s?.templates?.style?.theme) style.color = DEFAULT_DOC_STYLE.color; // ancien noir par défaut
      setTpl({ style, html: withDefaults(s?.templates?.html), types: { ...s?.templates?.types } });
    });
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!tpl) return <p>Chargement…</p>;

  const style = tpl.style;
  const html = withDefaults(tpl.html);
  const cur: DocTypeTemplate = tpl.types[type] || {};
  const change = (t: DocTemplates) => { setTpl(t); setDirty(true); };
  const setStyle = (patch: Partial<DocStyle>) => change({ ...tpl, style: { ...style, ...patch } });
  const setHtml = (patch: Partial<DocHtml>) => change({ ...tpl, html: { ...html, ...patch } });
  const setCur = (patch: Partial<DocTypeTemplate>) => change({ ...tpl, types: { ...tpl.types, [type]: { ...cur, ...patch } } });
  const base = lastDoc || sampleDoc(type, settings.company, settings.footer);
  const preview: Doc = { ...base, snapshot: { ...base.snapshot, company: lastDoc ? base.snapshot.company : settings.company, terms: base.snapshot.terms || settings.terms, template: { style, html, ...cur } } };

  const items = parseLayout(html.layout);
  const setItems = (next: Item[]) => setHtml({ layout: writeLayout(next) });
  const present = new Set(items.flatMap((it) => (it.kind === 'bloc' ? [it.id] : [])));
  const hidden = Object.keys(BLOCKS).filter((k) => !present.has(k));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setItems(next);
  };
  const keyOf = (it: Item, i: number) => (it.kind === 'bloc' ? it.id : `${it.kind}-${i}`);

  /** Mémorise le champ actif et la façon de le mettre à jour. */
  const track = (apply: (v: string) => void) => ({
    onFocus: (e: { currentTarget: HTMLTextAreaElement | HTMLInputElement }) => { target.current = { el: e.currentTarget, apply }; },
  });
  const insert = (key: string) => {
    const t = target.current;
    const token = `{{${key}}}`;
    if (!t) { setSaved('Clique d\'abord dans un champ de texte.'); setTimeout(() => setSaved(''), 2500); return; }
    const { el, apply } = t;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    apply(el.value.slice(0, start) + token + el.value.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const saveAll = async () => {
    const s = await db.settings.get('main');
    await db.settings.put({ ...(s || { ...settings }), templates: tpl });
    setDirty(false);
    setSaved('Enregistré. S\'applique aux prochains documents générés.');
    setTimeout(() => setSaved(''), 3000);
  };

  /** zone d'édition propre à un bloc (textes, en-tête, pied) */
  const editorOf = (it: Item, i: number) => {
    if (it.kind === 'texte') return (
      <textarea value={it.text} placeholder="Texte libre, ex. Merci pour votre confiance, {{client.contact}}." rows={3}
        onChange={(e) => setItems(items.map((x, j) => (j === i ? { kind: 'texte', text: e.target.value } : x)))}
        {...track((v) => setItems(items.map((x, j) => (j === i ? { kind: 'texte', text: v } : x))))} />
    );
    if (it.kind === 'html') return (
      <textarea className="code" value={it.html} rows={3}
        onChange={(e) => setItems(items.map((x, j) => (j === i ? { kind: 'html', html: e.target.value } : x)))}
        {...track((v) => setItems(items.map((x, j) => (j === i ? { kind: 'html', html: v } : x))))} />
    );
    switch (it.id) {
      case 'introduction': return (
        <textarea value={cur.intro || ''} rows={4} onChange={(e) => setCur({ intro: e.target.value })} {...track((v) => setCur({ intro: v }))}
          placeholder={type === 'devis' ? 'Bonjour {{client.contact}},\nVoici notre offre pour {{projet.nom}} du {{projet.debut}}.' : `Texte d'introduction du ${DOC_LABELS[type].toLowerCase()}`} />
      );
      case 'conclusion': return (
        <textarea value={cur.outro || ''} rows={3} onChange={(e) => setCur({ outro: e.target.value })} {...track((v) => setCur({ outro: v }))}
          placeholder={type === 'facture' ? 'Merci de régler {{total.ttc}} avant le {{document.echeance}}.' : 'Texte de fin'} />
      );
      case 'entete': case 'pied': {
        const z = it.id === 'entete' ? 'header' : 'footer';
        return (
          <>
            <textarea className="code" value={html[z]} rows={8} spellCheck={false} onChange={(e) => setHtml({ [z]: e.target.value })} {...track((v) => setHtml({ [z]: v }))} />
            <button type="button" className="ghost small" onClick={() => setHtml({ [z]: DEFAULT_HTML[z] })}><Icon name="reset" />Rétablir par défaut</button>
          </>
        );
      }
      case 'signature': return <label className="check-row"><input type="checkbox" checked={!!style.showSignature} onChange={(e) => setStyle({ showSignature: e.target.checked })} /> Cadre « Bon pour accord » sur les devis</label>;
      case 'salles': return (
        <div className="blk-toggles">
          {TOGGLES.filter(([k]) => k !== 'showSignature').map(([k, label]) => (
            <label key={k} className="check-row"><input type="checkbox" checked={!!style[k]} onChange={(e) => setStyle({ [k]: e.target.checked } as Partial<DocStyle>)} /> {label}</label>
          ))}
        </div>
      );
      case 'conditions': return <p className="muted" style={{ margin: 0 }}>Le texte se règle dans Paramètres, « Conditions générales ».</p>;
    }
    return null;
  };
  const editable = (it: Item) => it.kind !== 'bloc' || ['introduction', 'conclusion', 'entete', 'pied', 'signature', 'salles', 'conditions'].includes(it.id);

  return (
    <>
      <style>{DOC_CSS}</style>
      <PageHead title="Modèles de documents">
        {saved ? <span className="avail ok">{saved}</span> : dirty && <span className="muted">Modifications non enregistrées</span>}
        <button type="button" className="secondary" onClick={() => setIo('ia')}><Icon name="chat" />Pour une IA</button>
        <button type="button" className="secondary" onClick={() => download('modele-documents-fabevent.html', exportTemplate(tpl), 'text/html;charset=utf-8')}><Icon name="arrow-down" />Exporter</button>
        <button type="button" className="secondary" onClick={() => setIo('import')}><Icon name="upload" />Importer</button>
        <button onClick={saveAll} disabled={!dirty}><Icon name="check" />Enregistrer</button>
      </PageHead>
      {io === 'ia' && <AiModal text={aiBrief(tpl)} onClose={() => setIo(null)} />}
      {io === 'import' && (
        <ImportModal onClose={() => setIo(null)} onImport={(text) => {
          change(importTemplate(text, tpl));
          setOpen(null);
          setSaved('Modèle importé : vérifie l\'aperçu puis Enregistrer.');
          setTimeout(() => setSaved(''), 5000);
        }} />
      )}

      <div className="tabs tpl-types" role="tablist" aria-label="Type de document">
        {TYPES.map((t) => <button key={t} type="button" role="tab" className={t === type ? 'on' : ''} onClick={() => setType(t)}>{DOC_LABELS[t]}</button>)}
      </div>

      <div className="tpl-layout">
        <div className="tpl-edit">
          <div className="card">
            <h2><Icon name="palette" />Apparence</h2>
            <div className="theme-pick">
              {([['moderne', 'Moderne', 'Couleur, cartes, tableaux colorés'], ['sobre', 'Sobre', 'Noir et blanc, filets fins']] as const).map(([k, label, help]) => (
                <button key={k} type="button" className={'theme-opt' + ((style.theme || 'moderne') === k ? ' on' : '')} onClick={() => setStyle({ theme: k })} aria-pressed={(style.theme || 'moderne') === k}>
                  <span className={`theme-mini t-${k}`} style={{ '--c': style.color } as React.CSSProperties}><i /><i /><i /></span>
                  <strong>{label}</strong><span className="muted">{help}</span>
                </button>
              ))}
            </div>
            <div className="swatches" role="radiogroup" aria-label="Couleur principale">
              {SWATCHES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={style.color.toLowerCase() === c} aria-label={`Couleur ${c}`}
                  className={'swatch' + (style.color.toLowerCase() === c ? ' on' : '')} style={{ background: c }} onClick={() => setStyle({ color: c })} />
              ))}
              <label className="swatch custom" title="Autre couleur" aria-label="Autre couleur">
                <input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} />
                <Icon name="plus" />
              </label>
            </div>
            <Field label="Police">
              <select value={style.font} onChange={(e) => setStyle({ font: e.target.value as DocStyle['font'] })}>
                <option value="sans">Moderne</option><option value="serif">Classique</option><option value="arrondie">Arrondie</option>
              </select>
            </Field>
          </div>

          <div className="card">
            <h2>Blocs du document</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Glisse les blocs pour changer l'ordre, masque ceux dont tu n'as pas besoin, clique sur un bloc (ici ou dans l'aperçu) pour le modifier.
              Textes d'introduction et de fin : propres au {DOC_LABELS[type].toLowerCase()}.
            </p>
            <ol className="blk-list">
              {items.map((it, i) => {
                const k = keyOf(it, i);
                const info = it.kind === 'bloc' ? BLOCKS[it.id] || { label: it.id, help: '' } : it.kind === 'texte' ? { label: 'Texte libre', help: it.text.split('\n')[0].slice(0, 50) || 'vide' } : { label: 'HTML personnalisé', help: it.html.slice(0, 50) };
                const isOpen = open === k;
                return (
                  <li key={k} className={'blk' + (isOpen ? ' open' : '') + (drag === i ? ' dragging' : '') + (hover === (it.kind === 'bloc' ? it.id : '') ? ' hl' : '')}
                    draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDrag(null)}
                    onDragOver={(e) => { e.preventDefault(); if (drag != null && drag !== i) { move(drag, i); setDrag(i); } }}
                    onMouseEnter={() => it.kind === 'bloc' && setHover(it.id)} onMouseLeave={() => setHover(undefined)}>
                    <div className="blk-row">
                      <span className="blk-grip" aria-hidden="true"><Icon name="grip" /></span>
                      <button type="button" className="blk-main" onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen} disabled={!editable(it)}>
                        <strong>{info.label}</strong><span className="muted">{info.help}</span>
                      </button>
                      <button type="button" className="ghost small" aria-label={`Monter ${info.label}`} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="arrow-up" /></button>
                      <button type="button" className="ghost small" aria-label={`Descendre ${info.label}`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}><Icon name="arrow-down" /></button>
                      <button type="button" className="ghost small" aria-label={`${it.kind === 'bloc' ? 'Masquer' : 'Supprimer'} ${info.label}`} title={it.kind === 'bloc' ? 'Masquer ce bloc' : 'Supprimer'}
                        onClick={() => { setItems(items.filter((_, j) => j !== i)); if (isOpen) setOpen(null); }}>
                        <Icon name={it.kind === 'bloc' ? 'eye-off' : 'trash'} />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="blk-edit">
                        {editorOf(it, i)}
                        {(it.kind !== 'bloc' || ['introduction', 'conclusion', 'entete', 'pied'].includes(it.id)) && (
                          <button type="button" className="ghost small" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { setVarsOpen(true); requestAnimationFrame(() => document.getElementById('tpl-vars')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }}>
                            <Icon name="plus" />Insérer une variable
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button type="button" className="secondary small" onClick={() => { const next: Item[] = [...items]; const at = Math.max(0, items.findIndex((x) => x.kind === 'bloc' && x.id === 'totaux') + 1) || items.length; next.splice(at, 0, { kind: 'texte', text: '' }); setItems(next); setOpen(`texte-${at}`); }}>
                <Icon name="plus" />Texte libre
              </button>
              <button type="button" className="ghost small" onClick={() => setHtml({ layout: DEFAULT_HTML.layout })}><Icon name="reset" />Ordre par défaut</button>
            </div>
            {hidden.length > 0 && (
              <div className="blk-hidden">
                <span className="muted">Blocs masqués :</span>
                {hidden.map((k) => (
                  <button key={k} type="button" className="chip" onClick={() => setItems([...items.filter((x) => !(x.kind === 'bloc' && x.id === 'pied')), { kind: 'bloc', id: k }, ...items.filter((x) => x.kind === 'bloc' && x.id === 'pied')])}>
                    <Icon name="eye" />{BLOCKS[k].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2>Titre du {DOC_LABELS[type].toLowerCase()}</h2>
            <input value={cur.title || ''} placeholder={DOC_LABELS[type]} onChange={(e) => setCur({ title: e.target.value })} {...track((v) => setCur({ title: v }))} />
          </div>

          <details className="card vars" id="tpl-vars" open={varsOpen} onToggle={(e) => setVarsOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary><strong>Variables</strong> <span className="muted">— clique pour insérer dans le champ en cours</span></summary>
            <input placeholder="Filtrer…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ margin: '8px 0' }} />
            <div className="vars-grid">
              {VARIABLE_GROUPS.map((g) => {
                const list = g.items.filter(([k, l]) => (k + l).toLowerCase().includes(filter.toLowerCase()));
                if (!list.length) return null;
                return (
                  <div key={g.label}>
                    <h3>{g.label}</h3>
                    {list.map(([k, l]) => (
                      <button key={k} type="button" className="var" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k)} title={`{{${k}}}`}>
                        <span>{l}</span><code>{`{{${k}}}`}</code>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </details>

          <details className="card">
            <summary><strong>Avancé : HTML et CSS</strong></summary>
            <div className="tabs" style={{ marginTop: 10 }}>
              {ZONES.map(([k, label]) => <button key={k} type="button" className={zone === k ? 'on' : ''} onClick={() => setZone(k)}>{label}</button>)}
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>{ZONES.find((z) => z[0] === zone)![2]}</p>
            <textarea className="code" spellCheck={false} value={html[zone]}
              onChange={(e) => setHtml({ [zone]: e.target.value } as Partial<DocHtml>)}
              {...track((v) => setHtml({ [zone]: v } as Partial<DocHtml>))} />
            <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
              <button type="button" className="secondary small" onClick={() => setHtml({ [zone]: DEFAULT_HTML[zone] } as Partial<DocHtml>)}>Rétablir par défaut</button>
            </div>
          </details>
        </div>

        <div className="tpl-side">
          <p className="muted" style={{ margin: '0 0 6px' }}>Aperçu {lastDoc ? `sur le dernier ${DOC_LABELS[type].toLowerCase()} (${lastDoc.number})` : 'sur un exemple'} — clique sur un bloc pour le modifier</p>
          <div className="doc-wrap tpl-preview">
            <DocRender doc={preview} mark highlight={hover}
              onPick={(b) => { const i = items.findIndex((x) => x.kind === 'bloc' && x.id === b); if (i >= 0) { setOpen(b); setHover(b); document.querySelector(`.blk-list > li:nth-child(${i + 1})`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Fiche à coller dans une IA (ChatGPT, Claude…) : variables, blocs, règles et modèle actuel. */
function AiModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('Copié. Colle-le dans ton IA, écris ta demande en bas, puis importe le fichier qu\'elle te renvoie.'); }
    catch { setMsg('Copie impossible ici : sélectionne le texte et copie-le à la main.'); }
  };
  return (
    <Modal title="Modifier les documents avec une IA" onClose={onClose} wide>
      <ol className="muted" style={{ marginTop: 0, paddingLeft: 18, fontSize: 13 }}>
        <li>Copie ce texte et colle-le dans ton IA (il contient toutes les variables, les blocs et ton modèle actuel).</li>
        <li>Écris ta demande à la fin (ex. « en-tête avec bandeau de couleur, logo à droite »).</li>
        <li>Enregistre la réponse en fichier .html (ou copie-la), puis « Importer » ici.</li>
      </ol>
      <textarea className="code ai-brief" readOnly value={text} onFocus={(e) => e.currentTarget.select()} aria-label="Texte pour l'IA" />
      <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
        <button type="button" onClick={copy}><Icon name="copy" />Copier</button>
        <button type="button" className="secondary" onClick={() => download('modele-documents-fabevent-ia.md', text, 'text/markdown;charset=utf-8')}><Icon name="arrow-down" />Télécharger (.md)</button>
        {msg && <span className="avail ok">{msg}</span>}
      </div>
    </Modal>
  );
}

/** Import d'un modèle complet : fichier .html exporté (ou retouché par une IA), ou texte collé. */
function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (text: string) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const apply = (t: string) => {
    try { onImport(t); onClose(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="Importer un modèle de documents" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Fichier .html exporté depuis cette page (ou modifié par une IA). L'en-tête, la mise en page, le pied, le CSS et les options sont remplacés ;
        rien n'est enregistré avant « Enregistrer ». Les documents déjà créés ne changent pas.
      </p>
      <label className="secondary file-btn">
        <Icon name="upload" />Choisir un fichier .html
        <input type="file" accept=".html,.htm,text/html,.txt,.md" onChange={async (e) => { const f = e.target.files?.[0]; if (f) apply(await f.text()); }} />
      </label>
      <p className="muted" style={{ fontSize: 13 }}>ou colle le HTML complet :</p>
      <textarea className="code" value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} placeholder="<!doctype html> … <!-- fabevent:header --> …" style={{ minHeight: 180 }} aria-label="HTML du modèle" />
      {err && <p className="avail ko">{err}</p>}
      <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
        <button type="button" disabled={!text.trim()} onClick={() => apply(text)}>Importer ce texte</button>
        <button type="button" className="ghost" onClick={onClose}>Annuler</button>
      </div>
    </Modal>
  );
}
