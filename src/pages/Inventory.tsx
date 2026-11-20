import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, StatusBadge } from '../components/ui';
import { Scanner } from '../components/Scanner';
import { addExtraCode, findByCode, removeExtraCode, setUnitState, UNIT_STATE_LABELS, unitState, type UnitState } from '../codes';
import { useAvailability } from '../data';
import { currentWorkspace, db } from '../db';
import type { Equipment, SerialUnit } from '../types';
import { fmtDate, fmtRange, money, patch, stockIn, toLocalInput } from '../utils';
import { AssociateModal, stockMove } from './Checklist';

/*
 * Inventaire (repris de l'Inventaire FABRI.live, désormais natif) :
 * comptage au scan (douchette ou caméra) ou à la main, kits scannés d'un coup, unités sérialisées,
 * « conforme » en un clic, écarts envoyés au stock avec un mouvement daté, unités non vues
 * déclarées perdues ou en réparation, fiche article (stock, unités, codes, historique, où est-il ?).
 * Le comptage en cours est gardé sur l'appareil : on peut l'étaler sur plusieurs jours.
 */

interface Session { counted: Record<string, number>; found: string[]; kits: { kitId: string; items: { equipmentId: string; qty: number }[] }[] }
const emptySession = (): Session => ({ counted: {}, found: [], kits: [] });
const key = (depot: string) => `fab.inv.${currentWorkspace()}.${depot}`;
const load = (depot: string): Session => { try { return { ...emptySession(), ...JSON.parse(localStorage.getItem(key(depot)) || '{}') }; } catch { return emptySession(); } };

