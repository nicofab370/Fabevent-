/**
 * Réglages ajoutés (d'après Rentman), dans le formulaire des Paramètres :
 * notifications, devis en ligne, jours importants, grilles de coefficients, comptes comptables, modes de paiement,
 * conditions supplémentaires, séries de numéros, formules d'appel, mails, rôles personnalisés, webhooks.
 * Chaque bloc est repliable ; tout est enregistré avec le bouton « Enregistrer » des Paramètres.
 */
import type { ReactNode } from 'react';
import { Field, NumInput } from '../components/ui';
import { Icon } from '../components/Icon';
import type { CustomRole, ImportantDay, Ledger, NotifKind, NumberSeries, Permission, Settings, WebhookEvent } from '../types';
import { NOTIF_LABELS, PERMISSION_LABELS, ROLE_LABELS, WEBHOOK_LABELS } from '../types';
import { uid } from '../utils';
import { DEFAULT_SALUTATIONS } from './Contacts';

type Props = { s: Settings; setS: (s: Settings) => void };

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  const open = new URLSearchParams(window.location.hash.split('?')[1] || '').get('onglet') === id;
  return (
    <details className="set-section" id={'set-' + id} open={open}>
      <summary><h2>{title}</h2></summary>
      {hint && <p className="muted" style={{ marginTop: 0 }}>{hint}</p>}
      {children}
    </details>
  );
}

/** Liste éditable d'éléments (ajouter, modifier, retirer). */
function ListEditor<T>({ items, onChange, render, make, addLabel }: { items: T[]; onChange: (x: T[]) => void; render: (x: T, upd: (p: Partial<T>) => void) => ReactNode; make: () => T; addLabel: string }) {
  return (
    <>
      {items.map((x, i) => (
        <div key={i} className="set-row">
          {render(x, (p) => onChange(items.map((y, j) => (j === i ? { ...y, ...p } : y))))}
          <button type="button" className="ghost" aria-label="Retirer" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="x" /></button>
        </div>
      ))}
      <button type="button" className="secondary small" onClick={() => onChange([...items, make()])}><Icon name="plus" />{addLabel}</button>
    </>
  );
}

const PAGES: [string, string][] = [
  ['/projets', 'Projets'], ['/planning', 'Planning'], ['/materiel', 'Matériel'], ['/entrepot', 'Entrepôt'], ['/penuries', 'Pénuries'], ['/souslocations', 'Sous-locations'],
  ['/transferts', 'Transferts'], ['/maintenance', 'Maintenance'], ['/contacts', 'Contacts'], ['/lieux', 'Lieux'], ['/equipe', 'Équipe'], ['/attribution', 'Attribution'],
  ['/vehicules', 'Véhicules'], ['/comptabilite', 'Export comptable'], ['/rapports', 'Rapports'], ['/taches', 'Tâches'], ['/bons-de-commande', 'Bons de commande'],
  ['/emails', 'Emails envoyés'], ['/checklists', 'Checklists'], ['/inventaire', 'Inventaire'], ['/etiquettes', 'Étiquettes'], ['/parametres', 'Paramètres'],
];

