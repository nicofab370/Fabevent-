import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Empty, Field, Modal, NumInput, PageHead } from '../components/ui';
import { db } from '../db';
import type { Vehicle } from '../types';
import { fmtRange, money, save, toLocalInput } from '../utils';
import { CsvButton, exportCsv } from '../components/extra';

type Draft = Partial<Vehicle> & { name: string; dailyPrice: number };

export default function Vehicles() {
  const vehicles = useLiveQuery(() => db.vehicles.orderBy('name').toArray(), []) || [];
  const vas = useLiveQuery(() => db.vehicleAssignments.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const [edit, setEdit] = useState<Draft | null>(null);
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const nowS = toLocalInput(new Date());

  return (
    <>
      <PageHead title="Véhicules">
        <CsvButton onClick={() => exportCsv('vehicules.csv', ['Véhicule', 'Immatriculation', 'Places', 'Charge utile', 'Forfait / jour', 'Prix / km'], vehicles.map((v) => [v.name, v.plate, v.seats, v.payload, v.dailyPrice, v.pricePerKm]))} />
        <button onClick={() => setEdit({ name: '', dailyPrice: 0 })}>+ Nouveau véhicule</button>
      </PageHead>
      <div className="card">
        {vehicles.length === 0 ? <Empty>Aucun véhicule.</Empty> : (
          <table className="list">
            <thead><tr><th>Véhicule</th><th>Immatriculation</th><th className="n">Charge utile</th><th className="n">Forfait/j</th><th className="n">€/km</th><th>Prochaines sorties</th></tr></thead>
            <tbody>
              {vehicles.map((v) => {
                const next = vas.filter((a) => a.vehicleId === v.id && a.end >= nowS).sort((a, b) => a.start.localeCompare(b.start));
                return (
                  <tr key={v.id} className="click" onClick={() => setEdit(v)}>
                    <td><strong>{v.name}</strong></td><td>{v.plate}</td>
                    <td className="n">{v.payload ? `${v.payload} kg` : ''}</td>
                    <td className="n">{money(v.dailyPrice)}</td>
                    <td className="n">{v.pricePerKm != null ? money(v.pricePerKm) : <span className="muted">défaut</span>}</td>
                    <td>{next.slice(0, 3).map((a) => <div key={a.id} style={{ fontSize: 12 }}>{pMap.get(a.projectId)?.name} · {fmtRange(a.start, a.end)}</div>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Modifier le véhicule' : 'Nouveau véhicule'} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={async (e) => { e.preventDefault(); await save(db.vehicles, edit as Vehicle); setEdit(null); }}>
            <Field label="Nom *" full><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="ex. Fourgon 20m³" /></Field>
            <Field label="Immatriculation"><input value={edit.plate || ''} onChange={(e) => setEdit({ ...edit, plate: e.target.value })} /></Field>
            <Field label="Places"><NumInput value={edit.seats || 0} step="1" onChange={(n) => setEdit({ ...edit, seats: n })} /></Field>
            <Field label="Charge utile (kg)"><NumInput value={edit.payload || 0} onChange={(n) => setEdit({ ...edit, payload: n })} /></Field>
            <Field label="Forfait facturé / jour HT (€)"><NumInput value={edit.dailyPrice} onChange={(n) => setEdit({ ...edit, dailyPrice: n })} /></Field>
            <Field label="Prix facturé au km HT (€, vide = paramètres)"><input type="number" step="any" value={edit.pricePerKm ?? ''} onChange={(e) => setEdit({ ...edit, pricePerKm: e.target.value === '' ? undefined : parseFloat(e.target.value) })} /></Field>
            <Field label="Notes" full><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <div className="form-actions">
              {edit.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => {
                if (confirm('Supprimer ce véhicule et ses réservations ?')) {
                  await db.vehicleAssignments.where({ vehicleId: edit.id }).delete();
                  await db.vehicles.delete(edit.id!); setEdit(null);
                }
              }}>Supprimer</button>}
              <button type="button" className="secondary" onClick={() => setEdit(null)}>Annuler</button>
              <button type="submit">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
