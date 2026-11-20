import { useEffect, useState } from 'react';
import { Field, PageHead, useSettings } from '../components/ui';
import { currentWorkspace, db, listWorkspaces, switchWorkspace, TABLES } from '../db';
import type { Settings } from '../types';
import { download } from '../utils';

export default function SettingsPage() {
  const current = useSettings();
  const [s, setS] = useState<Settings>(current);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [newWs, setNewWs] = useState('');

  useEffect(() => {
    db.settings.get('main').then((x) => { if (x) setS({ ...current, ...x, company: { ...current.company, ...x.company } }); setLoaded(true); });
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCo = (k: keyof Settings['company'], v: string) => setS({ ...s, company: { ...s.company, [k]: v } });

  const saveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    const latest = await db.settings.get('main');
    await db.settings.put({ ...s, counters: latest?.counters || s.counters });
    setMsg('Paramètres enregistrés.');
    setTimeout(() => setMsg(''), 2500);
  };

  const backup = async () => {
    const data: Record<string, unknown[]> = {};
    for (const t of TABLES) data[t] = await db.table(t).toArray();
    download(`fabevent-${currentWorkspace()}-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ app: 'fabevent', version: 1, exportedAt: new Date().toISOString(), data }), 'application/json');
  };

  const restore = async (file: File) => {
    if (!confirm('Remplacer TOUTES les données de cette base par la sauvegarde ?')) return;
    try {
      const json = JSON.parse(await file.text());
      if (json.app !== 'fabevent') throw new Error('Fichier non reconnu');
      await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
        for (const t of TABLES) {
          await db.table(t).clear();
          if (json.data[t]) await db.table(t).bulkPut(json.data[t]);
        }
      });
      alert('Sauvegarde restaurée.');
      location.reload();
    } catch (err) {
      alert('Échec de la restauration : ' + (err as Error).message);
    }
  };

  if (!loaded) return <p>Chargement…</p>;

  return (
    <>
      <PageHead title="Paramètres" />
      <form className="card" onSubmit={saveAll}>
        <h2>Ma société (en-tête des documents)</h2>
        <div className="form">
          <Field label="Nom"><input value={s.company.name} onChange={(e) => setCo('name', e.target.value)} /></Field>
          <Field label="Email"><input value={s.company.email || ''} onChange={(e) => setCo('email', e.target.value)} /></Field>
          <Field label="Adresse" full><textarea value={s.company.address || ''} onChange={(e) => setCo('address', e.target.value)} /></Field>
          <Field label="Téléphone"><input value={s.company.phone || ''} onChange={(e) => setCo('phone', e.target.value)} /></Field>
          <Field label="SIRET"><input value={s.company.siret || ''} onChange={(e) => setCo('siret', e.target.value)} /></Field>
          <Field label="N° TVA intracom."><input value={s.company.vatNumber || ''} onChange={(e) => setCo('vatNumber', e.target.value)} /></Field>
          <Field label="IBAN (factures)"><input value={s.company.iban || ''} onChange={(e) => setCo('iban', e.target.value)} /></Field>
          <Field label="Logo">
            <input type="file" accept="image/*" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => setCo('logo', String(r.result));
              r.readAsDataURL(f);
            }} />
          </Field>
          {s.company.logo && <div className="field"><img src={s.company.logo} alt="Logo" style={{ maxHeight: 50, maxWidth: 160 }} /><button type="button" className="ghost small" onClick={() => setCo('logo', '')}>Retirer le logo</button></div>}
        </div>

        <h2 style={{ marginTop: 20 }}>Tarification</h2>
        <div className="form">
          <Field label="Taux de TVA (%)"><input type="number" step="any" value={s.vatRate} onChange={(e) => setS({ ...s, vatRate: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Validité des devis (jours)"><input type="number" value={s.quoteValidityDays} onChange={(e) => setS({ ...s, quoteValidityDays: parseInt(e.target.value) || 0 })} /></Field>
          <Field label="Coefficients par durée (1 j, 2 j, 3 j…) séparés par des « ; »" full>
            <input value={s.factors.join(' ; ')} onChange={(e) => setS({ ...s, factors: e.target.value.split(';').map((x) => parseFloat(x.replace(',', '.'))).filter((x) => !isNaN(x)) })} />
          </Field>
          <Field label="Au-delà : + par jour supplémentaire"><input type="number" step="any" value={s.factorExtraPerDay} onChange={(e) => setS({ ...s, factorExtraPerDay: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Pied de page des documents" full><textarea value={s.footer} onChange={(e) => setS({ ...s, footer: e.target.value })} /></Field>
          <Field label="Adresse web de l'application (pour les liens d'agenda)" full>
            <input value={s.appUrl} placeholder={location.origin + location.pathname} onChange={(e) => setS({ ...s, appUrl: e.target.value })} />
          </Field>
        </div>
        <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
          {msg && <span className="avail ok" style={{ alignSelf: 'center' }}>{msg}</span>}
          <button type="submit">Enregistrer</button>
        </div>
      </form>

      <div className="card">
        <h2>Données & hors ligne</h2>
        <p className="muted">
          Les données sont enregistrées dans ce navigateur et fonctionnent sans connexion. Fais des sauvegardes régulières
          tant que la synchronisation serveur n'est pas en place.
        </p>
        <p>
          Stockage protégé contre l'effacement automatique : <strong>{persisted === null ? 'inconnu' : persisted ? 'oui' : 'non'}</strong>{' '}
          {!persisted && <button className="secondary small" onClick={async () => setPersisted(!!(await navigator.storage?.persist?.()))}>Activer</button>}
        </p>
        <div className="toolbar">
          <button onClick={backup}>Télécharger une sauvegarde (.json)</button>
          <label className="btn secondary" style={{ background: 'var(--soft)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            Restaurer une sauvegarde
            <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Bases de données</h2>
        <p className="muted">Une base séparée par activité ou par collègue. Base active : <strong>{currentWorkspace()}</strong></p>
        <div className="toolbar">
          {listWorkspaces().map((w) => (
            <button key={w} className={w === currentWorkspace() ? '' : 'secondary'} disabled={w === currentWorkspace()} onClick={() => switchWorkspace(w)}>{w}</button>
          ))}
        </div>
        <div className="toolbar">
          <input placeholder="Nom de la nouvelle base" value={newWs} onChange={(e) => setNewWs(e.target.value)} />
          <button className="secondary" disabled={!newWs.trim()} onClick={() => switchWorkspace(newWs.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}>Créer et ouvrir</button>
        </div>
      </div>
    </>
  );
}
