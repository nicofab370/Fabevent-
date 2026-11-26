import { describe, expect, it } from 'vitest';
import { applyPlace, applyVat, fillFromSimilar, parseViesAddress, placeFromNominatim, similarEquipment, specSearchUrl, splitVat } from '../../src/lookup';
import type { Equipment } from '../../src/types';

describe('remplissage automatique : n° de TVA (VIES)', () => {
  it('lit les n° de TVA tels qu’on les tape', () => {
    expect(splitVat('BE 0417.497.106')).toEqual({ country: 'BE', number: '0417497106' });
    expect(splitVat('417497106')).toEqual({ country: 'BE', number: '0417497106' });
    expect(splitVat('fr40303265045')).toEqual({ country: 'FR', number: '40303265045' });
    expect(splitVat('GR094014201')).toEqual({ country: 'EL', number: '094014201' });
    expect(splitVat('abc')).toBeNull();
  });
  it('découpe l’adresse renvoyée par le registre', () => {
    expect(parseViesAddress('Rue de la Loi 16\n1000 Bruxelles')).toEqual({ address: 'Rue de la Loi 16', postalCode: '1000', city: 'Bruxelles' });
    expect(parseViesAddress('QUAI DE ROME 25\n4000 LIEGE')).toEqual({ address: 'QUAI DE ROME 25', postalCode: '4000', city: 'Liege' });
    expect(parseViesAddress('Grand-Rue 1, L-1660 Luxembourg')).toEqual({ address: 'Grand-Rue 1', postalCode: '1660', city: 'Luxembourg' });
  });
  it('remplit la fiche : nom gardé s’il est saisi, adresse officielle, Peppol belge', () => {
    const v = { valid: true, name: 'Fabri SRL', address: 'Rue X 1', postalCode: '4000', city: 'Liège', country: 'BE', vatNumber: 'BE0123456789' };
    expect(applyVat({ company: '' }, v)).toMatchObject({ company: 'Fabri SRL', address: 'Rue X 1', postalCode: '4000', city: 'Liège', country: 'BE', vatNumber: 'BE0123456789', peppolId: '0208:0123456789' });
    expect(applyVat({ company: 'Fabri', peppolId: '9925:BE0123456789' }, v)).toMatchObject({ company: 'Fabri', peppolId: '9925:BE0123456789' });
  });
});

describe('remplissage automatique : carte (OpenStreetMap)', () => {
  const hit = { display_name: 'La Boverie, Parc de la Boverie 3, 4020 Liège, Belgique', name: 'La Boverie',
    address: { road: 'Parc de la Boverie', house_number: '3', postcode: '4020', city: 'Liège', country_code: 'be' }, extratags: { phone: '+32 4 238 55 01' } };
  it('reprend adresse, code postal, ville, pays et téléphone', () => {
    expect(placeFromNominatim(hit)).toMatchObject({ name: 'La Boverie', address: 'Parc de la Boverie 3', postalCode: '4020', city: 'Liège', country: 'BE', phone: '+32 4 238 55 01' });
    expect(placeFromNominatim({ display_name: 'x', address: { town: 'Namur', postcode: '5000' } })).toMatchObject({ city: 'Namur', postalCode: '5000', address: undefined });
  });
  it('ne remplace ni le nom ni le téléphone déjà saisis', () => {
    expect(applyPlace({ company: 'Boverie', phone: '0470' }, placeFromNominatim(hit))).toMatchObject({ company: 'Boverie', phone: '0470', city: 'Liège' });
  });
});

describe('remplissage automatique : équipement', () => {
  const t = '2026-01-01T00:00:00.000Z';
  const eq = (id: string, x: Partial<Equipment>): Equipment => ({ id, createdAt: t, updatedAt: t, name: id, quantity: 1, dailyPrice: 0, isKit: false, kitItems: [], ...x });
  const all = [
    eq('a', { brand: 'L-Acoustics', model: 'X12', weight: 20, replacementValue: 3200, summary: 'Enceinte coaxiale', inspectionMonths: 12 }),
    eq('b', { brand: 'L-Acoustics', model: 'X12', weight: 20 }),
    eq('c', { brand: 'Shure', model: 'SM58', weight: 0.3 }),
  ];
  it('trouve l’article de même marque et modèle le plus complet', () => {
    expect(similarEquipment({ brand: 'l-acoustics', model: 'x 12' }, all).map((x) => x.id)).toEqual(['a', 'b']);
    expect(similarEquipment({ brand: 'd&b', model: 'X12' }, all)).toEqual([]);
    // ancien article : marque et modèle seulement dans la désignation
    const old = eq('d', { name: 'Enceinte L-Acoustics X12', weight: 20 });
    expect(similarEquipment({ brand: 'L-Acoustics', model: 'X12' }, [old]).map((x) => x.id)).toEqual(['d']);
    expect(similarEquipment({ brand: 'L-Acoustics', model: 'X1' }, [old])).toEqual([]);
  });
  it('ne remplit que les champs vides', () => {
    const r = fillFromSimilar({ name: 'X12 bis', brand: 'L-Acoustics', model: 'X12', weight: 21 }, all[0]);
    expect(r.value).toMatchObject({ weight: 21, replacementValue: 3200, summary: 'Enceinte coaxiale', inspectionMonths: 12 });
    expect(r.filled).toEqual(['summary', 'replacementValue', 'inspectionMonths']);
  });
  it('recherche de la fiche technique', () => {
    expect(specSearchUrl({ brand: 'Shure', model: 'SM58' })).toContain(encodeURIComponent('Shure SM58 poids'));
  });
});
