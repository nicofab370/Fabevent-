import { useLiveQuery } from 'dexie-react-hooks';
import { unitNo } from '../unitNumbers';
import { setUnitState, UNIT_STATE_LABELS, unitState } from '../codes';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead } from '../components/ui';
import { useAvailability } from '../data';
import { db } from '../db';
import type { Inspection, Repair } from '../types';
import { fmtDate, inspectionsDue, money, save, toLocalInput } from '../utils';
import { CsvButton, exportCsv } from '../components/extra';

export function RepairModal({ equipmentId, unitId, repair, onClose }: { equipmentId: string; unitId?: string; repair?: Repair; onClose: () => void }) {
  const suppliers = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const [r, setR] = useState<Partial<Repair>>(repair || { equipmentId, unitId, qty: 1, start: toLocalInput(new Date()), status: 'ouvert', description: '', cost: 0 });
  return (
    <Modal title={repair ? 'Réparation' : 'Déclarer une réparation'} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        await save(db.repairs, { ...r, end: r.end || undefined } as Repair);
        onClose();
      }}>
        <Field label="Problème constaté *" full><textarea required autoFocus value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} /></Field>
        {!r.unitId && <Field label="Quantité immobilisée"><NumInput value={r.qty || 1} step="1" min={1} onChange={(n) => setR({ ...r, qty: n })} /></Field>}
        <Field label="Statut">
          <select value={r.status} onChange={(e) => setR({ ...r, status: e.target.value as Repair['status'], end: e.target.value === 'termine' && !r.end ? toLocalInput(new Date()) : r.end })}>
            <option value="ouvert">En réparation (indisponible)</option>
            <option value="termine">Réparé (de nouveau disponible)</option>
          </select>
        </Field>
        <Field label="Depuis le"><input type="datetime-local" value={r.start} onChange={(e) => setR({ ...r, start: e.target.value })} /></Field>
        <Field label="Retour prévu / effectif"><input type="datetime-local" value={r.end || ''} onChange={(e) => setR({ ...r, end: e.target.value })} /></Field>
        <Field label="Réparateur">
          <select value={r.supplierId || ''} onChange={(e) => setR({ ...r, supplierId: e.target.value || undefined })}>
            <option value="">Interne</option>
            {suppliers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </Field>
        <Field label="Coût HT (€)"><NumInput value={r.cost || 0} onChange={(n) => setR({ ...r, cost: n })} /></Field>
        <div className="form-actions">
          {repair && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm('Supprimer ?')) { await db.repairs.delete(repair.id); onClose(); } }}>Supprimer</button>}
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

