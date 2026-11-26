import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { EmailModal } from '../components/EmailModal';
import type { Attachment } from '../email';
import { htmlToPdf, safeFileName } from '../pdf';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DOC_CSS, DocRender } from '../components/DocRender';
import { Modal, PageHead } from '../components/ui';
import { setStatusDeep } from '../documents';
import { db } from '../db';
import { createDocument } from '../documents';
import type { DocStatus, SnapshotSub } from '../types';
import { DOC_LABELS, DOC_STATUS_LABELS, INVOICE_TYPES } from '../types';
import { buildUbl, peppolProblems } from '../ubl';
import { download, fmtDate, fmtRange, money, orderedSubprojects, parseNumber, save, subKey } from '../utils';
import { newToken, quoteLink } from '../mailer';
import { Icon } from '../components/Icon';

export default function DocumentView() {
  const { id } = useParams();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [mailing, setMailing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quoteUrl, setQuoteUrl] = useState<string | null>(null);
  const [qMsg, setQMsg] = useState('');
  const [ordering, setOrdering] = useState(false);
  const doc = useLiveQuery(() => db.docs.get(id!), [id]);
  const siblings = useLiveQuery(
    async () => (doc ? (await db.docs.where({ projectId: doc.projectId }).toArray()).filter((d) => d.type === doc.type).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [doc?.projectId, doc?.type],
  ) || [];
  /** emails des techniciens affectés au projet */
  const crewEmails = useLiveQuery(async () => {
    if (!doc) return [];
    const crew = await db.crew.where({ projectId: doc.projectId }).toArray();
    const people = await db.people.toArray();
    const pm = new Map(people.map((x) => [x.id, x]));
    return crew.map((c) => (c.personId ? pm.get(c.personId)?.email : undefined)).filter((e): e is string => !!e);
  }, [doc?.id, doc?.projectId]) || [];
  /** adresses liées au projet, proposées en premier dans les destinataires ; feuille de route / bon de sortie : les techniciens seuls, pas le client */
  const hints = useLiveQuery(async () => {
    if (!doc) return [];
    const p = await db.projects.get(doc.projectId);
    const client = p?.clientId ? await db.contacts.get(p.clientId) : undefined;
    const venue = p?.venueId ? await db.contacts.get(p.venueId) : undefined;
    const out: string[] = [];
    const push = (e?: string) => { if (e && !out.includes(e)) out.push(e); };
    if (doc.type === 'feuille_route' || doc.type === 'bon_sortie') for (const e of crewEmails) push(e);
    else {
      push(client?.email); for (const pe of client?.persons || []) push(pe.email); for (const d of client?.departments || []) push(d.email);
      push(venue?.email); for (const pe of venue?.persons || []) push(pe.email);
      for (const e of crewEmails) push(e);
    }
    return out;
  }, [doc?.id, doc?.projectId, doc?.type, crewEmails.join(',')]) || [];
  if (!doc) return <p>Chargement…</p>;

  const isInvoice = INVOICE_TYPES.includes(doc.type);
  const title = `${DOC_LABELS[doc.type]} ${doc.number}${!isInvoice ? ' v' + doc.version : ''}`;
  /** déplace une salle (sous-projet figé) d'un cran dans le document et fige le nouvel ordre */
  const moveSub = async (sp: SnapshotSub, dir: -1 | 1) => {
    const arr = orderedSubprojects(doc);
    const i = arr.findIndex((x) => subKey(x) === subKey(sp));
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    const keys = arr.map(subKey);
    [keys[i], keys[j]] = [keys[j], keys[i]];
    await save(db.docs, { ...doc, subOrder: keys });
  };
  const exportPeppol = () => {
    const problems = peppolProblems(doc);
    if (problems.length && !confirm('Informations manquantes pour Peppol :\n- ' + problems.join('\n- ') + '\n\nLe document a été figé sans elles. Corrige-les puis génère une nouvelle facture, ou télécharge quand même ?')) return;
    download(`${doc.number}.xml`, buildUbl(doc), 'application/xml');
  };
  const makeCreditNote = async () => {
    const answer = prompt(`Montant HT à créditer (laisser vide = avoir total de ${doc.snapshot.totalHT.toFixed(2)} €)`, '');
    if (answer === null) return;
    const amountHT = answer.trim() ? parseNumber(answer) : undefined;
    const credit = await createDocument(doc.projectId, 'avoir', { invoiceId: doc.id, amountHT });
    nav('/documents/' + credit.id);
  };
  const exportHtml = () => {
    const body = ref.current?.innerHTML || '';
    download(`${doc.number}-v${doc.version}.html`,
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#fff}${DOC_CSS}</style></head><body>${body}</body></html>`,
      'text/html;charset=utf-8');
  };
  /** PDF du document tel qu'affiché (figé), pour l'email ou le téléchargement */
  const makePdf = async (): Promise<Attachment> => ({
    name: `${safeFileName(title)}.pdf`, type: 'application/pdf', blob: await htmlToPdf(ref.current?.innerHTML || '', DOC_CSS),
  });
  const attachments = async (): Promise<Attachment[]> => {
    const list = [await makePdf()];
    // facture : le XML Peppol (UBL) est joint s'il est complet
    if (isInvoice && !peppolProblems(doc).length) list.push({ name: `${doc.number}.xml`, type: 'application/xml', blob: new Blob([buildUbl(doc)], { type: 'application/xml' }) });
    return list;
  };
  const mailDraft = () => ({
    // feuille de route / bon de sortie : envoyés aux techniciens concernés, jamais au client
    to: (doc.type === 'feuille_route' || doc.type === 'bon_sortie') ? crewEmails.join(', ') : doc.snapshot.contactEmail || doc.snapshot.department?.email || doc.snapshot.client?.email || '',
    subject: `${title} — ${doc.snapshot.project.name}`,
    body: `Bonjour${doc.contactPerson ? ' ' + doc.contactPerson.split(' ')[0] : ''},\n\nVeuillez trouver ci-joint notre ${DOC_LABELS[doc.type].toLowerCase()} ${doc.number} pour « ${doc.snapshot.project.name} ».\n\nCordialement,\n${doc.snapshot.company.name}`,
  });

  /** variables des modèles de mail */
  const mailVars = () => {
    const sn = doc.snapshot;
    return {
      prenom: doc.contactPerson?.split(' ')[0] || '', client: sn.client?.company, projet: sn.project.name, numero: doc.number, lieu: sn.project.venue,
      dates: sn.project.start ? fmtRange(sn.project.start, sn.project.end) : '', montant: money(sn.totalTTC), echeance: sn.dueDate ? fmtDate(sn.dueDate, false) : '',
      societe: sn.company.name, contact: sn.contacts?.map((c) => `${c.name}${c.phone ? ' ' + c.phone : ''}`).join(', '),
      lien: doc.type === 'devis' && doc.publicToken ? quoteLink(doc.publicToken) : '',
    };
  };

  return (
    <>
      <style>{DOC_CSS}</style>
      <div className="no-print">
        <PageHead title={title}>
          <Link to={'/projets/' + doc.projectId + '?onglet=finances'} state={{ restore: true }}><button className="secondary" title="Revenir au projet, à l'endroit où tu étais dans Finances & documents"><Icon name="arrow-left" />Projet</button></Link>
          <select value={doc.status} style={{ width: 'auto' }} onChange={async (e) => {
            const status = e.target.value as DocStatus;
            await save(db.docs, { ...doc, status });
            // devis accepté = projet confirmé (le matériel passe en réservation ferme)
            if (doc.type === 'devis' && status === 'accepte') await setStatusDeep(doc.projectId, 'confirme', ['demande', 'brouillon', 'option']);
          }}>
            {Object.entries(DOC_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={() => window.print()}>Imprimer / PDF</button>
          <button className="secondary" onClick={exportHtml}>Télécharger (HTML)</button>
          <button className="secondary" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const f = await makePdf(); download(f.name, f.blob, f.type); } catch (e) { alert('PDF impossible : ' + (e as Error).message); } finally { setBusy(false); }
          }}>{busy ? 'PDF…' : 'Télécharger le PDF'}</button>
          <button className="secondary" onClick={() => setMailing(true)}>Envoyer par email</button>
          {doc.type === 'devis' && <button className="secondary" title="Lien public : le client accepte ou refuse le devis en ligne (arrive ici, statut « accepté » + projet confirmé)" onClick={async () => {
            let tok = doc.publicToken;
            if (!tok) { tok = newToken(24); await save(db.docs, { ...doc, publicToken: tok }); }
            const u = quoteLink(tok);
            setQuoteUrl(u);
            if (u) await navigator.clipboard?.writeText(u).then(() => setQMsg('Lien d\'acceptation copié.'), () => setQMsg('Sélectionne le lien et copie-le.'));
            else setQMsg('Nécessite FabEvent installé sur un hébergement (serveur de synchronisation).');
          }}>Lien d'acceptation en ligne</button>}
          {isInvoice && <button className="secondary" onClick={exportPeppol}>Peppol (XML)</button>}
          {(doc.type === 'facture' || doc.type === 'acompte') && <button className="secondary" onClick={makeCreditNote}>Créer un avoir</button>}
          {(doc.type === 'facture' || doc.type === 'acompte') && doc.status !== 'paye' && (doc.snapshot.dueDate || '9') < new Date().toISOString() && (
            <button className="secondary" onClick={async () => nav('/documents/' + (await createDocument(doc.projectId, 'rappel', { invoiceId: doc.id })).id)}>Envoyer un rappel</button>
          )}
          {!isInvoice && <button className="secondary" onClick={async () => nav('/documents/' + (await createDocument(doc.projectId, doc.type)).id)}>Régénérer (nouvelle version)</button>}
          {doc.snapshot.subprojects.length > 1 && (
            <button className="secondary" title="Changer l'ordre des salles (sous-projets) dans ce document : l'ordre choisi s'affiche, s'imprime, s'exporte et s'envoie tel quel" onClick={() => setOrdering(true)}>Ordre des salles</button>
          )}
        </PageHead>
        <div className="info">
          Document figé le {fmtDate(doc.createdAt)} : il ne change plus même si le projet évolue.
          {isInvoice && ' Une facture ne se modifie pas : pour la corriger, crée un avoir puis une nouvelle facture.'}
          {siblings.length > 1 && <> Autres versions : {siblings.filter((d) => d.id !== doc.id).map((d) => (
            <Link key={d.id} to={'/documents/' + d.id} style={{ marginRight: 8 }}>{d.number} v{d.version} ({fmtDate(d.createdAt, false)})</Link>
          ))}</>}
        </div>
        {isInvoice && !doc.snapshot.company.iban && (
          <div className="info">Pas d'IBAN renseigné : ajoute-le (et le BIC) dans <Link to="/parametres">Paramètres → Ma société</Link> pour que le QR code de paiement s'imprime sur les factures.</div>
        )}
        {doc.type === 'devis' && (doc.acceptedOptions || []).length > 0 && (
          <div className="info">
            Options acceptées en ligne par le client ({doc.acceptedOptions!.length}) : {doc.snapshot.subprojects.flatMap((s) => s.equipment).filter((l) => l.optId && doc.acceptedOptions!.includes(l.optId)).map((l) => l.name).join(', ')} — passées en lignes facturées.
          </div>
        )}
      </div>
      {doc.type === 'devis' && quoteUrl !== null && quoteUrl && (
        <div className="no-print toolbar" style={{ marginBottom: 10 }}>
          <input readOnly value={quoteUrl} aria-label="Lien public d'acceptation du devis" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, maxWidth: 'none' }} />
          <button className="secondary small" onClick={() => navigator.clipboard?.writeText(quoteUrl).then(() => setQMsg('Lien copié.'), () => setQMsg('Sélectionne le lien et copie-le.'))}>Copier</button>
          {qMsg && <span className="avail ok">{qMsg}</span>}
        </div>
      )}
      {doc.type === 'devis' && quoteUrl === '' && qMsg && <div className="no-print" style={{ marginBottom: 10 }}><div className="info">{qMsg}</div></div>}
      <div className="doc-wrap" ref={ref}><DocRender doc={doc} /></div>
      {mailing && (
        <EmailModal initial={mailDraft()} prepare={attachments} onClose={() => setMailing(false)} kind={doc.type} vars={mailVars()} hints={hints}
          onSent={() => { if (doc.status === 'brouillon') save(db.docs, { ...doc, status: 'envoye' }); }} />
      )}
      {ordering && (
        <Modal title="Ordre des salles dans ce document" onClose={() => setOrdering(false)}>
          <p className="muted">Une section par salle (sous-projet), dans cet ordre à l'écran, à l'impression, au PDF et dans l'export XML. Les montants ne changent pas.</p>
          <table className="list"><tbody>
            {orderedSubprojects(doc).map((sp, i, arr) => (
              <tr key={subKey(sp)}>
                <td><strong>{sp.name}</strong><div className="muted">{fmtDate(sp.start)} → {fmtDate(sp.end)}</div></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button type="button" className="secondary small" aria-label={`Monter ${sp.name}`} title={`Monter « ${sp.name} » d'un cran`} disabled={i === 0} onClick={() => moveSub(sp, -1)}><Icon name="arrow-up" /></button>{' '}
                  <button type="button" className="secondary small" aria-label={`Descendre ${sp.name}`} title={`Descendre « ${sp.name} » d'un cran`} disabled={i === arr.length - 1} onClick={() => moveSub(sp, 1)}><Icon name="arrow-down" /></button>
                </td>
              </tr>
            ))}
          </tbody></table>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="secondary" onClick={async () => { const nd = { ...doc }; delete nd.subOrder; await save(db.docs, nd); }}>Ordre du projet (réinitialiser)</button>
          </div>
        </Modal>
      )}
      <div className="no-print" style={{ marginTop: 12 }}>
        {(!isInvoice || doc.status === 'brouillon') && <button className="danger small" onClick={async () => {
          if (confirm('Supprimer définitivement ce document ?')) { await db.docs.delete(doc.id); nav('/projets/' + doc.projectId); }
        }}>Supprimer ce document</button>}
      </div>
    </>
  );
}
