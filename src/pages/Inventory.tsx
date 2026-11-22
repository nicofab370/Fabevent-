import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, StatusBadge, useSettings } from '../components/ui';
import { Scanner } from '../components/Scanner';
import PrintLabelModal from '../components/PrintLabelModal';
import { addExtraCode, contentsText, findByCode, removeExtraCode, setUnitState, UNIT_STATE_LABELS, unitState, type UnitState } from '../codes';
import { newArticleCode, nextUnitCode } from '../codegen';
import { useAvailability } from '../data';
import { currentWorkspace, db } from '../db';
import type { Equipment, SerialUnit } from '../types';
import { fmtDate, fmtRange, money, patch, save, stockIn, toLocalInput } from '../utils';
import { AssociateModal, stockMove } from './Checklist';
import { Icon } from '../components/Icon';
import { CategoryOptions } from '../components/CategoryOptions';
import { categoryLabel, inCategory } from '../categories';

/*
 * Inventaire — repris de l'Inventaire FABRI.live (sitefab/inventaire), désormais natif :
 *  - liste par catégorie avec la progression (« 12 / 40 comptés · 3 écarts »), vues Tout / À compter / Écarts ;
 *  - on touche un article pour le compter : − / +, « Conforme », et comptage en plusieurs endroits
 *    (5 au dépôt + 3 dans le camion : « Trouvés ici (en plus) », « Corriger le total », « Annuler le dernier ») ;
 *  - articles à numéros de série : une pastille par unité, scan limité à l'article, « Toutes présentes » ;
 *  - kits : comptés kit par kit (contenu à cocher ou à scanner, le kit se valide tout seul quand tout y est) ;
 *  - scan à la douchette ou à la caméra : « chaque scan compte 1 », ou bien le scan ouvre l'article pour taper la quantité ;
 *  - « Infos » : scanner un code pour tout voir sans rien compter ;
 *  - écarts appliqués article par article (cases à cocher), unités non vues perdues ou en réparation ;
 *  - nouvel article créé sur place (avec « déjà au parc ? → ajouter du stock »).
 * Le comptage en cours reste sur l'appareil : on peut l'étaler sur plusieurs jours.
 */

interface KitRec { kitId: string; items: { equipmentId: string; qty: number }[]; units?: string[] }
interface Session {
  counted: Record<string, number>;
  /** ce qui a été compté à chaque endroit (ex. [5, 3]) */
  parts?: Record<string, number[]>;
  found: string[];
  kits: KitRec[];
  kitsDone?: Record<string, number>;
}
const emptySession = (): Session => ({ counted: {}, parts: {}, found: [], kits: [], kitsDone: {} });
const key = (depot: string) => `fab.inv.${currentWorkspace()}.${depot}`;
const load = (depot: string): Session => { try { return { ...emptySession(), ...JSON.parse(localStorage.getItem(key(depot)) || '{}') }; } catch { return emptySession(); } };
const UIKEY = 'fab.inv.ui';
type View = 'all' | 'todo' | 'diff';
const loadUi = (): { view: View; cat: string; burst: boolean } => { try { return { view: 'all', cat: '', burst: true, ...JSON.parse(localStorage.getItem(UIKEY) || '{}') }; } catch { return { view: 'all', cat: '', burst: true }; } };
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const norm = (s?: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const partsOf = (s: Session, id: string) => (s.parts?.[id]?.length ? s.parts[id] : s.counted[id] !== undefined ? [s.counted[id]] : []);

/** Petit bip (et vibration) : aigu = bon, grave = refusé. */
let audio: AudioContext | null = null;
export function beep(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 50 : [80, 60, 80]);
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1320 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (ok ? 0.08 : 0.25));
  } catch { /* pas de son disponible */ }
}

type Flash = { ok: boolean; msg: string; actions?: { label: string; run: () => void }[] };

