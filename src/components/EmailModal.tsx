import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db';
import { buildEml, canShareFiles, mailtoUrl, shareFiles, type Attachment, type MailDraft } from '../email';
import { fillVars, mailServer, MAIL_KINDS, newTemplate, sendMail, splitAddrs, templatesFor, toTemplate, type MailServer } from '../mailer';
import { requestLogin } from '../serverAuth';
import { safeFileName } from '../pdf';
import type { MailKind } from '../types';
import { download } from '../utils';
import { Field, Modal, useSettings } from './ui';
import { FileViewer } from './FileViewer';
import { Icon } from './Icon';

const size = (b: Blob) => (b.size > 1024 * 1024 ? `${(b.size / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(b.size / 1024))} Ko`);

/** Une adresse du carnet : contact, interlocuteur, service ou technicien. */
interface BookEntry { email: string; name: string; sub: string }

/** Toutes les adresses connues : clients, lieux, fournisseurs, leurs interlocuteurs et services, techniciens. */
export function useAddressBook(): BookEntry[] {
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const people = useLiveQuery(() => db.people.toArray(), []) || [];
  const out: BookEntry[] = [];
  for (const c of contacts) {
    if (c.email) out.push({ email: c.email, name: c.company, sub: [c.firstName, c.lastName].filter(Boolean).join(' ') || ({ client: 'client', fournisseur: 'fournisseur', lieu: 'lieu' } as Record<string, string>)[c.type] || '' });
    for (const p of c.persons || []) if (p.email) out.push({ email: p.email, name: p.name, sub: [p.role, c.company, (c.departments || []).find((d) => d.id === p.departmentId)?.name].filter(Boolean).join(' · ') });
    for (const d of c.departments || []) if (d.email) out.push({ email: d.email, name: `${c.company} — ${d.name}`, sub: 'service' });
  }
  for (const p of people) if (p.email && !p.pending) out.push({ email: p.email, name: p.name, sub: ['technicien', p.role].filter(Boolean).join(' · ') });
  const seen = new Set<string>();
  return out.filter((e) => { const k = e.email.toLowerCase() + '|' + e.name; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Champ de destinataires : étiquettes, suggestions du carnet d'adresses au fil de la frappe, et carnet complet. */
export function Recipients({ label, value, onChange, book, hints }: { label: string; value: string; onChange: (v: string) => void; book: BookEntry[]; /** adresses liées au contexte (projet…) : proposées en premier, même champ vide */ hints?: string[] }) {
  const list = splitAddrs(value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const qn = norm(q.trim());
  const hintSet = new Set((hints || []).map((e) => e.toLowerCase()));
  // champ vide : on propose déjà les adresses du contexte ; sinon recherche dans tout le carnet, contexte d'abord
  const base = qn.length >= 1 ? book.filter((e) => !list.includes(e.email) && norm(`${e.name} ${e.email} ${e.sub}`).includes(qn)) : book.filter((e) => hintSet.has(e.email.toLowerCase()));
  const hits = [...base.filter((e) => hintSet.has(e.email.toLowerCase())), ...base.filter((e) => !hintSet.has(e.email.toLowerCase()))].slice(0, 8);
  const add = (email: string) => { const e = email.trim().replace(/[,;]+$/, ''); if (e && !list.includes(e)) onChange([...list, e].join(', ')); setQ(''); };
  const nameOf = (email: string) => book.find((e) => e.email.toLowerCase() === email.toLowerCase())?.name;
  return (
    <div className="field full recipients">
      <span>{label}</span>
      <div className="rcpt-box">
        {list.map((e) => (
          <span key={e} className="rcpt" title={e}>{nameOf(e) ? <>{nameOf(e)} <small>{e}</small></> : e}
            <button type="button" aria-label={`Retirer ${e}`} onClick={() => onChange(list.filter((x) => x !== e).join(', '))}><Icon name="x" /></button></span>
        ))}
        <input value={q} aria-label={`${label} : ajouter une adresse`} placeholder={list.length ? '' : 'Nom ou adresse…'} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => { setOpen(false); if (q.includes('@')) add(q); }, 150)}
          onChange={(e) => { const v = e.target.value; if (/[,;]$/.test(v)) add(v); else setQ(v); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (hits[0] && !q.includes('@')) add(hits[0].email); else if (q.trim()) add(q); }
            if (e.key === 'Backspace' && !q && list.length) onChange(list.slice(0, -1).join(', '));
          }} />
        <button type="button" className="ghost small" title="Carnet d'adresses" aria-label={`Carnet d'adresses (${label})`} onClick={() => setPicker(true)}><Icon name="book" /></button>
      </div>
      {open && hits.length > 0 && (
        <div className="rcpt-hits">
          {hits.map((h) => <button key={h.email + h.name} type="button" onMouseDown={(e) => { e.preventDefault(); add(h.email); }}><b>{h.name}</b> <span className="muted">{h.email}{h.sub ? ` · ${h.sub}` : ''}</span></button>)}
        </div>
      )}
      {picker && <AddressBook book={book} selected={list} onClose={(sel) => { setPicker(false); if (sel) onChange(sel.join(', ')); }} />}
    </div>
  );
}

function AddressBook({ book, selected, onClose }: { book: BookEntry[]; selected: string[]; onClose: (sel?: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(selected);
  const [q, setQ] = useState('');
  const qn = norm(q);
  const shown = book.filter((e) => !qn || norm(`${e.name} ${e.email} ${e.sub}`).includes(qn));
  return (
    <Modal title="Carnet d'adresses" onClose={() => onClose()}>
      <input autoFocus type="search" placeholder="Rechercher un nom, une société, une adresse…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="book-list">
        {shown.length === 0 && <p className="muted">Aucune adresse. Ajoute les emails dans Contacts ou Équipe.</p>}
        {shown.map((e) => (
          <label key={e.email + e.name} className="check-row book-row">
            <input type="checkbox" checked={sel.includes(e.email)} onChange={(x) => setSel(x.target.checked ? [...sel, e.email] : sel.filter((y) => y !== e.email))} />
            <span><b>{e.name}</b> <span className="muted">{e.email}</span>{e.sub && <div className="muted" style={{ fontSize: 12 }}>{e.sub}</div>}</span>
          </label>
        ))}
      </div>
      <div className="form-actions"><button type="button" className="secondary" onClick={() => onClose()}>Annuler</button><button type="button" onClick={() => onClose(sel)}>Valider ({sel.length})</button></div>
    </Modal>
  );
}

/**
 * Envoi d'un document par email AVEC ses pièces jointes (PDF, XML Peppol, agenda .ics…).
 * - Directement depuis FabEvent quand le serveur sait envoyer (mail.php) ;
 * - sinon : partage natif, brouillon .eml, ou fichiers + messagerie.
 * Modèles de mail par type (kind), destinataires depuis le carnet d'adresses.
 */
export function EmailModal({ initial, prepare, onSent, onClose, kind, vars, hints }: {
  initial: MailDraft;
  /** fabrique les pièces jointes (PDF…) à l'ouverture */
  prepare: () => Promise<Attachment[]>;
  /** appelé quand l'email est parti (ex. statut « Envoyé ») */
  onSent?: (how: 'direct' | 'autre') => void;
  onClose: () => void;
  /** type d'envoi : propose les modèles de ce type */
  kind?: MailKind;
  /** valeurs des variables des modèles ({prenom}, {projet}…) */
  vars?: Record<string, string | undefined>;
  /** adresses liées au contexte (client, lieu, équipe du projet…) : proposées en premier dans les destinataires */
  hints?: string[];
}) {
  const settings = useSettings();
  const book = useAddressBook();
  const own = kind ? (settings.mailTemplates || []).filter((t) => t.kind === kind) : [];
  const [m, setM] = useState(initial);
  const [cc, setCc] = useState('');
  const [copyMe, setCopyMe] = useState(true);
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<MailServer | null>(null);
  const [tpl, setTpl] = useState('');
  const applied = useRef(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  useEffect(() => {
    let alive = true;
    prepare().then((a) => alive && setFiles(a)).catch((e) => alive && setError('Impossible de préparer les pièces jointes : ' + (e as Error).message));
    mailServer().then((s) => alive && setServer(s));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // un modèle enregistré pour ce type d'envoi remplace le texte proposé
  useEffect(() => {
    if (applied.current || !own.length || !vars) return;
    applied.current = true;
    setTpl(own[0].id);
    setM((x) => ({ ...x, subject: fillVars(own[0].subject, vars), body: fillVars(own[0].body, vars) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.length]);

  const ready = !!files;
  const finish = (msg: string, how: 'direct' | 'autre') => { setDone(msg); onSent?.(how); };
  const me = settings.company.email;
  const choose = (id: string) => {
    setTpl(id);
    if (!id) { setM({ ...m, subject: initial.subject, body: initial.body }); return; }
    const t = kind && templatesFor(settings, kind).concat(own).find((x) => x.id === id);
    if (t) setM({ ...m, subject: fillVars(t.subject, vars || {}), body: fillVars(t.body, vars || {}) });
  };
  const saveTemplate = async () => {
    if (!kind) return;
    const name = prompt(`Nom du modèle (${MAIL_KINDS[kind]}) :`, own.find((t) => t.id === tpl)?.name || MAIL_KINDS[kind])?.trim();
    if (!name) return;
    const s = await db.settings.get('main');
    if (!s) return;
    const list = s.mailTemplates || [];
    const ex = list.find((t) => t.kind === kind && t.name === name);
    const t = { ...(ex || newTemplate(kind, name, '', '')), subject: toTemplate(m.subject, vars || {}), body: toTemplate(m.body, vars || {}) };
    await db.settings.put({ ...s, mailTemplates: ex ? list.map((x) => (x.id === ex.id ? t : x)) : [...list, t] });
    setTpl(t.id);
    setDone(`Modèle « ${name} » enregistré : il sera proposé pour chaque ${MAIL_KINDS[kind].toLowerCase()}.`);
  };
  const choices = kind ? [...own, ...(own.length ? [] : templatesFor(settings, kind))] : [];

  return (
    <Modal title="Envoyer par email" onClose={onClose} wide>
      <div className="form email-modal">
        {kind && (
          <div className="field full mail-tpl">
            <span>Modèle</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <select aria-label="Modèle de mail" value={tpl} onChange={(e) => choose(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                <option value="">Texte proposé</option>
                {choices.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id.startsWith('default-') ? ' (par défaut)' : ''}</option>)}
              </select>
              <button type="button" className="secondary small" onClick={saveTemplate} title="Enregistre l'objet et le texte actuels comme modèle (les noms, dates, montants deviennent des variables)">Enregistrer comme modèle</button>
              <Link to="/modeles?onglet=mails" onClick={onClose} className="small" style={{ alignSelf: 'center' }}>Gérer les modèles</Link>
            </div>
          </div>
        )}
        <Recipients label="À" value={m.to} onChange={(to) => setM({ ...m, to })} book={book} hints={hints} />
        <Recipients label="Cc" value={cc} onChange={setCc} book={book} hints={hints} />
        <Field label="Objet" full><input value={m.subject} onChange={(e) => setM({ ...m, subject: e.target.value })} /></Field>
        <Field label="Message" full><textarea style={{ minHeight: 160 }} value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} /></Field>
        <div className="field full">
          <span>Pièces jointes</span>
          {error ? <div className="avail ko">{error}</div> : !files ? <p className="muted" style={{ margin: 0 }}>Préparation des pièces jointes…</p> : files.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucune.</p> : (
            <ul className="attachments" style={{ margin: 0, paddingLeft: 18 }}>
              {files.map((f) => (
                <li key={f.name}><Icon name="clip" /> <a href="#" onClick={(e) => { e.preventDefault(); setViewing(f); }}>{f.name}</a> <span className="muted">({size(f.blob)})</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {server?.ok && (
        <div className="send-direct">
          <button disabled={!ready || busy || !splitAddrs(m.to).length} onClick={async () => {
            setBusy(true); setError('');
            try {
              const r = await sendMail({ ...m, cc, bcc: copyMe && me ? me : '', replyTo: me }, files!);
              finish(`Envoyé à ${r.to.join(', ')}${cc ? ` (copie : ${cc})` : ''}`, 'direct');
            } catch (e) { setError('Envoi impossible : ' + (e as Error).message); } finally { setBusy(false); }
          }}>{busy ? 'Envoi…' : <><Icon name="send" />{`Envoyer${files?.length ? ` avec ${files.length} pièce(s) jointe(s)` : ''}`}</>}</button>
          {me && <label className="check-row"><input type="checkbox" checked={copyMe} onChange={(e) => setCopyMe(e.target.checked)} /> Copie cachée à moi ({me}) — les réponses arrivent à cette adresse</label>}
        </div>
      )}
      {server && !server.ok && <p className="muted send-why">Envoi direct indisponible : {server.error}{' '}
        {server.login ? <><button type="button" className="small secondary" onClick={requestLogin}>Se reconnecter</button> (rien n'est perdu), ou utilise l'une des façons ci-dessous.</> : 'Utilise l\'une des façons ci-dessous.'}</p>}

      <details className="send-others" open={!!server && !server.ok}>
        <summary>{server?.ok ? 'Autres façons d\'envoyer (ma messagerie)' : 'Envoyer avec ma messagerie'}</summary>
        <div className="send-options">
          {ready && canShareFiles(files!) && (
            <div className="send-option">
              <button className="secondary" disabled={!ready} onClick={async () => {
                try { await shareFiles(m, files!); finish('Partagé.', 'autre'); } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
              }}>Partager avec les pièces jointes…</button>
              <span className="muted">Ouvre la feuille de partage de l'appareil : choisis Mail, Outlook, Gmail… Le destinataire est à saisir dans l'app.</span>
            </div>
          )}
          <div className="send-option">
            <button className="secondary" disabled={!ready} onClick={async () => {
              const eml = await buildEml({ ...m, to: [m.to, cc].filter(Boolean).join(', ') }, files!);
              download(`${safeFileName(m.subject) || 'email'}.eml`, new Blob([eml], { type: 'message/rfc822' }), 'message/rfc822');
              finish('Brouillon téléchargé : ouvre-le, vérifie et clique sur Envoyer.', 'autre');
            }}>Brouillon prêt à envoyer (.eml)</button>
            <span className="muted">Pour Outlook, Apple Mail ou Thunderbird : ouvre le fichier téléchargé, le message s'affiche avec destinataire, texte et pièces jointes.</span>
          </div>
          <div className="send-option">
            <button className="secondary" disabled={!ready} onClick={() => {
              for (const f of files!) download(f.name, f.blob, f.type);
              location.href = mailtoUrl({ ...m, to: [m.to, cc].filter(Boolean).join(', '), body: files!.length ? `${m.body}\n\n(Pièces jointes : ${files!.map((f) => f.name).join(', ')})` : m.body });
              finish('Fichiers téléchargés : glisse-les dans le message qui vient de s\'ouvrir.', 'autre');
            }}>Télécharger les fichiers et ouvrir ma messagerie</button>
            <span className="muted">Pour Gmail ou une messagerie web : les fichiers arrivent dans « Téléchargements », il reste à les glisser dans le message.</span>
          </div>
        </div>
      </details>
      {error && <div className="flash ko" style={{ marginTop: 10 }}>{error}</div>}
      {done && <div className="flash ok" style={{ marginTop: 10 }}>{done}</div>}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
      <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
        <button className="secondary" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
