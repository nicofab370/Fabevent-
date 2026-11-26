import { useLiveQuery } from 'dexie-react-hooks';
import { unitNo } from '../unitNumbers';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Modal, PageHead, StatusBadge } from '../components/ui';
import { Scanner } from '../components/Scanner';
import { addExtraCode, contentsText, findByCode, setUnitState, unitState, type CodeHit } from '../codes';
import { useAvailability } from '../data';
import { db, nextNumber } from '../db';
import { importFile, rowsFromText, type ImportedList } from '../importList';
import type { Equipment, EquipmentLine, FreeChecklist, FreeLine, Project, SerialUnit, Subproject } from '../types';
import { fmtDate, nowIso, patch, save, uid } from '../utils';
import { RepairModal } from './Maintenance';
import { ItemSheet, beep } from './Inventory';
import { addEquipmentToSub } from './project/EquipmentTab';
import { warehouseStatus } from './project/status';
import { Icon, type IconName } from '../components/Icon';
import { categoryLabel } from '../categories';

/*
 * Checklist de sortie et de retour — reprise de la Checklist FABRI.live (sitefab/checklist), désormais native :
 *  - la même liste se compte deux fois : à la sortie sur le prévu, au retour sur ce qui est sorti ;
 *  - catégories et kits repliables avec leur compteur (« KIT · 3/5 »), filtres Tout / Restant / Fait, recherche ;
 *  - on touche une ligne pour la cocher entièrement, − / + pour une partie ;
 *  - scan (douchette ou caméra) : unités à numéro de série une seule fois, article en vrac → « combien ? »
 *    (le reste par défaut), kit → tout son contenu d'un coup, hors liste → « ajouter en plus » ;
 *  - au retour : bandeau « N pas encore rentrés », unités non sorties refusées, bilan avec cases à cocher,
 *    pertes déclarées une seule fois (historique daté avec le projet) ;
 *  - menu : modifier les lignes (checklist libre), tout replier, tout décocher, imprimer A4 (état ou vierge),
 *    renommer, dupliquer à zéro, exporter, supprimer.
 */

export type Phase = 'sortie' | 'retour';

/** Ligne normalisée, quelle que soit l'origine (sous-projet FabEvent ou checklist libre). */
export interface CLine {
  key: string;
  name: string;
  code?: string;
  equipmentId?: string;
  qty: number;
  out: number;
  back: number;
  outSerials: string[];
  inSerials: string[];
  cat: string;
  parentKey?: string;
  location?: string;
  remark?: string;
  /** contenu fourni à vérifier (chargeur, dock…) */
  contents?: string;
  /** ajouté pendant la sortie (« en plus ») ou à la main */
  extra?: boolean;
}

export interface LineDraft { name: string; qty: number; code?: string; cat: string; parentKey?: string }

export interface ChecklistSource {
  title: string;
  subtitle?: string;
  backTo?: { to: string; label: string };
  projectId?: string;
  /** libellé utilisé dans l'historique des pertes, ex. « Projet P-2026-004 Conférence » */
  label: string;
  phase: Phase;
  setPhase: (p: Phase) => void;
  lines: CLine[];
  /** les lignes enfants forment un kit (bon importé) : le kit lui-même ne se compte pas, son contenu oui */
  kitMode?: boolean;
  /** déjà déclaré perdu (clés « u<unité> » / « b<ligne> ») */
  lostSent: string[];
  addLostSent: (keys: string[]) => Promise<void>;
  setCount: (key: string, phase: Phase, n: number) => Promise<void>;
  setSerials: (key: string, phase: Phase, serials: string[]) => Promise<void>;
  /** article scanné hors liste : on l'ajoute (+n), déjà compté à la sortie */
  addExtra?: (equipmentId: string, n: number, serial?: string) => Promise<void>;
  /** une ligne de plus sur une ligne existante */
  bumpQty: (key: string, n: number) => Promise<void>;
  /** actions en plus dans le menu ⋯ */
  menuExtra?: { label: string; run: () => void; icon?: IconName }[];
  /** checklist libre : modifier les lignes et la liste */
  edit?: {
    update: (key: string, d: LineDraft) => Promise<void>;
    remove: (key: string) => Promise<void>;
    add: (d: LineDraft) => Promise<void>;
    rename: (title: string) => Promise<void>;
    duplicate: () => Promise<void>;
    exportJson: () => void;
    removeList: () => Promise<void>;
  };
}

const target = (l: CLine, ph: Phase) => (ph === 'sortie' ? l.qty : l.out);
const counted = (l: CLine, ph: Phase) => (ph === 'sortie' ? l.out : l.back);
const inPhase = (l: CLine, ph: Phase) => ph === 'sortie' || l.out > 0;
const norm = (s?: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FOLD = 'fab.cl.fold';
const loadFold = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(FOLD) || '{}'); } catch { return {}; } };
type Filter = 'all' | 'todo' | 'done';

interface Flash { ok: boolean; msg: string; actions?: { label: string; run: () => void | Promise<void> }[] }
/** Question posée après un scan (quantité, ajout en plus, kit) : Entrée valide, un nouveau scan l'annule. */
interface Ask { title: string; body?: ReactNode; qty?: { def: number; max?: number }; okLabel: string; onOk: (n: number) => void | Promise<void> }