export default function Inventory() {
  const av = useAvailability();
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const multi = av.depots.length > 1;
  const [depotSel, setDepot] = useState('');
  const depot = depotSel || av.mainDepot;
  const [ses, setSes] = useState<Session>(() => load(depot));
  useEffect(() => { setSes(load(depot)); }, [depot]);
  useEffect(() => { try { localStorage.setItem(key(depot), JSON.stringify(ses)); } catch { /* sans stockage */ } }, [ses, depot]);
  const [ui, setUi] = useState(loadUi);
  const setUiP = (p: Partial<typeof ui>) => setUi((o) => { const n = { ...o, ...p }; try { localStorage.setItem(UIKEY, JSON.stringify(n)); } catch { /* sans stockage */ } return n; });
  const found = new Set(ses.found);
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [infoMode, setInfoMode] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [q, setQ] = useState('');
  const [done, setDone] = useState('');
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [assoc, setAssoc] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; unit?: string } | null>(null);
  const [printFor, setPrintFor] = useState<{ id: string; unitIds?: string[] } | null>(null);
  const [addStock, setAddStock] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const dep = multi ? depot : undefined;
  const inDepot = (u: SerialUnit) => !multi || (u.depotId || av.mainDepot) === depot;
  /** unités attendues au dépôt : en service ou à réparer (les unités en réparation et perdues n'y sont pas) */
  const unitsHere = (eqId: string) => av.units.filter((u) => u.equipmentId === eqId && u.status === 'ok' && inDepot(u)).sort((a, b) => (a.barcode || a.serial).localeCompare(b.barcode || b.serial, 'fr', { numeric: true }));
  const items = av.equipment.filter((e) => !e.isKit && !e.archived && !e.accessoryOnly);
  const kits = av.equipment.filter((e) => e.isKit && !e.archived && e.kitItems.length);
  const byId = new Map(av.equipment.map((e) => [e.id, e]));
  const expected = (e: Equipment) => (e.trackSerials ? unitsHere(e.id).length : stockIn(e, dep));
  const countOf = (e: Equipment): number | undefined => (e.trackSerials ? (unitsHere(e.id).some((u) => found.has(u.id)) ? unitsHere(e.id).filter((u) => found.has(u.id)).length : undefined) : ses.counted[e.id]);
  const stateOf = (e: Equipment): 'todo' | 'ok' | 'diff' => { const c = countOf(e); return c === undefined ? 'todo' : c === expected(e) ? 'ok' : 'diff'; };

  /* ---------- modifications du comptage ---------- */
  const setTotal = (id: string, n: number | undefined, parts?: number[]) => setSes((s) => {
    const counted = { ...s.counted }, P = { ...(s.parts || {}) };
    if (n === undefined) { delete counted[id]; delete P[id]; } else { counted[id] = Math.max(0, n); P[id] = parts || [Math.max(0, n)]; }
    return { ...s, counted, parts: P };
  });
  const addCount = (id: string, qty: number) => setSes((s) => ({
    ...s, counted: { ...s.counted, [id]: (s.counted[id] || 0) + qty }, parts: { ...(s.parts || {}), [id]: [...partsOf(s, id), qty] },
  }));
  const markUnits = (ids: string[]) => setSes((s) => ({ ...s, found: Array.from(new Set([...s.found, ...ids])) }));
  const unmarkUnits = (ids: string[]) => setSes((s) => ({ ...s, found: s.found.filter((x) => !ids.includes(x)) }));
  /** Un kit compté : son contenu en vrac s'ajoute au comptage, ses unités scannées sont vues. */
  const commitKit = (kitId: string, qtys: Record<string, number>, units: string[]) => setSes((s) => {
    const counted = { ...s.counted }, P = { ...(s.parts || {}) };
    const recItems: KitRec['items'] = [];
    for (const [id, q] of Object.entries(qtys)) {
      if (!(q > 0)) continue;
      counted[id] = (counted[id] || 0) + q;
      P[id] = [...partsOf(s, id), q];
      recItems.push({ equipmentId: id, qty: q });
    }
    const fresh = units.filter((u) => !s.found.includes(u));
    return { ...s, counted, parts: P, found: [...s.found, ...fresh], kits: [...s.kits, { kitId, items: recItems, units: fresh }], kitsDone: { ...(s.kitsDone || {}), [kitId]: (s.kitsDone?.[kitId] || 0) + 1 } };
  });
  const undoKit = () => setSes((s) => {
    const last = s.kits[s.kits.length - 1];
    if (!last) return s;
    const counted = { ...s.counted }, P = { ...(s.parts || {}) };
    for (const k of last.items) {
      counted[k.equipmentId] = Math.max(0, (counted[k.equipmentId] || 0) - k.qty);
      const p = [...partsOf(s, k.equipmentId)], i = p.lastIndexOf(k.qty);
      if (i >= 0) p.splice(i, 1);
      if (!p.length && !counted[k.equipmentId]) { delete counted[k.equipmentId]; delete P[k.equipmentId]; } else P[k.equipmentId] = p.length ? p : [counted[k.equipmentId]];
    }
    const kd = { ...(s.kitsDone || {}) };
    kd[last.kitId] = Math.max(0, (kd[last.kitId] || 0) - 1);
    return { ...s, counted, parts: P, found: s.found.filter((x) => !(last.units || []).includes(x)), kits: s.kits.slice(0, -1), kitsDone: kd };
  });

  const say = (f: Flash) => { setFlash(f); beep(f.ok); };

  /** Douchette / caméra : un code lu dans la page principale. */
  const scan = async (raw: string): Promise<boolean> => {
    const c = raw.trim();
    setCode('');
    if (!c) return false;
    const hit = findByCode(c, av.equipment, av.units);
    if (!hit) { say({ ok: false, msg: `Code inconnu : ${c}`, actions: [{ label: 'Associer à un article…', run: () => setAssoc(c) }] }); return false; }
    const { equipment: e, unit } = hit;
    if (infoMode) { beep(true); setFlash({ ok: true, msg: `Infos : ${e.name}${unit ? ` n° ${unit.serial}` : ''}` }); setSheet(e.id); return true; }
    if (unit) {
      const st = unitState(unit);
      if (st === 'lost') {
        // unité perdue retrouvée à l'inventaire : elle revient en stock
        await setUnitState(unit.id, 'ok', "retrouvée à l'inventaire");
        markUnits([unit.id]);
        say({ ok: true, msg: `${e.name} n° ${unit.serial} était déclarée perdue : retrouvée et remise en stock` });
        return true;
      }
      if (st === 'repair') { say({ ok: false, msg: `${e.name} n° ${unit.serial} est en réparation (hors service) : non comptée.`, actions: [{ label: 'Remettre en service', run: async () => { await setUnitState(unit.id, 'ok'); setFlash({ ok: true, msg: 'Remise en service. Scanne-la à nouveau.' }); } }] }); return false; }
      if (!ui.burst) { beep(true); markUnits([unit.id]); setFlash({ ok: true, msg: `${e.name} n° ${unit.serial} : ouvert` }); setOpen({ id: e.id, unit: unit.id }); return true; }
      if (found.has(unit.id)) { say({ ok: false, msg: `${e.name} n° ${unit.serial} déjà compté, pas compté deux fois.` }); return false; }
      markUnits([unit.id]);
      say({ ok: true, msg: `${e.name} n° ${unit.serial} — ${unitsHere(e.id).filter((u) => found.has(u.id)).length + 1} / ${unitsHere(e.id).length}${unit.defect ? ` · à réparer : ${unit.defect}` : ''}` });
      return true;
    }
    if (e.isKit && e.kitItems.length) {
      if (!ui.burst) { beep(true); setFlash({ ok: true, msg: `${e.name} : ouvert pour le comptage` }); setOpen({ id: e.id }); return true; }
      // scan en continu : le contenu du kit compte d'un coup (les unités à numéro de série se scannent à part)
      const bulk = e.kitItems.filter((k) => !byId.get(k.equipmentId)?.trackSerials);
      commitKit(e.id, Object.fromEntries(bulk.map((k) => [k.equipmentId, k.qty])), []);
      say({ ok: true, msg: `Kit ${e.name} : contenu compté (${bulk.map((k) => `${k.qty} × ${byId.get(k.equipmentId)?.name}`).join(', ')})${bulk.length < e.kitItems.length ? ' — scanne les unités à numéro de série du kit' : ''}` });
      return true;
    }
    if (e.trackSerials) {
      if (!ui.burst) { beep(true); setFlash({ ok: true, msg: `${e.name} : ouvert pour le comptage` }); setOpen({ id: e.id }); return true; }
      say({ ok: false, msg: `${e.name} est suivi par numéro de série : scanne l'étiquette de chaque unité.`, actions: [{ label: 'Ouvrir', run: () => setOpen({ id: e.id }) }] });
      return false;
    }
    if (!ui.burst) { beep(true); setFlash({ ok: true, msg: `${e.name} : ouvert pour le comptage` }); setOpen({ id: e.id }); return true; }
    const n = (ses.counted[e.id] || 0) + 1;
    addCount(e.id, 1);
    say({ ok: true, msg: `${e.name} : ${n} compté(s) (attendu : ${expected(e)})`, actions: [{ label: 'Taper la quantité', run: () => setOpen({ id: e.id }) }] });
    ref.current?.focus();
    return true;
  };

  /* ---------- liste ---------- */
  const qn = norm(q);
  const inScope = (e: Equipment) => inCategory(cats, e.categoryId, ui.cat);
  const scope = items.filter(inScope);
  const counted = scope.filter((e) => countOf(e) !== undefined);
  const diffs = items.filter((e) => stateOf(e) === 'diff');
  const scopeDiffs = scope.filter((e) => stateOf(e) === 'diff').length;
  const match = (e: Equipment) => !qn || norm([e.name, e.code, e.barcode, e.location, ...(e.extraCodes || [])].join(' ')).includes(qn);
  const rows = [...scope.filter((e) => ui.view === 'all' || stateOf(e) === ui.view), ...(ui.view === 'all' ? kits.filter(inScope) : [])].filter(match);
  const catName = (id?: string) => categoryLabel(cats, id) || 'Sans catégorie';
  rows.sort((a, b) => catName(a.categoryId).localeCompare(catName(b.categoryId), 'fr') || Number(!!a.isKit) - Number(!!b.isKit)
    || (a.code || '').localeCompare(b.code || '', 'fr', { numeric: true }) || a.name.localeCompare(b.name, 'fr'));
  const groups: { name: string; list: Equipment[] }[] = [];
  for (const e of rows) {
    const n = catName(e.categoryId);
    if (groups[groups.length - 1]?.name !== n) groups.push({ name: n, list: [] });
    groups[groups.length - 1].list.push(e);
  }
  const value = items.reduce((a, e) => a + (e.replacementValue || 0) * e.quantity, 0);
  const pct = scope.length ? Math.round((counted.length / scope.length) * 100) : 0;
  const openItem = open ? byId.get(open.id) : undefined;

  return (
    <>
      <PageHead title="Inventaire">
        {multi && (
          <select value={depot} onChange={(e) => setDepot(e.target.value)} style={{ width: 'auto' }} aria-label="Dépôt">
            {av.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {(Object.keys(ses.counted).length > 0 || ses.found.length > 0) && <button className="secondary" onClick={() => { if (confirm('Effacer tout le comptage en cours ?')) setSes(emptySession()); }}>Recommencer</button>}
      </PageHead>
      <div className="stats inv-stats">
        <div className="stat"><b>{items.reduce((a, e) => a + e.quantity, 0)}</b><span>pièces au parc</span></div>
        <div className="stat"><b>{money(value)}</b><span>valeur de remplacement</span></div>
      </div>
      {done && <div className="flash ok">{done}</div>}

      <div className="card inv-tools">
        <div className="toolbar">
          <input ref={ref} className="scan-input" autoFocus placeholder={infoMode ? 'Infos : scanne un code pour tout voir (rien n\'est compté)…' : 'Scanner une étiquette (article, unité ou kit) ou saisir un code…'} value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan(code)} enterKeyHint="search" style={{ maxWidth: 'none', flex: 1 }} />
          <button className={infoMode ? '' : 'secondary'} onClick={() => { setInfoMode(!infoMode); ref.current?.focus(); }} title="Scanner un code pour voir toutes ses infos, sans rien compter" aria-pressed={infoMode}><Icon name="info" />Infos</button>
          <button className="secondary" onClick={() => setCamera(!camera)}>{camera ? 'Fermer la caméra' : <><Icon name="camera" />Caméra</>}</button>
        </div>
        <label className="check-row"><input type="checkbox" checked={ui.burst} onChange={(e) => setUiP({ burst: e.target.checked })} />
          Scan en continu : chaque scan compte 1 (une unité à numéro de série ne compte qu'une fois). Décoché : le scan ouvre l'article pour taper la quantité.</label>
        {camera && <Scanner onCode={scan} onClose={() => setCamera(false)} />}
        {flash && <div className={'flash ' + (flash.ok ? 'ok' : 'ko')}>{flash.msg}{flash.actions?.map((a) => <button key={a.label} className="small" style={{ marginLeft: 10 }} onClick={a.run}>{a.label}</button>)}</div>}
        <div className="toolbar inv-filters">
          <input type="search" placeholder="Nom, code, emplacement…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
          <select value={ui.cat} onChange={(e) => setUiP({ cat: e.target.value })} aria-label="Catégorie">
            <option value="">Toutes les catégories</option>
            <CategoryOptions cats={cats} filter />
          </select>
          <div className="seg" role="group" aria-label="Vue">
            {([['all', 'Tout'], ['todo', 'À compter'], ['diff', 'Écarts']] as [View, string][]).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={ui.view === v} onClick={() => setUiP({ view: v })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="inv-prog"><span><b>{counted.length}</b> / {scope.length} comptés{scopeDiffs > 0 && <> · <b className="warn-txt">{scopeDiffs}</b> écart{scopeDiffs > 1 ? 's' : ''}</>}</span><span className="muted">{pct} %</span></div>
        <div className="inv-bar"><i style={{ width: `${pct}%` }} /></div>
      </div>

      {groups.length === 0 ? <Empty>{qn ? 'Aucun article trouvé. Crée-le avec « + Nouvel article ».' : ui.view === 'todo' ? 'Tout est compté ici.' : ui.view === 'diff' ? 'Aucun écart.' : 'Aucun article.'}</Empty> : groups.map((g) => {
        const cnt = g.list.filter((e) => !e.isKit);
        return (
          <section key={g.name} className="inv-group">
            <div className="inv-fold"><span>{g.name}</span><span>{cnt.filter((e) => countOf(e) !== undefined).length}/{cnt.length}</span></div>
            <div className="inv-list">
              {g.list.map((e) => {
                if (e.isKit) {
                  const n = ses.kitsDone?.[e.id] || 0;
                  return (
                    <button key={e.id} type="button" className="inv-row st-kit" onClick={() => setOpen({ id: e.id })}>
                      <span className="inv-main"><span className="inv-name">{e.name}</span>
                        <span className="inv-sub">{e.code && <span>{e.code}</span>}<span className="tag">kit · {e.kitItems.length} article{e.kitItems.length > 1 ? 's' : ''}</span>{n > 0 && <span>{n} kit{n > 1 ? 's' : ''} compté{n > 1 ? 's' : ''}</span>}</span></span>
                      <span className="inv-badge kit">kit<small>compter</small></span>
                    </button>
                  );
                }
                const st = stateOf(e), c = countOf(e), exp = expected(e);
                const miss = e.trackSerials && c !== undefined ? unitsHere(e.id).filter((u) => !found.has(u.id)) : [];
                const defects = av.units.filter((u) => u.equipmentId === e.id && (u.defect || u.status === 'hs')).length;
                return (
                  <button key={e.id} type="button" className={`inv-row st-${st}`} onClick={() => setOpen({ id: e.id })} aria-label={`Compter ${e.name}`}>
                    <span className="inv-main"><span className="inv-name">{e.name}</span>
                      <span className="inv-sub">{e.code && <span>{e.code}</span>}{e.location && <span className="loc"><Icon name="pin" />{e.location}</span>}{e.trackSerials && <span className="tag">n° de série</span>}{defects > 0 && <span className="tag"><Icon name="wrench" />{defects}</span>}
                        {miss.length > 0 && <span className="warn-txt">manque {miss.length > 5 ? `${miss.length} unités` : miss.map((u) => u.barcode || u.serial).join(', ')}</span>}</span></span>
                    <span className="inv-exp"><small>attendu</small><b>{exp}</b></span>
                    <span className="inv-badge">{c === undefined ? <>—<small>à compter</small></> : <>{c}<small>{st === 'ok' ? 'conforme' : signed(c - exp)}</small></>}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="inv-dock">
        <button className="secondary" onClick={() => setCreating(true)}>+ Nouvel article</button>
        {ses.kits.length > 0 && <button className="secondary" onClick={undoKit}>Annuler le dernier kit</button>}
        <button disabled={!diffs.length} onClick={() => setSending(true)}>Appliquer {diffs.length} écart{diffs.length > 1 ? 's' : ''}</button>
      </div>

      {openItem && !openItem.isKit && !openItem.trackSerials && (
        <CountModal e={openItem} exp={expected(openItem)} parts={partsOf(ses, openItem.id)} onClose={() => { setOpen(null); ref.current?.focus(); }}
          onSave={(n, parts) => setTotal(openItem.id, n, parts)} onClear={() => setTotal(openItem.id, undefined)}
          onPrint={() => { setOpen(null); setPrintFor({ id: openItem.id }); }} onInfo={() => setSheet(openItem.id)}
          onAddStock={() => { setOpen(null); setAddStock(openItem.id); }} />
      )}
      {openItem && !openItem.isKit && openItem.trackSerials && (
        <UnitsModal e={openItem} here={unitsHere(openItem.id)} all={av.units.filter((u) => u.equipmentId === openItem.id)} found={found} flash={open?.unit}
          equipment={av.equipment} units={av.units} onToggle={(id) => (found.has(id) ? unmarkUnits([id]) : markUnits([id]))}
          onMark={markUnits} onReset={() => unmarkUnits(av.units.filter((u) => u.equipmentId === openItem.id).map((u) => u.id))}
          onClose={() => { setOpen(null); ref.current?.focus(); }} onInfo={() => setSheet(openItem.id)}
          onPrint={(unitIds) => { setOpen(null); setPrintFor({ id: openItem.id, unitIds }); }} />
      )}
      {openItem && openItem.isKit && (
        <KitModal kit={openItem} byId={byId} units={av.units} here={unitsHere} found={found} done={ses.kitsDone?.[openItem.id] || 0} canUndo={ses.kits[ses.kits.length - 1]?.kitId === openItem.id}
          onCommit={(qtys, units) => commitKit(openItem.id, qtys, units)} onUndo={undoKit} onClose={() => { setOpen(null); ref.current?.focus(); }}
          onPrint={() => { setOpen(null); setPrintFor({ id: openItem.id }); }} />
      )}
      {sending && (
        <SendDiffs diffs={diffs} countOf={countOf} expected={expected} unitsHere={unitsHere} found={found} depot={depot} multi={multi} mainDepot={av.mainDepot}
          onClose={(msg, sent) => {
            setSending(false);
            if (msg) {
              setDone(msg);
              // les articles envoyés sortent du comptage ; ceux décochés restent à revoir
              setSes((s) => {
                const counted = { ...s.counted }, P = { ...(s.parts || {}) };
                for (const id of sent || []) { delete counted[id]; delete P[id]; }
                const sentUnits = new Set(av.units.filter((u) => (sent || []).includes(u.equipmentId)).map((u) => u.id));
                return { ...s, counted, parts: P, found: s.found.filter((x) => !sentUnits.has(x)) };
              });
            }
          }} />
      )}
      {sheet && <ItemSheet id={sheet} onClose={() => { setSheet(null); ref.current?.focus(); }} />}
      {printFor && <PrintLabelModal equipmentId={printFor.id} unitIds={printFor.unitIds} onClose={() => setPrintFor(null)} />}
      {addStock && <AddStockModal id={addStock} onClose={(added) => { const e = byId.get(addStock); setAddStock(null); if (added && e) setFlash({ ok: true, msg: `${e.name} : +${added} au stock` }); }} />}
      {creating && <NewItemModal items={items} onClose={() => setCreating(false)}
        onExisting={(id) => { setCreating(false); const e = byId.get(id); if (e?.trackSerials) setOpen({ id }); else setAddStock(id); }}
        onCreated={(e) => { setCreating(false); if (!e.trackSerials) setTotal(e.id, e.quantity); setFlash({ ok: true, msg: `« ${e.name} » créé (${e.code})` }); }} />}
      {assoc && <AssociateModal code={assoc} equipment={av.equipment} units={av.units} onClose={(ok) => { setAssoc(null); if (ok) setFlash({ ok: true, msg: `Code ${assoc} associé. Scanne-le à nouveau.` }); }} />}
    </>
  );
}

/* ---------- comptage d'un article en vrac ---------- */
function CountModal({ e, exp, parts: parts0, onSave, onClear, onClose, onPrint, onInfo, onAddStock }: {
  e: Equipment; exp: number; parts: number[];
  onSave: (n: number, parts: number[]) => void; onClear: () => void; onClose: () => void; onPrint: () => void; onInfo: () => void; onAddStock: () => void;
}) {
  const [parts, setParts] = useState(parts0);
  const before = parts.reduce((a, b) => a + b, 0);
  // déjà compté ailleurs : ce qu'on trouve ici s'ajoute
  const [mode, setMode] = useState<'set' | 'add'>(parts0.length ? 'add' : 'set');
  const [txt, setTxt] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => inp.current?.focus(), 50); }, [mode]);
  const val = txt === '' ? null : Math.max(0, parseInt(txt, 10) || 0);
  const result = val === null ? null : mode === 'add' ? { n: before + val, parts: val > 0 ? [...parts, val] : parts } : { n: val, parts: [val] };
  const total = result ? result.n : mode === 'add' ? before : null;
  const x = total === null ? null : total - exp;
  const commit = () => {
    if (!result) { onClose(); return; }
    if (mode === 'add' && !(val! > 0)) { onClose(); return; }
    onSave(result.n, result.parts);
    onClose();
  };
  const step = (d: number) => setTxt(String(Math.max(0, (parseInt(txt || '0', 10) || 0) + d)));
  return (
    <Modal title={e.name} onClose={onClose}>
      <div className="inv-count">
        <div className="muted">{e.code}{e.location && <span className="loc"><Icon name="pin" />{e.location}</span>}</div>
        <div className="inv-expect"><span className="muted">Attendu</span><b>{exp}</b></div>
        {mode === 'add' && <div className="inv-expect"><span className="muted">Déjà compté{parts.length > 1 ? ` (${parts.join(' + ')})` : ''}</span><b>{before}</b></div>}
        <div className="inv-lab">{mode === 'add' ? 'Trouvés ici (en plus)' : parts0.length ? 'Total compté' : 'Quantité comptée'}</div>
        <div className="inv-stepper">
          <button type="button" onClick={() => step(-1)} aria-label="Un de moins">−</button>
          <input ref={inp} type="number" inputMode="numeric" min={0} step={1} placeholder="?" value={txt} aria-label="Quantité comptée"
            onChange={(ev) => setTxt(ev.target.value.replace(/[^\d]/g, ''))} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } }} />
          <button type="button" onClick={() => step(1)} aria-label="Un de plus">+</button>
        </div>
        <div className={'inv-diff ' + (x === null ? '' : x === 0 ? 'ok' : 'ko')}>
          {x === null ? '' : `${mode === 'add' && val !== null ? `Total ${before} + ${val} = ${total} · ` : mode === 'add' ? `Total ${before} · ` : ''}${x === 0 ? 'Conforme' : `Écart ${signed(x)}`}`}
        </div>
        <div className="inv-quick">
          {parts0.length > 0 && <button type="button" className="secondary" onClick={() => { const m = mode === 'add' ? 'set' : 'add'; setMode(m); setTxt(m === 'set' ? String(before) : ''); }}>{mode === 'add' ? 'Corriger le total' : 'Ajouter à ce qui est déjà compté'}</button>}
          {mode === 'add' && parts.length > 1 && <button type="button" className="secondary" onClick={() => { const p = parts.slice(0, -1); setParts(p); onSave(p.reduce((a, b) => a + b, 0), p); }}>Annuler le dernier (−{parts[parts.length - 1]})</button>}
        </div>
        <div className="inv-quick">
          <button type="button" className="secondary" onClick={() => { onSave(exp, [exp]); onClose(); }}>Conforme ({exp})</button>
          <button type="button" className="secondary" onClick={onPrint}><Icon name="tag" />Étiquette</button>
          <button type="button" className="secondary" onClick={onInfo}><Icon name="info" />Infos</button>
          <button type="button" className="secondary" onClick={onAddStock}>+ Ajouter du stock</button>
          {parts0.length > 0 && <button type="button" className="ghost" onClick={() => { onClear(); onClose(); }}>Pas compté (effacer)</button>}
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="button" onClick={commit}>{mode === 'add' ? 'Ajouter au comptage' : 'Enregistrer'}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- articles à numéros de série : une pastille par unité ---------- */
function UnitsModal({ e, here, all, found, flash, equipment, units, onToggle, onMark, onReset, onClose, onInfo, onPrint }: {
  e: Equipment; here: SerialUnit[]; all: SerialUnit[]; found: Set<string>; flash?: string; equipment: Equipment[]; units: SerialUnit[];
  onToggle: (id: string) => void; onMark: (ids: string[]) => void; onReset: () => void; onClose: () => void; onInfo: () => void; onPrint: (unitIds?: string[]) => void;
}) {
  const [hl, setHl] = useState(flash);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [serial, setSerial] = useState('');
  const seen = here.filter((u) => found.has(u.id));
  const miss = here.filter((u) => !found.has(u.id));
  const started = seen.length > 0;
  const label = (u: SerialUnit) => u.barcode || u.serial;
  const lost = all.filter((u) => u.status === 'perdu'), rep = all.filter((u) => u.status === 'hs'), fix = here.filter((u) => u.defect);
  const scanHere = async (raw: string) => {
    const c = raw.trim(); setCode('');
    if (!c) return false;
    const hit = findByCode(c, equipment, units);
    const ko = (t: string) => { setMsg({ ok: false, t }); beep(false); return false; };
    if (!hit) return ko(`Code « ${c} » inconnu.`);
    if (hit.equipment.id !== e.id) return ko(`Ce code est celui de « ${hit.equipment.name} », pas de cet article.`);
    if (!hit.unit) return ko("C'est l'étiquette de l'article : scanne celle de chaque unité.");
    const u = hit.unit, st = unitState(u);
    if (st === 'repair') return ko(`${label(u)} est en réparation (hors service) : pas comptée.`);
    if (st === 'lost') { await setUnitState(u.id, 'ok', "retrouvée à l'inventaire"); onMark([u.id]); setHl(u.id); setMsg({ ok: true, t: `${label(u)} était perdue : retrouvée et remise en stock` }); beep(true); return true; }
    if (found.has(u.id)) return ko(`${label(u)} déjà scannée, pas comptée deux fois.`);
    onMark([u.id]); setHl(u.id); beep(true);
    setMsg({ ok: true, t: `${label(u)} — ${seen.length + 1} / ${here.length}` });
    return true;
  };
  return (
    <Modal title={e.name} onClose={onClose} wide>
      <div className="muted">{e.code}{e.location && <span className="loc"><Icon name="pin" />{e.location}</span>}</div>
      <div className="inv-expect"><span className="muted">Unités vues</span><b>{seen.length} / {here.length}</b></div>
      <p className="muted">Scanne l'étiquette de chaque unité : une unité scannée deux fois ne compte qu'une fois. Touche un numéro pour le cocher ou le décocher à la main.</p>
      <div className="toolbar">
        <input className="unit-scan" placeholder="Scanner les unités…" value={code} onChange={(ev) => setCode(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && scanHere(code)} aria-label="Scanner une unité" autoFocus />
        <button type="button" className="secondary" onClick={() => setCamera(!camera)}>{camera ? 'Fermer la caméra' : <><Icon name="camera" />Caméra</>}</button>
      </div>
      {camera && <Scanner onCode={scanHere} onClose={() => setCamera(false)} />}
      {msg && <div className={'flash ' + (msg.ok ? 'ok' : 'ko')}>{msg.t}</div>}
      <div className="uchips">
        {here.map((u) => (
          <button key={u.id} type="button" className={'uchip' + (found.has(u.id) ? ' on' : '') + (u.id === hl ? ' hl' : '') + (u.defect ? ' fix' : '')}
            title={u.serial !== label(u) ? `N° fabricant : ${u.serial}` : undefined} onClick={() => { setHl(undefined); onToggle(u.id); }}>{label(u)}</button>
        ))}
      </div>
      <div className={'inv-umsg ' + (!started ? '' : miss.length ? 'ko' : 'ok')}>{!started ? 'Pas encore compté.' : miss.length ? `Manquent : ${miss.map(label).join(', ')}` : 'Toutes les unités sont là.'}</div>
      {lost.length > 0 && <p className="muted">Déclarée(s) perdue(s) : {lost.map(label).join(', ')}. Scanne-la pour la remettre en stock.</p>}
      {rep.length > 0 && <p className="muted"><Icon name="wrench" />En réparation, hors service (pas comptées) : {rep.map(label).join(', ')}.</p>}
      {fix.length > 0 && <p className="muted"><Icon name="wrench" />À réparer mais utilisables : {fix.map(label).join(', ')}.</p>}
      <div className="inv-quick">
        <button type="button" className="secondary" onClick={() => onMark(here.map((u) => u.id))}>Toutes présentes</button>
        <button type="button" className="secondary" onClick={() => onPrint(started && miss.length && miss.length < here.length ? miss.map((u) => u.id) : hl ? [hl] : undefined)}><Icon name="tag" />Étiquettes{started && miss.length && miss.length < here.length ? ' (manquantes)' : hl ? ' (dernière)' : ''}</button>
        <button type="button" className="secondary" onClick={onInfo}><Icon name="info" />Infos</button>
        {started && <button type="button" className="ghost" onClick={onReset}>Remettre à zéro</button>}
      </div>
      <form className="toolbar inv-addunit" onSubmit={async (ev) => {
        ev.preventDefault();
        // nouvelle unité trouvée au dépôt : code F-S-0010-0x, n° du fabricant facultatif
        const all2 = await db.units.where({ equipmentId: e.id }).toArray();
        const code2 = nextUnitCode(e, all2);
        const u = await save(db.units, { equipmentId: e.id, barcode: code2, serial: serial.trim() || code2, status: 'ok' } as SerialUnit);
        onMark([u.id]); setHl(u.id); setSerial('');
        setMsg({ ok: true, t: `Unité ${code2} ajoutée et comptée.` });
      }}>
        <strong>Ajouter une unité</strong>
        <input value={serial} onChange={(ev) => setSerial(ev.target.value)} placeholder="N° du fabricant (facultatif)" aria-label="N° du fabricant de la nouvelle unité" />
        <button className="secondary small" type="submit">Ajouter</button>
      </form>
      <div className="form-actions"><button type="button" onClick={onClose}>Terminé</button></div>
    </Modal>
  );
}

/* ---------- kits : comptés un par un, contenu coché ou scanné ---------- */
function KitModal({ kit, byId, units, here, found, done, canUndo, onCommit, onUndo, onClose, onPrint }: {
  kit: Equipment; byId: Map<string, Equipment>; units: SerialUnit[]; done: number; canUndo: boolean;
  /** unités attendues au dépôt et unités déjà vues pendant l'inventaire */
  here: (eqId: string) => SerialUnit[]; found: Set<string>;
  onCommit: (qtys: Record<string, number>, units: string[]) => void; onUndo: () => void; onClose: () => void; onPrint: () => void;
}) {
  const rows = kit.kitItems.map((k, i) => ({ i, k, comp: byId.get(k.equipmentId) })).filter((r): r is { i: number; k: typeof r.k; comp: Equipment } => !!r.comp);
  const [cur, setCur] = useState<Record<number, number>>({});
  const [curU, setCurU] = useState<Record<number, string[]>>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  type Row = (typeof rows)[number];
  const got = (r: Row, c = cur, cu = curU) => (r.comp.trackSerials ? (cu[r.i] || []).length : Math.max(c[r.i] || 0, (cu[r.i] || []).length));
  /** unités encore libres d'un article sérialisé : ni vues ailleurs dans l'inventaire, ni déjà dans ce kit */
  const free = (r: Row, cu = curU) => { const taken = new Set(Object.values(cu).flat()); return here(r.comp.id).filter((u) => !found.has(u.id) && !taken.has(u.id)); };
  /** comptage à la main d'un article sérialisé : on prend les unités libres dans l'ordre (le bon numéro peut être touché ensuite) */
  const setUnitsCount = (r: Row, n: number, cu = curU) => {
    const l = (cu[r.i] || []).slice(0, Math.max(0, n));
    const add = free(r, cu).slice(0, Math.max(0, n - l.length)).map((u) => u.id);
    return { ...cu, [r.i]: [...l, ...add] };
  };
  const finish = (full: boolean, c = cur, cu0 = curU, auto = false) => {
    const qtys: Record<string, number> = {}, us: string[] = [];
    // « Kit complet » : les unités sérialisées non scannées sont comptées à la main
    let cu = cu0;
    if (full) for (const r of rows) if (r.comp.trackSerials) cu = setUnitsCount(r, r.k.qty, cu);
    for (const r of rows) {
      if (r.comp.trackSerials) { us.push(...(cu[r.i] || [])); continue; }
      const q = full ? r.k.qty : Math.min(got(r, c, cu), r.k.qty);
      qtys[r.comp.id] = (qtys[r.comp.id] || 0) + q;
    }
    onCommit(qtys, us);
    const short = rows.filter((r) => r.comp.trackSerials && (cu[r.i] || []).length < r.k.qty).map((r) => r.comp.name);
    setCur({}); setCurU({});
    setMsg({ ok: true, t: `Kit n° ${done + 1} ${(full && !short.length) || auto ? 'complet' : 'incomplet enregistré'}${full && short.length ? ` · plus d'unité libre au dépôt pour : ${short.join(', ')}` : ''}` });
    beep(true);
  };
  const check = (c: typeof cur, cu: typeof curU) => {
    setCur(c); setCurU(cu);
    if (rows.length && rows.every((r) => got(r, c, cu) >= r.k.qty)) finish(false, c, cu, true);
  };
  const started = rows.some((r) => got(r) > 0);
  const scanHere = (raw: string) => {
    const c = raw.trim(); setCode('');
    if (!c) return false;
    const hit = findByCode(c, [...byId.values()], units);
    const r = hit && (rows.find((x) => x.comp.id === hit.equipment.id && got(x) < x.k.qty) || rows.find((x) => x.comp.id === hit.equipment.id));
    if (!hit || !r) { setMsg({ ok: false, t: hit ? `« ${hit.equipment.name} » ne fait pas partie de ce kit.` : `Code « ${c} » inconnu.` }); beep(false); return false; }
    if (hit.unit) {
      const l = curU[r.i] || [];
      if (l.includes(hit.unit.id)) { setMsg({ ok: false, t: `${hit.unit.barcode || hit.unit.serial} déjà scannée dans ce kit.` }); beep(false); return false; }
      check(cur, { ...curU, [r.i]: [...l, hit.unit.id] });
    } else if (r.comp.trackSerials) { setMsg({ ok: false, t: `${r.comp.name} : scanne l'étiquette de l'unité.` }); beep(false); return false; }
    else check({ ...cur, [r.i]: Math.min(r.k.qty, got(r) + 1) }, curU);
    const left = rows.filter((x) => got(x) < x.k.qty).length;
    setMsg({ ok: true, t: `${r.comp.name} trouvé${left > 1 ? ` — encore ${left - 1} article(s) à trouver` : ''}` });
    beep(true);
    return true;
  };
  return (
    <Modal title={kit.name} onClose={() => { if (started) alert('Kit en cours non enregistré : rien n\'a été compté pour ce kit.'); onClose(); }} wide>
      <div className="muted">{[kit.code, 'kit / pack'].filter(Boolean).join(' · ')}</div>
      <div className="inv-expect"><span className="muted">Kits comptés</span><b>{done}</b></div>
      {msg && <div className={'flash ' + (msg.ok ? 'ok' : 'ko')}>{msg.t}</div>}
      <p className="muted"><b>Kit n° {done + 1}</b> — « Kit complet » s'il ne manque rien. Sinon touche (ou scanne) chaque article trouvé ; les articles à numéro de série se comptent aussi à la main (+ / −, ou touche le numéro de l'unité). Quand tout y est, le kit est compté tout seul et on passe au suivant.</p>
      <div className="toolbar">
        <input placeholder="Scanner le contenu…" value={code} onChange={(ev) => setCode(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && scanHere(code)} aria-label="Scanner le contenu du kit" />
        <button type="button" className="secondary" onClick={() => setCamera(!camera)}>{camera ? 'Fermer la caméra' : <><Icon name="camera" />Caméra</>}</button>
      </div>
      {camera && <Scanner onCode={scanHere} onClose={() => setCamera(false)} />}
      <div className="inv-kitlist">
        {rows.map((r) => {
          const g = got(r), ok = g >= r.k.qty;
          return (
            <div key={r.i} className={'inv-kitrow' + (ok ? ' ok' : '')} role="button" tabIndex={0}
              onClick={() => {
                if (r.comp.trackSerials) { check(cur, setUnitsCount(r, ok ? 0 : r.k.qty)); return; }
                const c = { ...cur, [r.i]: ok ? 0 : r.k.qty }; const cu = { ...curU }; if (!c[r.i]) delete cu[r.i]; check(c, cu);
              }}>
              <span className="inv-main"><span className="inv-name">{ok && <Icon name="check" className="ok-txt" />}{r.comp.name}</span>
                <span className="inv-sub">{r.comp.code}{r.comp.trackSerials ? ' · numéro de série : scanne, touche le numéro ou compte avec + / −' : ''}</span>
                {r.comp.trackSerials && (() => {
                  const mine = (curU[r.i] || []).map((id) => units.find((u) => u.id === id)).filter((u): u is SerialUnit => !!u);
                  const list = [...mine, ...free(r)];
                  return list.length > 0 && (
                    <span className="uchips kit-uchips" onClick={(ev) => ev.stopPropagation()}>
                      {list.map((u) => {
                        const on = mine.includes(u);
                        return <button key={u.id} type="button" className={'uchip' + (on ? ' on' : '')} aria-pressed={on}
                          disabled={!on && g >= r.k.qty} title={on ? 'Retirer du kit' : 'Cette unité est dans le kit'}
                          onClick={() => check(cur, { ...curU, [r.i]: on ? (curU[r.i] || []).filter((x) => x !== u.id) : [...(curU[r.i] || []), u.id] })}>{u.barcode || u.serial}</button>;
                      })}
                    </span>
                  );
                })()}
              </span>
              <span className="inv-kq" onClick={(ev) => ev.stopPropagation()}>
                {(r.k.qty > 1 || r.comp.trackSerials) && <button type="button" className="ghost small" aria-label={`Un de moins : ${r.comp.name}`} disabled={!g}
                  onClick={() => (r.comp.trackSerials ? check(cur, setUnitsCount(r, g - 1)) : check({ ...cur, [r.i]: Math.max(0, g - 1) }, curU))}>−</button>}
                <b>{g} / {r.k.qty}</b>
                {(r.k.qty > 1 || r.comp.trackSerials) && <button type="button" className="ghost small" aria-label={`Un de plus : ${r.comp.name}`} disabled={g >= r.k.qty || (r.comp.trackSerials && !free(r).length)}
                  title={r.comp.trackSerials && !free(r).length && g < r.k.qty ? 'Plus aucune unité libre au dépôt' : undefined}
                  onClick={() => (r.comp.trackSerials ? check(cur, setUnitsCount(r, g + 1)) : check({ ...cur, [r.i]: Math.min(r.k.qty, g + 1) }, curU))}>+</button>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="inv-quick">
        <button type="button" className="secondary" onClick={onPrint}><Icon name="tag" />Étiquette du kit</button>
        {canUndo && <button type="button" className="secondary" onClick={() => { onUndo(); setMsg({ ok: true, t: 'Dernier kit annulé.' }); }}>Annuler le dernier kit</button>}
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>Fermer</button>
        {started && <button type="button" className="secondary" onClick={() => {
          const miss = rows.filter((r) => got(r) < r.k.qty).map((r) => `${r.comp.name} (${r.k.qty - got(r)})`);
          if (confirm(`Enregistrer ce kit avec seulement ce qui a été trouvé ? Manque : ${miss.join(', ')}.`)) finish(false);
        }}>Kit incomplet : enregistrer</button>}
        <button type="button" onClick={() => finish(true)}><Icon name="check" />Kit complet</button>
      </div>
    </Modal>
  );
}

/* ---------- ajouter du stock (achat…) ---------- */
function AddStockModal({ id, onClose }: { id: string; onClose: (added?: number) => void }) {
  const e = useLiveQuery(() => db.equipment.get(id), [id]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  if (!e) return null;
  return (
    <Modal title="Ajouter du stock" onClose={() => onClose()}>
      <form className="form" onSubmit={async (ev) => { ev.preventDefault(); if (!(qty > 0)) return; await stockMove(e.id, qty, `Ajout au stock${note ? ` — ${note}` : ''}`); onClose(qty); }}>
        <p className="muted full" style={{ margin: 0 }}>{e.name}{e.code ? ` · ${e.code}` : ''} — stock actuel : {e.quantity}</p>
        <Field label="Quantité à ajouter"><NumInput step="1" min={1} value={qty} onChange={setQty} aria-label="Quantité à ajouter" /></Field>
        <Field label="Note (facultatif)"><input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="ex. achat Thomann, facture 2026-114" /></Field>
        <div className="form-actions"><button type="button" className="secondary" onClick={() => onClose()}>Annuler</button><button type="submit">Ajouter</button></div>
      </form>
    </Modal>
  );
}

/* ---------- nouvel article créé pendant l'inventaire ---------- */
function NewItemModal({ items, onClose, onExisting, onCreated }: { items: Equipment[]; onClose: () => void; onExisting: (id: string) => void; onCreated: (e: Equipment) => void }) {
  const settings = useSettings();
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const [name, setName] = useState('');
  const [cat, setCat] = useState('');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [place, setPlace] = useState('');
  const [serials, setSerials] = useState(false);
  const qn = norm(name);
  const hits = qn.length >= 3 ? items.filter((e) => norm(`${e.name} ${e.code}`).includes(qn)).slice(0, 4) : [];
  return (
    <Modal title="Nouvel article" onClose={onClose}>
      <form className="form" onSubmit={async (ev) => {
        ev.preventDefault();
        if (!name.trim()) return;
        const draft = { name: name.trim(), categoryId: cat || undefined, quantity: serials ? 0 : qty, dailyPrice: price, location: place.trim() || undefined, isKit: false, kitItems: [], trackSerials: serials || undefined };
        const codeA = newArticleCode(draft, settings, await db.categories.toArray(), await db.equipment.toArray());
        const e = await save(db.equipment, { ...draft, code: codeA });
        if (serials) {
          // une unité par pièce trouvée, codes F-S-0010-01…
          const made: SerialUnit[] = [];
          for (let i = 0; i < qty; i++) { const c = nextUnitCode(e, made); made.push(await save(db.units, { equipmentId: e.id, barcode: c, serial: c, status: 'ok' } as SerialUnit)); }
          await patch(db.equipment, e.id, { quantity: qty });
        }
        onCreated(e);
      }}>
        <Field label="Nom *" full><input required autoFocus value={name} onChange={(ev) => setName(ev.target.value)} placeholder="ex. Shure SM58 (micro chant)" /></Field>
        {hits.length > 0 && (
          <div className="full inv-dupes"><b>Déjà au parc ?</b> {hits.map((h) => <button key={h.id} type="button" className="secondary small" onClick={() => onExisting(h.id)}>{h.name}{h.code ? ` · ${h.code}` : ''} → {h.trackSerials ? 'ajouter des unités' : 'ajouter du stock'}</button>)}</div>
        )}
        <Field label="Catégorie">
          <select value={cat} onChange={(ev) => setCat(ev.target.value)}><option value="">—</option><CategoryOptions cats={cats} /></select>
        </Field>
        <Field label={serials ? 'Nombre d\'unités trouvées' : 'Quantité trouvée'}><NumInput step="1" min={0} value={qty} onChange={setQty} /></Field>
        <Field label="Prix location / jour HT (€)"><NumInput value={price} onChange={setPrice} /></Field>
        <Field label="Emplacement au dépôt"><input value={place} onChange={(ev) => setPlace(ev.target.value)} placeholder="ex. étagère B2" /></Field>
        <Field label=" "><label className="check-row"><input type="checkbox" checked={serials} onChange={(ev) => setSerials(ev.target.checked)} /> Suivi par numéro de série (une étiquette par unité)</label></Field>
        <p className="muted full" style={{ margin: 0 }}>Le code (ex. F-S-0010) est attribué automatiquement. Le reste (photo, poids, accessoires…) se complète dans la fiche de l'article.</p>
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Créer</button></div>
      </form>
    </Modal>
  );
}

/** Envoi des écarts : articles cochés corrigés par un mouvement de stock daté ; unités non vues : perdue, en réparation ou rien. */
function SendDiffs({ diffs, countOf, expected, unitsHere, found, depot, multi, mainDepot, onClose }: {
  diffs: Equipment[]; countOf: (e: Equipment) => number | undefined; expected: (e: Equipment) => number; unitsHere: (id: string) => SerialUnit[];
  found: Set<string>; depot: string; multi: boolean; mainDepot: string; onClose: (msg?: string, sent?: string[]) => void;
}) {
  const bulk = diffs.filter((e) => !e.trackSerials);
  const unseen = diffs.filter((e) => e.trackSerials).flatMap((e) => unitsHere(e.id).filter((u) => !found.has(u.id)).map((u) => ({ e, u })));
  const [pick, setPick] = useState<Set<string>>(() => new Set(bulk.map((e) => e.id)));
  const [choice, setChoice] = useState<Record<string, 'lost' | 'repair' | 'none'>>(() => Object.fromEntries(unseen.map(({ u }) => [u.id, 'lost'])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Appliquer les écarts" onClose={() => onClose()} wide>
      {bulk.length > 0 && (
        <>
          <h3 style={{ marginTop: 0 }}>Stock corrigé</h3>
          <p className="muted" style={{ marginTop: 0 }}>Pour chaque article coché, le stock devient la quantité comptée (mouvement « Inventaire » daté). Décoche ceux à recompter : ils restent dans le comptage.</p>
          <table className="list"><tbody>{bulk.map((e) => {
            const c = countOf(e) ?? 0, x = expected(e);
            return (
              <tr key={e.id}>
                <td><label className="check-row"><input type="checkbox" checked={pick.has(e.id)} onChange={(ev) => { const n = new Set(pick); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setPick(n); }} aria-label={`Corriger ${e.name}`} /> {e.name} <span className="muted">{e.code}</span></label></td>
                <td className="n">{x} → <strong>{c}</strong></td><td className="n">{signed(c - x)}</td>
              </tr>
            );
          })}</tbody></table>
        </>
      )}
      {unseen.length > 0 && (
        <>
          <h3>Unités non vues (numéros de série)</h3>
          <p className="muted" style={{ marginTop: 0 }}>Choisis pour chacune : perdue (sort du stock, avec le dernier projet où elle est sortie), en réparation, ou ne rien faire.</p>
          <table className="list"><tbody>{unseen.map(({ e, u }) => (
            <tr key={u.id}><td>{e.name} {u.barcode || u.serial}{u.serial !== (u.barcode || u.serial) && <span className="muted"> · n° {u.serial}</span>}</td><td>
              <select value={choice[u.id]} onChange={(ev) => setChoice({ ...choice, [u.id]: ev.target.value as 'lost' | 'repair' | 'none' })} aria-label={`Unité ${u.serial}`}>
                <option value="lost">Perdue</option><option value="repair">En réparation</option><option value="none">Ne rien faire</option>
              </select>
            </td></tr>
          ))}</tbody></table>
        </>
      )}
      <Field label="Note (facultatif)" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. inventaire de fin d'année" /></Field>
      <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
        <button className="secondary" onClick={() => onClose()}>Annuler</button>
        <button disabled={busy} onClick={async () => {
          const nLost = unseen.filter(({ u }) => choice[u.id] !== 'none').length;
          if (nLost && !confirm(`${nLost} unité(s) seront déclarées perdues ou en réparation. Continuer ?`)) return;
          setBusy(true);
          let nb = 0, nu = 0;
          const sent: string[] = [];
          for (const e of bulk) {
            if (!pick.has(e.id)) continue;
            const c = countOf(e) ?? 0, x = expected(e);
            sent.push(e.id);
            if (c === x) continue;
            const txt = `Inventaire : ${c} compté(s), ${x} attendu(s)${note ? ` — ${note}` : ''}`;
            if (multi && depot !== mainDepot) {
              // dépôt secondaire : on corrige son stock propre
              const raw = await db.equipment.get(e.id);
              if (raw) await patch(db.equipment, e.id, { stock: { ...raw.stock, [depot]: c }, quantity: raw.quantity + c - x, stockLog: [...(raw.stockLog || []), { at: new Date().toISOString(), delta: c - x, text: `[${new Date().toLocaleDateString('fr-FR')}] ${txt}` }] });
            } else await stockMove(e.id, c - x, txt);
            nb++;
          }
          for (const { e, u } of unseen) {
            const ch = choice[u.id];
            if (!sent.includes(e.id)) sent.push(e.id);
            if (ch === 'none') continue;
            await setUnitState(u.id, ch, ch === 'lost' ? `à l'inventaire${await lastOutContext(u)}${note ? ` · ${note}` : ''}` : `non trouvée à l'inventaire${note ? ` · ${note}` : ''}`);
            nu++;
          }
          onClose(`Inventaire appliqué : ${nb} article(s) corrigé(s)${nu ? `, ${nu} unité(s) mise(s) à jour` : ''}.`, sent);
        }}>Appliquer</button>
      </div>
    </Modal>
  );
}

/** Dernier projet où l'unité est sortie sans rentrer (pour l'historique d'une perte). */
async function lastOutContext(u: SerialUnit): Promise<string> {
  const lines = (await db.lines.where({ equipmentId: u.equipmentId }).toArray()).filter((l) => l.outSerials?.includes(u.serial));
  if (!lines.length) return ' — aucun projet connu';
  const subs = await db.subprojects.bulkGet(lines.map((l) => l.subprojectId));
  const withDate = lines.map((l, i) => ({ l, sp: subs[i] })).filter((x) => x.sp).sort((a, b) => b.sp!.start.localeCompare(a.sp!.start));
  const last = withDate[0];
  if (!last) return '';
  const p = await db.projects.get(last.l.projectId);
  const back = last.l.inSerials?.includes(u.serial);
  return ` — ${back ? 'dernier projet' : 'après le projet'} ${p?.number || ''} ${p?.name || ''} (${back ? 'rentrée' : 'sortie, pas rentrée'})`;
}

/** Fiche d'un article : stock, unités et leur état, codes, historique, « où est-il ? », ajout de stock. */
export function ItemSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const e = useLiveQuery(() => db.equipment.get(id), [id]);
  const units = useLiveQuery(() => db.units.where({ equipmentId: id }).toArray(), [id]) || [];
  const where = useLiveQuery(() => whereIs(id), [id]);
  const [addQty, setAddQty] = useState(0);
  const [addNote, setAddNote] = useState('');
  const [newCode, setNewCode] = useState('');
  const [stateFor, setStateFor] = useState<SerialUnit | null>(null);
  if (!e) return null;
  return (
    <Modal title={e.name} onClose={onClose} wide>
      <dl className="kv">
        <dt>Code</dt><dd>{e.code || '—'}{e.barcode && <span className="muted"> · étiquette {e.barcode}</span>}</dd>
        {e.location && <><dt>Emplacement</dt><dd><Icon name="pin" />{e.location}</dd></>}
        <dt>Stock</dt><dd><strong>{e.trackSerials ? units.filter((u) => u.status === 'ok').length : e.quantity}</strong>{e.trackSerials && ` unité(s) en service sur ${units.length}`}</dd>
        {e.contents?.length ? <><dt>Contenu fourni</dt><dd>{contentsText(e)}</dd></> : null}
        <dt>Codes en plus</dt><dd>
          {(e.extraCodes || []).map((c) => <span key={c} className="tag small">{c} <button className="ghost small" aria-label={`Retirer ${c}`} onClick={() => removeExtraCode({ equipmentId: e.id }, c)}><Icon name="x" /></button></span>)}
          <form style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }} onSubmit={async (ev) => { ev.preventDefault(); if (newCode.trim()) { await addExtraCode({ equipmentId: e.id }, newCode); setNewCode(''); } }}>
            <input value={newCode} onChange={(ev) => setNewCode(ev.target.value)} placeholder="code fabricant…" style={{ width: 160 }} /><button className="secondary small" type="submit">+ Code</button>
          </form>
        </dd>
      </dl>

      {!e.trackSerials && !e.isKit && (
        <form className="toolbar" onSubmit={async (ev) => { ev.preventDefault(); if (addQty) { await stockMove(e.id, addQty, `Ajout au stock${addNote ? ` — ${addNote}` : ''}`); setAddQty(0); setAddNote(''); } }}>
          <strong>Ajouter du stock</strong>
          <NumInput className="w-qty" value={addQty} onChange={setAddQty} aria-label="Quantité à ajouter" />
          <input value={addNote} onChange={(ev) => setAddNote(ev.target.value)} placeholder="Note (achat, facture…)" style={{ maxWidth: 260 }} />
          <button className="small" type="submit" disabled={!addQty}>Ajouter</button>
        </form>
      )}

      {units.length > 0 && (
        <>
          <h3>Unités</h3>
          <table className="list"><tbody>{units.map((u) => {
            const st = unitState(u);
            return (
              <tr key={u.id}>
                <td>n° <strong>{u.serial}</strong>{u.barcode && <span className="muted"> · {u.barcode}</span>}</td>
                <td><span className={'badge ' + (st === 'ok' ? 'st-confirme' : st === 'lost' ? 'st-annule' : 'st-option')}>{UNIT_STATE_LABELS[st]}</span>{u.defect && <div className="muted" style={{ fontSize: 12 }}>{u.defect}</div>}</td>
                <td className="muted" style={{ fontSize: 12 }}>{(u.history || []).slice(-2).map((h, i) => <div key={i}>{h.text}</div>)}</td>
                <td><button className="secondary small" onClick={() => setStateFor(u)}>Changer l'état…</button></td>
              </tr>
            );
          })}</tbody></table>
        </>
      )}

      <h3>Où est cet article ?</h3>
      {!where ? <p className="muted">Recherche…</p> : (
        <>
          {where.planned.length === 0 ? <p className="muted">Prévu sur aucun projet.</p> : (
            <table className="list"><tbody>{where.planned.map((p) => (
              <tr key={p.subId}>
                <td><Link to={'/projets/' + p.projectId}>{p.number} {p.name}</Link> <span className="muted">· {p.sub}</span></td>
                <td>{fmtRange(p.start, p.end)}</td><td><StatusBadge status={p.status} /></td>
                <td className="n">{p.qty} prévu(s){p.out > 0 && ` · ${p.out} sorti(s)`}{p.out > 0 && ` · ${p.back} rentré(s)`}</td>
                <td><span className="muted">{p.state}</span></td>
              </tr>
            ))}</tbody></table>
          )}
          {where.free.length > 0 && <p className="muted">Checklists libres : {where.free.map((f) => <Link key={f.id} to={'/checklists/' + f.id} style={{ marginRight: 8 }}>{f.title} ({f.out} sorti(s), {f.back} rentré(s))</Link>)}</p>}
        </>
      )}

      {(e.stockLog?.length || units.some((u) => u.history?.length)) ? (
        <>
          <h3>Historique</h3>
          <div className="muted" style={{ fontSize: 12, maxHeight: 180, overflowY: 'auto' }}>
            {[...(e.stockLog || []).map((m) => ({ at: m.at, text: `${m.text} (${m.delta > 0 ? '+' : ''}${m.delta})` })),
              ...units.flatMap((u) => (u.history || []).map((h) => ({ at: h.at, text: `n° ${u.serial} : ${h.text}` })))]
              .sort((a, b) => b.at.localeCompare(a.at)).map((h, i) => <div key={i}>{h.text}</div>)}
          </div>
        </>
      ) : null}
      {stateFor && <UnitStateModal unit={stateFor} onClose={() => setStateFor(null)} />}
    </Modal>
  );
}

function UnitStateModal({ unit, onClose }: { unit: SerialUnit; onClose: () => void }) {
  const [st, setSt] = useState<UnitState>(unitState(unit) === 'ok' ? 'fix' : 'ok');
  const [note, setNote] = useState('');
  return (
    <Modal title={`Unité n° ${unit.serial}`} onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await setUnitState(unit.id, st, note.trim()); onClose(); }}>
        {(['ok', 'fix', 'repair', 'lost'] as UnitState[]).map((s) => (
          <label key={s} className="check-row"><input type="radio" checked={st === s} onChange={() => setSt(s)} /> {s === 'ok' ? (unitState(unit) === 'lost' ? 'Retrouvée, remise en stock' : 'En service / réparée') : UNIT_STATE_LABELS[s]}</label>
        ))}
        <Field label="Note" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={st === 'fix' || st === 'repair' ? 'Défaut constaté' : 'Facultatif'} /></Field>
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Enregistrer</button></div>
      </form>
    </Modal>
  );
}

/** Projets où l'article est prévu (en cours, à venir, 5 derniers passés) et checklists libres. */
export async function whereIs(equipmentId: string) {
  const lines = await db.lines.where({ equipmentId }).toArray();
  const subs = new Map((await db.subprojects.bulkGet(Array.from(new Set(lines.map((l) => l.subprojectId))))).filter(Boolean).map((s) => [s!.id, s!]));
  const projects = new Map((await db.projects.bulkGet(Array.from(new Set(lines.map((l) => l.projectId))))).filter(Boolean).map((p) => [p!.id, p!]));
  const now = toLocalInput(new Date());
  const bySub = new Map<string, { qty: number; out: number; back: number }>();
  for (const l of lines) {
    if (l.optional) continue;
    const a = bySub.get(l.subprojectId) || { qty: 0, out: 0, back: 0 };
    bySub.set(l.subprojectId, { qty: a.qty + l.qty, out: a.out + (l.outQty || 0), back: a.back + (l.inQty || 0) });
  }
  const planned = [...bySub.entries()].map(([subId, a]) => {
    const sp = subs.get(subId)!, p = projects.get(sp?.projectId || '');
    if (!sp || !p || p.isTemplate || sp.status === 'annule') return null;
    const start = sp.prepStart || sp.start, end = sp.returnEnd || sp.end;
    const state = end < now ? 'passé' : start > now ? 'à venir' : 'en cours';
    return { subId, projectId: p.id, number: p.number, name: p.name, sub: sp.name, start, end, status: sp.status, state, ...a };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const rank: Record<string, number> = { 'en cours': 0, 'à venir': 1, passé: 2 };
  planned.sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'passé' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
  let past = 0;
  const free = (await db.checklists.toArray()).flatMap((c) => {
    const ls = c.lines.filter((l) => l.equipmentId === equipmentId);
    return ls.length ? [{ id: c.id, title: c.title, out: ls.reduce((a, l) => a + l.out, 0), back: ls.reduce((a, l) => a + l.back, 0) }] : [];
  });
  return { planned: planned.filter((p) => p.state !== 'passé' || ++past <= 5), free, at: fmtDate(new Date().toISOString()) };
}
