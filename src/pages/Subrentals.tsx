import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { DOC_CSS } from '../components/DocRender';
import { Empty, Field, NumInput, PageHead, useSettings } from '../components/ui';
import { db } from '../db';
import type { Subrental, SubrentStatus } from '../types';
import { SUBRENT_LABELS } from '../types';
import { fmtDate, fmtRange, money, save } from '../utils';

export default function Subrentals() {
  const nav = useNavigate();
  const list = useLiveQuery(() => db.subrentals.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const cMap = new Map(contacts.map((c) => [c.id, c.company]));
  return (
    <>
      <PageHead title="Sous-locations" />
      <div className="info">Une sous-location se crée depuis un projet en manque de matériel (bouton « Sous-louer le manque »). Une fois confirmée, le matériel sous-loué compte dans les disponibilités.</div>
      <div className="card">
        {list.length === 0 ? <Empty>Aucune sous-location.</Empty> : (
          <table className="list">
            <thead><tr><th>N°</th><th>Projet</th><th>Fournisseur</th><th>Période</th><th className="n">Coût</th><th>Statut</th></tr></thead>
            <tbody>
              {list.sort((a, b) => b.start.localeCompare(a.start)).map((s) => (
                <tr key={s.id} className="click" onClick={() => nav('/souslocations/' + s.id)}>
                  <td><strong>{s.number}</strong></td><td>{pMap.get(s.projectId)?.name}</td><td>{s.supplierId ? cMap.get(s.supplierId) : <span className="muted">à choisir</span>}</td>
                  <td>{fmtRange(s.start, s.end)}</td><td className="n">{money(s.lines.reduce((a, l) => a + l.cost, 0))}</td>
                  <td><span className="badge">{SUBRENT_LABELS[s.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function SubrentalDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const sr = useLiveQuery(() => db.subrentals.get(id!), [id]);
  const contacts = useLiveQuery(() => db.contacts.orderBy('company').toArray(), []) || [];
  const project = useLiveQuery(() => (sr ? db.projects.get(sr.projectId) : undefined), [sr?.projectId]);
  if (!sr) return <p>Chargement…</p>;
  const upd = (patch: Partial<Subrental>) => save(db.subrentals, { ...sr, ...patch });
  const supplier = contacts.find((c) => c.id === sr.supplierId);
  const total = sr.lines.reduce((a, l) => a + l.cost, 0);
  const suppliers = contacts.filter((c) => c.type === 'fournisseur' || c.type === 'soustraitant' || c.id === sr.supplierId);

  return (
    <>
      <style>{DOC_CSS}</style>
      <div className="no-print">
        <PageHead title={`Sous-location ${sr.number}`}>
          <button className="secondary" onClick={() => nav('/projets/' + sr.projectId)}>← Projet</button>
          <button onClick={() => window.print()}>Bon de commande (PDF)</button>
          {supplier?.email && <a className="btn secondary" style={{ background: 'var(--soft)', color: 'var(--text)', border: '1px solid var(--border)' }}
            href={`mailto:${supplier.email}?subject=${encodeURIComponent(`Demande de sous-location ${sr.number}`)}&body=${encodeURIComponent(`Bonjour,\n\nPourriez-vous nous confirmer la disponibilité du matériel suivant du ${fmtDate(sr.start)} au ${fmtDate(sr.end)} :\n\n${sr.lines.map((l) => `- ${l.qty} × ${l.name}`).join('\n')}\n\nMerci,\n${settings.company.name}`)}`}>Email au fournisseur</a>}
          <button className="danger" onClick={async () => { if (confirm('Supprimer cette sous-location ?')) { await db.subrentals.delete(sr.id); nav('/souslocations'); } }}>Supprimer</button>
        </PageHead>
        <div className="card">
          <div className="form">
            <Field label="Fournisseur">
              <select value={sr.supplierId || ''} onChange={(e) => upd({ supplierId: e.target.value || undefined })}>
                <option value="">—</option>
                {suppliers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
              </select>
            </Field>
            <Field label="Statut">
              <select value={sr.status} onChange={(e) => upd({ status: e.target.value as SubrentStatus })}>
                {Object.entries(SUBRENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Du"><input type="datetime-local" value={sr.start} onChange={(e) => upd({ start: e.target.value })} /></Field>
            <Field label="Au"><input type="datetime-local" value={sr.end} onChange={(e) => upd({ end: e.target.value })} /></Field>
          </div>
          {suppliers.length === 0 && <p className="muted">Crée tes confrères comme contacts de type « Fournisseur ».</p>}
          <h3 style={{ margin: '16px 0 8px' }}>Matériel</h3>
          <table className="list">
            <thead><tr><th>Qté</th><th>Désignation</th><th>Coût total HT</th><th /></tr></thead>
            <tbody>
              {sr.lines.map((l, i) => {
                const set = (patch: Partial<typeof l>) => upd({ lines: sr.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <tr key={i}>
                    <td><NumInput className="w-qty" step="1" min={0} value={l.qty} onChange={(n) => set({ qty: n })} /></td>
                    <td><input value={l.name} onChange={(e) => set({ name: e.target.value })} /></td>
                    <td><NumInput className="w-price" value={l.cost} onChange={(n) => set({ cost: n })} /></td>
                    <td><button className="ghost" onClick={() => upd({ lines: sr.lines.filter((_, j) => j !== i) })} aria-label="Retirer">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="secondary small" style={{ marginTop: 8 }} onClick={() => upd({ lines: [...sr.lines, { name: '', qty: 1, cost: 0 }] })}>+ Ligne</button>
          <p><strong>Coût total : {money(total)} HT</strong> <span className="muted">(compté dans la marge du projet)</span></p>
          <Field label="Notes" full><textarea value={sr.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></Field>
        </div>
      </div>
      <div className="doc-wrap print-only-doc">
        <div className="doc">
          <div className="head">
            <div>{settings.company.logo && <img src={settings.company.logo} alt="" />}<div><strong>{settings.company.name}</strong></div>
              {settings.company.address && <div style={{ whiteSpace: 'pre-line' }}>{settings.company.address}</div>}</div>
            <div className="box"><h1>Bon de commande</h1><div>N° <strong>{sr.number}</strong></div><div>Date : {fmtDate(new Date().toISOString(), false)}</div>
              {supplier && <div style={{ marginTop: 8 }}><strong>{supplier.company}</strong>{supplier.address && <div>{supplier.address}</div>}</div>}</div>
          </div>
          <p>Sous-location pour le projet <strong>{project?.number} {project?.name}</strong><br />Période : {fmtRange(sr.start, sr.end)}</p>
          <table><thead><tr><th className="n">Qté</th><th>Désignation</th><th className="n">Prix convenu HT</th></tr></thead>
            <tbody>{sr.lines.map((l, i) => <tr key={i}><td className="n">{l.qty}</td><td>{l.name}</td><td className="n">{l.cost ? money(l.cost) : ''}</td></tr>)}</tbody></table>
          {total > 0 && <p className="right"><strong>Total : {money(total)} HT</strong></p>}
          {sr.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{sr.notes}</p>}
        </div>
      </div>
    </>
  );
}
