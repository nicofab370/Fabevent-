/**
 * Panneaux de la page d'un document :
 * - devis en ligne : vues du client, historique, demandes de modification, mot de passe, mise hors ligne ;
 * - paiements reçus (factures, acomptes) : partiels ou totaux, avec date et mode ; la facture passe « payée » d'elle-même ;
 * - notes internes (jamais montrées au client).
 */
import { useState } from 'react';
import { db } from '../db';
import { newToken } from '../mailer';
import type { Doc, Payment } from '../types';
import { fmtDate, money, parseNumber, round2, save, uid } from '../utils';
import { Field, useSettings } from './ui';
import { ago } from './Notifications';

const EVENTS: Record<string, string> = {
  cree: 'Créé', publie: 'Publié en ligne', envoye: 'Envoyé', ouvert: 'Ouvert par le client', accepte: 'Accepté par le client', refuse: 'Refusé par le client',
  remarque: 'Demande de modification', hors_ligne: 'Mis hors ligne', en_ligne: 'Remis en ligne', mot_de_passe: 'Mot de passe changé', paiement: 'Paiement enregistré',
};
export const eventLabel = (e: string) => EVENTS[e] || e;

/** Ajoute un événement à l'historique du document. */
export function withEvent(d: Doc, event: string, by?: string): Doc {
  return { ...d, history: [...(d.history || []), { at: new Date().toISOString(), event, by }].slice(-100) };
}

export function OnlineQuotePanel({ doc }: { doc: Doc }) {
  const settings = useSettings();
  if (doc.type !== 'devis' || !doc.publicToken) return null;
  const views = doc.views || [];
  const setPassword = async (on: boolean) => {
    const pw = on ? newToken(8).toLowerCase() : undefined;
    await save(db.docs, withEvent({ ...doc, publicPassword: pw }, 'mot_de_passe'));
  };
  return (
    <div className="card no-print online-quote">
      <h2>Devis en ligne</h2>
      <div className="oq-grid">
        <div><strong>{views.length}</strong> vue{views.length > 1 ? 's' : ''}{views.length ? <span className="muted"> · dernière {ago(views[views.length - 1].at)}</span> : null}</div>
        <div>{doc.publicDisabled ? <span className="avail ko">Hors ligne : le lien ne s'ouvre plus</span> : <span className="avail ok">En ligne</span>}</div>
        <div>Mot de passe : {doc.publicPassword ? <code>{doc.publicPassword}</code> : <span className="muted">aucun</span>}</div>
      </div>
      <div className="toolbar">
        <button className="secondary small" onClick={() => save(db.docs, withEvent({ ...doc, publicDisabled: !doc.publicDisabled }, doc.publicDisabled ? 'en_ligne' : 'hors_ligne'))}>
          {doc.publicDisabled ? 'Remettre en ligne' : 'Mettre le devis hors ligne'}
        </button>
        <button className="secondary small" onClick={() => setPassword(true)}>{doc.publicPassword ? 'Nouveau mot de passe' : 'Exiger un mot de passe'}</button>
        {doc.publicPassword && <button className="secondary small" onClick={() => setPassword(false)}>Retirer le mot de passe</button>}
      </div>
      {settings.quotePassword && !doc.publicPassword && <p className="muted">Les paramètres demandent un mot de passe pour les devis en ligne : clique sur « Exiger un mot de passe ».</p>}
      {(doc.clientRemarks || []).length > 0 && (
        <>
          <h3>Remarques du client</h3>
          <ul className="oq-remarks">{doc.clientRemarks!.map((r) => <li key={r.at}><span className="muted">{fmtDate(r.at)}</span> — {r.text}</li>)}</ul>
        </>
      )}
      {(doc.history || []).length > 0 && (
        <details>
          <summary>Historique du document ({doc.history!.length})</summary>
          <ul className="oq-history">{[...doc.history!].reverse().map((h, i) => <li key={h.at + i}><span className="muted">{fmtDate(h.at)}</span> {eventLabel(h.event)}{h.by && h.by !== 'client' ? ` (${h.by})` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** Reste à payer : total TTC moins les acomptes déduits, moins les paiements reçus. */
export function balanceDue(doc: Doc): number {
  const total = doc.snapshot.totalTTC - (doc.snapshot.deposits || []).reduce((a, x) => a + x.ttc, 0);
  return round2(total - (doc.payments || []).reduce((a, p) => a + p.amount, 0));
}

export function PaymentsPanel({ doc }: { doc: Doc }) {
  const settings = useSettings();
  const methods = settings.paymentMethods?.length ? settings.paymentMethods : ['Virement', 'Carte', 'Espèces', 'Domiciliation'];
  const due = balanceDue(doc);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(methods[0]);
  if (doc.type !== 'facture' && doc.type !== 'acompte') return null;
  const apply = async (payments: Payment[]) => {
    const rest = balanceDue({ ...doc, payments });
    const status = payments.length && rest <= 0.005 ? 'paye' : doc.status === 'paye' ? 'envoye' : doc.status;
    await save(db.docs, withEvent({ ...doc, payments: payments.length ? payments : undefined, status }, 'paiement'));
    if (status === 'paye' && doc.status !== 'paye') {
      const { fireWebhook } = await import('../webhooks');
      void fireWebhook('facture_payee', { number: doc.number, total: doc.snapshot.totalTTC });
    }
  };
  const add = async () => {
    const a = amount.trim() ? parseNumber(amount) : due;
    if (!a) return;
    await apply([...(doc.payments || []), { id: uid(), date, amount: round2(a), method }]);
    setAmount('');
  };
  return (
    <div className="card no-print">
      <h2>Paiements</h2>
      <p>{due > 0.005 ? <>Reste à payer : <strong>{money(due)}</strong>{(doc.payments || []).length ? ' (partiellement payée)' : ''}</> : <span className="avail ok">Payée</span>}</p>
      {(doc.payments || []).length > 0 && (
        <table className="list no-sort"><tbody>
          {doc.payments!.map((p) => (
            <tr key={p.id}>
              <td>{fmtDate(p.date, false)}</td><td>{p.method}</td><td className="num">{money(p.amount)}</td>
              <td><button className="ghost small" aria-label="Supprimer le paiement" onClick={() => apply(doc.payments!.filter((x) => x.id !== p.id))}>Supprimer</button></td>
            </tr>
          ))}
        </tbody></table>
      )}
      {due > 0.005 && (
        <div className="form">
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={`Montant (vide = ${money(due)})`}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={due.toFixed(2)} /></Field>
          <Field label="Mode"><select value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <div className="form-actions"><button className="secondary" onClick={add}>Enregistrer le paiement</button></div>
        </div>
      )}
    </div>
  );
}

export function InternalNotes({ doc }: { doc: Doc }) {
  const [v, setV] = useState(doc.internalNotes || '');
  return (
    <div className="card no-print">
      <h2>Notes internes</h2>
      <textarea aria-label="Notes internes du document" value={v} placeholder="Jamais montrées au client" onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (doc.internalNotes || '') && save(db.docs, { ...doc, internalNotes: v || undefined })} />
    </div>
  );
}
