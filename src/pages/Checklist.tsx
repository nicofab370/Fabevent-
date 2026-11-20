import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Modal, PageHead, StatusBadge } from '../components/ui';
import { Scanner } from '../components/Scanner';
import { addExtraCode, findByCode, setUnitState, unitState, type CodeHit } from '../codes';
import { useAvailability } from '../data';
import { db } from '../db';
import { importFile, rowsFromText, type ImportedList } from '../importList';
import type { Equipment, EquipmentLine, FreeChecklist, FreeLine, SerialUnit, Subproject } from '../types';
import { fmtDate, nowIso, patch, save, uid } from '../utils';
import { RepairModal } from './Maintenance';
import { addEquipmentToSub } from './project/EquipmentTab';
import { warehouseStatus } from './project/status';

/*
 * Checklist de sortie et de retour (reprise de la Checklist FABRI.live, désormais native) :
 * la même liste se compte deux fois — à la sortie sur le prévu, au retour sur ce qui est sorti.
 * Scan à la douchette ou à la caméra (ZXing), unités sérialisées, « ajouter en plus », unités à réparer,
 * bilan du retour et déclaration des pertes avec historique daté.
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
}

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
  missingSent?: boolean;
  setCount: (key: string, phase: Phase, n: number) => Promise<void>;
  setSerials: (key: string, phase: Phase, serials: string[]) => Promise<void>;
  /** article scanné hors liste : on l'ajoute (+n) */
  addExtra?: (equipmentId: string, n: number) => Promise<void>;
  /** une ligne de plus sur une ligne existante */
  bumpQty: (key: string, n: number) => Promise<void>;
  markMissingSent: () => Promise<void>;
}

const target = (l: CLine, ph: Phase) => (ph === 'sortie' ? l.qty : l.out);
const counted = (l: CLine, ph: Phase) => (ph === 'sortie' ? l.out : l.back);

interface Flash { ok: boolean; msg: string; actions?: { label: string; run: () => void | Promise<void> }[] }

