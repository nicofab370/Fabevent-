import { useRef, useState } from 'react';
import { Empty, NumInput, PageHead } from '../components/ui';
import { useAvailability } from '../data';
import { db } from '../db';
import { money, save, stockIn } from '../utils';

/** Comptage d'inventaire : scan ou saisie, écarts avec le stock théorique, mise à jour du stock. */
export default function Inventory() {
  const av = useAvailability();
  const multi = av.depots.length > 1;
  const [depot, setDepot] = useState(av.mainDepot);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [found, setFound] = useState<Set<string>>(new Set());
  const [code, setCode] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [done, setDone] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const dep = multi ? depot : undefined;
  const unitsHere = (eqId: string) => av.units.filter((u) => u.equipmentId === eqId && u.status === 'ok' && (!multi || (u.depotId || av.mainDepot) === depot));
  const items = av.equipment.filter((e) => !e.isKit && !e.archived);
  const expected = (eqId: string) => {
    const e = items.find((x) => x.id === eqId)!;
    return e.trackSerials ? unitsHere(eqId).length : stockIn(e, dep);
  };
  const countOf = (eqId: string) => {
    const e = items.find((x) => x.id === eqId)!;
    return e.trackSerials ? unitsHere(eqId).filter((u) => found.has(u.id)).length : counted[eqId];
  };

  const scan = (raw: string) => {
    const c = raw.trim();
    setCode('');
    if (!c) return;
    const unit = av.units.find((u) => u.barcode === c || u.serial === c);
    if (unit) {
      const e = items.find((x) => x.id === unit.equipmentId);
      if (found.has(unit.id)) return setFlash({ ok: false, msg: `${e?.name} n° ${unit.serial} déjà compté.` });
      setFound(new Set([...found, unit.id]));
      return setFlash({ ok: true, msg: `${e?.name} n° ${unit.serial} trouvé.` });
    }
    const e = items.find((x) => x.barcode === c || x.code === c);
    if (!e) return setFlash({ ok: false, msg: `Code inconnu : ${c}` });
    if (e.trackSerials) return setFlash({ ok: false, msg: `${e.name} est suivi par numéro de série : scanne l'étiquette de l'unité.` });
    const n = (counted[e.id] || 0) + 1;
    setCounted({ ...counted, [e.id]: n });
    setFlash({ ok: true, msg: `${e.name} : ${n} compté(s)` });
    ref.current?.focus();
  };

  const rows = items.filter((e) => {
    const c = countOf(e.id);
    return !onlyDiff || (c !== undefined && c !== expected(e.id));
  });
  const touched = items.filter((e) => countOf(e.id) !== undefined && (e.trackSerials ? found.size > 0 : true));
  const diffs = touched.filter((e) => countOf(e.id) !== expected(e.id));
  const value = items.reduce((a, e) => a + (e.replacementValue || 0) * e.quantity, 0);

  const apply = async () => {
    const lost = items.filter((e) => e.trackSerials && unitsHere(e.id).some((u) => found.has(u.id))).flatMap((e) => unitsHere(e.id).filter((u) => !found.has(u.id)));
    if (!confirm(`Mettre à jour ${diffs.length} article(s)${lost.length ? ` et marquer ${lost.length} unité(s) non trouvée(s) comme perdue(s)` : ''} ?`)) return;
    for (const e of diffs) {
      if (e.trackSerials) continue;
      const raw = await db.equipment.get(e.id);
      if (!raw) continue;
      const n = counted[e.id] ?? 0;
      if (multi && depot !== av.mainDepot) {
        const old = raw.stock?.[depot] || 0;
        await save(db.equipment, { ...raw, stock: { ...raw.stock, [depot]: n }, quantity: raw.quantity - old + n });
      } else {
        await save(db.equipment, { ...raw, quantity: raw.quantity - stockIn(e, dep) + n });
      }
    }
    for (const u of lost) await save(db.units, { ...u, status: 'perdu', notes: `${u.notes ? u.notes + '\n' : ''}Non trouvé à l'inventaire du ${new Date().toLocaleDateString('fr-FR')}` });
    setDone(`Inventaire appliqué : ${diffs.length} article(s) corrigé(s)${lost.length ? `, ${lost.length} unité(s) perdue(s)` : ''}.`);
    setCounted({}); setFound(new Set());
  };

  return (
    <>
      <PageHead title="Inventaire">
        {multi && (
          <select value={depot} onChange={(e) => { setDepot(e.target.value); setCounted({}); setFound(new Set()); }} style={{ width: 'auto' }}>
            {av.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <button disabled={!diffs.length} onClick={apply}>Appliquer {diffs.length} écart(s)</button>
      </PageHead>
      <div className="stats">
        <div className="stat"><b>{items.reduce((a, e) => a + e.quantity, 0)}</b><span>pièces au parc</span></div>
        <div className="stat"><b>{money(value)}</b><span>valeur de remplacement du parc</span></div>
        <div className="stat"><b>{touched.length}</b><span>articles comptés</span></div>
        <div className="stat"><b style={{ color: diffs.length ? 'var(--danger)' : undefined }}>{diffs.length}</b><span>écarts</span></div>
      </div>
      {done && <div className="flash ok">{done}</div>}
      <div className="card">
        <div className="toolbar">
          <input ref={ref} className="scan-input" autoFocus placeholder="Scanner une étiquette ou saisir un code…" value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan(code)} style={{ maxWidth: 'none', flex: 1 }} />
          <label className="check-row"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Seulement les écarts</label>
        </div>
        {flash && <div className={'flash ' + (flash.ok ? 'ok' : 'ko')}>{flash.msg}</div>}
        {rows.length === 0 ? <Empty>Rien à afficher.</Empty> : (
          <table className="list">
            <thead><tr><th>Article</th><th>Emplacement</th><th className="n">Théorique</th><th>Compté</th><th className="n">Écart</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const exp = expected(e.id);
                const c = countOf(e.id);
                const diff = c === undefined ? null : c - exp;
                return (
                  <tr key={e.id} className={diff === 0 ? 'done' : diff ? 'missing' : ''}>
                    <td>{e.name}{e.trackSerials && <span className="muted"> — n° de série</span>}</td>
                    <td className="muted">{e.location}</td>
                    <td className="n">{exp}</td>
                    <td>{e.trackSerials
                      ? <span>{c} / {exp}{unitsHere(e.id).filter((u) => !found.has(u.id)).length > 0 && found.size > 0 && <span className="muted"> — manque {unitsHere(e.id).filter((u) => !found.has(u.id)).map((u) => u.serial).join(', ')}</span>}</span>
                      : <NumInput className="w-qty" step="1" min={0} value={c ?? 0} onChange={(n) => setCounted({ ...counted, [e.id]: n })} />}</td>
                    <td className="n">{diff === null ? '—' : <span className={'avail ' + (diff === 0 ? 'ok' : 'ko')}>{diff > 0 ? '+' : ''}{diff}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