export function ChecklistView({ src }: { src: ChecklistSource }) {
  const av = useAvailability();
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [infoMode, setInfoMode] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [log, setLog] = useState<Flash[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askQty, setAskQty] = useState('');
  /** choix manuel de l'unité quand on scanne l'étiquette de l'article (plusieurs unités sérialisées) */
  const [pickUnit, setPickUnit] = useState<{ eq: Equipment; units: SerialUnit[] } | null>(null);
  const [assoc, setAssoc] = useState<string | null>(null);
  const [broken, setBroken] = useState<CLine | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [summary, setSummary] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [fold, setFoldState] = useState(loadFold);
  const [editing, setEditing] = useState(false);
  const [lineEdit, setLineEdit] = useState<{ line?: CLine; cat?: string; parentKey?: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [perScan, setPerScan] = useState(() => { try { return localStorage.getItem('fab.cl.perScan') === '1'; } catch { return false; } });
  const inputRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ask) setTimeout(() => { askRef.current?.focus(); askRef.current?.select(); }, 30); }, [ask]);
  const ph = src.phase;
  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));
  const isSerial = (l: CLine) => !!(l.equipmentId && eqMap.get(l.equipmentId)?.trackSerials);
  const kids = new Map<string, CLine[]>();
  if (src.kitMode) for (const l of src.lines) if (l.parentKey) kids.set(l.parentKey, [...(kids.get(l.parentKey) || []), l]);
  const kidsOf = (l: CLine) => (kids.get(l.key) || []).filter((k) => inPhase(k, ph));
  // vrai kit : article isKit avec des lignes de contenu (un simple accessoire ne fait pas un kit) ; en checklist libre, tout parent avec contenu
  const isKit = (l: CLine) => (kids.get(l.key) || []).length > 0 && (!src.projectId || !!(l.equipmentId && eqMap.get(l.equipmentId)?.isKit));
  const leaves = src.lines.filter((l) => !isKit(l) && inPhase(l, ph));
  const lineDone = (l: CLine) => counted(l, ph) >= target(l, ph);
  const stateOf = (l: CLine): 'done' | 'part' | 'none' => {
    if (isKit(l)) { const k = kidsOf(l); if (!k.length) return 'done'; return k.every(lineDone) ? 'done' : k.some((x) => counted(x, ph) > 0) ? 'part' : 'none'; }
    return lineDone(l) && target(l, ph) > 0 ? 'done' : counted(l, ph) > 0 ? 'part' : 'none';
  };
  const doneLines = leaves.filter(lineDone).length;
  const pct = leaves.length ? Math.round((doneLines / leaves.length) * 100) : 0;
  const pieces = leaves.reduce((a, l) => a + target(l, ph), 0);
  const piecesDone = leaves.reduce((a, l) => a + Math.min(counted(l, ph), target(l, ph)), 0);
  const missing = src.lines.filter((l) => !isKit(l) && l.back < l.out);
  const nMissing = missing.reduce((a, l) => a + l.out - l.back, 0);
  const unitLabel = (eqId: string | undefined, serial: string) => { const u = av.units.find((x) => x.equipmentId === eqId && x.serial === serial); return [u && unitNo(u), u?.barcode && u.barcode !== serial ? u.barcode : `n° ${serial}`].filter(Boolean).join(' '); };

  const setFold = (k: string, v: boolean) => setFoldState((f) => { const n = { ...f, [k]: v }; try { localStorage.setItem(FOLD, JSON.stringify(n)); } catch { /* sans stockage */ } return n; });
  const say = (f: Flash) => { setFlash(f); setLog((l) => [f, ...l].slice(0, 6)); beep(f.ok); };
  const verb = ph === 'sortie' ? 'sorti' : 'rentré';
  const setN = (l: CLine, n: number) => src.setCount(l.key, ph, Math.max(0, ph === 'retour' ? Math.min(n, l.out) : n));
  const toggle = async (l: CLine) => {
    if (isKit(l)) { const full = stateOf(l) === 'done'; for (const k of kidsOf(l)) if (!isSerial(k)) await setN(k, full ? 0 : target(k, ph)); return; }
    if (isSerial(l)) { say({ ok: false, msg: `${l.name} : scanne l'étiquette de chaque unité (numéros de série).` }); return; }
    await setN(l, lineDone(l) ? 0 : target(l, ph));
  };

  /** Un scan dans la page (douchette, caméra ou code tapé). */
  const handle = async (raw: string): Promise<boolean> => {
    const c = raw.trim();
    setCode('');
    setAsk(null);
    if (!c) return false;
    const hit: CodeHit | undefined = findByCode(c, av.equipment, av.units);
    if (!hit) {
      say({ ok: false, msg: `Code inconnu : ${c}`, actions: [{ label: 'Associer à un article…', run: () => setAssoc(c) }] });
      return false;
    }
    const { equipment: eq, unit } = hit;
    if (infoMode) { beep(true); setFlash({ ok: true, msg: `Infos : ${eq.name}${unit ? ` ${unitNo(unit)} n° ${unit.serial}` : ''}` }); setSheet(eq.id); return true; }
    const name = eq.name + (unit ? ` ${unitNo(unit)} n° ${unit.serial}`.replace('  ', ' ') : '');
    // unité perdue, en réparation ou à réparer
    if (unit) {
      const st = unitState(unit);
      if (st === 'lost') {
        say({ ok: false, msg: `${name} est déclarée perdue.`, actions: [{ label: 'Retrouvée : la remettre en stock', run: async () => { await setUnitState(unit.id, 'ok', `scannée (${src.label})`, src.projectId); setFlash({ ok: true, msg: 'Remise en stock. Scanne-la à nouveau pour la compter.' }); } }] });
        return false;
      }
      if (st === 'repair' && ph === 'sortie') {
        say({ ok: false, msg: `${name} est en réparation (hors service) : elle ne doit pas partir.` });
        return false;
      }
    }
    const fixNote = unit?.defect ? ` · à réparer : ${unit.defect}` : '';
    const contentNote = eq.contents?.length ? ` · vérifie le contenu : ${contentsText(eq)}` : '';
    const cands = src.lines.filter((l) => l.equipmentId === eq.id && !isKit(l) && inPhase(l, ph));
    // QR d'un kit (ligne qui a du contenu) : valider tout le kit d'un coup
    if (!cands.length) {
      const kit = src.lines.find((l) => l.equipmentId === eq.id && isKit(l));
      if (kit) {
        const rest = kidsOf(kit).filter((k) => !lineDone(k));
        if (!kidsOf(kit).length) { say({ ok: false, msg: `Kit ${eq.name} : rien n'est sorti, rien à rentrer.` }); return false; }
        if (!rest.length) { say({ ok: false, msg: `Kit ${eq.name} : déjà entièrement ${verb}.` }); return false; }
        beep(true);
        setAsk({
          title: `Kit ${eq.name} : marquer comme ${verb} tout son contenu ?`,
          body: <ul className="cl-asklist">{rest.map((k) => <li key={k.key}>{target(k, ph) - counted(k, ph)} × {k.name}</li>)}</ul>,
          okLabel: ph === 'sortie' ? 'Valider la sortie du kit' : 'Valider le retour du kit',
          onOk: async () => { for (const k of rest) await setN(k, target(k, ph)); say({ ok: true, msg: `Kit ${eq.name} : ${verb} (${rest.length} ligne(s))` }); },
        });
        return true;
      }
      if (ph === 'retour') { say({ ok: false, msg: `${name} : pas sorti avec cette liste.` }); return false; }
      if (!src.addExtra) { say({ ok: false, msg: `${eq.name} n'est pas prévu sur cette liste.` }); return false; }
      beep(false);
      setAsk({
        title: `${name} n'est pas prévu sur cette liste. L'ajouter en plus ?`, qty: unit ? undefined : { def: 1 }, okLabel: 'Ajouter en plus',
        onOk: async (n) => { await src.addExtra!(eq.id, n, unit?.serial); say({ ok: true, msg: `Sortie : ${name} ajouté en plus (${n})${fixNote}` }); },
      });
      return false;
    }
    const line = cands.find((l) => !lineDone(l)) || cands[0];
    const serials = ph === 'sortie' ? line.outSerials : line.inSerials;
    const t = target(line, ph), cur = counted(line, ph);
    // étiquette de l'article (pas d'une unité) scannée sur une ligne sérialisée :
    // une seule unité → on la scanne d'office ; plusieurs → choix manuel de l'unité
    if (!unit && isSerial(line)) {
      const units = av.units.filter((u) => u.equipmentId === eq.id && u.status !== 'perdu');
      if (units.length === 1) return await handle(units[0].barcode || units[0].serial);
      if (units.length > 1) { setPickUnit({ eq, units }); return false; }
      say({ ok: false, msg: `${eq.name} : aucune unité sérialisée déclarée (fiche article → « + Unité »).` });
      return false;
    }
    if (unit && isSerial(line)) {
      if (serials.includes(unit.serial)) { say({ ok: false, msg: `${name} est déjà ${verb}, pas compté deux fois.` }); return false; }
      if (ph === 'retour' && line.outSerials.length && !line.outSerials.includes(unit.serial)) {
        say({ ok: false, msg: `${name} n'était pas sorti avec cette liste (sortis : ${line.outSerials.map((s) => unitLabel(eq.id, s)).join(', ')}).` });
        return false;
      }
      if (cur >= t) {
        if (ph === 'retour') { say({ ok: false, msg: `${eq.name} : tout ce qui est sorti est déjà rentré.` }); return false; }
        beep(false);
        setAsk({
          title: `${eq.name} : le nombre d'éléments prévus (${line.qty}) est déjà complet. Êtes-vous sûr d'avoir scanné une seule fois chaque élément ? Si oui, ajouter ${unitLabel(eq.id, unit.serial)} en plus.`, okLabel: 'Oui, ajouter',
          // en plus que prévu : le nombre prévu (t) ne change pas, seuls les sortis augmentent (6/5)
          onOk: async () => { await src.setSerials(line.key, ph, [...serials, unit.serial]); say({ ok: true, msg: `Sortie : ${name} en plus (${cur + 1}/${t})` }); },
        });
        return false;
      }
      await src.setSerials(line.key, ph, [...serials, unit.serial]);
      say({ ok: true, msg: `${ph === 'sortie' ? 'Sortie' : 'Retour'} : ${name} — ${serials.length + 1}/${t}${fixNote}${contentNote}` });
      return true;
    }
    // vrac (ou étiquette de l'article lui-même)
    if (cur >= t) {
      if (ph === 'retour') { say({ ok: false, msg: `${eq.name} : tout ce qui est sorti est déjà rentré (${cur}).` }); return false; }
      beep(false);
      setAsk({
        title: `${eq.name} : le nombre d'éléments prévus (${line.qty}) est déjà complet. Êtes-vous sûr d'avoir scanné une seule fois chaque élément ? Si oui, combien en ajouter ?`, qty: { def: 1 }, okLabel: 'Oui, ajouter',
        onOk: async (n) => { await src.setCount(line.key, ph, cur + n); say({ ok: true, msg: `Sortie : ${eq.name} +${n} en plus (${cur + n}/${t})` }); },
      });
      return false;
    }
    if (perScan || isSerial(line)) {
      await setN(line, cur + 1);
      say({ ok: true, msg: `${ph === 'sortie' ? 'Sortie' : 'Retour'} : ${eq.name} — ${cur + 1}/${t}${contentNote}${isSerial(line) ? ' (étiquette de l\'article : scanne plutôt chaque unité)' : ''}` });
      inputRef.current?.focus();
      return true;
    }
    beep(true);
    setAsk({
      title: `${eq.name} — reste ${t - cur} à ${ph === 'sortie' ? 'sortir' : 'rentrer'}`, qty: { def: t - cur, max: t - cur }, okLabel: ph === 'sortie' ? 'Valider la sortie' : 'Valider le retour',
      onOk: async (n) => { await setN(line, cur + n); say({ ok: true, msg: `${ph === 'sortie' ? 'Sortie' : 'Retour'} : ${eq.name} — ${cur + n}/${t}${contentNote}` }); },
    });
    return true;
  };

  const confirmAsk = async () => {
    if (!ask) return;
    let n = 1;
    if (ask.qty) {
      // un nouveau code scanné dans le champ quantité : on le traite comme un scan
      if (askQty.trim() && !/^\d+$/.test(askQty.trim())) { const c = askQty; setAskQty(''); await handle(c); return; }
      n = parseInt(askQty || String(ask.qty.def), 10);
      if (!(n > 0) || (ask.qty.max && n > ask.qty.max)) { askRef.current?.focus(); return; }
    }
    const a = ask;
    setAsk(null);
    setAskQty('');
    await a.onOk(n);
    inputRef.current?.focus();
  };
  useEffect(() => { if (ask?.qty) setAskQty(String(ask.qty.def)); }, [ask]);

  /* ---------- affichage ---------- */
  const qn = norm(q);
  const match = (l: CLine) => !qn || norm(`${l.name} ${l.code || ''}`).includes(qn);
  const pass = (l: CLine) => inPhase(l, ph) && (filter === 'all' || (filter === 'todo' ? stateOf(l) !== 'done' : stateOf(l) === 'done'));
  const tops = src.kitMode ? src.lines.filter((l) => !l.parentKey || !src.lines.some((p) => p.key === l.parentKey)) : src.lines;
  const cats = Array.from(new Set(tops.map((l) => l.cat)));
  const allFolded = cats.every((c) => fold[`${src.title}|c|${c}`]);

  const lineRow = (l: CLine, kid = false) => {
    const st = stateOf(l), n = counted(l, ph), t = target(l, ph), serial = isSerial(l), kit = isKit(l);
    const outU = ph === 'retour' ? l.outSerials.filter((s) => !l.inSerials.includes(s)) : l.outSerials;
    return (
      <div key={l.key} className={`cl-line ${st}${kid ? ' kid' : ''}${kit ? ' kit' : ''}`} data-line={l.name} role="checkbox" aria-checked={st === 'done'} tabIndex={0}
        onClick={() => (editing && src.edit ? setLineEdit({ line: l }) : toggle(l))} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <button type="button" className="cl-check" aria-label={st === 'done' ? 'Décocher' : 'Tout cocher'} disabled={serial && !editing} tabIndex={-1}>{st === 'done' ? <Icon name="check" /> : st === 'part' ? <Icon name="minus" /> : null}</button>
        <div className="cl-name">
          <div className="cl-title">{kid && <Icon name="corner" className="muted" />}<span className="cl-q">{kit ? l.qty : t}×</span> <strong>{l.name}</strong>
            {kit && <span className="tag small">KIT · {kidsOf(l).filter(lineDone).length}/{kidsOf(l).length}</span>}
            {l.extra && <span className="tag small">en plus</span>}</div>
          {(l.code || l.location || l.remark) && <div className="cl-meta">{l.code}{l.location && <span className="loc"><Icon name="pin" />{l.location}</span>}{l.remark && <span>{(l.code || l.location) ? ' · ' : ''}{l.remark}</span>}</div>}
          {l.contents && <div className="cl-meta cl-contents"><Icon name="corner" />avec : {l.contents}</div>}
          {serial && !kit && (
            <div className="cl-units">
              {outU.map((s) => {
                const u = av.units.find((x) => x.equipmentId === l.equipmentId && x.serial === s);
                return <span key={s} className={'unit-chip ' + (ph === 'retour' ? 'miss' : 'ok')} title={u?.defect ? `À réparer : ${u.defect}` : ''}>{ph === 'retour' ? 'manque ' : ''}{unitLabel(l.equipmentId, s)}{u?.defect && <Icon name="wrench" />}</span>;
              })}
              {ph === 'retour' && l.inSerials.length > 0 && l.inSerials.map((s) => <span key={'b' + s} className="unit-chip ok">{unitLabel(l.equipmentId, s)} <Icon name="check" /></span>)}
              {n < t && <span className="muted cl-hint"><Icon name="camera" />scanne chaque unité</span>}
            </div>
          )}
        </div>
        {!editing && (
          <div className="cl-count" onClick={(e) => e.stopPropagation()}>
            {!kit && !serial && t > 1 && <button type="button" className="ghost" aria-label="Moins" onClick={() => setN(l, n - 1)}>−</button>}
            {!kit && <span className="cl-n" title={serial ? 'Scanne chaque unité' : undefined}>{serial && <Icon name="camera" />}<b>{n}</b>/{t}</span>}
            {!kit && !serial && t > 1 && <button type="button" className="ghost" aria-label="Plus" title="Ajouter un exemplaire sorti" onClick={() => {
              if (n < t || ph === 'retour') return setN(l, n + 1);
              setAsk({ title: `Plus que les ${t} prévus ?`, body: `Le nombre prévu reste à ${t} : seuls les sortis augmentent (${n + 1}/${t}).`, okLabel: 'Ajouter quand même', onOk: () => setN(l, n + 1) });
            }}>+</button>}
            {l.equipmentId && <button type="button" className="ghost small" aria-label={`Infos ${l.name}`} title="Infos (stock, unités, où est-il ?)" onClick={() => setSheet(l.equipmentId!)}><Icon name="info" /></button>}
            {ph === 'retour' && l.equipmentId && !kit && <button type="button" className="secondary small" onClick={() => setBroken(l)}>Cassé</button>}
            {kit && <button type="button" className="ghost small" aria-label="Déplier" aria-expanded={!fold[`${src.title}|k|${l.key}`]} onClick={() => setFold(`${src.title}|k|${l.key}`, !fold[`${src.title}|k|${l.key}`])}><Icon name={fold[`${src.title}|k|${l.key}`] ? 'chevron-right' : 'chevron-down'} /></button>}
          </div>
        )}
      </div>
    );
  };

  const body = cats.map((cat) => {
    const rows: ReactNode[] = [];
    for (const t of tops.filter((l) => l.cat === cat)) {
      if (src.kitMode && isKit(t)) {
        const self = match(t);
        const kv = (kids.get(t.key) || []).filter((x) => pass(x) && (self || match(x)));
        if (ph === 'retour' && !kidsOf(t).length) continue;
        if (!kv.length && !(editing && filter === 'all' && !qn)) continue;
        const open = !fold[`${src.title}|k|${t.key}`] || !!qn;
        rows.push(lineRow(t));
        if (open) rows.push(<div key={t.key + '-kids'} className="cl-kids">{kv.map((x) => lineRow(x, true))}
          {editing && src.edit && <button type="button" className="ghost small cl-addrow" onClick={() => setLineEdit({ cat: t.cat, parentKey: t.key })}>+ Ajouter dans ce kit</button>}</div>);
      } else if (pass(t) && match(t)) {
        rows.push(lineRow(t, !src.kitMode && !!t.parentKey));
        // accessoires (lignes enfants d'un article non-kit) : cochés individuellement sous leur parent
        if (src.kitMode) {
          const kv = (kids.get(t.key) || []).filter((x) => pass(x) && match(x));
          if (kv.length) rows.push(<div key={t.key + '-kids'} className="cl-kids">{kv.map((x) => lineRow(x, true))}</div>);
        }
      }
    }
    if (!rows.length && !(editing && !qn && filter === 'all')) return null;
    const lv = leaves.filter((l) => (src.kitMode && l.parentKey ? src.lines.find((p) => p.key === l.parentKey)?.cat : l.cat) === cat);
    const dn = lv.filter(lineDone).length, fk = `${src.title}|c|${cat}`, open = !fold[fk] || !!qn;
    return (
      <section key={cat} className="card checklist-cat">
        <button type="button" className="cl-chead" aria-expanded={open} onClick={() => setFold(fk, !fold[fk])}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} /><h3>{cat}</h3><span className={'cl-cnt' + (dn === lv.length && lv.length ? ' full' : '')}>{dn}/{lv.length}</span>
        </button>
        {open && rows}
        {open && editing && src.edit && <button type="button" className="ghost small cl-addrow" onClick={() => setLineEdit({ cat })}>+ Ajouter une ligne</button>}
      </section>
    );
  }).filter(Boolean);

  const resetPhase = async () => {
    if (!confirm(ph === 'retour' ? 'Remettre le retour à zéro ? La sortie reste comptée.' : 'Remettre la sortie à zéro ? Le retour sera aussi effacé.')) return;
    for (const l of src.lines) {
      if (ph === 'retour') { if (l.inSerials.length) await src.setSerials(l.key, 'retour', []); if (l.back) await src.setCount(l.key, 'retour', 0); }
      else {
        if (l.inSerials.length) await src.setSerials(l.key, 'retour', []);
        if (l.back) await src.setCount(l.key, 'retour', 0);
        if (l.outSerials.length) await src.setSerials(l.key, 'sortie', []);
        if (l.out) await src.setCount(l.key, 'sortie', 0);
      }
    }
  };

  return (
    <>
      <PageHead title={src.title}>
        {src.backTo && <Link to={src.backTo.to}><button className="secondary"><Icon name="arrow-left" />{src.backTo.label}</button></Link>}
        <button className="secondary" aria-label="Menu de la checklist" onClick={() => setMenu(true)}><Icon name="more" /></button>
      </PageHead>
      {src.subtitle && <div className="info">{src.subtitle}</div>}
      <div className="card checklist-scan">
        <div className="cl-phrow">
          <div className="seg cl-phase" role="group" aria-label="Phase">
            <button type="button" aria-pressed={ph === 'sortie'} onClick={() => { src.setPhase('sortie'); setFlash(null); setAsk(null); setFilter('all'); }}><Icon name="arrow-up" />Sortie</button>
            <button type="button" aria-pressed={ph === 'retour'} onClick={() => { src.setPhase('retour'); setFlash(null); setAsk(null); setFilter('all'); }}><Icon name="arrow-down" />Retour</button>
          </div>
          <button type="button" className={infoMode ? '' : 'secondary'} aria-pressed={infoMode} title="Scanner un code pour voir sa fiche, sans rien compter" onClick={() => { setInfoMode(!infoMode); inputRef.current?.focus(); }}><Icon name="info" />Infos</button>
        </div>
        <div className="toolbar">
          <input ref={inputRef} className="scan-input" autoFocus placeholder={infoMode ? 'Infos : scanne un code pour voir sa fiche…' : `Scanner (${ph === 'sortie' ? 'sortie' : 'retour'}) à la douchette ou taper un code…`} value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handle(code)} enterKeyHint="go" style={{ maxWidth: 'none', flex: 1 }} />
          <button className="secondary" onClick={() => setCamera(!camera)}>{camera ? 'Fermer la caméra' : <><Icon name="camera" />Caméra</>}</button>
        </div>
        <label className="check-row cl-perscan"><input type="checkbox" checked={perScan} onChange={(e) => { setPerScan(e.target.checked); try { localStorage.setItem('fab.cl.perScan', e.target.checked ? '1' : '0'); } catch { /* sans stockage */ } }} />
          Chaque scan compte 1 (sinon le scan d'un article en vrac demande combien, le reste par défaut)</label>
        {camera && <Scanner onCode={handle} onClose={() => setCamera(false)} />}
        {pickUnit && (
          <div className="cl-ask">
            <b>{pickUnit.eq.name} : quelle unité a été scannée ?</b>
            <div className="cl-asklist">
              {pickUnit.units.map((u) => (
                <button key={u.id} type="button" className="secondary" style={{ display: 'block', width: '100%', marginBottom: 6, textAlign: 'left' }}
                  onClick={async () => { setPickUnit(null); await handle(u.barcode || u.serial); }}>
                  {unitNo(u)} · n° {u.serial}{u.barcode !== u.serial ? ` · ${u.barcode}` : ''}
                  {u.status !== 'ok' && <span className="badge st-annule" style={{ marginLeft: 6 }}>{u.status === 'hs' ? 'hors service' : u.status}</span>}
                </button>
              ))}
            </div>
            <div className="toolbar"><button type="button" className="secondary" onClick={() => { setPickUnit(null); inputRef.current?.focus(); }}>Annuler</button></div>
          </div>
        )}
        {ask && (
          <form className="cl-ask" onSubmit={(e) => { e.preventDefault(); confirmAsk(); }}>
            <b>{ask.title}</b>
            {ask.body}
            {ask.qty && <label className="check-row">Quantité <input ref={askRef} className="cl-askq" inputMode="numeric" value={askQty} onChange={(e) => setAskQty(e.target.value)} aria-label="Quantité" /></label>}
            <div className="toolbar">
              <button type="button" className="secondary" onClick={() => { setAsk(null); inputRef.current?.focus(); }}>Annuler</button>
              <button type="submit" ref={ask.qty ? undefined : (b) => b?.focus()}>{ask.okLabel}</button>
            </div>
          </form>
        )}
        {flash && !ask && (
          <div className={'flash ' + (flash.ok ? 'ok' : 'ko')}>
            {flash.msg}
            {flash.actions?.map((a) => <button key={a.label} className="small" style={{ marginLeft: 10 }} onClick={() => a.run()}>{a.label}</button>)}
          </div>
        )}
        {log.length > 1 && <div className="cl-log">{log.slice(1, 5).map((f, i) => <div key={i} className={f.ok ? 'ok' : 'ko'}>{f.msg}</div>)}</div>}
        <div className="cl-prog"><span><b>{doneLines}</b> / {leaves.length} lignes {ph === 'sortie' ? 'sorties' : 'rentrées'} · {piecesDone}/{pieces} pièces</span><span className="muted">{pct} %</span></div>
        <div className={'inv-bar' + (pct === 100 ? ' full' : '')}><i style={{ width: `${pct}%` }} /></div>
        <div className="toolbar cl-filters">
          <input type="search" placeholder="Rechercher (nom ou code)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher dans la liste" />
          <div className="seg" role="group" aria-label="Filtre">
            {([['all', 'Toutes'], ['todo', 'Restant'], ['done', 'Fait']] as [Filter, string][]).map(([v, l]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>)}
          </div>
        </div>
      </div>

      {ph === 'retour' && !editing && (
        <div className={'cl-banner' + (nMissing ? '' : ' ok')}>
          <span>{nMissing ? <>Retour : <b>{nMissing}</b> élément(s) pas encore rentré(s){src.lostSent.length ? ' · pertes déjà déclarées' : ''}</> : 'Retour : tout ce qui est sorti est rentré.'}</span>
          <button className="small" onClick={() => setSummary(true)}>Bilan du retour</button>
        </div>
      )}
      {editing && (
        <div className="cl-banner"><span>Mode édition : touche une ligne pour la modifier ou la supprimer.</span><button className="small" onClick={() => setEditing(false)}>Terminer</button></div>
      )}

      {body.length === 0 ? (
        <div className="card"><Empty>{qn ? 'Aucun résultat.' : ph === 'retour' && !src.lines.some((l) => l.out > 0) ? 'Rien n\'est encore sorti : fais d\'abord la sortie, le retour se compte sur ce qui est sorti.' : filter === 'todo' ? (ph === 'retour' ? 'Tout est rentré.' : 'Tout est sorti.') : 'Aucun matériel sur cette liste.'}</Empty></div>
      ) : body}
      {editing && src.edit && <button className="secondary" onClick={() => { const c = prompt('Nom de la nouvelle catégorie :')?.trim(); if (c) setLineEdit({ cat: c }); }}>+ Nouvelle catégorie…</button>}

      {menu && (
        <Modal title={src.title} onClose={() => setMenu(false)}>
          <div className="cl-menu">
            {src.edit && <button className="secondary" onClick={() => { setEditing(!editing); setMenu(false); }}>{editing ? 'Quitter le mode édition' : <><Icon name="edit" />Modifier les lignes (corriger l'import)</>}</button>}
            <button className="secondary" onClick={() => { const v = !allFolded; const n = { ...fold }; for (const c of cats) n[`${src.title}|c|${c}`] = v; for (const l of src.lines) if (isKit(l)) n[`${src.title}|k|${l.key}`] = v; setFoldState(n); try { localStorage.setItem(FOLD, JSON.stringify(n)); } catch { /* */ } setMenu(false); }}>{allFolded ? 'Tout déplier' : 'Tout replier'}</button>
            {src.menuExtra?.map((m) => <button key={m.label} className="secondary" onClick={() => { setMenu(false); m.run(); }}>{m.icon && <Icon name={m.icon} />}{m.label}</button>)}
            <button className="secondary" onClick={async () => { setMenu(false); await resetPhase(); }}><Icon name="reset" />Tout décocher ({ph})</button>
            <button className="secondary" onClick={() => { setMenu(false); printSheet(src, false, isKit); }}><Icon name="printer" />Imprimer / PDF (A4) avec l'état actuel</button>
            <button className="secondary" onClick={() => { setMenu(false); printSheet(src, true, isKit); }}><Icon name="printer" />Imprimer vierge (à remplir à la main)</button>
            {src.edit && <>
              <button className="secondary" onClick={async () => { const n = prompt('Titre de la checklist', src.title)?.trim(); if (n) await src.edit!.rename(n); setMenu(false); }}>Renommer</button>
              <button className="secondary" onClick={async () => { setMenu(false); await src.edit!.duplicate(); }}>Dupliquer (nouvelle préparation à zéro)</button>
              <button className="secondary" onClick={() => { src.edit!.exportJson(); setMenu(false); }}>Exporter (.json)</button>
              <button className="danger" onClick={async () => { if (confirm(`Supprimer « ${src.title} » ?`)) { setMenu(false); await src.edit!.removeList(); } }}>Supprimer cette checklist</button>
            </>}
          </div>
        </Modal>
      )}
      {lineEdit && src.edit && <LineEditModal edit={src.edit} line={lineEdit.line} cat={lineEdit.cat} parentKey={lineEdit.parentKey} cats={cats}
        kits={src.lines.filter((l) => !l.parentKey)} equipment={av.equipment} onClose={() => setLineEdit(null)} />}
      {summary && <ReturnSummary src={src} units={av.units} equipment={av.equipment} isKit={isKit} onClose={() => setSummary(false)} />}
      {assoc && <AssociateModal code={assoc} equipment={av.equipment} units={av.units} onClose={(ok) => { setAssoc(null); if (ok) setFlash({ ok: true, msg: `Code ${assoc} associé. Scanne-le à nouveau.` }); }} />}
      {broken && <BrokenModal line={broken} src={src} units={av.units} onClose={() => setBroken(null)} />}
      {sheet && <ItemSheet id={sheet} onClose={() => { setSheet(null); inputRef.current?.focus(); }} />}
    </>
  );
}

/** Ajouter ou modifier une ligne (checklist libre). */
function LineEditModal({ edit, line, cat, parentKey, cats, kits, equipment, onClose }: {
  edit: NonNullable<ChecklistSource['edit']>; line?: CLine; cat?: string; parentKey?: string; cats: string[]; kits: CLine[]; equipment: Equipment[]; onClose: () => void;
}) {
  const [name, setName] = useState(line?.name || '');
  const [qty, setQty] = useState(String(line?.qty || 1));
  const [code, setCode] = useState(line?.code || '');
  const [c, setC] = useState(line?.cat || cat || cats[0] || 'Matériel');
  const [parent, setParent] = useState(line?.parentKey || parentKey || '');
  const match = equipment.find((e) => e.name.toLowerCase() === name.trim().toLowerCase() || (e.code && e.code.toLowerCase() === (code || name).trim().toLowerCase()));
  return (
    <Modal title={line ? 'Modifier la ligne' : 'Ajouter une ligne'} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const d: LineDraft = { name: match && !line ? match.name : name.trim(), qty: Math.max(1, parseInt(qty, 10) || 1), code: code.trim() || match?.code, cat: c.trim() || 'Matériel', parentKey: parent || undefined };
        if (!d.name) return;
        if (line) await edit.update(line.key, d); else await edit.add(d);
        onClose();
      }}>
        <Field label="Nom (ou article du catalogue)" full>
          <input autoFocus required list="cl-eq" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="cl-eq">{equipment.filter((e) => !e.archived).map((e) => <option key={e.id} value={e.name}>{e.code}</option>)}</datalist>
          {match && <small className="muted">Reconnu dans le catalogue : se scanne.</small>}
        </Field>
        <Field label="Quantité"><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Catégorie"><input list="cl-cats" value={c} onChange={(e) => setC(e.target.value)} /><datalist id="cl-cats">{cats.map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Dans le kit">
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— aucun (ligne principale) —</option>
            {kits.filter((k) => k.key !== line?.key).map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
          </select>
        </Field>
        <div className="form-actions">
          {line && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm(`Supprimer « ${line.name} » ?`)) { await edit.remove(line.key); onClose(); } }}>Supprimer</button>}
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

/** Feuille A4 : prévu / préparé (ou vierge, à remplir à la main), signatures. */
function printSheet(src: ChecklistSource, blank: boolean, isKit: (l: CLine) => boolean) {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const leaves = src.lines.filter((l) => !isKit(l));
  const plan = leaves.reduce((a, l) => a + l.qty, 0), prep = leaves.reduce((a, l) => a + Math.min(l.out, l.qty), 0);
  const cats = Array.from(new Set(src.lines.filter((l) => !l.parentKey || !src.kitMode).map((l) => l.cat)));
  let body = '';
  for (const c of cats) {
    const top = src.lines.filter((l) => l.cat === c && (!src.kitMode || !l.parentKey));
    body += `<tr class="pc"><td colspan="5">${esc(c)}</td></tr>`;
    const row = (l: CLine, kid: boolean) => {
      const kit = isKit(l), done = kit ? 0 : Math.min(l.out, l.qty);
      return `<tr class="${kid ? 'kid' : ''}"><td class="c"><span class="box ${!blank && !kit && done >= l.qty ? 'on' : ''}"></span></td><td>${esc(l.name)}${kit ? ' <b>KIT</b>' : ''}</td><td class="cd">${esc(l.code || '')}</td><td class="n">${l.qty}</td><td class="n">${blank || kit ? '<span class="fill"></span>' : done}</td></tr>`;
    };
    for (const t of top) { body += row(t, !src.kitMode && !!t.parentKey); if (src.kitMode) for (const k of src.lines.filter((x) => x.parentKey === t.key)) body += row(k, true); }
  }
  const w = window.open('', '_blank');
  if (!w) { alert('Autorise les fenêtres pop-up pour imprimer.'); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(src.title)}</title><style>
    @page{size:A4;margin:12mm}body{font:10pt system-ui,sans-serif;color:#111}h1{font-size:15pt;margin:0 0 4px}.m{color:#444;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:3px 4px;text-align:left}th{font-size:8pt;text-transform:uppercase;color:#555}
    .n{text-align:right;width:52px}.c{width:18px}.cd{font:8pt monospace;color:#555}.pc td{background:#eee;font-weight:700;text-transform:uppercase;font-size:8.5pt}
    .kid td:nth-child(2){padding-left:18px}.box{display:inline-block;width:11px;height:11px;border:1.5px solid #333;border-radius:2px}.box.on{background:#333}
    .fill{display:inline-block;width:34px;border-bottom:1px solid #333;height:10px}.sg{display:flex;gap:20px;margin-top:22px}.sg div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:9pt}
    .f{margin-top:12px;font-size:8pt;color:#777}</style></head><body>
    <h1>${esc(src.title)}</h1><div class="m">${esc(src.subtitle || '')}<br>${blank ? `Prévu : <b>${plan}</b> pièces · ${leaves.length} lignes à préparer` : `Préparé : <b>${prep}</b> / ${plan} pièces`}</div>
    <table><thead><tr><th></th><th>Désignation</th><th>Code</th><th class="n">Prévu</th><th class="n">Préparé</th></tr></thead><tbody>${body}</tbody></table>
    <div class="sg"><div>Préparé par</div><div>Contrôlé par</div><div>Date</div></div>
    <div class="f">Imprimé le ${new Date().toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })} — FabEvent</div></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/**
 * Bilan du retour : ce qui est sorti et pas rentré. On coche ce qui est perdu (on décoche ce qui revient plus tard) :
 * les unités passent « perdues » (historique daté avec le projet), le vrac manquant sort du stock (mouvement daté).
 * Ce qui a déjà été déclaré ne peut pas l'être deux fois.
 */
function ReturnSummary({ src, units, equipment, isKit, onClose }: { src: ChecklistSource; units: SerialUnit[]; equipment: Equipment[]; isKit: (l: CLine) => boolean; onClose: () => void }) {
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const missing = src.lines.filter((l) => !isKit(l) && l.back < l.out);
  type Row = { k: string; l: CLine; unit?: SerialUnit; serial?: string; qty: number };
  const rows: Row[] = [], manual: CLine[] = [];
  for (const l of missing) {
    const serial = !!(l.equipmentId && eqMap.get(l.equipmentId)?.trackSerials);
    if (serial && l.outSerials.length) {
      for (const s of l.outSerials.filter((x) => !l.inSerials.includes(x))) {
        const u = units.find((x) => x.equipmentId === l.equipmentId && x.serial === s);
        rows.push({ k: 'u' + (u?.id || s), l, unit: u, serial: s, qty: 1 });
      }
    } else if (!serial && l.equipmentId) rows.push({ k: 'b' + l.key, l, qty: l.out - l.back });
    else manual.push(l);
  }
  const sent = new Set(src.lostSent);
  const [pick, setPick] = useState<Set<string>>(() => new Set(rows.filter((r) => !sent.has(r.k)).map((r) => r.k)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const picked = rows.filter((r) => pick.has(r.k) && !sent.has(r.k));
  const nb = missing.reduce((a, l) => a + l.out - l.back, 0);
  return (
    <Modal title="Bilan du retour" onClose={onClose} wide>
      {missing.length === 0 ? <p className="avail ok" style={{ fontSize: 16 }}><Icon name="check" />Tout ce qui est sorti est rentré.</p> : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>{nb} élément(s) sortis ne sont pas rentrés. Coche ce qui est <b>perdu</b> (décoche ce qui revient plus tard).</p>
          {rows.length > 0 && (
            <table className="list"><tbody>{rows.map((r) => (
              <tr key={r.k}>
                <td><label className="check-row"><input type="checkbox" disabled={sent.has(r.k)} checked={pick.has(r.k) && !sent.has(r.k)} aria-label={`Perdu : ${r.l.name}${r.serial ? ' ' + r.serial : ''}`}
                  onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(r.k); else n.delete(r.k); setPick(n); }} />
                  <strong>{r.l.name}</strong>{r.serial && <span> n° {r.serial}</span>}{sent.has(r.k) && <span className="muted"> · déjà déclaré perdu</span>}</label></td>
                <td className="n avail ko">−{r.qty}</td><td className="n muted">{r.l.back} / {r.l.out} rentrés</td>
              </tr>
            ))}</tbody></table>
          )}
          {manual.length > 0 && <p className="muted">À vérifier à la main : {manual.map((l) => `${l.out - l.back} × ${l.name}`).join(', ')} (article à numéros de série compté sans scanner les unités, ou ligne hors catalogue).</p>}
          {picked.length > 0 && <div className="info">{picked.some((r) => r.unit) && <>• {picked.filter((r) => r.unit).length} unité(s) passeront « perdues » (plus disponibles pour les projets) ; si tu la retrouves, scanne-la : elle sera proposée à la remise en stock.<br /></>}
            {picked.some((r) => !r.unit) && <>• le stock de {picked.filter((r) => !r.unit).length} article(s) en vrac baissera de la quantité perdue (si tu le retrouves : recompte-le à l'inventaire).</>}</div>}
          {done && <div className="flash ok">{done}</div>}
        </>
      )}
      <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
        <button className="secondary" onClick={onClose}>Fermer</button>
        {rows.length > 0 && (
          <button className="danger" disabled={busy || !picked.length} onClick={async () => {
            if (!confirm(`Déclarer perdu ${picked.length} élément(s) ?`)) return;
            setBusy(true);
            let n = 0;
            const keys: string[] = [];
            for (const r of picked) {
              if (r.unit) { await setUnitState(r.unit.id, 'lost', `au retour — ${src.label}`, src.projectId); n++; }
              else if (r.l.equipmentId) { await stockMove(r.l.equipmentId, -r.qty, `PERDU au retour — ${src.label}`, src.projectId); n += r.qty; }
              else continue;
              keys.push(r.k);
            }
            await src.addLostSent(keys);
            setBusy(false);
            setDone(`${n} article(s) déclaré(s) perdu(s).`);
          }}>Déclarer perdu{picked.length ? ` (${picked.length})` : ''}</button>
        )}
      </div>
    </Modal>
  );
}

/** Mouvement de stock daté (ajout, inventaire, perte…). */
export async function stockMove(equipmentId: string, delta: number, text: string, projectId?: string) {
  const e = await db.equipment.get(equipmentId);
  if (!e || !delta) return;
  await patch(db.equipment, e.id, {
    // élément hors inventaire : pas de stock, on garde seulement la trace
    quantity: e.accessoryOnly ? e.quantity : Math.max(0, e.quantity + delta),
    stockLog: [...(e.stockLog || []), { at: nowIso(), delta, text: `[${new Date().toLocaleDateString('fr-FR')}] ${text}`, projectId }],
  });
}

/** Code inconnu : l'associer à un article (ou à une unité) comme « code en plus ». */
export function AssociateModal({ code, equipment, units, onClose }: { code: string; equipment: Equipment[]; units: SerialUnit[]; onClose: (ok: boolean) => void }) {
  const [q, setQ] = useState('');
  const [eqId, setEqId] = useState('');
  const [unitId, setUnitId] = useState('');
  const list = q.trim().length >= 2 ? equipment.filter((e) => !e.archived && [e.name, e.code].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0, 30) : [];
  const eq = equipment.find((e) => e.id === eqId);
  const eqUnits = eq?.trackSerials ? units.filter((u) => u.equipmentId === eq.id) : [];
  return (
    <Modal title={`Associer le code « ${code} »`} onClose={() => onClose(false)}>
      <p className="muted" style={{ marginTop: 0 }}>Ce code (code-barres du fabricant, ancienne étiquette…) désignera désormais cet article ou cette unité, au scan comme dans l'inventaire.</p>
      {!eq ? (
        <>
          <input autoFocus placeholder="Rechercher l'article (au moins 2 lettres)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pick-list" style={{ marginTop: 8 }}>
            {list.map((e) => <button key={e.id} className="ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setEqId(e.id)}>{e.name} <span className="muted">{e.code}</span></button>)}
            {q.trim().length >= 2 && !list.length && <p className="muted">Aucun article trouvé.</p>}
          </div>
        </>
      ) : (
        <div className="form">
          <Field label="Article" full><strong>{eq.name}</strong> <button className="ghost small" onClick={() => setEqId('')}>changer</button></Field>
          {eqUnits.length > 0 && (
            <Field label="Unité (facultatif)" full>
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">L'article (toutes unités)</option>
                {eqUnits.map((u) => <option key={u.id} value={u.id}>{unitNo(u)} n° {u.serial}</option>)}
              </select>
            </Field>
          )}
          <div className="form-actions">
            <button className="secondary" onClick={() => onClose(false)}>Annuler</button>
            <button onClick={async () => { await addExtraCode({ equipmentId: eq.id, unitId: unitId || undefined }, code); onClose(true); }}>Associer</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Matériel abîmé au retour : unité à réparer (utilisable) ou en réparation (hors service) ; vrac : réparation. */
function BrokenModal({ line, src, units, onClose }: { line: CLine; src: ChecklistSource; units: SerialUnit[]; onClose: () => void }) {
  const lineUnits = units.filter((u) => u.equipmentId === line.equipmentId && (line.outSerials.includes(u.serial) || line.inSerials.includes(u.serial)));
  const [unitId, setUnitId] = useState(lineUnits[0]?.id || '');
  const [usable, setUsable] = useState(true);
  const [note, setNote] = useState('');
  if (!lineUnits.length) return <RepairModal equipmentId={line.equipmentId!} onClose={onClose} />;
  return (
    <Modal title={`Cassé — ${line.name}`} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        await setUnitState(unitId, usable ? 'fix' : 'repair', note.trim() || undefined, src.projectId);
        onClose();
      }}>
        <Field label="Unité" full>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>{lineUnits.map((u) => <option key={u.id} value={u.id}>{unitNo(u)} n° {u.serial}</option>)}</select>
        </Field>
        <Field label="Défaut" full><input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. connecteur XLR qui grésille" /></Field>
        <label className="check-row"><input type="radio" checked={usable} onChange={() => setUsable(true)} /> À réparer, encore utilisable (signalé au prochain scan)</label>
        <label className="check-row"><input type="radio" checked={!usable} onChange={() => setUsable(false)} /> Hors service : en réparation (ne peut plus sortir)</label>
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Enregistrer</button></div>
      </form>
    </Modal>
  );
}

/* ---------- Source : sous-projet FabEvent ---------- */

/** Checklist d'un sous-projet (route /entrepot/:id). */
export function ProjectChecklist() {
  const { id } = useParams();
  const sp = useLiveQuery(() => db.subprojects.get(id!), [id]);
  const project = useLiveQuery(() => (sp ? db.projects.get(sp.projectId) : undefined), [sp?.projectId]);
  const av = useAvailability();
  const categories = useLiveQuery(() => db.categories.toArray(), []) || [];
  const catName = new Map(categories.map((c) => [c.id, categoryLabel(categories, c.id)]));
  const [phase, setPhase] = useState<Phase>(() => (sp && ['en_cours', 'execute'].includes(sp.status) ? 'retour' : 'sortie'));
  if (!sp || !project) return <p>Chargement…</p>;
  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));
  const groupName = new Map((sp.groups || []).map((g) => [g.id, g.name]));
  const raw = av.lines.filter((l) => l.subprojectId === sp.id && !l.optional && l.equipmentId).sort((a, b) => a.order - b.order);
  const toC = (l: EquipmentLine): CLine => {
    const e = eqMap.get(l.equipmentId!);
    const kit = e?.isKit && e.kitItems.length ? ` · contient ${e.kitItems.map((k) => `${k.qty} × ${eqMap.get(k.equipmentId)?.name || '?'}`).join(', ')}` : '';
    return {
      key: l.id, name: l.name, code: e?.code, equipmentId: l.equipmentId, qty: l.qty, out: l.outQty || 0, back: l.inQty || 0,
      outSerials: l.outSerials || [], inSerials: l.inSerials || [], cat: (l.groupId && groupName.get(l.groupId)) || l.group || (e?.categoryId && catName.get(e.categoryId)) || 'Matériel',
      parentKey: l.parentLineId, location: e?.location, contents: contentsText(e) || undefined, remark: [l.internalRemark || l.remark, kit.replace(/^ · /, '')].filter(Boolean).join(' — ') || undefined,
    };
  };
  const after = () => warehouseStatus(sp.id);
  const src: ChecklistSource = {
    kitMode: true,
    title: `${project.name} · ${sp.name}`,
    subtitle: `${project.number} · ${fmtDate(sp.prepStart || sp.start)} → ${fmtDate(sp.returnEnd || sp.end)}${project.venue ? ` · ${project.venue}` : ''}`,
    backTo: { to: '/projets/' + project.id, label: 'Projet' },
    projectId: project.id,
    label: `Projet ${project.number} ${project.name}`,
    phase, setPhase,
    lines: raw.map(toC),
    lostSent: sp.lostSent || [],
    addLostSent: async (keys) => { const f = await db.subprojects.get(sp.id); await patch(db.subprojects, sp.id, { lostSent: [...(f?.lostSent || []), ...keys], missingSent: true }); },
    setCount: async (key, ph, n) => { await patch(db.lines, key, ph === 'sortie' ? { outQty: Math.max(0, n) } : { inQty: Math.max(0, n) }); await after(); },
    setSerials: async (key, ph, serials) => { await patch(db.lines, key, ph === 'sortie' ? { outSerials: serials, outQty: serials.length } : { inSerials: serials, inQty: serials.length }); await after(); },
    addExtra: async (equipmentId, n, serial) => {
      await addEquipmentToSub(sp as Subproject, av.equipment, av.lines.filter((l) => l.subprojectId === sp.id), { [equipmentId]: n });
      // la ligne ajoutée est déjà sortie
      const l = (await db.lines.where({ subprojectId: sp.id }).toArray()).find((x) => x.equipmentId === equipmentId && !x.parentLineId && !x.optional);
      if (l) await patch(db.lines, l.id, { outQty: (l.outQty || 0) + n, outSerials: serial ? [...(l.outSerials || []), serial] : l.outSerials });
      await after();
    },
    bumpQty: async (key, n) => { const l = await db.lines.get(key); if (l) await patch(db.lines, key, { qty: l.qty + n }); },
  };
  return <><div className="no-print" style={{ marginBottom: 6 }}><StatusBadge status={sp.status} /></div><ChecklistView src={src} /></>;
}

/* ---------- Source : checklist libre (bon importé) ---------- */

export function FreeChecklistPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const cl = useLiveQuery(() => db.checklists.get(id!), [id]);
  const av = useAvailability();
  const [toProject, setToProject] = useState(false);
  if (!cl) return <p>Chargement…</p>;
  const setLines = (fn: (ls: FreeLine[]) => FreeLine[]) => db.transaction('rw', db.checklists, async () => {
    const fresh = await db.checklists.get(cl.id);
    if (fresh) await patch(db.checklists, cl.id, { lines: fn(fresh.lines) });
  });
  const updLine = (key: string, c: Partial<FreeLine>) => setLines((ls) => ls.map((l) => (l.id === key ? { ...l, ...c } : l)));
  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));
  const byCode = (code?: string) => (code ? av.equipment.find((e) => e.code && e.code.toLowerCase() === code.toLowerCase()) : undefined);
  const byName = (name: string) => av.equipment.find((e) => e.name.toLowerCase() === name.toLowerCase());
  const src: ChecklistSource = {
    title: cl.title || 'Checklist',
    subtitle: [...Object.entries(cl.meta).map(([k, v]) => `${k} : ${v}`), ...cl.plan.map((p) => `${p.label} ${p.from} → ${p.to}`)].join(' · ') || undefined,
    backTo: { to: '/checklists', label: 'Checklists' },
    label: cl.title,
    kitMode: true,
    menuExtra: [{ icon: 'folder', label: cl.projectId ? 'Ouvrir le projet créé avec cette liste' : 'Créer un projet avec cette liste', run: () => (cl.projectId ? nav('/projets/' + cl.projectId) : setToProject(true)) }],
    phase: cl.phase, setPhase: (p) => patch(db.checklists, cl.id, { phase: p }),
    lines: cl.lines.map((l) => ({
      key: l.id, name: l.name, code: l.code, equipmentId: l.equipmentId, qty: l.qty, out: l.out, back: l.back,
      outSerials: l.outSerials || [], inSerials: l.inSerials || [], cat: l.cat, parentKey: l.parent || undefined,
      location: l.equipmentId ? eqMap.get(l.equipmentId)?.location : undefined,
      contents: l.equipmentId ? contentsText(eqMap.get(l.equipmentId)) || undefined : undefined,
      extra: l.cat === 'Ajouté en plus',
    })),
    lostSent: cl.lostSent || [],
    addLostSent: async (keys) => { const f = await db.checklists.get(cl.id); await patch(db.checklists, cl.id, { lostSent: [...(f?.lostSent || []), ...keys], missingSent: true }); },
    setCount: (key, ph, n) => updLine(key, ph === 'sortie' ? { out: Math.max(0, n) } : { back: Math.max(0, n) }),
    setSerials: (key, ph, serials) => updLine(key, ph === 'sortie' ? { outSerials: serials, out: serials.length } : { inSerials: serials, back: serials.length }),
    addExtra: async (equipmentId, n, serial) => {
      const e = eqMap.get(equipmentId);
      if (e) await setLines((ls) => [...ls, { id: uid(), cat: 'Ajouté en plus', parent: null, qty: n, name: e.name, code: e.code, equipmentId, out: n, back: 0, outSerials: serial ? [serial] : [] }]);
    },
    bumpQty: (key, n) => setLines((ls) => ls.map((l) => (l.id === key ? { ...l, qty: l.qty + n } : l))),
    edit: {
      update: (key, d) => updLine(key, { name: d.name, qty: d.qty, code: d.code, cat: d.cat, parent: d.parentKey || null, equipmentId: (byCode(d.code) || byName(d.name))?.id }),
      remove: (key) => setLines((ls) => ls.filter((l) => l.id !== key && l.parent !== key)),
      add: (d) => setLines((ls) => {
        const line: FreeLine = { id: uid(), cat: d.cat, parent: d.parentKey || null, qty: d.qty, name: d.name, code: d.code, equipmentId: (byCode(d.code) || byName(d.name))?.id, out: 0, back: 0 };
        // à la suite de sa catégorie (ou de son kit)
        let at = -1;
        ls.forEach((l, i) => { if (d.parentKey ? l.id === d.parentKey || l.parent === d.parentKey : l.cat === d.cat) at = i; });
        return at < 0 ? [...ls, line] : [...ls.slice(0, at + 1), line, ...ls.slice(at + 1)];
      }),
      rename: (title) => patch(db.checklists, cl.id, { title }),
      duplicate: async () => {
        const ids = new Map(cl.lines.map((l) => [l.id, uid()]));
        const c = await save(db.checklists, {
          title: `${cl.title} (copie)`, meta: cl.meta, plan: cl.plan, phase: 'sortie',
          lines: cl.lines.map((l) => ({ ...l, id: ids.get(l.id)!, parent: l.parent ? ids.get(l.parent) || null : null, out: 0, back: 0, outSerials: [], inSerials: [] })),
        });
        nav('/checklists/' + c.id);
      },
      exportJson: () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(cl, null, 2)], { type: 'application/json' }));
        a.download = `checklist-${(cl.title || 'liste').replace(/[^\w]+/g, '-').toLowerCase()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
      removeList: async () => { await db.checklists.delete(cl.id); nav('/checklists'); },
    },
  };
  return (
    <>
      {cl.projectId && <div className="info no-print">Projet créé avec cette liste : <Link to={'/projets/' + cl.projectId}>ouvrir le projet</Link>.</div>}
      <ChecklistView src={src} />
      {toProject && <ProjectFromList cl={cl} equipment={av.equipment} onClose={(pid) => { setToProject(false); if (pid) nav('/projets/' + pid); }} />}
    </>
  );
}

/** Dates du bon (« 12-12-2026 10:00 ») → datetime-local. */
function parseBE(s?: string): string | undefined {
  const m = String(s || '').match(/(\d{2})[-/.](\d{2})[-/.](\d{4})(?:\s+(\d{1,2})[:h](\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${(m[4] || '08').padStart(2, '0')}:${m[5] || '00'}` : undefined;
}

/**
 * Crée un projet FabEvent à partir d'une liste de sortie : un sous-projet avec les articles reconnus
 * (les autres lignes sont notées dans le projet), et au choix ce qui est déjà sorti / rentré.
 */
function ProjectFromList({ cl, equipment, onClose }: { cl: FreeChecklist; equipment: Equipment[]; onClose: (projectId?: string) => void }) {
  const clients = useLiveQuery(() => db.contacts.where({ type: 'client' }).toArray(), []) || [];
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const dates = cl.plan.map((p) => [parseBE(p.from), parseBE(p.to)]).filter((x) => x[0]);
  const today = new Date(); today.setHours(8, 0, 0, 0);
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [name, setName] = useState(cl.title || 'Projet');
  const [clientId, setClientId] = useState(() => clients.find((c) => cl.meta.Client && c.company.toLowerCase() === cl.meta.Client.toLowerCase())?.id || '');
  const [start, setStart] = useState(dates.map((x) => x[0]!).sort()[0] || iso(today));
  const [end, setEnd] = useState(dates.map((x) => x[1] || x[0]!).sort().slice(-1)[0] || iso(new Date(today.getTime() + 10 * 3600000)));
  const [keepCounts, setKeepCounts] = useState(true);
  // client du bon reconnu par son nom, une fois les contacts chargés
  useEffect(() => {
    if (clientId || !cl.meta.Client) return;
    const c = clients.find((x) => x.company.toLowerCase() === cl.meta.Client.toLowerCase());
    if (c) setClientId(c.id);
  }, [clients.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const kitIds = new Set(cl.lines.filter((l) => l.equipmentId && eqMap.get(l.equipmentId)?.isKit).map((l) => l.id));
  // le contenu d'un kit du catalogue suit le kit ; les autres lignes reconnues deviennent des lignes du projet
  const known = cl.lines.filter((l) => l.equipmentId && eqMap.has(l.equipmentId) && !(l.parent && kitIds.has(l.parent)));
  const parents = new Set(cl.lines.map((l) => l.parent).filter(Boolean));
  const unknown = cl.lines.filter((l) => !l.equipmentId && !parents.has(l.id));
  return (
    <Modal title="Créer un projet avec cette liste" onClose={() => onClose()}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const number = await nextNumber('P');
        const notes = unknown.length ? `Lignes de la liste « ${cl.title} » hors catalogue :\n${unknown.map((l) => `- ${l.qty} × ${l.name}${l.code ? ` (${l.code})` : ''}`).join('\n')}` : undefined;
        const client = clients.find((c) => c.id === clientId);
        const p = await save(db.projects, {
          number, name: name.trim() || cl.title, status: 'confirme', clientId: clientId || undefined, venue: cl.meta['Lieu de la prestation'] || undefined,
          start, end, notes, vatRegime: client?.vatRegime, discount: client?.discounts?.total || 0,
        } as Project);
        const sp = await save(db.subprojects, { projectId: p.id, name: 'Principal', venue: p.venue, status: p.status, start, end, order: 0 }) as Subproject;
        const qtys: Record<string, number> = {};
        for (const l of known) qtys[l.equipmentId!] = (qtys[l.equipmentId!] || 0) + l.qty;
        await addEquipmentToSub(sp, equipment, [], qtys);
        if (keepCounts) {
          const lines = await db.lines.where({ subprojectId: sp.id }).toArray();
          for (const pl of lines.filter((x) => !x.parentLineId)) {
            const src = known.filter((l) => l.equipmentId === pl.equipmentId);
            const out = src.reduce((a, l) => a + l.out, 0), back = src.reduce((a, l) => a + l.back, 0);
            if (out || back) await patch(db.lines, pl.id, { outQty: out, inQty: back, outSerials: src.flatMap((l) => l.outSerials || []), inSerials: src.flatMap((l) => l.inSerials || []) });
          }
          await warehouseStatus(sp.id);
        }
        await patch(db.checklists, cl.id, { projectId: p.id });
        onClose(p.id);
      }}>
        <Field label="Nom du projet" full><input required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Client" full>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </Field>
        <Field label="Début"><input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Fin"><input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <label className="check-row full"><input type="checkbox" checked={keepCounts} onChange={(e) => setKeepCounts(e.target.checked)} /> Reprendre ce qui est déjà sorti / rentré</label>
        <p className="muted full" style={{ margin: 0 }}>{known.length} ligne(s) du catalogue deviennent le matériel du projet (sous-projet « Principal », prix du catalogue).
          {unknown.length > 0 && ` ${unknown.length} ligne(s) hors catalogue sont notées dans le projet.`}</p>
        <div className="form-actions"><button type="button" className="secondary" onClick={() => onClose()}>Annuler</button><button type="submit">Créer le projet</button></div>
      </form>
    </Modal>
  );
}

/** Transforme un bon importé en checklist libre ; les codes connus sont reliés au catalogue (pour le scan). */
export async function createFreeChecklist(r: ImportedList, equipment: Equipment[]): Promise<FreeChecklist> {
  const byCode = new Map(equipment.filter((e) => e.code).map((e) => [e.code!.toLowerCase(), e]));
  const byName = new Map(equipment.map((e) => [e.name.toLowerCase(), e]));
  return save(db.checklists, {
    title: r.title || 'Checklist', meta: r.meta, plan: r.plan, phase: 'sortie',
    lines: r.lines.map((l) => {
      const e = (l.code && byCode.get(l.code.toLowerCase())) || byName.get(l.name.toLowerCase());
      return { id: l.id, cat: l.cat, parent: l.parent, qty: l.qty, name: l.name, code: l.code, equipmentId: e?.id, out: 0, back: 0 };
    }),
  });
}

/** Progression d'une checklist libre (lignes de contenu, sur la phase en cours). */
function progressOf(c: FreeChecklist) {
  const parents = new Set(c.lines.map((l) => l.parent).filter(Boolean));
  const back = c.phase === 'retour';
  const lv = c.lines.filter((l) => !parents.has(l.id) && (!back || l.out > 0));
  const done = lv.filter((l) => (back ? l.back >= l.out : l.out >= l.qty)).length;
  return { done, total: lv.length, pct: lv.length ? Math.round((done / lv.length) * 100) : 0, back };
}

/** Accueil des checklists libres : cartes avec leur progression, import d'un bon (PDF, Word, HTML, texte) ou texte collé. */
export default function FreeChecklists() {
  const nav = useNavigate();
  const lists = useLiveQuery(() => db.checklists.orderBy('updatedAt').reverse().toArray(), []) || [];
  const av = useAvailability();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const importFiles = async (files: FileList | File[]) => {
    setErr('');
    let last: FreeChecklist | undefined;
    for (const f of Array.from(files)) {
      setBusy(`Lecture de « ${f.name} »…`);
      try { last = await createFreeChecklist(await importFile(f), av.equipment); } catch (e) { setErr((e as Error).message); }
    }
    setBusy('');
    if (last && files.length === 1) nav('/checklists/' + last.id);
  };
  const withP = lists.map((c) => ({ c, p: progressOf(c) }));
  // terminée = tout est rentré au retour
  const active = withP.filter((x) => !(x.p.back && x.p.pct === 100 && x.c.lines.length));
  const finished = withP.filter((x) => !active.includes(x));
  const card = ({ c, p }: (typeof withP)[number]) => (
    <Link key={c.id} to={'/checklists/' + c.id} className="cl-card">
      <h3>{c.title}</h3>
      <div className="muted cl-card-sub">{[c.meta.Client, c.meta['Lieu de la prestation']].filter(Boolean).join(' · ') || Object.values(c.meta).slice(0, 2).join(' · ') || '\u00a0'}</div>
      <div className={'inv-bar' + (p.pct === 100 ? ' full' : '')}><i style={{ width: `${p.pct}%` }} /></div>
      <div className="cl-card-foot"><span>{p.done}/{p.total} lignes {p.back ? 'rentrées' : 'sorties'} · {p.pct} %</span><span>{fmtDate(c.updatedAt)}</span></div>
    </Link>
  );
  return (
    <>
      <PageHead title="Checklists libres">
        <button className="secondary" onClick={() => setPaste(true)}>Coller du texte</button>
        <button onClick={async () => { const c = await save(db.checklists, { title: 'Nouvelle checklist', meta: {}, plan: [], lines: [], phase: 'sortie' }); nav('/checklists/' + c.id); }}>+ Nouvelle checklist</button>
      </PageHead>
      <div className="info">
        Pour les jobs hors FabEvent : importe un bon de préparation (PDF, Word .docx, export HTML/.doc de Rentman, .txt) et il devient une liste à cocher
        à la sortie et au retour. Les articles reconnus par leur code se scannent comme dans un projet. Les projets FabEvent ont leur checklist dans <Link to="/entrepot">Entrepôt</Link>.
      </div>
      <label className={'drop' + (over ? ' on' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); importFiles(e.dataTransfer.files); }}>
        <b>Glisse un ou plusieurs bons ici</b>
        <span className="muted">PDF, Word (.docx), export HTML/.doc de Rentman, .txt — ou clique pour choisir</span>
        <input type="file" multiple accept=".pdf,.docx,.doc,.html,.htm,.txt" style={{ display: 'none' }} onChange={(e) => e.target.files && importFiles(e.target.files)} />
      </label>
      {busy && <p className="muted">{busy}</p>}
      {err && <div className="flash ko">{err}</div>}
      {lists.length === 0 ? <div className="card"><Empty>Aucune checklist pour l'instant.</Empty></div> : (
        <>
          <p className="muted">{active.length} en cours{finished.length ? ` · ${finished.length} terminée(s)` : ''}</p>
          {active.length > 0 && <div className="cl-cards">{active.map(card)}</div>}
          {finished.length > 0 && <><h3 className="cl-sect">Terminées</h3><div className="cl-cards">{finished.map(card)}</div></>}
        </>
      )}
      {paste && (
        <Modal title="Créer depuis le texte" onClose={() => setPaste(false)} wide>
          <p className="muted" style={{ marginTop: 0 }}>Colle les lignes du bon : « quantité  nom  code  total » (une par ligne). Les titres courts deviennent des catégories.</p>
          <textarea style={{ minHeight: 220, fontFamily: 'monospace' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Son\n2   Enceinte X12   SON-01   2\n4   Micro SM58   MIC-58   4'} />
          <div className="form-actions" style={{ display: 'flex', marginTop: 10 }}>
            <button className="secondary" onClick={() => setPaste(false)}>Annuler</button>
            <button onClick={async () => {
              const r = rowsFromText(text);
              if (!r.lines.length) return setErr('Aucune ligne reconnue : « quantité  nom  code  total » par ligne.');
              r.title = r.title || 'Checklist collée';
              const c = await createFreeChecklist(r, av.equipment);
              setPaste(false);
              nav('/checklists/' + c.id);
            }}>Créer la checklist</button>
          </div>
        </Modal>
      )}
    </>
  );
}