export function ChecklistView({ src }: { src: ChecklistSource }) {
  const av = useAvailability();
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [assoc, setAssoc] = useState<string | null>(null);
  const [broken, setBroken] = useState<CLine | null>(null);
  const [summary, setSummary] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ph = src.phase;
  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));
  const isSerial = (l: CLine) => !!(l.equipmentId && eqMap.get(l.equipmentId)?.trackSerials);
  const lines = src.lines.filter((l) => ph === 'sortie' || l.out > 0 || l.back > 0);
  const total = lines.reduce((a, l) => a + target(l, ph), 0);
  const done = lines.reduce((a, l) => a + Math.min(counted(l, ph), target(l, ph)), 0);

  const say = (f: Flash) => { setFlash(f); if (navigator.vibrate) navigator.vibrate(f.ok ? 60 : [80, 60, 80]); };

  /** Compte un scan ; renvoie true (✓) ou false (✕) pour la caméra. */
  const handle = async (raw: string): Promise<boolean> => {
    const c = raw.trim();
    setCode('');
    if (!c) return false;
    const hit: CodeHit | undefined = findByCode(c, av.equipment, av.units);
    if (!hit) {
      say({ ok: false, msg: `Code inconnu : ${c}`, actions: [{ label: 'Associer à un article…', run: () => setAssoc(c) }] });
      return false;
    }
    const { equipment: eq, unit } = hit;
    // unité perdue, en réparation ou à réparer
    if (unit) {
      const st = unitState(unit);
      if (st === 'lost') {
        say({ ok: false, msg: `${eq.name} n° ${unit.serial} est déclarée perdue.`, actions: [{ label: 'Retrouvée : la remettre en stock', run: async () => { await setUnitState(unit.id, 'ok', `scannée (${src.label})`, src.projectId); setFlash({ ok: true, msg: 'Remise en stock. Scanne-la à nouveau pour la compter.' }); } }] });
        return false;
      }
      if (st === 'repair' && ph === 'sortie') {
        say({ ok: false, msg: `🔧 ${eq.name} n° ${unit.serial} est en réparation (hors service) : ne pas la sortir.` });
        return false;
      }
    }
    const candidates = src.lines.filter((l) => l.equipmentId === eq.id);
    const line = candidates.find((l) => counted(l, ph) < target(l, ph)) || candidates[0];
    if (!line) {
      say({
        ok: false, msg: `${eq.name} n'est pas prévu sur cette liste.`,
        actions: ph === 'sortie' && src.addExtra ? [{ label: 'Ajouter en plus (+1)', run: async () => { await src.addExtra!(eq.id, 1); setFlash({ ok: true, msg: `${eq.name} ajouté. Scanne-le à nouveau pour le compter.` }); } }] : [],
      });
      return false;
    }
    const serials = ph === 'sortie' ? line.outSerials : line.inSerials;
    if (unit && isSerial(line)) {
      if (serials.includes(unit.serial)) { say({ ok: false, msg: `${eq.name} n° ${unit.serial} est déjà ${ph === 'sortie' ? 'sorti' : 'rentré'}.` }); return false; }
      const warn = ph === 'retour' && line.outSerials.length && !line.outSerials.includes(unit.serial) ? ` (n'avait pas été scannée à la sortie)` : '';
      if (ph === 'sortie' && serials.length >= line.qty) {
        say({ ok: false, msg: `${eq.name} : ${line.qty}/${line.qty} déjà sortis.`, actions: [{ label: 'Oui, +1', run: async () => { await src.bumpQty(line.key, 1); await src.setSerials(line.key, ph, [...serials, unit.serial]); setFlash({ ok: true, msg: `Ajouté en plus : ${eq.name} n° ${unit.serial}` }); } }] });
        return false;
      }
      await src.setSerials(line.key, ph, [...serials, unit.serial]);
      const n = serials.length + 1;
      say({ ok: true, msg: `${ph === 'sortie' ? 'Sortie' : 'Retour'} : ${eq.name} n° ${unit.serial} — ${n}/${target(line, ph) || n}${warn}${unit.defect ? ` · ⚠ à réparer : ${unit.defect}` : ''}` });
      return true;
    }
    const cur = counted(line, ph);
    if (cur >= target(line, ph)) {
      if (ph === 'sortie') {
        say({ ok: false, msg: `${eq.name} : ${cur}/${line.qty}, tout est déjà sorti.`, actions: [{ label: 'Oui, +1', run: async () => { await src.bumpQty(line.key, 1); await src.setCount(line.key, ph, cur + 1); setFlash({ ok: true, msg: `Ajouté en plus : ${eq.name} (${cur + 1})` }); } }] });
      } else say({ ok: false, msg: `${eq.name} : tout ce qui est sorti est déjà rentré (${cur}).` });
      return false;
    }
    await src.setCount(line.key, ph, cur + 1);
    say({ ok: true, msg: `${ph === 'sortie' ? 'Sortie' : 'Retour'} : ${eq.name} — ${cur + 1}/${target(line, ph)}` });
    inputRef.current?.focus();
    return true;
  };

  const cats = Array.from(new Set(lines.map((l) => l.cat)));
  const missing = src.lines.filter((l) => l.back < l.out);

  return (
    <>
      <PageHead title={src.title}>
        {src.backTo && <Link to={src.backTo.to}><button className="secondary">← {src.backTo.label}</button></Link>}
        <div className="tabs" style={{ margin: 0, border: 0 }}>
          <button className={ph === 'sortie' ? 'on' : ''} onClick={() => { src.setPhase('sortie'); setFlash(null); }}>↑ Sortie</button>
          <button className={ph === 'retour' ? 'on' : ''} onClick={() => { src.setPhase('retour'); setFlash(null); }}>↓ Retour</button>
        </div>
        {ph === 'retour' && <button onClick={() => setSummary(true)}>Bilan du retour</button>}
      </PageHead>
      {src.subtitle && <div className="info">{src.subtitle}</div>}
      <div className="card checklist-scan">
        <div className="toolbar">
          <input ref={inputRef} className="scan-input" autoFocus placeholder={`Scanner (${ph === 'sortie' ? 'sortie' : 'retour'}) à la douchette ou taper un code…`} value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handle(code)} style={{ maxWidth: 'none', flex: 1 }} />
          <button className="secondary" onClick={() => setCamera(!camera)}>{camera ? 'Fermer la caméra' : '📷 Caméra'}</button>
        </div>
        {camera && <Scanner onCode={handle} onClose={() => setCamera(false)} />}
        {flash && (
          <div className={'flash ' + (flash.ok ? 'ok' : 'ko')}>
            {flash.msg}
            {flash.actions?.map((a) => <button key={a.label} className="small" style={{ marginLeft: 10 }} onClick={() => a.run()}>{a.label}</button>)}
          </div>
        )}
        <div className="progress"><div style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} /></div>
        <p className="muted" style={{ marginBottom: 0 }}>{ph === 'sortie' ? `${done} / ${total} articles sortis` : `${done} / ${total} articles rentrés`}</p>
      </div>

      {lines.length === 0 ? <div className="card"><Empty>{ph === 'retour' ? 'Rien n\'est encore sorti.' : 'Aucun matériel sur cette liste.'}</Empty></div> : cats.map((cat) => (
        <div key={cat} className="card checklist-cat">
          <h3 style={{ marginTop: 0 }}>{cat}</h3>
          {lines.filter((l) => l.cat === cat).map((l) => {
            const n = counted(l, ph), t = target(l, ph), serial = isSerial(l);
            const state = n >= t && t > 0 ? 'done' : n > 0 ? 'part' : 'none';
            const units = serial ? (l.equipmentId ? av.units.filter((u) => u.equipmentId === l.equipmentId) : []) : [];
            return (
              <div key={l.key} className={'cl-line ' + state + (l.parentKey ? ' kid' : '')} data-line={l.name}>
                <button className="cl-check" aria-label={state === 'done' ? 'Décocher' : 'Tout cocher'} disabled={serial}
                  onClick={() => src.setCount(l.key, ph, state === 'done' ? 0 : t)}>{state === 'done' ? '✓' : state === 'part' ? '◐' : ''}</button>
                <div className="cl-name">
                  <div className="cl-title"><strong>{l.name}</strong></div>
                  {(l.code || l.location || l.remark) && (
                    <div className="cl-meta">{[l.code, l.location && `📍 ${l.location}`, l.remark].filter(Boolean).join(' · ')}</div>
                  )}
                  {serial && (
                    <div className="cl-units">
                      {(ph === 'sortie' ? l.outSerials : l.outSerials).map((s) => {
                        const u = units.find((x) => x.serial === s);
                        const back = l.inSerials.includes(s);
                        return <span key={s} className={'unit-chip' + (ph === 'retour' ? (back ? ' ok' : ' miss') : ' ok')} title={u?.defect ? `À réparer : ${u.defect}` : ''}>n° {s}{ph === 'retour' && back ? ' ✓' : ''}{u?.defect ? ' 🔧' : ''}</span>;
                      })}
                      {ph === 'sortie' && l.outSerials.length < l.qty && <span className="muted cl-hint">📷 scanne chaque unité</span>}
                    </div>
                  )}
                </div>
                <div className="cl-count">
                  {!serial && <button className="ghost" aria-label="Moins" onClick={() => src.setCount(l.key, ph, Math.max(0, n - 1))}>−</button>}
                  <span className="cl-n" title={serial ? 'Scanne chaque unité' : undefined}>{serial && '📷 '}<b>{n}</b>/{t}</span>
                  {!serial && <button className="ghost" aria-label="Plus" onClick={() => (n < t || ph === 'retour' ? src.setCount(l.key, ph, Math.min(n + 1, ph === 'retour' ? t : n + 1)) : src.bumpQty(l.key, 1).then(() => src.setCount(l.key, ph, n + 1)))}>+</button>}
                  {!serial && n < t && <button className="secondary small cl-all" onClick={() => src.setCount(l.key, ph, t)}>Tout</button>}
                  {ph === 'retour' && l.equipmentId && <button className="secondary small" onClick={() => setBroken(l)}>Cassé</button>}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {ph === 'retour' && missing.length > 0 && !summary && (
        <div className="alert">
          <strong>Pas encore rentré :</strong> {missing.map((l) => `${l.out - l.back} × ${l.name}`).join(', ')} — <a href="#" onClick={(e) => { e.preventDefault(); setSummary(true); }}>bilan du retour</a>
        </div>
      )}

      {summary && <ReturnSummary src={src} units={av.units} equipment={av.equipment} onClose={() => setSummary(false)} />}
      {assoc && <AssociateModal code={assoc} equipment={av.equipment} units={av.units} onClose={(ok) => { setAssoc(null); if (ok) setFlash({ ok: true, msg: `Code ${assoc} associé. Scanne-le à nouveau.` }); }} />}
      {broken && <BrokenModal line={broken} src={src} units={av.units} onClose={() => setBroken(null)} />}
    </>
  );
}

/**
 * Bilan du retour : ce qui est sorti et pas rentré. « Déclarer perdu » met les unités en « perdue »
 * (historique daté avec le projet) et retire le vrac manquant du stock (mouvement de stock daté).
 */
function ReturnSummary({ src, units, equipment, onClose }: { src: ChecklistSource; units: SerialUnit[]; equipment: Equipment[]; onClose: () => void }) {
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const missing = src.lines.filter((l) => l.back < l.out);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const rows = missing.map((l) => {
    const serial = !!(l.equipmentId && eqMap.get(l.equipmentId)?.trackSerials);
    const lostSerials = serial ? l.outSerials.filter((s) => !l.inSerials.includes(s)) : [];
    return { l, serial, lostSerials, qty: l.out - l.back };
  });
  return (
    <Modal title="Bilan du retour" onClose={onClose} wide>
      {rows.length === 0 ? <p className="avail ok" style={{ fontSize: 16 }}>Tout ce qui est sorti est rentré ✓</p> : (
        <>
          <table className="list">
            <thead><tr><th>Article</th><th className="n">Sortis</th><th className="n">Rentrés</th><th className="n">Manquent</th><th>Unités</th></tr></thead>
            <tbody>{rows.map(({ l, lostSerials, qty }) => (
              <tr key={l.key}><td><strong>{l.name}</strong></td><td className="n">{l.out}</td><td className="n">{l.back}</td><td className="n avail ko">{qty}</td><td>{lostSerials.map((s) => `n° ${s}`).join(', ')}</td></tr>
            ))}</tbody>
          </table>
          {src.missingSent ? <p className="muted">Les manquants de cette liste ont déjà été déclarés perdus.</p> : (
            <p className="muted">« Déclarer perdu » retire le matériel manquant du stock, avec la date et le projet dans l'historique de chaque article ou unité.
              Si tu le retrouves plus tard, scanne-le : il sera proposé de le remettre en stock.</p>
          )}
          {done && <div className="flash ok">{done}</div>}
        </>
      )}
      <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
        <button className="secondary" onClick={onClose}>Fermer</button>
        {rows.length > 0 && !src.missingSent && (
          <button className="danger" disabled={busy} onClick={async () => {
            if (!confirm(`Déclarer perdu le matériel manquant (${rows.reduce((a, r) => a + r.qty, 0)} article(s)) ?`)) return;
            setBusy(true);
            let n = 0;
            for (const r of rows) {
              if (r.serial) {
                for (const s of r.lostSerials) {
                  const u = units.find((x) => x.equipmentId === r.l.equipmentId && x.serial === s);
                  if (u) { await setUnitState(u.id, 'lost', `au retour — ${src.label}`, src.projectId); n++; }
                }
              } else if (r.l.equipmentId) {
                await stockMove(r.l.equipmentId, -r.qty, `PERDU au retour — ${src.label}`, src.projectId);
                n += r.qty;
              }
            }
            await src.markMissingSent();
            setBusy(false);
            setDone(`${n} article(s) déclaré(s) perdu(s).`);
          }}>Déclarer perdu</button>
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
    quantity: Math.max(0, e.quantity + delta),
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
                {eqUnits.map((u) => <option key={u.id} value={u.id}>n° {u.serial}</option>)}
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
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>{lineUnits.map((u) => <option key={u.id} value={u.id}>n° {u.serial}</option>)}</select>
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
  const catName = new Map(categories.map((c) => [c.id, c.name]));
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
      parentKey: l.parentLineId, location: e?.location, remark: [l.internalRemark || l.remark, kit.replace(/^ · /, '')].filter(Boolean).join(' — ') || undefined,
    };
  };
  const after = () => warehouseStatus(sp.id);
  const src: ChecklistSource = {
    title: `${project.name} · ${sp.name}`,
    subtitle: `${project.number} · ${fmtDate(sp.prepStart || sp.start)} → ${fmtDate(sp.returnEnd || sp.end)}${project.venue ? ` · ${project.venue}` : ''}`,
    backTo: { to: '/projets/' + project.id, label: 'Projet' },
    projectId: project.id,
    label: `Projet ${project.number} ${project.name}`,
    phase, setPhase,
    lines: raw.map(toC),
    missingSent: sp.missingSent,
    setCount: async (key, ph, n) => { await patch(db.lines, key, ph === 'sortie' ? { outQty: Math.max(0, n) } : { inQty: Math.max(0, n) }); await after(); },
    setSerials: async (key, ph, serials) => { await patch(db.lines, key, ph === 'sortie' ? { outSerials: serials, outQty: serials.length } : { inSerials: serials, inQty: serials.length }); await after(); },
    addExtra: (equipmentId, n) => addEquipmentToSub(sp as Subproject, av.equipment, av.lines.filter((l) => l.subprojectId === sp.id), { [equipmentId]: n }),
    bumpQty: async (key, n) => { const l = await db.lines.get(key); if (l) await patch(db.lines, key, { qty: l.qty + n }); },
    markMissingSent: async () => { await patch(db.subprojects, sp.id, { missingSent: true }); },
  };
  return <><div className="no-print" style={{ marginBottom: 6 }}><StatusBadge status={sp.status} /></div><ChecklistView src={src} /></>;
}

/* ---------- Source : checklist libre (bon importé) ---------- */

export function FreeChecklistPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const cl = useLiveQuery(() => db.checklists.get(id!), [id]);
  const av = useAvailability();
  const [adding, setAdding] = useState(false);
  if (!cl) return <p>Chargement…</p>;
  const setLines = (fn: (ls: FreeLine[]) => FreeLine[]) => db.transaction('rw', db.checklists, async () => {
    const fresh = await db.checklists.get(cl.id);
    if (fresh) await patch(db.checklists, cl.id, { lines: fn(fresh.lines) });
  });
  const updLine = (key: string, c: Partial<FreeLine>) => setLines((ls) => ls.map((l) => (l.id === key ? { ...l, ...c } : l)));
  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));
  const src: ChecklistSource = {
    title: cl.title || 'Checklist',
    subtitle: [...Object.entries(cl.meta).map(([k, v]) => `${k} : ${v}`), ...cl.plan.map((p) => `${p.label} ${p.from} → ${p.to}`)].join(' · ') || undefined,
    backTo: { to: '/checklists', label: 'Checklists' },
    label: cl.title,
    phase: cl.phase, setPhase: (p) => patch(db.checklists, cl.id, { phase: p }),
    lines: cl.lines.map((l) => ({
      key: l.id, name: l.name, code: l.code, equipmentId: l.equipmentId, qty: l.qty, out: l.out, back: l.back,
      outSerials: l.outSerials || [], inSerials: l.inSerials || [], cat: l.cat, parentKey: l.parent || undefined,
      location: l.equipmentId ? eqMap.get(l.equipmentId)?.location : undefined,
    })),
    missingSent: cl.missingSent,
    setCount: (key, ph, n) => updLine(key, ph === 'sortie' ? { out: Math.max(0, n) } : { back: Math.max(0, n) }),
    setSerials: (key, ph, serials) => updLine(key, ph === 'sortie' ? { outSerials: serials, out: serials.length } : { inSerials: serials, back: serials.length }),
    addExtra: async (equipmentId, n) => {
      const e = eqMap.get(equipmentId);
      if (e) await setLines((ls) => [...ls, { id: uid(), cat: 'Ajouté en plus', parent: null, qty: n, name: e.name, code: e.code, equipmentId, out: 0, back: 0 }]);
    },
    bumpQty: (key, n) => setLines((ls) => ls.map((l) => (l.id === key ? { ...l, qty: l.qty + n } : l))),
    markMissingSent: async () => { await patch(db.checklists, cl.id, { missingSent: true }); },
  };
  return (
    <>
      <ChecklistView src={src} />
      <div className="toolbar no-print">
        <button className="secondary" onClick={() => setAdding(true)}>+ Ajouter une ligne</button>
        <button className="danger" onClick={async () => { if (confirm('Supprimer cette checklist ?')) { await db.checklists.delete(cl.id); nav('/checklists'); } }}>Supprimer la checklist</button>
      </div>
      {adding && <AddLineModal equipment={av.equipment} cats={Array.from(new Set(cl.lines.map((l) => l.cat)))} onClose={async (l) => { setAdding(false); if (l) await setLines((ls) => [...ls, l]); }} />}
    </>
  );
}

function AddLineModal({ equipment, cats, onClose }: { equipment: Equipment[]; cats: string[]; onClose: (l?: FreeLine) => void }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [cat, setCat] = useState(cats[0] || 'Matériel');
  const match = equipment.find((e) => e.name.toLowerCase() === name.trim().toLowerCase() || (e.code && e.code.toLowerCase() === name.trim().toLowerCase()));
  return (
    <Modal title="Ajouter une ligne" onClose={() => onClose()}>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        onClose({ id: uid(), cat: cat.trim() || 'Matériel', parent: null, qty: Math.max(1, parseInt(qty) || 1), name: match?.name || name.trim(), code: match?.code, equipmentId: match?.id, out: 0, back: 0 });
      }}>
        <Field label="Article (nom ou code du catalogue, ou texte libre)" full>
          <input autoFocus required list="cl-eq" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="cl-eq">{equipment.filter((e) => !e.archived).map((e) => <option key={e.id} value={e.name}>{e.code}</option>)}</datalist>
          {match && <small className="muted">Reconnu dans le catalogue : se scanne.</small>}
        </Field>
        <Field label="Quantité"><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Catégorie"><input list="cl-cats" value={cat} onChange={(e) => setCat(e.target.value)} /><datalist id="cl-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <div className="form-actions"><button type="button" className="secondary" onClick={() => onClose()}>Annuler</button><button type="submit">Ajouter</button></div>
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

/** Liste des checklists libres : import d'un bon (PDF, Word, HTML, texte) ou texte collé. */
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
      <div className="card">
        {lists.length === 0 ? <Empty>Aucune checklist pour l'instant.</Empty> : (
          <table className="list">
            <thead><tr><th>Checklist</th><th>Infos</th><th className="n">Sortis</th><th className="n">Rentrés</th><th>Modifiée</th></tr></thead>
            <tbody>
              {lists.map((c) => {
                const qty = c.lines.reduce((a, l) => a + l.qty, 0), out = c.lines.reduce((a, l) => a + l.out, 0), back = c.lines.reduce((a, l) => a + l.back, 0);
                return (
                  <tr key={c.id} className="click" onClick={() => nav('/checklists/' + c.id)}>
                    <td><strong>{c.title}</strong></td>
                    <td className="muted">{Object.values(c.meta).slice(0, 2).join(' · ')}</td>
                    <td className="n">{out}/{qty}</td><td className="n">{back}/{out}</td>
                    <td>{fmtDate(c.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
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
