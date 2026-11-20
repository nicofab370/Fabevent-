import { useLiveQuery } from 'dexie-react-hooks';
import { useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DOC_CSS, DocRender } from '../components/DocRender';
import { PageHead } from '../components/ui';
import { setStatusDeep } from '../documents';
import { db } from '../db';
import { createDocument } from '../documents';
import type { DocStatus } from '../types';
import { DOC_LABELS, DOC_STATUS_LABELS, INVOICE_TYPES } from '../types';
import { buildUbl, peppolProblems } from '../ubl';
import { download, fmtDate, parseNumber, save } from '../utils';

export default function DocumentView() {
  const { id } = useParams();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const doc = useLiveQuery(() => db.docs.get(id!), [id]);
  const siblings = useLiveQuery(
    async () => (doc ? (await db.docs.where({ projectId: doc.projectId }).toArray()).filter((d) => d.type === doc.type).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [doc?.projectId, doc?.type],
  ) || [];
  if (!doc) return <p>Chargement…</p>;

  const isInvoice = INVOICE_TYPES.includes(doc.type);
  const title = `${DOC_LABELS[doc.type]} ${doc.number}${!isInvoice ? ' v' + doc.version : ''}`;
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
  const mail = () => {
    const c = doc.snapshot.client;
    const subject = encodeURIComponent(`${title} — ${doc.snapshot.project.name}`);
    const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint notre ${DOC_LABELS[doc.type].toLowerCase()} ${doc.number} pour « ${doc.snapshot.project.name} ».\n\nCordialement,\n${doc.snapshot.company.name}`);
    location.href = `mailto:${c?.email || ''}?subject=${subject}&body=${body}`;
  };

  return (
    <>
      <style>{DOC_CSS}</style>
      <div className="no-print">
        <PageHead title={title}>
          <Link to={'/projets/' + doc.projectId}><button className="secondary">← Projet</button></Link>
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
          <button className="secondary" onClick={mail}>Email</button>
          {isInvoice && <button className="secondary" onClick={exportPeppol}>Peppol (XML)</button>}
          {(doc.type === 'facture' || doc.type === 'acompte') && <button className="secondary" onClick={makeCreditNote}>Créer un avoir</button>}
          {(doc.type === 'facture' || doc.type === 'acompte') && doc.status !== 'paye' && (doc.snapshot.dueDate || '9') < new Date().toISOString() && (
            <button className="secondary" onClick={async () => nav('/documents/' + (await createDocument(doc.projectId, 'rappel', { invoiceId: doc.id })).id)}>Envoyer un rappel</button>
          )}
          {!isInvoice && <button className="secondary" onClick={async () => nav('/documents/' + (await createDocument(doc.projectId, doc.type)).id)}>Régénérer (nouvelle version)</button>}
        </PageHead>
        <div className="info">
          Document figé le {fmtDate(doc.createdAt)} : il ne change plus même si le projet évolue.
          {isInvoice && ' Une facture ne se modifie pas : pour la corriger, crée un avoir puis une nouvelle facture.'}
          {siblings.length > 1 && <> Autres versions : {siblings.filter((d) => d.id !== doc.id).map((d) => (
            <Link key={d.id} to={'/documents/' + d.id} style={{ marginRight: 8 }}>{d.number} v{d.version} ({fmtDate(d.createdAt, false)})</Link>
          ))}</>}
        </div>
      </div>
      <div className="doc-wrap" ref={ref}><DocRender doc={doc} /></div>
      <div className="no-print" style={{ marginTop: 12 }}>
        {(!isInvoice || doc.status === 'brouillon') && <button className="danger small" onClick={async () => {
          if (confirm('Supprimer définitivement ce document ?')) { await db.docs.delete(doc.id); nav('/projets/' + doc.projectId); }
        }}>Supprimer ce document</button>}
      </div>
    </>
  );
}
