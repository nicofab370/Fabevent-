import { useEffect, useState } from 'react';
import { buildEml, canShareFiles, mailtoUrl, shareFiles, type Attachment, type MailDraft } from '../email';
import { safeFileName } from '../pdf';
import { download } from '../utils';
import { Field, Modal } from './ui';

const size = (b: Blob) => (b.size > 1024 * 1024 ? `${(b.size / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(b.size / 1024))} Ko`);

/**
 * Envoi d'un document par email AVEC ses pièces jointes (PDF, XML Peppol, agenda .ics…).
 * Trois façons, selon l'appareil et la messagerie : partage natif, brouillon .eml, ou fichiers + messagerie.
 */
export function EmailModal({ initial, prepare, onSent, onClose }: {
  initial: MailDraft;
  /** fabrique les pièces jointes (PDF…) à l'ouverture */
  prepare: () => Promise<Attachment[]>;
  /** appelé quand l'email est parti vers la messagerie (ex. statut « Envoyé ») */
  onSent?: () => void;
  onClose: () => void;
}) {
  const [m, setM] = useState(initial);
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    let alive = true;
    prepare().then((a) => alive && setFiles(a)).catch((e) => alive && setError('Impossible de préparer les pièces jointes : ' + (e as Error).message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = !!files;
  const finish = (msg: string) => { setDone(msg); onSent?.(); };

  return (
    <Modal title="Envoyer par email" onClose={onClose} wide>
      <div className="form email-modal">
        <Field label="À" full><input value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} placeholder="adresse@client.be (plusieurs : séparées par des virgules)" /></Field>
        <Field label="Objet" full><input value={m.subject} onChange={(e) => setM({ ...m, subject: e.target.value })} /></Field>
        <Field label="Message" full><textarea style={{ minHeight: 140 }} value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} /></Field>
        <div className="field full">
          <span>Pièces jointes</span>
          {error ? <div className="avail ko">{error}</div> : !files ? <p className="muted" style={{ margin: 0 }}>Préparation du PDF…</p> : (
            <ul className="attachments" style={{ margin: 0, paddingLeft: 18 }}>
              {files.map((f) => (
                <li key={f.name}>📎 <a href="#" onClick={(e) => { e.preventDefault(); download(f.name, f.blob, f.type); }}>{f.name}</a> <span className="muted">({size(f.blob)})</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="send-options">
        {ready && canShareFiles(files!) && (
          <div className="send-option">
            <button disabled={!ready} onClick={async () => {
              try { await shareFiles(m, files!); finish('Partagé.'); } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
            }}>Partager avec les pièces jointes…</button>
            <span className="muted">Ouvre la feuille de partage de l'appareil : choisis Mail, Outlook, Gmail… Le destinataire est à saisir dans l'app.</span>
          </div>
        )}
        <div className="send-option">
          <button className={ready && canShareFiles(files!) ? 'secondary' : ''} disabled={!ready} onClick={async () => {
            const eml = await buildEml(m, files!);
            download(`${safeFileName(m.subject) || 'email'}.eml`, new Blob([eml], { type: 'message/rfc822' }), 'message/rfc822');
            finish('Brouillon téléchargé : ouvre-le, vérifie et clique sur Envoyer.');
          }}>Brouillon prêt à envoyer (.eml)</button>
          <span className="muted">Pour Outlook, Apple Mail ou Thunderbird : ouvre le fichier téléchargé, le message s'affiche avec destinataire, texte et pièces jointes.</span>
        </div>
        <div className="send-option">
          <button className="secondary" disabled={!ready} onClick={() => {
            for (const f of files!) download(f.name, f.blob, f.type);
            location.href = mailtoUrl({ ...m, body: `${m.body}\n\n(Pièces jointes : ${files!.map((f) => f.name).join(', ')})` });
            finish('Fichiers téléchargés : glisse-les dans le message qui vient de s\'ouvrir.');
          }}>Télécharger les fichiers et ouvrir ma messagerie</button>
          <span className="muted">Pour Gmail ou une messagerie web : les fichiers arrivent dans « Téléchargements », il reste à les glisser dans le message.</span>
        </div>
      </div>
      {done && <div className="flash ok" style={{ marginTop: 10 }}>{done}</div>}
      <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
        <button className="secondary" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
