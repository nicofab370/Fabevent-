import { useState } from 'react';
import { Empty, Field, PageHead, useSettings } from '../components/ui';
import { db } from '../db';
import { DEFAULT_TEMPLATES, MAIL_KINDS, MAIL_VARS, newTemplate } from '../mailer';
import type { MailKind, MailTemplate } from '../types';
import { Icon } from '../components/Icon';

/** Modèles de mail par type d'envoi (devis, facture, demande de dispo, confirmation…), avec variables. */
export default function MailTemplates() {
  const settings = useSettings();
  const list = settings.mailTemplates || [];
  const [kind, setKind] = useState<MailKind>('devis');
  const [edit, setEdit] = useState<MailTemplate | null>(null);
  const [saved, setSaved] = useState('');
  const store = async (next: MailTemplate[]) => {
    const s = await db.settings.get('main');
    if (s) await db.settings.put({ ...s, mailTemplates: next });
  };
  const mine = list.filter((t) => t.kind === kind);
  return (
    <>
      <PageHead title="Modèles de mail">{saved && <span className="avail ok">{saved}</span>}</PageHead>
      <div className="info">
        Un modèle par type d'envoi (ou plusieurs : « relance douce », « relance ferme »…). Le premier du type est proposé d'office dans la fenêtre d'envoi.
        On peut aussi écrire un mail puis cliquer « Enregistrer comme modèle » : les noms, dates et montants deviennent des variables.
      </div>
      <div className="tpl-mail">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Types d'envoi</h2>
          <div className="mail-kinds">
            {(Object.keys(MAIL_KINDS) as MailKind[]).map((k) => (
              <button key={k} type="button" className={k === kind ? '' : 'secondary'} onClick={() => { setKind(k); setEdit(null); }}>
                {MAIL_KINDS[k]} {list.some((t) => t.kind === k) && <span className="badge">{list.filter((t) => t.kind === k).length}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{MAIL_KINDS[kind]}</h2>
          {mine.length === 0 ? <Empty>Pas de modèle enregistré : le texte par défaut est utilisé (« {DEFAULT_TEMPLATES[kind].subject} »).</Empty> : (
            <table className="list"><tbody>{mine.map((t, i) => (
              <tr key={t.id}>
                <td><strong>{t.name}</strong>{i === 0 && <span className="badge" style={{ marginLeft: 6 }}>proposé d'office</span>}<div className="muted">{t.subject}</div></td>
                <td className="nowrap">
                  {i > 0 && <button className="ghost small" title="Proposer d'office" onClick={() => store([t, ...list.filter((x) => x.id !== t.id)])}><Icon name="arrow-up" />En premier</button>}
                  <button className="secondary small" onClick={() => setEdit(t)}>Modifier</button>
                  <button className="ghost small" aria-label={`Supprimer ${t.name}`} onClick={() => confirm(`Supprimer le modèle « ${t.name} » ?`) && store(list.filter((x) => x.id !== t.id))}><Icon name="x" /></button>
                </td>
              </tr>
            ))}</tbody></table>
          )}
          <button className="small" style={{ marginTop: 8 }} onClick={() => setEdit(newTemplate(kind, mine.length ? `${MAIL_KINDS[kind]} ${mine.length + 1}` : DEFAULT_TEMPLATES[kind].name, DEFAULT_TEMPLATES[kind].subject, DEFAULT_TEMPLATES[kind].body))}>+ Nouveau modèle</button>
          {edit && (
            <form className="form" style={{ marginTop: 14 }} onSubmit={async (e) => {
              e.preventDefault();
              await store(list.some((x) => x.id === edit.id) ? list.map((x) => (x.id === edit.id ? edit : x)) : [...list, edit]);
              setEdit(null);
              setSaved('Modèle enregistré.'); setTimeout(() => setSaved(''), 2500);
            }}>
              <Field label="Nom du modèle" full><input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Nom du modèle" /></Field>
              <Field label="Objet" full><input required value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} aria-label="Objet du modèle" /></Field>
              <Field label="Message" full><textarea style={{ minHeight: 200 }} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} aria-label="Message du modèle" /></Field>
              <div className="field full"><span>Variables</span>
                <div className="chips">{Object.entries(MAIL_VARS).map(([k, v]) => <button key={k} type="button" className="chip" title={v} onClick={() => setEdit({ ...edit, body: edit.body + `{${k}}` })}>{`{${k}}`}</button>)}</div>
              </div>
              <div className="form-actions"><button type="button" className="secondary" onClick={() => setEdit(null)}>Annuler</button><button type="submit">Enregistrer le modèle</button></div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
