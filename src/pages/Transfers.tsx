import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DOC_CSS } from '../components/DocRender';
import { Empty, Field, Modal, NumInput, PageHead, useSettings } from '../components/ui';
import { useAvailability } from '../data';
import { db, nextNumber } from '../db';
import type { Transfer, TransferStatus } from '../types';
import { TRANSFER_LABELS } from '../types';
import { availableQty, escHtml as esc, fmtDate, fmtRange, isVirtualKit, save, stockAt, toLocalInput } from '../utils';
import { applyTransfer } from '../transferApply';
import { unitNo } from '../unitNumbers';
import type { SerialUnit } from '../types';
import { printHtml } from './project/shared';
import { Icon } from '../components/Icon';
import { EquipmentChooser } from '../components/EquipmentChooser';


/** Transferts de matériel entre dépôts (définitifs ou temporaires). */
export default function Transfers() {
  const av = useAvailability();
  const [params, setParams] = useSearchParams();
  const transfers = useLiveQuery(() => db.transfers.orderBy('start').reverse().toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const [edit, setEdit] = useState<Partial<Transfer> | null>(null);
  const depotName = (id: string) => av.depots.find((d) => d.id === id)?.name || '?';
  const eqName = new Map(av.equipment.map((e) => [e.id, e.name]));

  useEffect(() => {
    const id = params.get('id');
    if (id) { db.transfers.get(id).then((t) => t && setEdit(t)); return; }
    // ?from=…&eq=… (inventaire : article vu dans un autre dépôt) : nouveau transfert pré-rempli
    const from = params.get('from'), eq = params.get('eq');
    if (from && eq) setEdit({ fromDepotId: from, toDepotId: av.depots.find((d) => d.id !== from)?.id || av.mainDepot, start: toLocalInput(new Date()), status: 'planifie', lines: [{ equipmentId: eq, qty: 1 }] });
  }, [params]);
  const close = () => { setEdit(null); if (params.get('id') || params.get('from')) setParams({}, { replace: true }); };

  if (av.depots.length < 2) {
    return (
      <>
        <PageHead title="Transferts entre dépôts" />
        <div className="info">Les transferts servent quand tu as plusieurs dépôts. Ajoute-les dans <Link to="/parametres">Paramètres → Dépôts</Link>.</div>
      </>
    );
  }

  return (
    <>
      <PageHead title="Transferts entre dépôts">
        <button onClick={() => setEdit({ fromDepotId: av.depots[1]?.id, toDepotId: av.depots[0].id, start: toLocalInput(new Date()), status: 'planifie', lines: [] })}>+ Nouveau transfert</button>
      </PageHead>
      <div className="info">
        Un transfert <strong>définitif</strong> (sans date de retour) déplace le stock d'un dépôt à l'autre. Un transfert <strong>temporaire</strong> prête
        le matériel jusqu'à la date de retour. Les disponibilités de chaque dépôt en tiennent compte dès qu'il est planifié.
      </div>
      <div className="card">
        {transfers.length === 0 ? <Empty>Aucun transfert.</Empty> : (
          <table className="list">
            <thead><tr><th>N°</th><th>De → vers</th><th>Période</th><th>Matériel</th><th>Projet</th><th>Statut</th></tr></thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="click" onClick={() => setEdit(t)}>
                  <td><strong>{t.number}</strong></td>
                  <td>{depotName(t.fromDepotId)} → {depotName(t.toDepotId)}</td>
                  <td>{t.end ? fmtRange(t.start, t.end) : <>{fmtDate(t.start)} <span className="badge">définitif</span></>}</td>
                  <td>{t.lines.map((l) => `${l.qty} × ${eqName.get(l.equipmentId) || '?'}`).join(', ')}</td>
                  <td>{projects.find((p) => p.id === t.projectId)?.name || '—'}</td>
                  <td><span className={'badge ' + (t.status === 'effectue' ? 'st-confirme' : t.status === 'annule' ? 'st-annule' : 'st-option')}>{TRANSFER_LABELS[t.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <TransferModal initial={edit} onClose={close} />}
    </>
  );
}

function TransferModal({ initial, onClose }: { initial: Partial<Transfer>; onClose: () => void }) {
  const av = useAvailability();
  const settings = useSettings();
  const [t, setT] = useState(initial);
  const [temporary, setTemporary] = useState(!!initial.end || !initial.id);
  const [choosing, setChoosing] = useState(false);
  const lines = t.lines || [];
  const start = t.start || toLocalInput(new Date());
  const end = temporary ? t.end || start : start;
  const set = (patch: Partial<Transfer>) => setT({ ...t, ...patch });
  const available = (eqId: string) => {
    const e = av.equipment.find((x) => x.id === eqId);
    // on exclut ce transfert lui-même du calcul
    return e && t.fromDepotId ? availableQty(e, av.equipment, av.res, start, end, t.id, t.fromDepotId) : 0;
  };
  const depotName = (id?: string) => av.depots.find((d) => d.id === id)?.name || '?';
  /** unités proposées : en service, au dépôt de départ (plus celles déjà choisies, même rangées ailleurs) */
  const unitsAt = (eqId: string, l: Transfer['lines'][number]) => av.units.filter((u) => u.equipmentId === eqId && (
    (l.unitIds || []).includes(u.id) || (u.status === 'ok' && (u.depotId && av.depots.some((d) => d.id === u.depotId) ? u.depotId : av.mainDepot) === t.fromDepotId)))
    .sort((a, b) => (a.number || 1e9) - (b.number || 1e9));

  const print = () => {
    const co = settings.company;
    printHtml(`Bon de transfert ${t.number || ''}`, `<div class="doc">
      <div class="head"><div>${co.logo ? `<img src="${co.logo}">` : ''}<div><strong>${esc(co.name)}</strong></div></div>
      <div class="box"><h1>Bon de transfert</h1><div>N° <strong>${esc(t.number || '—')}</strong></div>
      <div>De : <strong>${esc(depotName(t.fromDepotId))}</strong></div><div>Vers : <strong>${esc(depotName(t.toDepotId))}</strong></div>
      <div>Départ : ${fmtDate(start)}</div><div>${temporary ? `Retour : ${fmtDate(end)}` : 'Transfert définitif'}</div></div></div>
      <table><thead><tr><th>Sortie</th><th>Arrivée</th><th class="n">Qté</th><th>Désignation</th></tr></thead>
      <tbody>${lines.map((l) => `<tr><td><span class="check"></span></td><td><span class="check"></span></td><td class="n">${l.qty}</td><td>${esc(av.equipment.find((e) => e.id === l.equipmentId)?.name)}</td></tr>`).join('')}</tbody></table>
      ${t.notes ? `<p>${esc(t.notes)}</p>` : ''}<div class="sign"><div>Préparé par</div><div>Réceptionné par</div></div></div>`, DOC_CSS);
  };

  return (
    <Modal title={t.id ? `Transfert ${t.number}` : 'Nouveau transfert'} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        if (t.fromDepotId === t.toDepotId) return alert('Choisis deux dépôts différents.');
        if (!lines.length) return alert('Ajoute au moins un article.');
        if (temporary && end < start) return alert('Le retour doit être après le départ.');
        for (const l of lines) {
          const e = av.equipment.find((x) => x.id === l.equipmentId);
          if (e?.trackSerials && (l.unitIds || []).length > l.qty) return alert(`${e.name} : plus d'unités choisies que la quantité.`);
        }
        const number = t.number || (await nextNumber('TR'));
        const rec = { ...t, start, end: temporary ? end : undefined, number, lines } as Transfer;
        // transfert définitif effectué : le stock change vraiment de dépôt ; sinon il reste une réservation datée.
        // On remet d'abord en place l'ancienne version (quantités, unités ou dépôts modifiés), puis on applique la nouvelle.
        const apply = !temporary && t.status === 'effectue';
        const same = (a: Partial<Transfer>) => JSON.stringify([a.fromDepotId, a.toDepotId, a.lines]);
        if (!(initial.applied && apply && same(initial) === same(rec))) {
          if (initial.applied) await applyTransfer(initial as Transfer, settings, -1, `Transfert ${number} modifié`);
          if (apply) await applyTransfer(rec, settings, 1);
        }
        await save(db.transfers, { ...rec, applied: apply || undefined });
        onClose();
      }}>
        <Field label="Depuis le dépôt">
          <select value={t.fromDepotId} onChange={(e) => set({ fromDepotId: e.target.value })}>
            {av.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Vers le dépôt">
          <select value={t.toDepotId} onChange={(e) => set({ toDepotId: e.target.value })}>
            {av.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Départ"><input type="datetime-local" value={start} onChange={(e) => set({ start: e.target.value })} /></Field>
        <Field label="Statut">
          <select value={t.status} onChange={(e) => set({ status: e.target.value as TransferStatus })}>
            {Object.entries(TRANSFER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label=" "><label className="check-row"><input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} /> Temporaire (le matériel revient)</label></Field>
        {temporary && <Field label="Retour au dépôt d'origine"><input type="datetime-local" value={end} onChange={(e) => set({ end: e.target.value })} /></Field>}

        <div className="field full">
          <span>Matériel (disponibilité au dépôt de départ sur la période)</span>
          {lines.length > 0 && (
            <table className="list">
              <tbody>
                {lines.map((l, i) => {
                  const a = available(l.equipmentId);
                  return (
                    <tr key={i}>
                      <td><NumInput className="w-qty" step="1" min={1} value={l.qty} onChange={(n) => set({ lines: lines.map((x, j) => (j === i ? { ...x, qty: n } : x)) })} /></td>
                      <td>{av.equipment.find((e) => e.id === l.equipmentId)?.name}
                        {av.equipment.find((e) => e.id === l.equipmentId)?.trackSerials && (
                          <UnitPick line={l} units={unitsAt(l.equipmentId, l)} onChange={(unitIds) => set({ lines: lines.map((x, j) => (j === i ? { ...x, unitIds, qty: Math.max(x.qty, unitIds.length) } : x)) })} />
                        )}
                      </td>
                      <td className="n"><span className={'avail ' + (a >= l.qty ? 'ok' : 'ko')}>{a} dispo</span></td>
                      <td><button type="button" className="ghost" onClick={() => set({ lines: lines.filter((_, j) => j !== i) })} aria-label="Retirer"><Icon name="x" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" className="secondary small" onClick={() => setChoosing(true)}>+ Ajouter du matériel…</button>
            {choosing && (
              <EquipmentChooser title="Matériel à transférer" withQty equipment={av.equipment.filter((e) => !isVirtualKit(e))}
                exclude={lines.map((l) => l.equipmentId)}
                info={(e) => `${t.fromDepotId ? stockAt(e, t.fromDepotId, av.res) : e.quantity} au départ`}
                onClose={() => setChoosing(false)}
                onConfirm={(picked) => set({ lines: [...lines, ...picked] })} />
            )}
          </div>
        </div>
        <Field label="Notes" full><textarea value={t.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <div className="form-actions">
          {t.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => {
            if (!confirm('Supprimer ce transfert ?')) return;
            // transfert effectué : le stock a déjà changé de dépôt ; on propose de le remettre
            if (initial.applied && confirm('Ce transfert est effectué : le stock a déjà changé de dépôt. Le remettre au dépôt de départ ?')) await applyTransfer(initial as Transfer, settings, -1, `Transfert ${t.number} supprimé`);
            await db.transfers.delete(t.id!); onClose();
          }}>Supprimer</button>}
          <button type="button" className="secondary" onClick={print} disabled={!lines.length}>Bon de transfert</button>
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

/** choix des unités transférées (article sérialisé) : touche un numéro pour le prendre ou le retirer */
function UnitPick({ line, units, onChange }: { line: Transfer['lines'][number]; units: SerialUnit[]; onChange: (ids: string[]) => void }) {
  const picked = line.unitIds || [];
  if (!units.length) return <div className="muted" style={{ fontSize: 12 }}>Aucune unité en service à ce dépôt.</div>;
  return (
    <div className="uchips transfer-units" aria-label="Unités transférées">
      {units.map((u) => {
        const on = picked.includes(u.id);
        return (
          <button key={u.id} type="button" className={'uchip' + (on ? ' on' : '')} aria-pressed={on}
            onClick={() => onChange(on ? picked.filter((x) => x !== u.id) : [...picked, u.id])}>
            {u.number ? <b className="unit-no">{unitNo(u)} </b> : null}{u.barcode || u.serial}
          </button>
        );
      })}
      <small className="muted" style={{ width: '100%' }}>{picked.length ? `${picked.length} unité(s) choisie(s) : rangées au dépôt d'arrivée quand le transfert définitif est « Effectué ».` : 'Choisis les unités qui partent : un transfert définitif effectué les range au dépôt d\'arrivée.'}</small>
    </div>
  );
}
