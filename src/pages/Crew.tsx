import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Empty, Field, Modal, NumInput, PageHead, useSettings } from '../components/ui';
import { appBaseUrl, db } from '../db';
import type { Person, ProjectFile, Unavailability } from '../types';
import { buildIcs, crewWindow, download, fmtRange, money, save, toLocalInput, uid } from '../utils';
import { CsvButton, exportCsv } from '../components/extra';
import { BulkBar, BulkSet, SelectAllTh, SelectTd, useSelection } from '../components/Selection';
import { agendaLink, mySheetLink, newToken, signupLink } from '../mailer';
import { syncEnabled, syncNow } from '../sync';
import { FileViewer } from '../components/FileViewer';
import { Icon } from '../components/Icon';
import { PlanningSend } from './PlanningSend';
import { MailHistory } from './EmailsPage';

type Draft = Partial<Person> & { name: string; dailyRate: number; external: boolean };

const SHEET_FIELD_LABELS: Record<string, string> = {
  name: 'Nom', email: 'Email', phone: 'Téléphone', city: 'Ville', role: 'Fonction', skills: 'Fonctions',
  status: 'Statut', vatNumber: 'N° TVA', costRate: 'Tarif / jour souhaité', notes: 'Notes',
};

export default function Crew() {
  const settings = useSettings();
  const everyone = useLiveQuery(() => db.people.orderBy('name').toArray(), []) || [];
  const [q, setQ] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('q') || '');
  const qn = q.trim().toLowerCase();
  // inscrits via le formulaire, pas encore validés : à part
  const people = everyone.filter((p) => !p.pending && (!qn || [p.name, p.email, p.role, p.phone, p.folder].join(' ').toLowerCase().includes(qn)));
  const pending = everyone.filter((p) => p.pending);
  // fiches modifiées par les techniciens via leur lien « ma fiche », à relire
  const reviews = everyone.filter((p) => p.sheetReview);
  const [linkMsg, setLinkMsg] = useState('');
  const [sheetMsg, setSheetMsg] = useState('');
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const [edit, setEdit] = useState<Draft | null>(null);
  const [unavFor, setUnavFor] = useState<Person | null>(null);
  const [docsFor, setDocsFor] = useState<Person | null>(null);
  const [historyFor, setHistoryFor] = useState<Person | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [folder, setFolder] = useState('');
  const companies = useLiveQuery(() => db.contacts.where('type').anyOf('soustraitant', 'fournisseur').sortBy('company'), []) || [];
  const files = useLiveQuery(() => db.files.where('personId').above('').toArray(), []) || [];
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const unav = useLiveQuery(() => db.unavailability.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const sMap = new Map(subs.map((s) => [s.id, s]));
  const nowS = toLocalInput(new Date());

  const assignmentsOf = (id: string) => crew
    .filter((c) => c.personId === id && sMap.get(c.subprojectId)?.status !== 'annule' && c.final !== false)
    .sort((a, b) => a.start.localeCompare(b.start));

  const exportIcs = (person: Person) => {
    const base = appBaseUrl(settings);
    const events = assignmentsOf(person.id).map((c) => {
      const p = pMap.get(c.projectId);
      const s = sMap.get(c.subprojectId);
      const [a, b] = crewWindow(c, p?.travelMinutes);
      return { uid: c.id, title: `${c.function} — ${p?.name || ''}`, start: a, end: b, location: s?.venue || p?.venue, description: s?.name, url: `${base}#/projets/${c.projectId}` };
    });
    download(`agenda-${person.name.replace(/\s+/g, '-')}.ics`, buildIcs(`FabEvent — ${person.name}`, events), 'text/calendar;charset=utf-8');
  };

  const folders = Array.from(new Set(everyone.map((p) => p.folder).filter((f): f is string => !!f))).sort();
  const shown = people.filter((p) => (showInactive || !p.inactive) && (!folder || p.folder === folder));
  const sel = useSelection(shown.map((p) => p.id));
  const csv = (list = people) => exportCsv('equipe.csv', ['Nom', 'Fonction', 'Statut', 'Société', 'Téléphone', 'Email', 'Coût / jour', 'Coût / heure'],
    list.map((p) => [p.name, p.role, p.external ? 'Sous-traitant' : 'Interne', companies.find((c) => c.id === p.contactId)?.company, p.phone, p.email, p.costRate, p.hourlyCost]));
  const roles = Array.from(new Set(everyone.flatMap((p) => [p.role, ...(p.skills || [])]).filter((x): x is string => !!x))).sort((a, b) => a.localeCompare(b, 'fr'));

  return (
    <>
      <PageHead title="Équipe & sous-traitants">
        <input placeholder="Rechercher une personne…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une personne" />
        <CsvButton onClick={() => csv()} />
        <button className="secondary" onClick={() => setSharing(true)}><Icon name="send" />Partager le planning</button>
        <button onClick={() => setEdit({ name: '', dailyRate: 0, external: false })}>+ Nouvelle personne</button>
      </PageHead>
      {sharing && <PlanningSend people={people.filter((p) => !p.inactive)} onClose={() => setSharing(false)} />}
      {historyFor && <PersonHistory person={historyFor} onClose={() => setHistoryFor(null)} />}
      {sheetMsg && <div className="info">{sheetMsg}</div>}
      {pending.length > 0 && (
        <div className="card signup-pending">
          <h2 style={{ marginTop: 0 }}>Inscriptions à valider ({pending.length})</h2>
          <p className="muted" style={{ marginTop: 0 }}>Reçues par le formulaire d'inscription. Valide pour les ajouter à ton équipe (complète le coût si besoin), ou refuse.</p>
          <table className="list"><tbody>{pending.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong>{p.city && <span className="muted"> · {p.city}</span>}<div className="muted">{[p.email, p.phone].filter(Boolean).join(' · ')}</div></td>
              <td>{(p.skills || []).join(', ') || p.role}<div className="muted">{[p.status, p.vatNumber && `TVA ${p.vatNumber}`, p.costRate ? `${money(p.costRate)}/j souhaité` : ''].filter(Boolean).join(' · ')}</div>
                {p.notes && <div className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{p.notes}</div>}</td>
              <td className="nowrap">
                <button className="small" onClick={() => save(db.people, { ...p, pending: false, external: true })}>Valider</button>{' '}
                <button className="secondary small" onClick={() => setEdit({ ...p, pending: false })}>Valider et compléter…</button>{' '}
                <button className="ghost small" onClick={() => confirm(`Refuser et supprimer l'inscription de ${p.name} ?`) && db.people.delete(p.id)}>Refuser</button>
              </td>
            </tr>
          ))}</tbody></table>
        </div>
      )}
      {reviews.length > 0 && (
        <div className="card signup-pending">
          <h2 style={{ marginTop: 0 }}>Fiches mises à jour par les techniciens ({reviews.length})</h2>
          <p className="muted" style={{ marginTop: 0 }}>Modifications envoyées via le lien « ma fiche » de chaque personne. Garde-les, ou annule pour revenir aux valeurs d'avant.</p>
          <table className="list"><tbody>{reviews.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong>
                <div className="muted">{Object.entries(p.sheetReview!.prev).map(([k, old]) => (
                  <div key={k} style={{ fontSize: 12 }}>{SHEET_FIELD_LABELS[k] || k} : <s>{String(old ?? '—')}</s> → <b>{String((p as unknown as Record<string, unknown>)[k] ?? '—')}</b></div>
                ))}</div>
              </td>
              <td className="nowrap">
                <button className="small" onClick={() => save(db.people, { ...p, sheetReview: undefined })}>Garder</button>{' '}
                <button className="secondary small" onClick={() => save(db.people, { ...p, ...(p.sheetReview!.prev as Partial<Person>), sheetReview: undefined })}>Annuler les changements</button>
              </td>
            </tr>
          ))}</tbody></table>
        </div>
      )}
      <div className="card signup-link">
        <h2 style={{ marginTop: 0 }}>Formulaire d'inscription des techniciens</h2>
        {!signupLink('x') ? <p className="muted">Il fonctionne avec FabEvent installé sur ton hébergement (serveur de synchronisation) : les fiches remplies arrivent ici toutes seules.</p>
          : settings.signupKey ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Envoie ce lien (ou mets-le sur ton site) : chaque technicien remplit sa fiche (coordonnées, fonctions, statut, tarif), elle arrive dans « Inscriptions à valider ».</p>
              <div className="toolbar">
                <input readOnly value={signupLink(settings.signupKey)} aria-label="Lien du formulaire d'inscription" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, maxWidth: 'none' }} />
                <button className="secondary small" onClick={() => navigator.clipboard?.writeText(signupLink(settings.signupKey!)).then(() => setLinkMsg('Lien copié.'), () => setLinkMsg('Sélectionne le lien et copie-le.'))}>Copier</button>
                <button className="ghost small" onClick={async () => { if (confirm('Fermer le formulaire ? L\'ancien lien ne fonctionnera plus.')) { const s2 = await db.settings.get('main'); if (s2) await db.settings.put({ ...s2, signupKey: undefined }); } }}>Fermer le formulaire</button>
              </div>
              {linkMsg && <span className="avail ok">{linkMsg}</span>}
              <p className="muted" style={{ fontSize: 12 }}>Les fonctions proposées sont celles du catalogue (Paramètres → Fonctions et tarifs).</p>
            </>
          ) : <button className="small" onClick={async () => { const s2 = await db.settings.get('main'); if (s2) await db.settings.put({ ...s2, signupKey: newToken(24) }); }}>Ouvrir le formulaire d'inscription</button>}
      </div>
      <div className="card">
        <div className="toolbar">
          {folders.length > 0 && (
            <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Dossier">
              <option value="">Tous les dossiers</option>
              {folders.map((f) => <option key={f}>{f}</option>)}
            </select>
          )}
          {everyone.some((p) => p.inactive) && <label className="check-row"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Afficher les inactifs</label>}
        </div>
        <BulkBar sel={sel} noun="personne(s)">
          <BulkSet label="Ranger dans le dossier" options={[...folders.map((f) => [f, f] as [string, string]), ['__new', 'Nouveau dossier…'], ['__none', 'Sans dossier']]} onApply={async (f) => {
            const name = f === '__new' ? prompt('Nom du dossier :')?.trim() : f === '__none' ? '' : f;
            if (name === undefined || name === null) return;
            for (const id of sel.ids) await db.people.update(id, { folder: name || undefined, updatedAt: new Date().toISOString() });
          }} />
          {roles.length > 0 && <BulkSet label="Changer la fonction" options={roles.map((r) => [r, r])} onApply={async (role) => {
            for (const id of sel.ids) await db.people.update(id, { role, updatedAt: new Date().toISOString() });
          }} />}
          <BulkSet label="Changer le statut" options={[['interne', 'Interne'], ['externe', 'Sous-traitant']]} onApply={async (v) => {
            for (const id of sel.ids) await db.people.update(id, { external: v === 'externe', updatedAt: new Date().toISOString() });
          }} />
          <button className="secondary small" onClick={() => csv(people.filter((p) => sel.has(p.id)))}>Exporter (CSV)</button>
          <button className="danger small" onClick={async () => {
            if (!confirm(`Supprimer ${sel.size} personne(s) ? Leurs postes resteront « à pourvoir ».`)) return;
            for (const id of sel.ids) { await db.crew.where({ personId: id }).modify({ personId: undefined }); await db.people.delete(id); }
            sel.clear();
          }}>Supprimer</button>
        </BulkBar>
        {shown.length === 0 ? <Empty>Ajoute tes techniciens (salariés, intermittents, sous-traitants).</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><SelectAllTh sel={sel} /><th>Nom</th><th>Fonction</th><th>Statut</th><th>Téléphone</th><th className="n">Coût/j</th><th className="n">Coût/h</th><th>Prochaines missions</th><th /></tr></thead>
              <tbody>
                {shown.map((p) => {
                  const next = assignmentsOf(p.id).filter((c) => c.end >= nowS);
                  return (
                    <tr key={p.id}>
                      <SelectTd sel={sel} id={p.id} label={p.name} />
                      <td><a href="#" onClick={(e) => { e.preventDefault(); setEdit(p); }}><strong>{p.name}</strong></a>
                        {p.inactive && <span className="badge" style={{ marginLeft: 4 }}>inactif</span>}
                        {p.contract?.end && p.contract.end >= nowS.slice(0, 10) && p.contract.end <= soon && <div className="avail ko" style={{ fontSize: 11 }}>contrat jusqu'au {new Date(p.contract.end).toLocaleDateString('fr-BE')}</div>}
                        {p.folder && <div className="muted" style={{ fontSize: 11 }}>{p.folder}</div>}</td>
                      <td>{p.role}{p.skills?.filter((x) => x !== p.role).length ? <div className="muted" style={{ fontSize: 11 }}>{p.skills.filter((x) => x !== p.role).join(', ')}</div> : null}</td>
                      <td><span className="badge">{p.external ? 'Sous-traitant' : 'Interne'}</span>{p.contactId && <div className="muted" style={{ fontSize: 11 }}>{companies.find((c) => c.id === p.contactId)?.company}</div>}</td>
                      <td>{p.phone}</td>
                      <td className="n">{p.costRate ? money(p.costRate) : <span className="muted">—</span>}{p.dayHours ? <div className="muted" style={{ fontSize: 11 }}>forfait {p.dayHours} h</div> : null}{p.rates?.filter((r) => r.function && r.cost).map((r) => <div key={r.function} className="muted" style={{ fontSize: 11 }}>{r.function} {money(r.cost!)}</div>)}</td>
                      <td className="n">{p.hourlyCost ? money(p.hourlyCost) : <span className="muted">—</span>}</td>
                      <td>{next.length === 0 ? <span className="muted">—</span> : next.slice(0, 3).map((c) => (
                        <div key={c.id} style={{ fontSize: 12 }}>{pMap.get(c.projectId)?.name} · {fmtRange(c.start, c.end)}</div>
                      ))}{next.length > 3 && <span className="muted">+{next.length - 3}</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="secondary small" onClick={() => setDocsFor(p)}>Documents{(() => {
                          const mine = files.filter((f) => f.personId === p.id);
                          const late = mine.filter((f) => f.expires && f.expires <= soon).length;
                          return mine.length ? <span className={late ? 'avail ko' : ''}> ({mine.length}{late ? ` · ${late} à renouveler` : ''})</span> : null;
                        })()}</button>{' '}
                        <button className="secondary small" onClick={() => setUnavFor(p)}>Indispos{unav.filter((u) => u.personId === p.id && u.end >= nowS).length ? ` (${unav.filter((u) => u.personId === p.id && u.end >= nowS).length})` : ''}</button>{' '}
                        <button className="secondary small" onClick={() => setHistoryFor(p)}>Historique</button>{' '}
                        <button className="secondary small" onClick={() => exportIcs(p)}>Agenda .ics</button>{' '}
                        <button className="secondary small" title="Lien personnel « ma fiche » : le technicien met à jour lui-même ses coordonnées, fonctions et tarif (elles arrivent ici à relire)" onClick={async () => {
                          const tok = p.sheetToken || newToken(24);
                          if (!p.sheetToken) await save(db.people, { ...p, sheetToken: tok });
                          const link = mySheetLink(tok);
                          if (!link) { setSheetMsg('Le lien « ma fiche » nécessite FabEvent installé sur un hébergement (serveur de synchronisation, comme le formulaire d\'inscription).'); return; }
                          await navigator.clipboard?.writeText(link).catch(() => undefined);
                          setSheetMsg(`Lien « ma fiche » de ${p.name} copié dans le presse-papiers.`);
                        }}>Lien « ma fiche »</button>{' '}
                        <button className="secondary small" title="Lien d'abonnement à son agenda (Google, iPhone/Mac, Outlook) : ses postes s'y ajoutent et se mettent à jour tout seuls ; « [Option] » tant que le projet n'est pas confirmé" onClick={async () => {
                          const tok = p.calToken || newToken(24);
                          if (!p.calToken) await save(db.people, { ...p, calToken: tok });
                          const link = agendaLink(tok);
                          if (!link) { setSheetMsg('L\'agenda en ligne nécessite FabEvent installé sur un hébergement (serveur de synchronisation).'); return; }
                          if (syncEnabled()) await syncNow(); // le lien marche tout de suite
                          await navigator.clipboard?.writeText(link).catch(() => undefined);
                          setSheetMsg(`Lien d'agenda de ${p.name} copié : envoie-le-lui, il s'abonne en un clic (Google Agenda, iPhone/Mac, Outlook). ${link}`);
                        }}>Lien agenda</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted">« Lien agenda » : la personne s'abonne une fois et ses postes arrivent tout seuls dans son agenda (Google, iPhone/Mac, Outlook), mis à jour quand les horaires changent ; « [Option] » tant que le projet n'est pas confirmé. « Agenda .ics » : fichier ponctuel de son planning actuel.</p>
      {docsFor && <PersonDocs person={docsFor} files={files.filter((f) => f.personId === docsFor.id)} onClose={() => setDocsFor(null)} />}
      {unavFor && <UnavailabilityModal person={unavFor} list={unav.filter((u) => u.personId === unavFor.id)} onClose={() => setUnavFor(null)} />}
      {edit && (
        <Modal title={edit.id ? 'Modifier' : 'Nouvelle personne'} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={async (e) => { e.preventDefault(); await save(db.people, edit as Person); setEdit(null); }}>
            <Field label="Nom *" full><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Fonction principale"><input value={edit.role || ''} onChange={(e) => setEdit({ ...edit, role: e.target.value })} placeholder="ex. Régisseur son" /></Field>
            <Field label="Sait aussi faire (fonctions, séparées par des virgules)"><input value={(edit.skills || []).join(', ')} onChange={(e) => setEdit({ ...edit, skills: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="ex. Technicien lumière, Rigger" aria-label="Compétences" /></Field>
            <Field label="Ville"><input value={edit.city || ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
            <Field label="Ce qu'il te coûte / jour (€ HT)"><NumInput value={edit.costRate || 0} onChange={(n) => setEdit({ ...edit, costRate: n })} /></Field>
            <Field label="Ce qu'il te coûte / heure (€ HT)"><NumInput value={edit.hourlyCost || 0} onChange={(n) => setEdit({ ...edit, hourlyCost: n || undefined })} /></Field>
            <Field label="Heures comprises dans son forfait journalier">
              <NumInput step="0.5" value={edit.dayHours || 0} placeholder={String(settings.overtimeAfter ?? 10)} aria-label="Heures du forfait journalier"
                onChange={(n) => setEdit({ ...edit, dayHours: n || undefined })} />
            </Field>
            <p className="muted field full cost-help">
              {edit.hourlyCost && !edit.costRate ? 'Seulement un prix horaire : tous ses postes sont comptés à l\'heure (heures sup. majorées au-delà du forfait d\'heures).'
                : edit.costRate && !edit.hourlyCost ? `Seulement un forfait : au-delà de ${edit.dayHours || settings.overtimeAfter || 10} h, chaque heure sup. vaut ${money(edit.costRate / (edit.dayHours || settings.overtimeAfter || 10))} + ${settings.overtimeRate ?? 50} %.`
                : edit.costRate && edit.hourlyCost ? 'Forfait pour les postes à la journée, prix horaire pour les postes à l\'heure et pour les heures sup.'
                : `Forfait journalier et / ou prix horaire. Laisse les heures du forfait vides pour utiliser le réglage général (${settings.overtimeAfter ?? 10} h).`}
            </p>
            <div className="field full person-rates">
              <span>Tarifs selon la fonction (s'appliquent aux postes de cette fonction ; sinon le coût ci-dessus)</span>
              {(edit.rates || []).map((r, i) => {
                const upd = (patch: Partial<typeof r>) => setEdit({ ...edit, rates: (edit.rates || []).map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="rate-row">
                    <input list="fonctions-tarifs" value={r.function} onChange={(e) => upd({ function: e.target.value })} placeholder="ex. Technicien vidéo" aria-label="Fonction du tarif" />
                    <label>/ jour <NumInput value={r.cost ?? 0} onChange={(n) => upd({ cost: n || undefined })} aria-label={`Coût par jour ${r.function}`} /></label>
                    <label>/ heure <NumInput value={r.hourCost ?? 0} onChange={(n) => upd({ hourCost: n || undefined })} aria-label={`Coût par heure ${r.function}`} /></label>
                    <button type="button" className="ghost" aria-label="Retirer ce tarif" onClick={() => setEdit({ ...edit, rates: (edit.rates || []).filter((_, j) => j !== i) })}><Icon name="x" /></button>
                  </div>
                );
              })}
              <datalist id="fonctions-tarifs">{Array.from(new Set([...(settings.crewFunctions || []).map((f) => f.name), ...(edit.skills || []), edit.role || ''].filter(Boolean))).map((f) => <option key={f} value={f} />)}</datalist>
              <div><button type="button" className="secondary small" onClick={() => setEdit({ ...edit, rates: [...(edit.rates || []), { function: '' }] })}><Icon name="plus" />Tarif pour une fonction</button></div>
            </div>
            <p className="muted field full" style={{ margin: 0 }}>Le prix facturé au client vient de la fonction (Paramètres → Fonctions et tarifs clients). Ci-dessous, un tarif de secours si la fonction n'est pas au catalogue :</p>
            <Field label="Tarif client de secours / jour (€ HT)"><NumInput value={edit.dailyRate} onChange={(n) => setEdit({ ...edit, dailyRate: n })} /></Field>
            <Field label="Tarif client de secours / heure (€ HT)"><NumInput value={edit.hourlyRate || 0} onChange={(n) => setEdit({ ...edit, hourlyRate: n || undefined })} /></Field>
            <Field label="Email"><input type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Téléphone"><input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label=" "><label className="check-row"><input type="checkbox" checked={edit.external} onChange={(e) => setEdit({ ...edit, external: e.target.checked })} /> Sous-traitant / freelance externe</label></Field>
            {edit.external && (
              <Field label="Société qui facture (sinon le freelance lui-même)">
                <select value={edit.contactId || ''} onChange={(e) => setEdit({ ...edit, contactId: e.target.value || undefined })}>
                  <option value="">— freelance —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
                </select>
              </Field>
            )}
            <Field label="Contact d'urgence"><input value={edit.emergencyContact || ''} onChange={(e) => setEdit({ ...edit, emergencyContact: e.target.value || undefined })} placeholder="Nom et téléphone" /></Field>
            <Field label="Date de naissance"><input type="date" value={edit.birthDate || ''} onChange={(e) => setEdit({ ...edit, birthDate: e.target.value || undefined })} /></Field>
            <Field label="Permis de conduire"><input value={edit.drivingLicense || ''} onChange={(e) => setEdit({ ...edit, drivingLicense: e.target.value || undefined })} placeholder="B, C, BE…" /></Field>
            <Field label="Société du technicien"><input value={edit.company || ''} onChange={(e) => setEdit({ ...edit, company: e.target.value || undefined })} /></Field>
            <Field label="N° TVA"><input value={edit.vatNumber || ''} onChange={(e) => setEdit({ ...edit, vatNumber: e.target.value || undefined })} /></Field>
            <Field label="IBAN"><input value={edit.iban || ''} onChange={(e) => setEdit({ ...edit, iban: e.target.value || undefined })} /></Field>
            <Field label="Type de contrat"><input value={edit.contract?.type || ''} list="contract-types" onChange={(e) => setEdit({ ...edit, contract: { ...edit.contract, type: e.target.value || undefined } })} placeholder="CDI, CDD, intermittent, freelance…" />
              <datalist id="contract-types">{['CDI', 'CDD', 'Intermittent', 'Freelance', 'Étudiant', 'Intérim'].map((x) => <option key={x} value={x} />)}</datalist></Field>
            <Field label="Heures du contrat (par semaine)"><NumInput value={edit.contract?.hours || 0} onChange={(n) => setEdit({ ...edit, contract: { ...edit.contract, hours: n || undefined } })} /></Field>
            <Field label="Début du contrat"><input type="date" value={edit.contract?.start || ''} onChange={(e) => setEdit({ ...edit, contract: { ...edit.contract, start: e.target.value || undefined } })} /></Field>
            <Field label="Fin du contrat (alerte 30 jours avant)"><input type="date" value={edit.contract?.end || ''} onChange={(e) => setEdit({ ...edit, contract: { ...edit.contract, end: e.target.value || undefined } })} /></Field>
            <Field label="Dépôt habituel">
              <select value={edit.depotId || ''} onChange={(e) => setEdit({ ...edit, depotId: e.target.value || undefined })}>
                <option value="">—</option>
                {(settings.depots || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Dossier"><input value={edit.folder || ''} list="crew-folders" onChange={(e) => setEdit({ ...edit, folder: e.target.value || undefined })} placeholder="Intermittents, Freelances fréquents…" />
              <datalist id="crew-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist></Field>
            <Field label=" "><label className="check-row"><input type="checkbox" checked={!!edit.multiBooking} onChange={(e) => setEdit({ ...edit, multiBooking: e.target.checked || undefined })} /> Peut être planifié sur plusieurs postes en même temps</label></Field>
            <Field label=" "><label className="check-row"><input type="checkbox" checked={!!edit.inactive} onChange={(e) => setEdit({ ...edit, inactive: e.target.checked || undefined })} /> Inactif (n'est plus proposé pour les postes)</label></Field>
            <Field label="Notes" full><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            {edit.calToken && <p className="field full muted" style={{ margin: 0 }}>Agenda en ligne actif. <button type="button" className="secondary small" onClick={() => setEdit({ ...edit, calToken: undefined })} title="L'ancien lien ne marchera plus ; « Lien agenda » en crée un nouveau">Désactiver le lien d'agenda</button></p>}
            <div className="form-actions">
              {edit.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => {
                if (confirm('Supprimer cette personne ? Ses postes resteront « à pourvoir ».')) {
                  await db.crew.where({ personId: edit.id }).modify({ personId: undefined });
                  await db.people.delete(edit.id!); setEdit(null);
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

function UnavailabilityModal({ person, list, onClose }: { person: Person; list: Unavailability[]; onClose: () => void }) {
  const [start, setStart] = useState(toLocalInput(new Date()).slice(0, 10) + 'T00:00');
  const [end, setEnd] = useState(toLocalInput(new Date()).slice(0, 10) + 'T23:59');
  const [reason, setReason] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [until, setUntil] = useState('');
  return (
    <Modal title={`Indisponibilités — ${person.name}`} onClose={onClose}>
      {list.length === 0 ? <Empty>Aucune indisponibilité.</Empty> : (
        <table className="list">
          <tbody>
            {list.sort((a, b) => a.start.localeCompare(b.start)).map((u) => (
              <tr key={u.id}><td>{fmtRange(u.start, u.end)}</td><td>{u.reason}</td><td><button className="ghost" onClick={() => db.unavailability.delete(u.id)} aria-label="Retirer"><Icon name="x" /></button></td></tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="form" style={{ marginTop: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        if (end < start) return alert('La fin doit être après le début.');
        // répétée chaque semaine jusqu'à une date : une indisponibilité par semaine
        const stop = weekly && until ? until + 'T23:59' : start;
        const len = Date.parse(end) - Date.parse(start);
        for (let t = Date.parse(start), i = 0; toLocalInput(new Date(t)) <= stop && i < 260; t += 7 * 86400000, i++) {
          await save(db.unavailability, { personId: person.id, start: toLocalInput(new Date(t)), end: toLocalInput(new Date(t + len)), reason: (reason || '') + (weekly && until ? ' (chaque semaine)' : '') || undefined });
        }
        setReason('');
      }}>
        <Field label="Du"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Au"><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Motif" full><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Congés, autre prestation…" /></Field>
        <Field label=" "><label className="check-row"><input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /> Se répète chaque semaine</label></Field>
        {weekly && <Field label="jusqu'au"><input type="date" value={until} required onChange={(e) => setUntil(e.target.value)} /></Field>}
        <div className="form-actions"><button type="submit">+ Ajouter</button></div>
      </form>
    </Modal>
  );
}

/** Documents d'une personne (permis, habilitations, contrat…) avec date d'expiration. */
function PersonDocs({ person, files, onClose }: { person: Person; files: ProjectFile[]; onClose: () => void }) {
  const [expires, setExpires] = useState('');
  const [category, setCategory] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [viewing, setViewing] = useState<ProjectFile | null>(null);
  const open = (f: ProjectFile) => setViewing(f);
  if (viewing) return <FileViewer file={viewing} onClose={() => setViewing(null)} />;
  return (
    <Modal title={`Documents — ${person.name}`} onClose={onClose}>
      {files.length === 0 ? <Empty>Aucun document (permis, habilitation électrique, travail en hauteur, contrat…).</Empty> : (
        <table className="list">
          <tbody>
            {files.sort((a, b) => (a.expires || '9').localeCompare(b.expires || '9')).map((f) => (
              <tr key={f.id}>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(f); }}>{f.name}</a>
                  <div><input aria-label={`Catégorie de ${f.name}`} list="doc-cats" value={f.category || ''} placeholder="Catégorie" onChange={(e) => db.files.put({ ...f, category: e.target.value || undefined })} style={{ width: 150, fontSize: 12 }} /></div></td>
                <td>
                  <input type="date" value={f.expires || ''} onChange={(e) => db.files.put({ ...f, expires: e.target.value || undefined })} style={{ width: 150 }} />
                  {f.expires && f.expires < today && <span className="avail ko"> expiré</span>}
                  {f.expires && f.expires >= today && f.expires <= soon && <span className="avail ko"> expire bientôt</span>}
                </td>
                <td><button className="ghost" onClick={() => confirm(`Supprimer ${f.name} ?`) && db.files.delete(f.id)} aria-label="Supprimer"><Icon name="x" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="toolbar" style={{ marginTop: 12, alignItems: 'center' }}>
        <input list="doc-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Catégorie" aria-label="Catégorie du document" style={{ width: 150 }} />
        <datalist id="doc-cats">{['Permis', 'Certificat', 'Habilitation', 'Contrat', 'Pièce d\'identité', 'Médical'].map((x) => <option key={x} value={x} />)}</datalist>
        <span className="muted">Expire le</span>
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} style={{ width: 160 }} />
        <label className="btn secondary" style={{ background: 'var(--soft)', color: 'var(--text)', border: '1px solid var(--border)' }}>
          + Ajouter un document
          <input type="file" hidden multiple onChange={async (e) => {
            for (const file of Array.from(e.target.files || [])) {
              await db.files.put({ id: uid(), projectId: '', personId: person.id, name: file.name, type: file.type, size: file.size, blob: file, createdAt: new Date().toISOString(), expires: expires || undefined, category: category || undefined });
            }
            e.target.value = '';
          }} />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Le tableau de bord signale les documents qui expirent dans les 30 jours.</p>
    </Modal>
  );
}

/** Historique des missions d'une personne (passées et à venir), avec le total d'heures par année. */
function PersonHistory({ person, onClose }: { person: Person; onClose: () => void }) {
  const crew = useLiveQuery(() => db.crew.where({ personId: person.id }).toArray(), [person.id]) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const unav = useLiveQuery(() => db.unavailability.where({ personId: person.id }).toArray(), [person.id]) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const list = [...crew].sort((a, b) => b.start.localeCompare(a.start));
  const nowS = toLocalInput(new Date());
  return (
    <Modal title={`Historique — ${person.name}`} onClose={onClose} wide>
      <p className="muted">{list.length} poste(s) · {new Set(list.map((c) => c.projectId)).size} projet(s) · {unav.length} indisponibilité(s)</p>
      <MailHistory personId={person.id} email={person.email} />
      {list.length === 0 ? <Empty>Aucune mission.</Empty> : (
        <table className="list">
          <thead><tr><th>Dates</th><th>Projet</th><th>Fonction</th><th /></tr></thead>
          <tbody>{list.map((c) => {
            const p = pMap.get(c.projectId);
            return (
              <tr key={c.id}>
                <td className="nowrap">{fmtRange(c.start, c.end)}</td>
                <td>{p ? <a href={'#/projets/' + p.id} onClick={onClose}>{p.number} {p.name}</a> : '—'}</td>
                <td>{c.function}{c.final === false && <span className="badge st-option" style={{ marginLeft: 4 }}>provisoire</span>}</td>
                <td>{c.end < nowS ? <span className="muted">passé</span> : <span className="avail ok">à venir</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </Modal>
  );
}
