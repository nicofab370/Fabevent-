/**
 * Email avec pièces jointes depuis une application web :
 * un lien « mailto: » ne peut PAS joindre de fichier. On propose donc :
 * 1. le partage natif (téléphone, tablette, Mac, Windows) qui ouvre l'app Mail avec le fichier joint ;
 * 2. un brouillon .eml (Outlook, Apple Mail, Thunderbird) qui contient déjà destinataire, texte et pièces jointes ;
 * 3. en dernier recours, le téléchargement des fichiers puis « mailto: » pour les glisser dans le message.
 */

export interface Attachment {
  name: string;
  type: string;
  blob: Blob;
}

export interface MailDraft {
  to: string;
  subject: string;
  body: string;
}

const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();

/** En-tête encodé (UTF-8, base64) pour les accents et les tirets typographiques. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8ToBase64(s)}?=`);

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Message MIME prêt à envoyer. « X-Unsent: 1 » fait ouvrir le fichier comme un brouillon
 * (bouton Envoyer) dans Outlook ; Apple Mail et Thunderbird l'ouvrent aussi avec ses pièces jointes.
 */
export async function buildEml(m: MailDraft, attachments: Attachment[]): Promise<string> {
  const boundary = 'fabevent-' + Math.random().toString(36).slice(2);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8ToBase64(m.body.replace(/\r?\n/g, '\r\n'))),
  ];
  for (const a of attachments) {
    const name = encodeHeader(a.name);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.type}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrap76(await blobToBase64(a.blob)),
    );
  }
  parts.push(`--${boundary}--`, '');
  return [
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts,
  ].join('\r\n');
}

export function mailtoUrl(m: MailDraft): string {
  return `mailto:${encodeURIComponent(m.to).replace(/%40/g, '@').replace(/%2C/gi, ',')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
}

/** Le navigateur sait-il partager des fichiers (feuille de partage du système) ? */
export function canShareFiles(attachments: Attachment[]): boolean {
  try {
    const files = attachments.map((a) => new File([a.blob], a.name, { type: a.type }));
    return typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch {
    return false;
  }
}

export async function shareFiles(m: MailDraft, attachments: Attachment[]) {
  const files = attachments.map((a) => new File([a.blob], a.name, { type: a.type }));
  await navigator.share({ files, title: m.subject, text: m.body });
}
