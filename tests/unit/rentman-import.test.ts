import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS de l'outil d'import (sans types)
import { mapRentman, mapStatus, refId } from '../../tools/rentman-import/map.mjs';
// @ts-expect-error données de test JS
import { RENTMAN } from '../fixtures/rentman.mjs';

const { data, report } = mapRentman(RENTMAN, '2026-01-01T00:00:00.000Z');
const one = (t: string, id: string) => data[t].find((x: { id: string }) => x.id === id);

describe('import Rentman → FabEvent', () => {
  it('références et statuts', () => {
    expect(refId('/contacts/12')).toBe(12);
    expect(refId({ id: 5 })).toBe(5);
    expect(['Option', 'Confirmé', 'Annulé', 'Concept', 'Teruggebracht', 'Aanvraag'].map(mapStatus)).toEqual(['option', 'confirme', 'annule', 'brouillon', 'termine', 'demande']);
  });
  it('contacts : client avec interlocuteur, lieu ; adresse complète', () => {
    expect(one('contacts', 'rm-c-10')).toMatchObject({ type: 'client', company: 'Ville de Liège', address: 'Place du Marché 2', postalCode: '4000', city: 'Liège', country: 'BE', vatNumber: 'BE0207319313' });
    expect(one('contacts', 'rm-c-10').persons[0]).toMatchObject({ id: 'rm-cp-100', name: 'Anne Dupont', role: 'Régie' });
    expect(one('contacts', 'rm-c-11').type).toBe('lieu');
  });
  it('catégories : un seul niveau de sous-catégorie', () => {
    expect(one('categories', 'rm-f-2').parentId).toBe('rm-f-1');
    expect(one('categories', 'rm-f-3').parentId).toBe('rm-f-1'); // Son › Micros › Sans fil → Son › Sans fil
  });
  it('matériel : kit, vente, unités numérotées (quantité = unités)', () => {
    expect(one('equipment', 'rm-e-502')).toMatchObject({ isKit: true, kitItems: [{ equipmentId: 'rm-e-500', qty: 2 }] });
    expect(one('equipment', 'rm-e-503').kind).toBe('vente');
    expect(one('equipment', 'rm-e-501')).toMatchObject({ trackSerials: true, quantity: 2, weight: 20 });
    expect(one('units', 'rm-u-901').status).toBe('hs');
  });
  it('projet : client, lieu, interlocuteur, dates locales, statut des sous-projets', () => {
    expect(one('projects', 'rm-p-300')).toMatchObject({ number: '2026-041', clientId: 'rm-c-10', venueId: 'rm-c-11', venue: 'Salle La Boverie', contactPersonId: 'rm-cp-100', externalRef: 'BC-77', start: '2026-06-21T14:00', end: '2026-06-21T23:30', status: 'confirme' });
    expect(one('subprojects', 'rm-s-310')).toMatchObject({ status: 'confirme', start: '2026-06-21T14:00', prepStart: '2026-06-21T08:00', returnEnd: '2026-06-22T02:00', groups: [{ id: 'rm-g-400', name: 'Son', periodIds: [] }] });
    expect(one('subprojects', 'rm-s-311').status).toBe('annule');
  });
  it('lignes : groupe, remise en %, contenu de kit, option, remarque entrepôt', () => {
    expect(one('lines', 'rm-l-600')).toMatchObject({ subprojectId: 'rm-s-310', groupId: 'rm-g-400', qty: 4, unitPrice: 45, discount: 10, internalRemark: 'Prendre les housses' });
    expect(one('lines', 'rm-l-602')).toMatchObject({ parentLineId: 'rm-l-601', kitPart: true });
    expect(one('lines', 'rm-l-603').optional).toBe(true);
  });
  it('postes : un par place, technicien affecté, tarif ; véhicule du projet', () => {
    const posts = data.crew.filter((c: { function: string }) => c.function === 'Ingé son');
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ personId: 'rm-p-70', rate: 350, billable: true, start: '2026-06-21T12:00' });
    expect(posts[1].personId).toBeUndefined();
    expect(data.vehicleAssignments[0]).toMatchObject({ vehicleId: 'rm-v-80', subprojectId: 'rm-s-310', start: '2026-06-21T07:00' });
  });
  it('rapport : comptes, rien d’inventé', () => {
    expect(report.counts).toMatchObject({ projects: 1, subprojects: 2, lines: 4, crew: 2 });
    expect(report.warnings).toEqual([]);
  });
});
