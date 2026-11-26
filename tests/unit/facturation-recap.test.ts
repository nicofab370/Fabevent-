import { describe, expect, it } from 'vitest';
import { billingRecap, invoicedTotal } from '../../src/invoicing';
import type { Contact, Doc, Project } from '../../src/types';

const now = '2026-11-25T10:00:00.000Z';
const TODAY = '2026-11-25';

const project = (over: Partial<Project>): Project => ({
  id: 'p1', createdAt: now, updatedAt: now, number: 'P-2026-001', name: 'Gala', status: 'confirme',
  start: '2026-11-20T08:00', end: '2026-11-21T18:00', discount: 0, ...over,
} as Project);

const doc = (projectId: string, type: Doc['type'], totalHT: number, number = 'F-2026-001', deposits?: { number: string; ttc: number }[]): Doc => ({
  id: 'd-' + number, createdAt: now, updatedAt: now, projectId, type, number, version: 1, status: 'envoye',
  snapshot: { company: { name: 'x' }, project: { number: 'P', name: 'x' }, subprojects: [], totalHT, discountAmount: 0, vatRate: 21, vat: 0, totalTTC: totalHT, issuedAt: now, hidePrices: false, deposits },
} as unknown as Doc);

const client: Contact = { id: 'c1', createdAt: now, updatedAt: now, type: 'client', company: 'Client SA' } as Contact;

describe('récap de facturation par projet (billingRecap)', () => {
  it('reste = total − facturé, drapeau « évènement passé » si fin < aujourd’hui', () => {
    const p = project({ id: 'past', status: 'confirme', end: '2026-11-20T18:00', clientId: 'c1' });
    const rows = billingRecap([p], [doc('past', 'devis', 0)], new Map([['past', 1000]]), [client], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(1000);
    expect(rows[0].invoiced).toBe(0);
    expect(rows[0].reste).toBe(1000);
    expect(rows[0].past).toBe(true);
    expect(rows[0].client?.company).toBe('Client SA');
  });

  it('facture + acompte déduit (deposit) : on ne compte pas deux fois', () => {
    const docs = [doc('p1', 'acompte', 300, 'F-2026-000'), doc('p1', 'facture', 1000, 'F-2026-001', [{ number: 'F-2026-000', ttc: 363 }])];
    // l’acompte est repris (deposit) dans la facture finale → non décompté
    expect(invoicedTotal([docs[0]])).toBe(300);
    expect(invoicedTotal(docs)).toBe(1000);
    const rows = billingRecap([project({})], docs, new Map([['p1', 1000]]), [], TODAY);
    expect(rows[0].reste).toBe(0);
    expect(rows[0].past).toBe(true); // fin 21/11 < 25/11
  });

  it('avoir déduit du facturé ; projet annulé jamais « passé » ; projet offert listé à 0', () => {
    const pA = project({ id: 'a', end: '2026-11-20T18:00' });
    const pB = project({ id: 'b', status: 'annule', end: '2026-11-20T18:00' });
    const pC = project({ id: 'c', free: true, end: '2027-01-10T18:00' });
    const docs = [doc('a', 'facture', 800), doc('a', 'avoir', -200)];
    const rows = billingRecap([pA, pB, pC], docs, new Map([['a', 1000], ['b', 500], ['c', 0]]), [], TODAY);
    const a = rows.find((r) => r.project.id === 'a')!;
    expect(a.invoiced).toBe(600);
    expect(a.reste).toBe(400);
    expect(rows.find((r) => r.project.id === 'b')!.past).toBe(false);
    const c = rows.find((r) => r.project.id === 'c')!;
    expect(c.free).toBe(true);
    expect(c.total).toBe(0);
  });

  it('tri : évènement passé avec reste d’abord, puis reste partiel, puis le reste', () => {
    const pPast = project({ id: 'past', end: '2026-11-01T18:00' });
    const pPart = project({ id: 'part', end: '2026-12-10T18:00' });
    const pDone = project({ id: 'done', end: '2026-11-02T18:00' });
    const rows = billingRecap([pDone, pPart, pPast],
      [doc('part', 'acompte', 100), doc('done', 'facture', 500)],
      new Map([['past', 700], ['part', 400], ['done', 500]]), [], TODAY);
    expect(rows.map((r) => r.project.id)).toEqual(['past', 'part', 'done']);
  });
});
