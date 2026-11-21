import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHead, StatusBadge } from '../components/ui';
import { findByCode, UNIT_STATE_LABELS, unitState } from '../codes';
import { db } from '../db';
import { fmtRange } from '../utils';
import { whereIs } from './Inventory';
import { Icon } from '../components/Icon';

/**
 * Page ouverte en scannant une étiquette avec l'appareil photo de n'importe quel téléphone
 * (QR « lien vers la fiche ») : ce que c'est, ce qu'il y a dedans, où ça doit être.
 */
export default function QrCard() {
  const { code = '' } = useParams();
  const equipment = useLiveQuery(() => db.equipment.toArray(), []);
  const units = useLiveQuery(() => db.units.toArray(), []);
  const hit = equipment && units ? findByCode(decodeURIComponent(code), equipment, units) : undefined;
  const where = useLiveQuery(() => (hit ? whereIs(hit.equipment.id) : undefined), [hit?.equipment.id]);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  if (!equipment || !units) return <p>Chargement…</p>;
  if (!hit) {
    return (
      <>
        <PageHead title="Étiquette" />
        <div className="card"><p>Le code <code>{decodeURIComponent(code)}</code> n'est pas connu sur cet appareil.</p>
          <p className="muted">Connecte-toi et laisse la synchronisation se faire, ou vérifie l'étiquette.</p></div>
      </>
    );
  }
  const { equipment: e, unit } = hit;
  const st = unit ? unitState(unit) : 'ok';
  const now = where?.planned.find((p) => p.state === 'en cours') || where?.planned.find((p) => p.state === 'à venir');
  const contents = e.contents || [];
  return (
    <div className="qr-card">
      <PageHead title={e.name} />
      <div className="card">
        {e.photo && <img src={e.photo} alt="" style={{ width: '100%', maxWidth: 320, borderRadius: 10, display: 'block', marginBottom: 10 }} />}
        <dl className="kv">
          <dt>Code</dt><dd><code>{unit?.barcode || e.code}</code></dd>
          {unit && <><dt>Unité</dt><dd>n° {unit.serial} <span className={'badge ' + (st === 'ok' ? 'st-confirme' : st === 'lost' ? 'st-annule' : 'st-option')}>{UNIT_STATE_LABELS[st]}</span>{unit.defect && <div className="muted">{unit.defect}</div>}</dd></>}
          {e.location && <><dt>Emplacement</dt><dd><Icon name="pin" />{e.location}</dd></>}
          {now && <><dt>{now.state === 'en cours' ? 'En ce moment' : 'Prochain projet'}</dt><dd><Link to={'/projets/' + now.projectId}>{now.number} {now.name}</Link> · {fmtRange(now.start, now.end)} <StatusBadge status={now.status} /></dd></>}
        </dl>
      </div>
      {contents.length > 0 && (
        <div className="card">
          <h2>Contenu</h2>
          <p className="muted" style={{ marginTop: 0 }}>À vérifier au départ et au retour.</p>
          {contents.map((c, i) => (
            <label key={i} className="check-row qr-content">
              <input type="checkbox" checked={!!checked[i]} onChange={(ev) => setChecked({ ...checked, [i]: ev.target.checked })} />
              <span>{c.qty > 1 ? <b>{c.qty} × </b> : null}{c.name}</span>
            </label>
          ))}
          {contents.every((_, i) => checked[i]) && <p className="avail ok"><Icon name="check" />Contenu complet</p>}
        </div>
      )}
      <Link to={'/materiel/' + e.id}><button className="secondary">Fiche complète de l'article</button></Link>
    </div>
  );
}
