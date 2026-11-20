import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, NumInput, PageHead, StatusBadge } from '../components/ui';
import { useAvailability } from '../data';
import { db } from '../db';
import type { EquipmentLine } from '../types';
import { blockPeriod, fmtRange, save, toLocalInput } from '../utils';
import { RepairModal } from './Maintenance';
import { addEquipmentToSub } from './project/EquipmentTab';
import { warehouseStatus } from './project/status';
import { FIRM } from '../types';

/** Liste des préparations à venir. */
export default function Warehouse() {
  const nav = useNavigate();
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [onlyReady, setOnlyReady] = useState(false);
  const now = toLocalInput(new Date(Date.now() - 7 * 86400000));
  // l'entrepôt voit les salles confirmées, et celles marquées « prêtes pour la préparation »
  const list = subs
    .filter((s) => (FIRM.includes(s.status) || (s.readyToPack && s.status !== 'annule')) && !pMap.get(s.projectId)?.isTemplate && (!onlyReady || s.readyToPack) && (s.returnEnd || s.end) >= now)
    .sort((a, b) => blockPeriod(a)[0].localeCompare(blockPeriod(b)[0]));

  return (
    <>
      <PageHead title="Entrepôt" />
      <div className="info">Choisis une prestation pour préparer la sortie ou pointer le retour, à la douchette ou avec la caméra du téléphone.
        Les sous-projets confirmés apparaissent ici ; un sous-projet encore en attente apparaît dès qu'il est marqué « prête pour la préparation » (onglet Planning).</div>
      <label className="check-row" style={{ marginBottom: 8 }}><input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> Seulement les sous-projets prêts pour la préparation</label>
      <div className="card">
        {list.length === 0 ? <Empty>Aucune prestation à préparer.</Empty> : (
          <table className="list">
            <thead><tr><th>Projet</th><th>Sous-projet</th><th>Période bloquée</th><th>Statut</th><th className="n">Sortis</th><th className="n">Retournés</th></tr></thead>
            <tbody>
              {list.map((s) => {
                const ls = lines.filter((l) => l.subprojectId === s.id && !l.optional && l.equipmentId);
                const planned = ls.reduce((a, l) => a + l.qty, 0);
                const out = ls.reduce((a, l) => a + (l.outQty || 0), 0);
                const back = ls.reduce((a, l) => a + (l.inQty || 0), 0);
                const [b0, b1] = blockPeriod(s);
                return (
                  <tr key={s.id} className="click" onClick={() => nav('/entrepot/' + s.id)}>
                    <td><strong>{pMap.get(s.projectId)?.name}</strong></td><td>{s.name}</td><td>{fmtRange(b0, b1)}</td>
                    <td><StatusBadge status={s.status} />{s.readyToPack && <span className="badge st-confirme" style={{ marginLeft: 4 }}>prête</span>}</td>
                    <td className="n">{out}/{planned}</td><td className="n">{back}/{out}</td>
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

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }

export function WarehouseScan() {
  const { id } = useParams();
  const sp = useLiveQuery(() => db.subprojects.get(id!), [id]);
  const project = useLiveQuery(() => (sp ? db.projects.get(sp.projectId) : undefined), [sp?.projectId]);
  const av = useAvailability();
  const [mode, setMode] = useState<'sortie' | 'retour'>('sortie');
  const [code, setCode] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; msg: string; addId?: string } | null>(null);
  const [repairFor, setRepairFor] = useState<EquipmentLine | null>(null);
  const [camera, setCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!sp) return <p>Chargement…</p>;
  const lines = av.lines.filter((l) => l.subprojectId === sp.id && !l.optional && l.equipmentId).sort((a, b) => a.order - b.order);
  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));

  const handle = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    setCode('');
    const unit = av.units.find((u) => u.barcode === c || u.serial === c);
    const eq = unit ? eqMap.get(unit.equipmentId) : av.equipment.find((e) => e.barcode === c || e.code === c);
    if (!eq) return setFlash({ ok: false, msg: `Code inconnu : ${c}` });
    const line = lines.find((l) => l.equipmentId === eq.id && !l.parentLineId) || lines.find((l) => l.equipmentId === eq.id);
    if (!line) return setFlash({ ok: false, msg: `${eq.name} n'est pas prévu sur cette prestation.`, addId: mode === 'sortie' ? eq.id : undefined });
    if (mode === 'sortie') {
      if (unit) {
        if (line.outSerials?.includes(unit.serial)) return setFlash({ ok: false, msg: `${eq.name} n° ${unit.serial} est déjà sorti.` });
        const outSerials = [...(line.outSerials || []), unit.serial];
        await save(db.lines, { ...line, outSerials, outQty: outSerials.length });
      } else {
        await save(db.lines, { ...line, outQty: (line.outQty || 0) + 1 });
      }
      const n = (line.outQty || 0) + 1;
      await warehouseStatus(sp.id);
      setFlash({ ok: n <= line.qty, msg: `Sortie : ${eq.name}${unit ? ` n° ${unit.serial}` : ''} — ${n}/${line.qty}${n > line.qty ? ' (plus que prévu !)' : ''}` });
    } else {
      if (unit) {
        if (line.inSerials?.includes(unit.serial)) return setFlash({ ok: false, msg: `${eq.name} n° ${unit.serial} est déjà rentré.` });
        if (line.outSerials?.length && !line.outSerials.includes(unit.serial)) setFlash({ ok: false, msg: `Attention : n° ${unit.serial} n'avait pas été scanné à la sortie.` });
        const inSerials = [...(line.inSerials || []), unit.serial];
        await save(db.lines, { ...line, inSerials, inQty: inSerials.length });
      } else {
        await save(db.lines, { ...line, inQty: (line.inQty || 0) + 1 });
      }
      const n = (line.inQty || 0) + 1;
      const expected = line.outQty || line.qty;
      await warehouseStatus(sp.id);
      setFlash({ ok: true, msg: `Retour : ${eq.name}${unit ? ` n° ${unit.serial}` : ''} — ${n}/${expected}` });
    }
    inputRef.current?.focus();
  };

  const setCount = async (l: EquipmentLine, n: number) => {
    await save(db.lines, mode === 'sortie' ? { ...l, outQty: Math.max(0, n) } : { ...l, inQty: Math.max(0, n) });
    await warehouseStatus(sp.id);
  };
  const planned = lines.reduce((a, l) => a + l.qty, 0);
  const out = lines.reduce((a, l) => a + (l.outQty || 0), 0);
  const back = lines.reduce((a, l) => a + (l.inQty || 0), 0);
  const target = mode === 'sortie' ? planned : out;
  const doneCount = mode === 'sortie' ? out : back;
  const missing = mode === 'retour' ? lines.filter((l) => (l.inQty || 0) < (l.outQty || 0)) : [];

  return (
    <>
      <PageHead title={`Entrepôt — ${project?.name || ''} · ${sp.name}`}>
        <Link to={'/projets/' + sp.projectId}><button className="secondary">← Projet</button></Link>
        <div className="tabs" style={{ margin: 0, border: 0 }}>
          <button className={mode === 'sortie' ? 'on' : ''} onClick={() => { setMode('sortie'); setFlash(null); }}>Sortie</button>
          <button className={mode === 'retour' ? 'on' : ''} onClick={() => { setMode('retour'); setFlash(null); }}>Retour</button>
        </div>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <input ref={inputRef} className="scan-input" autoFocus placeholder={`Scanner un code-barres (${mode})…`} value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handle(code)} style={{ maxWidth: 'none', flex: 1 }} />
          {'BarcodeDetector' in window && <button className="secondary" onClick={() => setCamera(!camera)}>{camera ? 'Fermer la caméra' : '📷 Caméra'}</button>}
        </div>
        {camera && <CameraScanner onCode={handle} />}
        {flash && (
          <div className={'flash ' + (flash.ok ? 'ok' : 'ko')}>
            {flash.msg}
            {flash.addId && <button className="small" style={{ marginLeft: 10 }} onClick={async () => {
              await addEquipmentToSub(sp, av.equipment, av.lines.filter((l) => l.subprojectId === sp.id), { [flash.addId!]: 1 });
              setFlash({ ok: true, msg: 'Ajouté au projet. Scanne à nouveau pour le sortir.' });
            }}>Ajouter au projet</button>}
          </div>
        )}
        <div className="progress"><div style={{ width: `${target ? Math.min(100, (doneCount / target) * 100) : 0}%` }} /></div>
        <p className="muted">{mode === 'sortie' ? `${out} / ${planned} articles sortis` : `${back} / ${out} articles retournés`}</p>
      </div>

      <div className="card">
        {lines.length === 0 ? <Empty>Aucun matériel sur cette prestation.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Article</th><th>Emplacement</th><th className="n">Prévu</th><th>Sortis</th><th>Retournés</th><th /></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const eq = eqMap.get(l.equipmentId!);
                  const o = l.outQty || 0, i = l.inQty || 0;
                  const done = mode === 'sortie' ? o >= l.qty : i >= o && o > 0;
                  const miss = mode === 'retour' && i < o;
                  const serial = eq?.trackSerials;
                  return (
                    <tr key={l.id} className={done ? 'done' : miss ? 'missing' : ''}>
                      <td>{l.parentLineId && <span className="muted">↳ </span>}<strong>{l.name}</strong>
                        {serial && (l.outSerials?.length ? <div className="muted" style={{ fontSize: 11 }}>n° {l.outSerials.map((s) => (l.inSerials?.includes(s) ? `${s} ✓` : s)).join(', ')}</div> : null)}</td>
                      <td className="muted">{eq?.location}</td>
                      <td className="n">{l.qty}</td>
                      <td>{mode === 'sortie' && !serial ? <NumInput className="w-qty" step="1" min={0} value={o} onChange={(n) => setCount(l, n)} /> : o}</td>
                      <td>{mode === 'retour' && !serial ? <NumInput className="w-qty" step="1" min={0} value={i} onChange={(n) => setCount(l, n)} /> : i}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {mode === 'sortie' && !serial && o < l.qty && <button className="secondary small" onClick={() => setCount(l, l.qty)}>Tout</button>}
                        {mode === 'retour' && !serial && i < o && <button className="secondary small" onClick={() => setCount(l, o)}>Tout</button>}
                        {mode === 'retour' && <> <button className="secondary small" onClick={() => setRepairFor(l)}>Cassé</button></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {missing.length > 0 && (
          <div className="alert" style={{ marginTop: 12 }}>
            <strong>Manquants au retour :</strong> {missing.map((l) => `${(l.outQty || 0) - (l.inQty || 0)} × ${l.name}`).join(', ')}
          </div>
        )}
      </div>
      {repairFor && <RepairModal equipmentId={repairFor.equipmentId!} onClose={() => setRepairFor(null)} />}
    </>
  );
}

/** Lecture de code-barres par la caméra (Chrome Android, Edge…). */
function CameraScanner({ onCode }: { onCode: (c: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | undefined;
    let stop = false;
    let last = '';
    let lastAt = 0;
    const Ctor = (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector;
    const detector = new Ctor();
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const loop = async () => {
          if (stop || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const v = codes[0]?.rawValue;
            if (v && (v !== last || Date.now() - lastAt > 2000)) { last = v; lastAt = Date.now(); cb.current(v); }
          } catch { /* image pas prête */ }
          setTimeout(loop, 250);
        };
        loop();
      } catch {
        setErr("Impossible d'ouvrir la caméra (autorisation refusée ?).");
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return err ? <p className="avail ko">{err}</p> : <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 420, borderRadius: 10, marginBottom: 10 }} />;
}
