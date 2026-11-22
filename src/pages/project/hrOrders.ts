import { DOC_CSS } from '../../components/DocRender';
import { crewAmount, crewCostProfile, fmtDate, money, round2 } from '../../utils';
import { printHtml, type ProjectData } from './shared';

export interface HrOrder {
  key: string;
  supplier: string;
  email?: string;
  address?: string;
  lines: { function: string; person: string; start: string; end: string; qty: string; cost: number; final: boolean }[];
  total: number;
}

/** Bons de commande RH : postes tenus par des sous-traitants, regroupés par société (ou par freelance). */
export function hrOrders(d: ProjectData): HrOrder[] {
  const pMap = new Map(d.people.map((p) => [p.id, p]));
  const cMap = new Map(d.contacts.map((c) => [c.id, c]));
  const active = new Set(d.subs.filter((s) => s.status !== 'annule').map((s) => s.id));
  const groups = new Map<string, HrOrder>();
  for (const c of d.projectCrew) {
    const p = c.personId ? pMap.get(c.personId) : undefined;
    if (!p?.external || !active.has(c.subprojectId)) continue;
    const company = p.contactId ? cMap.get(p.contactId) : undefined;
    const key = company?.id || p.id;
    const g = groups.get(key) || {
      key, supplier: company?.company || p.name, email: company?.email || p.email,
      address: company ? [company.address, [company.postalCode, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : undefined,
      lines: [], total: 0,
    };
    const a = crewAmount(c, d.settings, d.project.travelMinutes, crewCostProfile(c, p));
    g.lines.push({ function: c.function, person: p.name, start: c.start, end: c.end, qty: a.unit === 'heure' ? `${a.hours} h${a.overtime ? ` (dont ${a.overtime} h sup.)` : ''}` : `${a.qty} j`, cost: a.cost, final: c.final !== false });
    g.total = round2(g.total + a.cost);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function printHrOrder(d: ProjectData, o: HrOrder) {
  printHtml(`Bon de commande — ${o.supplier}`, hrOrderHtml(d, o), DOC_CSS);
}

/** Bon de commande RH en HTML (impression et PDF joint à l'email). */
export function hrOrderHtml(d: ProjectData, o: HrOrder): string {
  const co = d.settings.company;
  return `<div class="doc">
    <div class="head"><div>${co.logo ? `<img src="${co.logo}">` : ''}<div><strong>${esc(co.name)}</strong></div><div style="white-space:pre-line">${esc(co.address)}</div></div>
    <div class="box"><h1>Bon de commande — prestations</h1><div>Date : ${fmtDate(new Date().toISOString(), false)}</div>
    <div>Projet : ${esc(d.project.number)} ${esc(d.project.name)}</div><div style="margin-top:8px"><strong>${esc(o.supplier)}</strong><div>${esc(o.address)}</div></div></div></div>
    <p>Lieu : ${esc(d.project.venue)}</p>
    <table><thead><tr><th>Fonction</th><th>Technicien</th><th>Horaires</th><th class="n">Quantité</th><th class="n">Montant HT</th></tr></thead>
    <tbody>${o.lines.map((l) => `<tr><td>${esc(l.function)}</td><td>${esc(l.person)}</td><td>${fmtDate(l.start)} → ${fmtDate(l.end)}</td><td class="n">${esc(l.qty)}</td><td class="n">${money(l.cost)}</td></tr>`).join('')}</tbody></table>
    <table class="totals"><tbody><tr class="grand"><td>Total HT</td><td class="n">${money(o.total)}</td></tr></tbody></table>
    <div class="sign"><div>Bon pour accord du prestataire</div></div></div>`;
}

/** Email du bon de commande RH (le PDF est joint par la fenêtre d'envoi). */
export function hrOrderMail(d: ProjectData, o: HrOrder) {
  const body = `Bonjour,\n\nNous confirmons la commande suivante pour « ${d.project.name} »${d.project.venue ? ` (${d.project.venue})` : ''} :\n\n${o.lines.map((l) => `- ${l.function} — ${l.person} : ${fmtDate(l.start)} → ${fmtDate(l.end)} (${l.qty}) : ${money(l.cost)} HT`).join('\n')}\n\nTotal : ${money(o.total)} HT\n\nMerci de nous confirmer.\n${d.settings.company.name}`;
  return { to: o.email || '', subject: `Bon de commande — ${d.project.number} ${d.project.name}`, body };
}
