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
  it('accessoires (automatique ou proposé, gratuit ou facturé), fournisseur, conditions du contact', () => {
    expect(one('equipment', 'rm-e-500').accessories).toEqual([{ equipmentId: 'rm-e-504', qty: 1, free: true, optional: undefined }]);
    expect(one('equipment', 'rm-e-501').accessories).toEqual([{ equipmentId: 'rm-e-504', qty: 2, free: false, optional: true }]);
    expect(one('contacts', 'rm-c-12')).toMatchObject({ type: 'fournisseur', paymentDays: 30, language: 'nl' });
  });
  it('projet : type, remise globale et remise sur le matériel (sous-projet Rentman)', () => {
    expect(one('projects', 'rm-p-300')).toMatchObject({ typeName: 'Festival', discount: 5, partDiscounts: { materiel: 15 } });
    expect(data.settings[0]).toMatchObject({ projectTypes: [{ name: 'Festival' }], depots: [{ id: 'rm-d-1', name: 'Entrepôt Herstal' }] });
  });
  it('coûts, sous-location (projet retrouvé par la ligne liée), réparation d’une unité', () => {
    expect(one('costs', 'rm-k-1000')).toMatchObject({ projectId: 'rm-p-300', qty: 2, amount: 180, price: 110, billable: true });
    expect(one('subrentals', 'rm-sr-1100')).toMatchObject({ projectId: 'rm-p-300', supplierId: 'rm-c-12', status: 'confirme', lines: [{ name: 'Line array additionnel', qty: 4, cost: 60 }] });
    expect(one('repairs', 'rm-r-1200')).toMatchObject({ equipmentId: 'rm-e-501', unitId: 'rm-u-901', cost: 140, status: 'ouvert' });
  });
  it('indisponibilités (pas les disponibilités), rendez-vous avec l’équipe', () => {
    expect(data.unavailability).toHaveLength(1);
    expect(data.unavailability[0]).toMatchObject({ personId: 'rm-p-70', reason: 'Vacances', start: '2026-07-01T00:00' });
    expect(one('appointments', 'rm-ap-1400')).toMatchObject({ personIds: ['rm-p-70'], projectId: 'rm-p-300', start: '2026-06-10T10:00' });
  });
  it('devis et factures : numéro, état, montants', () => {
    expect(one('docs', 'rm-dq-1500')).toMatchObject({ type: 'devis', status: 'accepte', number: 'Q-2026-12', snapshot: { totalHT: 1000, vat: 210, totalTTC: 1210, vatRate: 21 } });
    expect(one('docs', 'rm-di-1600')).toMatchObject({ type: 'facture', status: 'envoye', snapshot: { dueDate: '2026-07-25' } });
  });
  it('fichiers : projet, équipe, photo de l’article', () => {
    const { files } = mapRentman(RENTMAN);
    expect(files.map((f: { fileId: number; projectId?: string; personId?: string; photoOf?: string }) => [f.fileId, f.projectId, f.personId, f.photoOf])).toEqual([
      [950, 'rm-p-300', undefined, undefined], [951, undefined, undefined, 'rm-e-504'], [952, '', 'rm-p-70', undefined],
    ]);
  });
  it('rapport : comptes, rien d’inventé', () => {
    expect(report.counts).toMatchObject({ projects: 1, subprojects: 2, lines: 4, crew: 2, costs: 1, docs: 2, files: 2, photos: 1 });
    expect(report.warnings).toEqual([]);
  });
});