export function InspectionModal({ equipmentId, unitId, onClose }: { equipmentId: string; unitId?: string; onClose: () => void }) {
  const [i, setI] = useState<Partial<Inspection>>({ equipmentId, unitId, date: new Date().toISOString().slice(0, 10), result: 'ok' });
  return (
    <Modal title="Enregistrer un contrôle" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        await save(db.inspections, i as Inspection);
        if (i.result === 'ko') await save(db.repairs, { equipmentId, unitId, qty: 1, start: toLocalInput(new Date()), status: 'ouvert', description: 'Contrôle non conforme' + (i.notes ? ` : ${i.notes}` : ''), cost: 0 });
        onClose();
      }}>
        <Field label="Date"><input type="date" value={i.date} onChange={(e) => setI({ ...i, date: e.target.value })} /></Field>
        <Field label="Résultat">
          <select value={i.result} onChange={(e) => setI({ ...i, result: e.target.value as Inspection['result'] })}>
            <option value="ok">Conforme</option>
            <option value="ko">Non conforme (crée une réparation)</option>
          </select>
        </Field>
        <Field label="Contrôlé par"><input value={i.by || ''} onChange={(e) => setI({ ...i, by: e.target.value })} /></Field>
        <Field label="Notes" full><textarea value={i.notes || ''} onChange={(e) => setI({ ...i, notes: e.target.value })} /></Field>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Maintenance() {
  const av = useAvailability();
  const inspections = useLiveQuery(() => db.inspections.toArray(), []) || [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const [edit, setEdit] = useState<Repair | null>(null);
  const [inspect, setInspect] = useState<{ equipmentId: string; unitId?: string } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));
  const unitMap = new Map(av.units.map((u) => [u.id, u]));
  const cMap = new Map(contacts.map((c) => [c.id, c.company]));
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const due = inspectionsDue(av.equipment, av.units, inspections).filter((d) => d.due <= in30);
  const repairs = av.repairs.filter((r) => showDone || r.status === 'ouvert').sort((a, b) => b.start.localeCompare(a.start));

  return (
    <>
      <PageHead title="Maintenance">
        <CsvButton onClick={() => exportCsv('maintenance.csv', ['Article', 'Unité', 'Problème', 'Depuis', 'Retour', 'Réparateur', 'Coût', 'Statut'],
          av.repairs.map((r) => [eqMap.get(r.equipmentId)?.name, r.unitId ? unitMap.get(r.unitId)?.serial : '', r.description, r.start.replace('T', ' '), r.end?.replace('T', ' '), r.supplierId ? cMap.get(r.supplierId) : 'Interne', r.cost, r.status === 'ouvert' ? 'En cours' : 'Terminée']))} />
      </PageHead>
      <div className="card">
        <h2>Réparations</h2>
        <label className="check-row" style={{ marginBottom: 8 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Afficher les réparations terminées</label>
        {repairs.length === 0 ? <Empty>Aucune réparation en cours. Déclare-en une depuis la fiche d'un article ou au retour d'un projet (entrepôt).</Empty> : (
          <table className="list">
            <thead><tr><th>Article</th><th>Problème</th><th>Depuis</th><th>Retour prévu</th><th>Réparateur</th><th className="n">Coût</th><th>Statut</th></tr></thead>
            <tbody>
              {repairs.map((r) => (
                <tr key={r.id} className="click" onClick={() => setEdit(r)}>
                  <td><strong>{eqMap.get(r.equipmentId)?.name}</strong>{r.unitId ? ` · n° ${unitMap.get(r.unitId)?.serial}` : r.qty > 1 ? ` × ${r.qty}` : ''}</td>
                  <td>{r.description}</td><td>{fmtDate(r.start, false)}</td><td>{r.end ? fmtDate(r.end, false) : '—'}</td>
                  <td>{r.supplierId ? cMap.get(r.supplierId) : 'Interne'}</td><td className="n">{money(r.cost)}</td>
                  <td><span className={'badge ' + (r.status === 'ouvert' ? 'st-option' : 'st-confirme')}>{r.status === 'ouvert' ? 'En cours' : 'Terminée'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {(() => {
        // unités signalées au scan (checklist, inventaire) : à réparer (encore utilisables) ou hors service
        const flagged = av.units.filter((u) => u.defect || u.status === 'hs').sort((a, b) => ((a.history || []).slice(-1)[0]?.at || '').localeCompare((b.history || []).slice(-1)[0]?.at || ''));
        return flagged.length ? (
          <div className="card">
            <h2>Unités signalées</h2>
            <table className="list">
              <thead><tr><th>Article</th><th>Unité</th><th>État</th><th>Défaut / historique</th><th /></tr></thead>
              <tbody>{flagged.map((u) => (
                <tr key={u.id}>
                  <td><strong>{eqMap.get(u.equipmentId)?.name}</strong></td><td>{unitNo(u)} n° {u.serial}</td>
                  <td><span className={'badge ' + (u.status === 'hs' ? 'st-annule' : 'st-option')}>{UNIT_STATE_LABELS[unitState(u)]}</span></td>
                  <td className="muted" style={{ fontSize: 12 }}>{u.defect || (u.history || []).slice(-1)[0]?.text}</td>
                  <td><button className="small" onClick={() => setUnitState(u.id, 'ok')}>Remettre en service</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null;
      })()}
      <div className="card">
        <h2>Contrôles périodiques à faire (30 prochains jours)</h2>
        <p className="muted" style={{ marginTop: 0 }}>Règle la périodicité sur chaque article (ex. contrôle électrique tous les 12 mois).</p>
        {due.length === 0 ? <Empty>Aucun contrôle à prévoir.</Empty> : (
          <table className="list">
            <thead><tr><th>Article</th><th>Unité</th><th>Dernier contrôle</th><th>À faire avant le</th><th /></tr></thead>
            <tbody>
              {due.map((d, i) => (
                <tr key={i}>
                  <td><Link to={'/materiel/' + d.equipment.id}>{d.equipment.name}</Link></td>
                  <td>{d.unit?.serial || '—'}</td>
                  <td>{d.last ? fmtDate(d.last, false) : 'jamais'}</td>
                  <td><span className={d.due <= today ? 'avail ko' : ''}>{fmtDate(d.due, false)}</span></td>
                  <td><button className="small" onClick={() => setInspect({ equipmentId: d.equipment.id, unitId: d.unit?.id })}>Contrôlé</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <RepairModal equipmentId={edit.equipmentId} repair={edit} onClose={() => setEdit(null)} />}
      {inspect && <InspectionModal {...inspect} onClose={() => setInspect(null)} />}
    </>
  );
}
