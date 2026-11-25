import { describe, expect, it } from 'vitest';
import { buildDocHtml } from '../../src/components/DocRender';
import { orderedSubprojects, subKey } from '../../src/utils';
import type { Doc, SnapshotSub } from '../../src/types';

const now = '2026-11-20T10:00:00.000Z';
const sub = (subId: string, name: string, eq = 'x'): SnapshotSub => ({
  subId, name, start: '2026-12-10T08:00', end: '2026-12-11T18:00',
  equipment: [{ name: eq, qty: 1, unitPrice: 10, days: 1, factor: 1, discount: 0, total: 10, unit: 'jour' }],
  crew: [], vehicles: [], subtotal: 10,
});

const doc = (subs: SnapshotSub[], subOrder?: string[]): Doc => ({
  id: 'd', createdAt: now, updatedAt: now, projectId: 'p', type: 'devis', number: 'D-2026-001', version: 1, status: 'brouillon',
  subOrder,
  snapshot: {
    company: { name: 'FabEvent SRL' },
    project: { number: 'P-1', name: 'Gala', start: '2026-12-10T08:00', end: '2026-12-11T18:00', discount: 0 },
    subprojects: subs,
    totalHT: 30, discountAmount: 0, vatRate: 21, vat: 6.3, totalTTC: 36.3, issuedAt: now, hidePrices: false,
  },
} as Doc);

const A = sub('s1', 'Salle plénière', 'a');
const B = sub('s2', 'Atelier 1', 'b');
const C = sub('s3', 'Atelier 2', 'c');

describe('ordre des salles (sous-projets) dans un document', () => {
  it('sans subOrder : ordre figé du snapshot', () => {
    expect(orderedSubprojects(doc([A, B, C])).map((s) => s.name)).toEqual(['Salle plénière', 'Atelier 1', 'Atelier 2']);
  });

  it('subOrder réordonne, les salles inconnues restent à la fin dans leur ordre', () => {
    const d = doc([A, B, C], ['s3', 's1']);
    expect(orderedSubprojects(d).map((s) => s.name)).toEqual(['Atelier 2', 'Salle plénière', 'Atelier 1']);
  });

  it('les anciens documents sans subId sont rangés par nom', () => {
    const old = doc([{ ...A, subId: undefined }, { ...B, subId: undefined }], ['Atelier 1', 'Salle plénière']);
    expect(orderedSubprojects(old).map((s) => s.name)).toEqual(['Atelier 1', 'Salle plénière']);
    expect(subKey(A)).toBe('s1');
    expect(subKey({ ...A, subId: undefined })).toBe('Salle plénière');
  });

  it('le rendu HTML suit le même ordre (titres h2 des salles)', () => {
    const html = buildDocHtml(doc([A, B, C], ['s3', 's2', 's1']));
    const h2 = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(h2).toEqual(['Atelier 2', 'Atelier 1', 'Salle plénière']);
    // les lignes suivent leur salle
    expect(html.indexOf('>c<')).toBeLessThan(html.indexOf('>b<'));
    expect(html.indexOf('>b<')).toBeLessThan(html.indexOf('>a<'));
  });
});