export function MoreSettings({ s, setS }: Props) {
  const off = new Set(s.notifOff || []);
  return (
    <div className="more-settings">
      <Section id="notifications" title="Notifications" hint="La cloche signale ces événements ; si une adresse est indiquée, ils partent aussi par email (serveur FabEvent).">
        <div className="chips">
          {(Object.keys(NOTIF_LABELS) as NotifKind[]).map((k) => (
            <label key={k} className="check-row"><input type="checkbox" checked={!off.has(k)} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(k); else n.add(k); setS({ ...s, notifOff: n.size ? [...n] : undefined }); }} /> {NOTIF_LABELS[k]}</label>
          ))}
        </div>
        <div className="form"><Field label="Envoyer aussi par email à"><input type="email" value={s.notifEmail || ''} onChange={(e) => setS({ ...s, notifEmail: e.target.value || undefined })} placeholder="vide = dans l'application seulement" /></Field></div>
      </Section>

      <Section id="devis" title="Devis en ligne" hint="Page publique du devis : le client l'ouvre, l'accepte, la refuse ou demande une modification.">
        <div className="form">
          <Field label=" "><label className="check-row"><input type="checkbox" checked={!!s.quotePassword} onChange={(e) => setS({ ...s, quotePassword: e.target.checked || undefined })} /> Exiger un mot de passe (créé avec le lien)</label></Field>
          <Field label=" "><label className="check-row"><input type="checkbox" checked={!!s.quoteAllowExpired} onChange={(e) => setS({ ...s, quoteAllowExpired: e.target.checked || undefined })} /> Le client peut accepter un devis expiré</label></Field>
          <Field label="Texte d'accueil de la page ({client} {projet} {numero} {societe})" full><textarea value={s.quoteWelcome || ''} onChange={(e) => setS({ ...s, quoteWelcome: e.target.value || undefined })} placeholder="Bonjour {client}, voici notre proposition pour {projet}." /></Field>
        </div>
      </Section>

      <Section id="jours" title="Jours importants" hint="Fériés, salons, fermetures : signalés dans le planning et les créneaux des projets. Rien n'est bloqué.">
        <ListEditor<ImportantDay> items={s.importantDays || []} onChange={(importantDays) => setS({ ...s, importantDays: importantDays.length ? importantDays : undefined })} addLabel="Jour important"
          make={() => ({ id: uid(), date: new Date().toISOString().slice(0, 10), name: '' })}
          render={(d, upd) => (<>
            <input type="date" value={d.date} onChange={(e) => upd({ date: e.target.value })} aria-label="Date" />
            <input value={d.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Nom (Fête nationale, Salon…)" aria-label="Nom du jour" />
            <label className="check-row"><input type="checkbox" checked={!!d.yearly} onChange={(e) => upd({ yearly: e.target.checked || undefined })} /> chaque année</label>
          </>)} />
      </Section>

      <Section id="coefficients" title="Grilles de coefficients" hint="En plus de la grille par défaut (Tarification) : une grille par type de matériel (Rigging, Audio…), choisie sur la fiche de l'article.">
        <ListEditor items={s.factorGroups || []} onChange={(factorGroups) => setS({ ...s, factorGroups: factorGroups.length ? factorGroups : undefined })} addLabel="Grille"
          make={() => ({ id: uid(), name: 'Nouvelle grille', factors: [...s.factors], extraPerDay: s.factorExtraPerDay })}
          render={(g, upd) => (<>
            <input value={g.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Nom de la grille" style={{ maxWidth: 160 }} />
            <input value={g.factors.join(' ; ')} aria-label="Coefficients (1 j ; 2 j ; …)" onChange={(e) => upd({ factors: e.target.value.split(';').map((x) => parseFloat(x.replace(',', '.'))).filter((x) => !isNaN(x)) })} />
            <label className="check-row">+ / jour <NumInput className="w-qty" step="any" value={g.extraPerDay} onChange={(n) => upd({ extraPerDay: n })} /></label>
          </>)} />
      </Section>

      <Section id="comptes" title="Comptes comptables" hint="Code du grand livre de chaque ligne de facture, repris dans le journal des ventes (CSV). Choisi sur l'article, sa catégorie, sinon le compte par défaut de la partie.">
        <ListEditor<Ledger> items={s.ledgers || []} onChange={(ledgers) => setS({ ...s, ledgers: ledgers.length ? ledgers : undefined })} addLabel="Compte"
          make={() => ({ id: uid(), name: '', code: '', side: 'credit' })}
          render={(l, upd) => (<>
            <input value={l.code} onChange={(e) => upd({ code: e.target.value })} placeholder="700100" aria-label="Code" style={{ maxWidth: 110 }} />
            <input value={l.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Location audio" aria-label="Nom du compte" />
            <select value={l.side} onChange={(e) => upd({ side: e.target.value as Ledger['side'] })} aria-label="Crédit ou débit" style={{ width: 'auto' }}>
              <option value="credit">Ventes (crédit)</option><option value="debit">Achats (débit)</option>
            </select>
          </>)} />
        {(s.ledgers || []).length > 0 && (
          <div className="form" style={{ marginTop: 8 }}>
            {(['location', 'vente', 'personnel', 'transport', 'frais', 'assurance'] as const).map((k) => (
              <Field key={k} label={`Compte par défaut : ${k}`}>
                <select value={s.ledgerDefaults?.[k] || ''} onChange={(e) => setS({ ...s, ledgerDefaults: { ...s.ledgerDefaults, [k]: e.target.value || undefined } })}>
                  <option value="">—</option>
                  {(s.ledgers || []).filter((l) => l.side === 'credit').map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}
                </select>
              </Field>
            ))}
          </div>
        )}
      </Section>

      <Section id="paiements" title="Modes de paiement" hint="Proposés quand tu enregistres un paiement sur une facture.">
        <div className="form"><Field label="Modes (séparés par des virgules)" full>
          <input value={(s.paymentMethods || ['Virement', 'Carte', 'Espèces', 'Domiciliation']).join(', ')} onChange={(e) => setS({ ...s, paymentMethods: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Field></div>
      </Section>

      <Section id="conditions" title="Conditions supplémentaires" hint="Textes nommés ajoutés aux devis : choisis par type de projet (Types de projet) ou sur le projet (onglet Finances).">
        <ListEditor items={s.extraTerms || []} onChange={(extraTerms) => setS({ ...s, extraTerms: extraTerms.length ? extraTerms : undefined })} addLabel="Conditions"
          make={() => ({ id: uid(), name: 'Conditions', text: '' })}
          render={(t, upd) => (<div style={{ display: 'grid', gap: 4, flex: 1 }}>
            <input value={t.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Nom des conditions" />
            <textarea value={t.text} onChange={(e) => upd({ text: e.target.value })} aria-label="Texte des conditions" />
          </div>)} />
        {(s.extraTerms || []).length > 0 && (
          <div className="form" style={{ marginTop: 8 }}>
            {(s.projectTypes || []).map((pt, i, all) => (
              <Field key={pt.name + i} label={`Type « ${pt.name} »`}>
                <select value={pt.termsId || ''} onChange={(e) => setS({ ...s, projectTypes: all.map((x, j) => (j === i ? { ...x, termsId: e.target.value || undefined } : x)) })}>
                  <option value="">Aucune condition supplémentaire</option>
                  {s.extraTerms!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            ))}
          </div>
        )}
      </Section>

      <Section id="series" title="Séries de numéros" hint="Préfixe et compteur propres (ex. « EV-2026- » pour l'événementiel), choisis par type de projet. Sans série : la numérotation habituelle.">
        <ListEditor<NumberSeries> items={s.numberSeries || []} onChange={(numberSeries) => setS({ ...s, numberSeries: numberSeries.length ? numberSeries : undefined })} addLabel="Série"
          make={() => ({ id: uid(), name: 'Nouvelle série', prefix: 'S-', next: 1, types: ['devis', 'facture'] })}
          render={(sr, upd) => (<>
            <input value={sr.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Nom de la série" style={{ maxWidth: 150 }} />
            <input value={sr.prefix} onChange={(e) => upd({ prefix: e.target.value })} aria-label="Préfixe" style={{ maxWidth: 110 }} />
            <label className="check-row">prochain n° <NumInput className="w-qty" step="1" min={1} value={sr.next} onChange={(n) => upd({ next: Math.max(1, Math.round(n)) })} /></label>
            {(['devis', 'facture', 'contrat', 'bon_commande'] as const).map((t) => (
              <label key={t} className="check-row"><input type="checkbox" checked={sr.types.includes(t)} onChange={(e) => upd({ types: e.target.checked ? [...sr.types, t] : sr.types.filter((x) => x !== t) })} /> {t.replace('_', ' de ')}</label>
            ))}
          </>)} />
        {(s.numberSeries || []).length > 0 && (
          <div className="form" style={{ marginTop: 8 }}>
            {(s.projectTypes || []).map((pt, i, all) => (
              <Field key={pt.name + i} label={`Type « ${pt.name} »`}>
                <select value={pt.seriesId || ''} onChange={(e) => setS({ ...s, projectTypes: all.map((x, j) => (j === i ? { ...x, seriesId: e.target.value || undefined } : x)) })}>
                  <option value="">Numérotation habituelle</option>
                  {s.numberSeries!.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.prefix}…)</option>)}
                </select>
              </Field>
            ))}
          </div>
        )}
      </Section>

      <Section id="formules" title="Formules d'appel" hint="Proposées sur les personnes de contact, et utilisables dans les mails avec {formule}.">
        <div className="form"><Field label="Formules (séparées par des virgules)" full>
          <input value={(s.salutations || DEFAULT_SALUTATIONS).join(', ')} onChange={(e) => setS({ ...s, salutations: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Field></div>
      </Section>

      <Section id="mails" title="Mails" hint="Copies cachées automatiques, signature commune ajoutée à chaque mail, facture électronique jointe.">
        <div className="form">
          <Field label="Copie cachée de tous les mails"><input value={s.mailBcc?.all || ''} onChange={(e) => setS({ ...s, mailBcc: { ...s.mailBcc, all: e.target.value || undefined } })} /></Field>
          <Field label="Copie cachée des factures et rappels"><input value={s.mailBcc?.invoices || ''} onChange={(e) => setS({ ...s, mailBcc: { ...s.mailBcc, invoices: e.target.value || undefined } })} placeholder="comptable@…" /></Field>
          <Field label="Copie cachée des devis"><input value={s.mailBcc?.quotes || ''} onChange={(e) => setS({ ...s, mailBcc: { ...s.mailBcc, quotes: e.target.value || undefined } })} /></Field>
          <Field label="Copie cachée des invitations de l'équipe"><input value={s.mailBcc?.crew || ''} onChange={(e) => setS({ ...s, mailBcc: { ...s.mailBcc, crew: e.target.value || undefined } })} /></Field>
          <Field label="Signature commune ({societe})" full><textarea value={s.mailSignature || ''} onChange={(e) => setS({ ...s, mailSignature: e.target.value || undefined })} placeholder={'—\n{societe}\n+32 …'} /></Field>
          <Field label=" " full><label className="check-row"><input type="checkbox" checked={s.attachUbl !== false} onChange={(e) => setS({ ...s, attachUbl: e.target.checked ? undefined : false })} /> Joindre la facture électronique (XML UBL / Peppol) aux mails des factures</label></Field>
        </div>
      </Section>

      <Section id="roles" title="Rôles personnalisés" hint="Autant de rôles que tu veux (Bureau, Intermittent…), à partir d'un rôle de base : pages visibles et droits cochés. À choisir sur chaque utilisateur.">
        <ListEditor<CustomRole> items={s.customRoles || []} onChange={(customRoles) => setS({ ...s, customRoles: customRoles.length ? customRoles : undefined })} addLabel="Rôle"
          make={() => ({ id: uid(), name: 'Nouveau rôle', base: 'warehouse', paths: ['/materiel', '/entrepot'], perms: [] })}
          render={(r, upd) => (<div style={{ display: 'grid', gap: 6, flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input value={r.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Nom du rôle" style={{ maxWidth: 200 }} />
              <select value={r.base} onChange={(e) => upd({ base: e.target.value as CustomRole['base'] })} aria-label="Rôle de base" style={{ width: 'auto' }}>
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>Base : {v}</option>)}
              </select>
            </div>
            <div className="chips">{PAGES.map(([p, l]) => <label key={p} className="check-row"><input type="checkbox" checked={r.paths.includes(p)} onChange={(e) => upd({ paths: e.target.checked ? [...r.paths, p] : r.paths.filter((x) => x !== p) })} /> {l}</label>)}</div>
            <div className="chips">{(Object.keys(PERMISSION_LABELS) as Permission[]).map((p) => <label key={p} className="check-row"><input type="checkbox" checked={r.perms.includes(p)} onChange={(e) => upd({ perms: e.target.checked ? [...r.perms, p] : r.perms.filter((x) => x !== p) })} /> {PERMISSION_LABELS[p]}</label>)}</div>
          </div>)} />
      </Section>

      <Section id="integrations" title="Intégrations (webhooks)" hint="À chaque événement coché, FabEvent appelle l'adresse (Zapier, Make, n8n…) avec un petit JSON {event, at, data}.">
        <ListEditor items={s.webhooks || []} onChange={(webhooks) => setS({ ...s, webhooks: webhooks.length ? webhooks : undefined })} addLabel="Webhook"
          make={() => ({ id: uid(), url: '', events: ['projet_confirme'] as WebhookEvent[] })}
          render={(h, upd) => (<div style={{ display: 'grid', gap: 4, flex: 1 }}>
            <input type="url" value={h.url} onChange={(e) => upd({ url: e.target.value })} placeholder="https://hooks.zapier.com/…" aria-label="Adresse du webhook" />
            <div className="chips">{(Object.keys(WEBHOOK_LABELS) as WebhookEvent[]).map((ev) => <label key={ev} className="check-row"><input type="checkbox" checked={h.events.includes(ev)} onChange={(e) => upd({ events: e.target.checked ? [...h.events, ev] : h.events.filter((x) => x !== ev) })} /> {WEBHOOK_LABELS[ev]}</label>)}</div>
          </div>)} />
      </Section>
    </div>
  );
}
