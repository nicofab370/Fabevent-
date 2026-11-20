import { useEffect, useState } from 'react';
import { Field, NumInput, PageHead, useSettings } from '../components/ui';
import { currentWorkspace, db, DEFAULT_PROJECT_TYPES, listWorkspaces, switchWorkspace, TABLES } from '../db';
import { DEMO_WORKSPACE, seedDemo } from '../demo';
import type { InvoiceMoment, Settings } from '../types';
import { MOMENT_TRIGGERS, VAT_REGIME_LABELS } from '../types';
import { settingsMoments } from '../invoicing';
import { DEFAULT_VAT_MENTIONS } from '../payment';
import { download, uid } from '../utils';

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
    // les fichiers joints (Blob) sont convertis en texte pour tenir dans le JSON
    data.files = await Promise.all((data.files as { blob: Blob }[]).map(async (f) => ({ ...f, blob: { dataUrl: await blobToDataUrl(f.blob), type: f.blob.type } })));
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
          if (t === 'files' && json.data.files) {
            await db.files.bulkPut(json.data.files.map((f: { blob: { dataUrl?: string } }) => ({ ...f, blob: f.blob?.dataUrl ? dataUrlToBlob(f.blob.dataUrl) : new Blob() })));
          } else if (json.data[t]) await db.table(t).bulkPut(json.data[t]);
        }
      });
      alert('Sauvegarde restaurée.');
      location.reload();
    } catch (err) {
      alert('Échec de la restauration : ' + (err as Error).message);
    }
  };

  const moments = settingsMoments(s);

  if (!loaded) return <p>Chargement…</p>;

  return (
    <>
      <PageHead title="Paramètres" />
      <form className="card" onSubmit={saveAll}>
        <h2>Ma société (en-tête des documents)</h2>
        <div className="form">
          <Field label="Nom"><input value={s.company.name} onChange={(e) => setCo('name', e.target.value)} /></Field>
          <Field label="Email"><input value={s.company.email || ''} onChange={(e) => setCo('email', e.target.value)} /></Field>
          <Field label="Adresse (affichée sur les documents)" full><textarea value={s.company.address || ''} onChange={(e) => setCo('address', e.target.value)} /></Field>
          <Field label="Rue et numéro (Peppol)"><input value={s.company.street || ''} onChange={(e) => setCo('street', e.target.value)} /></Field>
          <Field label="Code postal"><input value={s.company.postalCode || ''} onChange={(e) => setCo('postalCode', e.target.value)} /></Field>
          <Field label="Ville"><input value={s.company.city || ''} onChange={(e) => setCo('city', e.target.value)} /></Field>
          <Field label="Pays (code)"><input value={s.company.country || ''} onChange={(e) => setCo('country', e.target.value)} placeholder="BE" /></Field>
          <Field label="Identifiant Peppol"><input value={s.company.peppolId || ''} onChange={(e) => setCo('peppolId', e.target.value)} placeholder="0208:0123456789 (BE) ou 0009:SIRET (FR)" /></Field>
          <Field label="Téléphone"><input value={s.company.phone || ''} onChange={(e) => setCo('phone', e.target.value)} /></Field>
          <Field label="N° d'entreprise / SIRET"><input value={s.company.siret || ''} onChange={(e) => setCo('siret', e.target.value)} /></Field>
          <Field label="N° TVA intracom."><input value={s.company.vatNumber || ''} onChange={(e) => setCo('vatNumber', e.target.value)} /></Field>
          <Field label="IBAN (factures)"><input value={s.company.iban || ''} onChange={(e) => setCo('iban', e.target.value)} /></Field>
          <Field label="BIC"><input value={s.company.bic || ''} onChange={(e) => setCo('bic', e.target.value)} /></Field>
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

        <h2 style={{ marginTop: 20 }}>Dépôts</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Avec un seul dépôt, rien à faire. Avec plusieurs, le stock se répartit par dépôt, chaque projet part d'un dépôt
          et tu peux transférer du matériel de l'un à l'autre. Le premier est le dépôt principal.
        </p>
        {(s.depots || []).map((dp, i, all) => {
          const upd = (patch: Partial<typeof dp>) => setS({ ...s, depots: all.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={dp.id} className="depot-row">
              <input value={dp.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Nom" />
              <input value={dp.street || ''} onChange={(e) => upd({ street: e.target.value })} placeholder="Rue et numéro" />
              <input value={dp.postalCode || ''} onChange={(e) => upd({ postalCode: e.target.value })} placeholder="CP" />
              <input value={dp.city || ''} onChange={(e) => upd({ city: e.target.value })} placeholder="Ville" />
              <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{i === 0 ? 'principal' : ''}</span>
              <button type="button" className="ghost" disabled={i === 0} title={i === 0 ? 'Le dépôt principal ne peut pas être supprimé' : 'Supprimer'}
                onClick={() => confirm(`Supprimer le dépôt « ${dp.name} » ? Son matériel sera compté dans le dépôt principal.`) && setS({ ...s, depots: all.filter((_, j) => j !== i) })}>✕</button>
            </div>
          );
        })}
        <button type="button" className="secondary small" onClick={() => {
          const list = s.depots?.length ? s.depots : [{ id: uid(), name: 'Dépôt principal', street: s.company.street, postalCode: s.company.postalCode, city: s.company.city, country: s.company.country }];
          setS({ ...s, depots: [...list, { id: uid(), name: `Dépôt ${list.length + 1}` }] });
        }}>+ Dépôt</button>

        <h2 style={{ marginTop: 20 }}>Champs personnalisés</h2>
        <p className="muted" style={{ marginTop: 0 }}>Informations en plus sur les projets, contacts ou articles (ex. « Repas fourni », « Accès PMR »). Utilisables dans les documents : {'{{champ.nom_du_champ}}'}.</p>
        {(s.customFields || []).map((f, i, all) => {
          const upd = (patch: Partial<typeof f>) => setS({ ...s, customFields: all.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={f.id} style={{ display: 'flex', gap: 8, marginBottom: 6, maxWidth: 640, flexWrap: 'wrap' }}>
              <input value={f.label} onChange={(e) => upd({ label: e.target.value })} placeholder="Nom du champ" style={{ flex: 2, minWidth: 160 }} />
              <select value={f.entity} onChange={(e) => upd({ entity: e.target.value as typeof f.entity })} style={{ width: 'auto' }}>
                <option value="projet">Projets</option><option value="contact">Contacts</option><option value="materiel">Matériel</option>
              </select>
              <select value={f.type} onChange={(e) => upd({ type: e.target.value as typeof f.type })} style={{ width: 'auto' }}>
                <option value="texte">Texte</option><option value="oui_non">Oui / non</option><option value="nombre">Nombre</option><option value="date">Date</option><option value="liste">Liste déroulante</option>
              </select>
              {f.type === 'liste' && <input defaultValue={(f.choices || []).join(', ')} onBlur={(e) => upd({ choices: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="Valeurs séparées par des virgules" style={{ flex: 3, minWidth: 200 }} />}
              {f.entity === 'projet' && <label className="check-row" title="Colonne et filtre dans la liste des projets"><input type="checkbox" checked={!!f.inList} onChange={(e) => upd({ inList: e.target.checked })} /> En liste</label>}
              <button type="button" className="ghost" onClick={() => setS({ ...s, customFields: all.filter((_, j) => j !== i) })} aria-label="Retirer">✕</button>
            </div>
          );
        })}
        <button type="button" className="secondary small" onClick={() => setS({ ...s, customFields: [...(s.customFields || []), { id: uid(), label: '', entity: 'projet', type: 'texte' }] })}>+ Champ</button>

        <h2 style={{ marginTop: 20 }}>Fonctions et tarifs clients</h2>
        <label className="check-row" style={{ marginBottom: 8 }}><input type="checkbox" checked={!!s.crewFinalByDefault} onChange={(e) => setS({ ...s, crewFinalByDefault: e.target.checked })} /> Nouveaux postes en planification finale (visibles des techniciens) par défaut</label>
        <p className="muted" style={{ marginTop: 0 }}>
          Le client paie la fonction (ex. Régisseur son 380 €/jour), quel que soit le technicien ou sous-traitant envoyé.
          Le coût, lui, dépend de la personne affectée (fiche dans Équipe) et ne joue que sur ta marge.
        </p>
        {(s.crewFunctions || []).map((f, i, all) => {
          const upd = (patch: Partial<typeof f>) => setS({ ...s, crewFunctions: all.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center', maxWidth: 640, flexWrap: 'wrap' }}>
              <input value={f.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Fonction" style={{ flex: 2, minWidth: 160 }} />
              <label className="check-row">€/jour <NumInput step="any" value={f.dayRate} onChange={(n) => upd({ dayRate: n })} style={{ width: 90 }} /></label>
              <label className="check-row">€/heure <input type="number" step="any" value={f.hourRate ?? ''} onChange={(e) => upd({ hourRate: e.target.value === '' ? undefined : parseFloat(e.target.value) })} style={{ width: 90 }} /></label>
              <button type="button" className="ghost" onClick={() => setS({ ...s, crewFunctions: all.filter((_, j) => j !== i) })} aria-label="Retirer">✕</button>
            </div>
          );
        })}
        <button type="button" className="secondary small" onClick={() => setS({ ...s, crewFunctions: [...(s.crewFunctions || []), { name: '', dayRate: 0 }] })}>+ Fonction</button>

        <h2 style={{ marginTop: 20 }}>Types de projet</h2>
        <p className="muted" style={{ marginTop: 0 }}>Chaque type a une couleur, reprise dans la liste des projets, et ses moments de facturation par défaut.</p>
        {(s.projectTypes?.length ? s.projectTypes : DEFAULT_PROJECT_TYPES).map((t, i, all) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, maxWidth: 680 }}>
            <input type="color" value={t.color} style={{ width: 48, padding: 2 }} onChange={(e) => setS({ ...s, projectTypes: all.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
            <input value={t.name} onChange={(e) => setS({ ...s, projectTypes: all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <select multiple title="Moments de facturation par défaut (Ctrl + clic pour en choisir plusieurs)" value={t.moments || []} style={{ minWidth: 200, height: 'auto' }} size={Math.min(3, moments.length)}
              onChange={(e) => setS({ ...s, projectTypes: all.map((x, j) => (j === i ? { ...x, moments: [...e.target.selectedOptions].map((o) => o.value).slice(0, 3) } : x)) })}>
              {moments.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button type="button" className="ghost" onClick={() => setS({ ...s, projectTypes: all.filter((_, j) => j !== i) })} aria-label="Retirer">✕</button>
          </div>
        ))}
        <button type="button" className="secondary small" onClick={() => setS({ ...s, projectTypes: [...(s.projectTypes?.length ? s.projectTypes : DEFAULT_PROJECT_TYPES), { name: 'Nouveau type', color: '#64748b' }] })}>+ Type</button>

        <h2 style={{ marginTop: 20 }}>Moments de facturation</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Quand facturer et quelle part du projet (ex. 30 % à la confirmation, 70 % après la prestation). Un projet en utilise 3 au plus,
          choisis sur le projet, sinon sur le client, sinon sur le type de projet. Ils alimentent la liste « À facturer ».
        </p>
        {moments.map((m, i) => {
          const upd = (c: Partial<InvoiceMoment>) => setS({ ...s, invoiceMoments: moments.map((x, j) => (j === i ? { ...x, ...c } : x)) });
          return (
            <div key={m.id} style={{ display: 'flex', gap: 8, marginBottom: 6, maxWidth: 760, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={m.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Nom (affiché sur la facture)" style={{ flex: 2, minWidth: 180 }} />
              <NumInput step="any" value={m.percent} onChange={(n) => upd({ percent: n })} style={{ width: 80 }} title="Part du total (%)" /> %
              <select value={m.trigger} onChange={(e) => upd({ trigger: e.target.value as InvoiceMoment['trigger'] })} style={{ width: 'auto' }}>
                {Object.entries(MOMENT_TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {m.trigger !== 'accord' && <><NumInput value={m.days || 0} onChange={(n) => upd({ days: n })} style={{ width: 70 }} title="Décalage en jours" /> j {m.trigger === 'avant' ? 'avant' : 'après'}</>}
              <button type="button" className="ghost" onClick={() => setS({ ...s, invoiceMoments: moments.filter((_, j) => j !== i) })} aria-label="Retirer">✕</button>
            </div>
          );
        })}
        <button type="button" className="secondary small" onClick={() => setS({ ...s, invoiceMoments: [...moments, { id: uid(), name: 'Nouveau moment', percent: 50, trigger: 'avant', days: 7 }] })}>+ Moment</button>

        <h2 style={{ marginTop: 20 }}>Tarification</h2>
        <div className="form">
          <Field label="Taux de TVA (%)"><NumInput step="any" value={s.vatRate} onChange={(n) => setS({ ...s, vatRate: n })} /></Field>
          <Field label="Transport : prix au km par défaut (€ HT)"><NumInput step="any" value={s.pricePerKm ?? 1} onChange={(n) => setS({ ...s, pricePerKm: n })} /></Field>
          <Field label="Transport : allers-retours par défaut"><NumInput step="1" min={1} value={s.defaultTrips ?? 2} onChange={(n) => setS({ ...s, defaultTrips: n || 1 })} /></Field>
          <Field label=" "><label className="check-row"><input type="checkbox" checked={s.structuredComm !== false} onChange={(e) => setS({ ...s, structuredComm: e.target.checked })} /> Communication structurée belge (+++…+++) sur les factures</label></Field>
          <Field label="Heures sup. au-delà de (heures / jour)"><NumInput step="0.5" value={s.overtimeAfter ?? 10} onChange={(n) => setS({ ...s, overtimeAfter: n })} /></Field>
          <Field label="Majoration des heures sup. (%)"><NumInput value={s.overtimeRate ?? 50} onChange={(n) => setS({ ...s, overtimeRate: n })} /></Field>
          <Field label="Rappels : nouveau délai accordé (jours)"><NumInput value={s.reminderDays ?? 10} onChange={(n) => setS({ ...s, reminderDays: n })} /></Field>
          {(['autoliquidation', 'exonere', 'hors_ue'] as const).map((r) => (
            <Field key={r} label={`Mention légale — ${VAT_REGIME_LABELS[r]}`} full>
              <input value={s.vatMentions?.[r] ?? DEFAULT_VAT_MENTIONS[r]} onChange={(e) => setS({ ...s, vatMentions: { ...s.vatMentions, [r]: e.target.value } })} />
            </Field>
          ))}
          <Field label="Délai de paiement des factures (jours)"><NumInput value={s.paymentDays} onChange={(n) => setS({ ...s, paymentDays: n })} /></Field>
          <Field label="Validité des devis (jours)"><NumInput value={s.quoteValidityDays} onChange={(n) => setS({ ...s, quoteValidityDays: n })} /></Field>
          <Field label="Coefficients par durée (1 j, 2 j, 3 j…) séparés par des « ; »" full>
            <input value={s.factors.join(' ; ')} onChange={(e) => setS({ ...s, factors: e.target.value.split(';').map((x) => parseFloat(x.replace(',', '.'))).filter((x) => !isNaN(x)) })} />
          </Field>
          <Field label="Au-delà : + par jour supplémentaire"><NumInput step="any" value={s.factorExtraPerDay} onChange={(n) => setS({ ...s, factorExtraPerDay: n })} /></Field>
          <Field label="Assurance du matériel par défaut (% de la location, 0 = aucune)"><NumInput step="any" value={s.insurancePct ?? 0} onChange={(n) => setS({ ...s, insurancePct: n })} /></Field>
          <Field label="Conditions générales (imprimées après les devis)" full><textarea style={{ minHeight: 120 }} value={s.terms || ''} onChange={(e) => setS({ ...s, terms: e.target.value || undefined })} placeholder="Annulation, casse, retards, assurance…" /></Field>
          <Field label=" " full><label className="check-row"><input type="checkbox" checked={!!s.termsOnInvoices} onChange={(e) => setS({ ...s, termsOnInvoices: e.target.checked })} /> Imprimer aussi les conditions générales sur les factures</label></Field>
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
        <h2>Base de démonstration</h2>
        <p className="muted">
          Une base séparée remplie de clients, de matériel, d'une équipe et de projets fictifs (dates calculées à partir d'aujourd'hui)
          pour tester toutes les fonctions sans toucher à tes vraies données.
        </p>
        <div className="toolbar">
          {currentWorkspace() === DEMO_WORKSPACE ? (
            <>
              <button onClick={async () => {
                if (!confirm('Effacer la base de démo et recréer les données fictives ?')) return;
                await seedDemo(); location.hash = '#/'; location.reload();
              }}>Réinitialiser les données de démo</button>
              <button className="secondary" onClick={() => switchWorkspace('principal')}>Revenir à ma base principale</button>
            </>
          ) : (
            <button onClick={() => switchWorkspace(DEMO_WORKSPACE)}>Ouvrir la base de démo</button>
          )}
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

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

function dataUrlToBlob(url: string): Blob {
  const [head, data] = url.split(',');
  const type = head.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bin = atob(data || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