export default function Inventory() {
  const av = useAvailability();
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const multi = av.depots.length > 1;
  const [depotSel, setDepot] = useState('');
  const depot = depotSel || av.mainDepot;
  const [ses, setSes] = useState<Session>(() => load(depot));
  useEffect(() => { setSes(load(depot)); }, [depot]);
  useEffect(() => { try { localStorage.setItem(key(depot), JSON.stringify(ses)); } catch { /* sans stockage */ } }, [ses, depot]);
  const found = new Set(ses.found);
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string; actions?: { label: string; run: () => void }[] } | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [done, setDone] = useState('');
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [assoc, setAssoc] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dep = multi ? depot : undefined;
  const inDepot = (u: SerialUnit) => !multi || (u.depotId || av.mainDepot) === depot;
  /** unités attendues au dépôt : en service ou à réparer (les unités en réparation et perdues n'y sont pas) */
  const unitsHere = (eqId: string) => av.units.filter((u) => u.equipmentId === eqId && u.status === 'ok' && inDepot(u));
  const items = av.equipment.filter((e) => !e.isKit && !e.archived);
  const expected = (e: Equipment) => (e.trackSerials ? unitsHere(e.id).length : stockIn(e, dep));
  const countOf = (e: Equipment): number | undefined => (e.trackSerials ? (unitsHere(e.id).some((u) => found.has(u.id)) ? unitsHere(e.id).filter((u) => found.has(u.id)).length : undefined) : ses.counted[e.id]);
  const setCount = (id: string, n: number | undefined) => setSes((s) => { const counted = { ...s.counted }; if (n === undefined) delete counted[id]; else counted[id] = n; return { ...s, counted }; });

  const say = (f: NonNullable<typeof flash>) => { setFlash(f); if (navigator.vibrate) navigator.vibrate(f.ok ? 60 : [80, 60, 80]); };
  const scan = async (raw: string): Promise<boolean> => {
    const c = raw.trim();
    setCode('');
    if (!c) return false;
    const hit = findByCode(c, av.equipment, av.units);
    if (!hit) { say({ ok: false, msg: `Code inconnu : ${c}`, actions: [{ label: 'Associer à un article…', run: () => setAssoc(c) }] }); return false; }
    const { equipment: e, unit } = hit;
    if (unit) {
      const st = unitState(unit);
      if (st === 'lost') {
        // unité perdue retrouvée à l'inventaire : elle revient en stock
        await setUnitState(unit.id, 'ok', "retrouvée à l'inventaire");
        setSes((s) => ({ ...s, found: [...s.found, unit.id] }));
        say({ ok: true, msg: `${e.name} n° ${unit.serial} était déclarée perdue : retrouvée et remise en stock ✓` });
        return true;
      }
      if (st === 'repair') { say({ ok: false, msg: `🔧 ${e.name} n° ${unit.serial} est en réparation (hors service) : non comptée.`, actions: [{ label: 'Remettre en service', run: async () => { await setUnitState(unit.id, 'ok'); setFlash({ ok: true, msg: 'Remise en service. Scanne-la à nouveau.' }); } }] }); return false; }
      if (found.has(unit.id)) { say({ ok: false, msg: `${e.name} n° ${unit.serial} déjà compté.` }); return false; }
      setSes((s) => ({ ...s, found: [...s.found, unit.id] }));
      say({ ok: true, msg: `${e.name} n° ${unit.serial} trouvé${unit.defect ? ` · ⚠ à réparer : ${unit.defect}` : ''}.` });
      return true;
    }
    // kit (flight case, pack) : on compte tout son contenu d'un coup
    if (e.isKit && e.kitItems.length) {
      const bulk = e.kitItems.filter((k) => !av.equipment.find((x) => x.id === k.equipmentId)?.trackSerials);
      setSes((s) => {
        const counted = { ...s.counted };
        for (const k of bulk) counted[k.equipmentId] = (counted[k.equipmentId] || 0) + k.qty;
        return { ...s, counted, kits: [...s.kits, { kitId: e.id, items: bulk.map((k) => ({ equipmentId: k.equipmentId, qty: k.qty })) }] };
      });
      say({ ok: true, msg: `Kit ${e.name} : contenu compté (${bulk.map((k) => `${k.qty} × ${av.equipment.find((x) => x.id === k.equipmentId)?.name}`).join(', ')})${bulk.length < e.kitItems.length ? ' — scanne les unités à numéro de série du kit' : ''}` });
      return true;
    }
    if (e.trackSerials) { say({ ok: false, msg: `${e.name} est suivi par numéro de série : scanne l'étiquette de chaque unité.` }); return false; }
    const n = (ses.counted[e.id] || 0) + 1;
    setCount(e.id, n);
    say({ ok: true, msg: `${e.name} : ${n} compté(s)` });
    ref.current?.focus();
    return true;
  };
  const undoKit = () => setSes((s) => {
    const last = s.kits[s.kits.length - 1];
    if (!last) return s;
    const counted = { ...s.counted };
    for (const k of last.items) counted[k.equipmentId] = Math.max(0, (counted[k.equipmentId] || 0) - k.qty);
    return { ...s, counted, kits: s.kits.slice(0, -1) };
  });

  const rows = items.filter((e) => {
    if (cat && e.categoryId !== cat) return false;
    if (q && ![e.name, e.code, e.location].join(' ').toLowerCase().includes(q.toLowerCase())) return false;
    const c = countOf(e);
    return !onlyDiff || (c !== undefined && c !== expected(e));
  });
  const touched = items.filter((e) => countOf(e) !== undefined);
  const diffs = touched.filter((e) => countOf(e) !== expected(e));
  const value = items.reduce((a, e) => a + (e.replacementValue || 0) * e.quantity, 0);

  return (
    <>
      <PageHead title="Inventaire">
        {multi && (
          <select value={depot} onChange={(e) => setDepot(e.target.value)} style={{ width: 'auto' }}>
            {av.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {(touched.length > 0 || ses.found.length > 0) && <button className="secondary" onClick={() => { if (confirm('Effacer le comptage en cours ?')) setSes(emptySession()); }}>Recommencer</button>}
        <button disabled={!diffs.length} onClick={() => setSending(true)}>Appliquer {diffs.length} écart(s)</button>
      </PageHead>
      <div className="stats">
        <div className="stat"><b>{items.reduce((a, e) => a + e.quantity, 0)}</b><span>pièces au parc</span></div>
        <div className="stat"><b>{money(value)}</b><span>valeur de remplacement du parc</span></div>
        <div className="stat"><b>{touched.length}</b><span>articles comptés</span></div>
        <div className="stat"><b style={{ color: diffs.length ? 'var(--danger)' : undefined }}>{diffs.length}</b><span>écarts</span></div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Le comptage en cours reste enregistré sur cet appareil : tu peux l'étaler sur plusieurs jours, puis appliquer les écarts.</p>
      {done && <div className="flash ok">{done}</div>}
      <div className="card">
        <div className="toolbar">
          <input ref={ref} className="scan-input" autoFocus placeholder="Scanner une étiquette (article, unité ou kit) ou saisir un code…" value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan(code)} style={{ maxWidth: 'none', flex: 1 }} />
          <button className="secondary" onClick={() => setCamera(!camera)}>{camera ? 'Fermer la caméra' : '📷 Caméra'}</button>
          {ses.kits.length > 0 && <button className="secondary" onClick={undoKit}>Annuler le dernier kit</button>}
        </div>
        {camera && <Scanner onCode={scan} onClose={() => setCamera(false)} />}
        {flash && <div className={'flash ' + (flash.ok ? 'ok' : 'ko')}>{flash.msg}{flash.actions?.map((a) => <button key={a.label} className="small" style={{ marginLeft: 10 }} onClick={a.run}>{a.label}</button>)}</div>}
        <div className="toolbar">
          <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Toutes catégories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="check-row"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Seulement les écarts</label>
        </div>
        {rows.length === 0 ? <Empty>Rien à afficher.</Empty> : (
          <div className="table-wrap">
            <table className="list inv-table">
              <thead><tr><th>Article</th><th>Emplacement</th><th className="n">Attendu</th><th>Compté</th><th className="n">Écart</th><th /></tr></thead>
              <tbody>
                {rows.map((e) => {
                  const exp = expected(e);
                  const c = countOf(e);
                  const diff = c === undefined ? null : c - exp;
                  const missingUnits = e.trackSerials && c !== undefined ? unitsHere(e.id).filter((u) => !found.has(u.id)) : [];
                  const defects = av.units.filter((u) => u.equipmentId === e.id && (u.defect || u.status === 'hs')).length;
                  return (
                    <tr key={e.id} className={diff === 0 ? 'done' : diff ? 'missing' : ''}>
                      <td><a href="#" onClick={(ev) => { ev.preventDefault(); setSheet(e.id); }}><strong>{e.name}</strong></a> <span className="muted">{e.code}</span>
                        {e.trackSerials && <span className="muted"> — n° de série</span>}{defects > 0 && <span className="badge st-option" style={{ marginLeft: 4 }}>🔧 {defects}</span>}</td>
                      <td className="muted">{e.location}</td>
                      <td className="n">{exp}</td>
                      <td>{e.trackSerials
                        ? <span>{c ?? 0} / {exp}{missingUnits.length > 0 && <span className="muted"> — pas vues : {missingUnits.map((u) => u.serial).join(', ')}</span>}</span>
                        : <NumInput className="w-qty" value={c ?? NaN} placeholder="—" onChange={(n) => setCount(e.id, n)} aria-label={`Compté ${e.name}`} />}</td>
                      <td className="n">{diff === null ? '' : diff > 0 ? `+${diff}` : diff}</td>
                      <td className="nowrap">
                        {c !== exp && (e.trackSerials
                          ? <button className="secondary small" onClick={() => setSes((s) => ({ ...s, found: Array.from(new Set([...s.found, ...unitsHere(e.id).map((u) => u.id)])) }))}>Toutes présentes</button>
                          : <button className="secondary small" onClick={() => setCount(e.id, exp)}>Conforme ({exp})</button>)}
                        <button className="ghost small" onClick={() => setSheet(e.id)}>Fiche</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {sending && (
        <SendDiffs diffs={diffs} countOf={countOf} expected={expected} unitsHere={unitsHere} found={found} depot={depot} multi={multi} mainDepot={av.mainDepot}
          onClose={(msg) => { setSending(false); if (msg) { setDone(msg); setSes(emptySession()); } }} />
      )}
      {sheet && <ItemSheet id={sheet} onClose={() => setSheet(null)} />}
      {assoc && <AssociateModal code={assoc} equipment={av.equipment} units={av.units} onClose={(ok) => { setAssoc(null); if (ok) setFlash({ ok: true, msg: `Code ${assoc} associé. Scanne-le à nouveau.` }); }} />}
    </>
  );
}

/** Envoi des écarts : vrac corrigé par un mouvement de stock daté ; unités non vues : perdue, en réparation ou rien. */
function SendDiffs({ diffs, countOf, expected, unitsHere, found, depot, multi, mainDepot, onClose }: {
  diffs: Equipment[]; countOf: (e: Equipment) => number | undefined; expected: (e: Equipment) => number; unitsHere: (id: string) => SerialUnit[];
  found: Set<string>; depot: string; multi: boolean; mainDepot: string; onClose: (msg?: string) => void;
}) {
  const bulk = diffs.filter((e) => !e.trackSerials);
  const unseen = diffs.filter((e) => e.trackSerials).flatMap((e) => unitsHere(e.id).filter((u) => !found.has(u.id)).map((u) => ({ e, u })));
  const [choice, setChoice] = useState<Record<string, 'lost' | 'repair' | 'none'>>(() => Object.fromEntries(unseen.map(({ u }) => [u.id, 'lost'])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Appliquer les écarts" onClose={() => onClose()} wide>
      {bulk.length > 0 && (
        <>
          <h3 style={{ marginTop: 0 }}>Stock corrigé</h3>
          <table className="list"><tbody>{bulk.map((e) => {
            const c = countOf(e) ?? 0, x = expected(e);
            return <tr key={e.id}><td>{e.name}</td><td className="n">{x} → <strong>{c}</strong></td><td className="n">{c - x > 0 ? `+${c - x}` : c - x}</td></tr>;
          })}</tbody></table>
        </>
      )}
      {unseen.length > 0 && (
        <>
          <h3>Unités non vues (numéros de série)</h3>
          <p className="muted" style={{ marginTop: 0 }}>Choisis pour chacune : perdue (sort du stock, avec le dernier projet où elle est sortie), en réparation, ou ne rien faire.</p>
          <table className="list"><tbody>{unseen.map(({ e, u }) => (
            <tr key={u.id}><td>{e.name} n° {u.serial}</td><td>
              <select value={choice[u.id]} onChange={(ev) => setChoice({ ...choice, [u.id]: ev.target.value as 'lost' | 'repair' | 'none' })} aria-label={`Unité ${u.serial}`}>
                <option value="lost">Perdue</option><option value="repair">En réparation</option><option value="none">Ne rien faire</option>
              </select>
            </td></tr>
          ))}</tbody></table>
        </>
      )}
      <Field label="Note (facultatif)" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. inventaire annuel" /></Field>
      <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
        <button className="secondary" onClick={() => onClose()}>Annuler</button>
        <button disabled={busy} onClick={async () => {
          setBusy(true);
          let nb = 0, nu = 0;
          for (const e of bulk) {
            const c = countOf(e) ?? 0, x = expected(e);
            if (c === x) continue;
            const txt = `Inventaire : ${c} compté(s), ${x} attendu(s)${note ? ` — ${note}` : ''}`;
            if (multi && depot !== mainDepot) {
              // dépôt secondaire : on corrige son stock propre
              const raw = await db.equipment.get(e.id);
              if (raw) await patch(db.equipment, e.id, { stock: { ...raw.stock, [depot]: c }, quantity: raw.quantity + c - x, stockLog: [...(raw.stockLog || []), { at: new Date().toISOString(), delta: c - x, text: `[${new Date().toLocaleDateString('fr-FR')}] ${txt}` }] });
            } else await stockMove(e.id, c - x, txt);
            nb++;
          }
          for (const { u } of unseen) {
            const ch = choice[u.id];
            if (ch === 'none') continue;
            await setUnitState(u.id, ch, ch === 'lost' ? `à l'inventaire${await lastOutContext(u)}${note ? ` · ${note}` : ''}` : `non trouvée à l'inventaire${note ? ` · ${note}` : ''}`);
            nu++;
          }
          onClose(`Inventaire appliqué : ${nb} article(s) corrigé(s)${nu ? `, ${nu} unité(s) mise(s) à jour` : ''}.`);
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
        {e.location && <><dt>Emplacement</dt><dd>📍 {e.location}</dd></>}
        <dt>Stock</dt><dd><strong>{e.trackSerials ? units.filter((u) => u.status === 'ok').length : e.quantity}</strong>{e.trackSerials && ` unité(s) en service sur ${units.length}`}</dd>
        <dt>Codes en plus</dt><dd>
          {(e.extraCodes || []).map((c) => <span key={c} className="tag small">{c} <button className="ghost small" aria-label={`Retirer ${c}`} onClick={() => removeExtraCode({ equipmentId: e.id }, c)}>✕</button></span>)}
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
