/**
 * Base de démonstration : données fictives pour tester l'application.
 * Elle vit dans sa propre base « demo », séparée des vraies données.
 */
import { db, defaultSettings, TABLES } from './db';
import { createDocument } from './documents';
import type { ContactType, Equipment, ProjectStatus } from './types';
import { nowIso, toLocalInput, uid } from './utils';

export const DEMO_WORKSPACE = 'demo';

const t = nowIso();
const base = () => ({ id: uid(), createdAt: t, updatedAt: t });

/** Date relative à aujourd'hui (jours), à l'heure donnée. */
function at(days: number, hour = 8, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return toLocalInput(d);
}
function dayOnly(days: number): string {
  return at(days).slice(0, 10);
}

export async function seedDemo() {
  await db.transaction('rw', TABLES.map((n) => db.table(n)), async () => {
    for (const n of TABLES) await db.table(n).clear();
  });

  await db.settings.put({
    ...defaultSettings,
    company: {
      name: 'FabEvent Démo SRL',
      address: 'Rue de l\'Exemple 12\n4000 Liège\nBelgique',
      street: 'Rue de l\'Exemple 12', postalCode: '4000', city: 'Liège', country: 'BE',
      email: 'contact@exemple.be', phone: '+32 4 000 00 00',
      vatNumber: 'BE0000000097', siret: '0000.000.097', iban: 'BE00 0000 0000 0000', bic: 'GEBABEBB',
      peppolId: '0208:0000000097',
    },
    vatRate: 21,
    footer: 'Données fictives — base de démonstration FabEvent.',
  });

  /* ---------- Contacts ---------- */
  const contact = async (type: ContactType, company: string, extra: Record<string, unknown> = {}) => {
    const c = { ...base(), type, company, country: 'BE', ...extra };
    await db.contacts.put(c as never);
    return c.id;
  };
  const cNamur = await contact('client', 'Ville de Namur (démo)', { city: 'Namur', postalCode: '5000', address: 'Hôtel de Ville', email: 'evenements@exemple.be', vatNumber: 'BE0000000196', peppolId: '0208:0000000196', persons: [{ name: 'Julie Martin', role: 'Service événements', phone: '+32 81 00 00 01' }, { name: 'Marc Lambert', role: 'Régie technique' }] });
  const cFestival = await contact('client', 'Festival des Lumières ASBL (démo)', { city: 'Liège', postalCode: '4020', email: 'prod@exemple.be', peppolId: '0208:0000000295', persons: [{ name: 'Sophie Renard', role: 'Directrice de production' }] });
  const cHotel = await contact('client', 'Hôtel Le Château (démo)', { city: 'Spa', postalCode: '4900', email: 'seminaires@exemple.be', persons: [{ name: 'Thomas Leclercq', role: 'Responsable séminaires' }] });
  const cAgence = await contact('client', 'Agence EventPro (démo)', { city: 'Bruxelles', postalCode: '1000', email: 'projets@exemple.be', vatNumber: 'BE0000000394', peppolId: '0208:0000000394', persons: [{ name: 'Nadia Benali', role: 'Chef de projet' }] });
  const cEcole = await contact('client', 'Lycée Saint-Jean (démo)', { city: 'Huy', postalCode: '4500' });
  const cDupont = await contact('client', 'Mariage Dupont-Lemaire (démo)', { firstName: 'Claire', lastName: 'Dupont', phone: '+32 470 00 00 00' });
  const cSono = await contact('fournisseur', 'SonoRent — confrère (démo)', { city: 'Verviers', email: 'location@exemple.be' });
  await contact('fournisseur', 'LightPro Location (démo)', { city: 'Namur', email: 'info@exemple.be' });
  await contact('soustraitant', 'Rigging Services (démo)', { city: 'Liège' });
  await contact('lieu', 'Palais des Congrès (démo)', { city: 'Liège', address: 'Esplanade de l\'Europe' });

  /* ---------- Catégories et matériel ---------- */
  const cats: Record<string, string> = {};
  for (const name of ['Son', 'Lumière', 'Vidéo', 'Structure', 'Câblage', 'Énergie', 'Consommables']) {
    const c = { ...base(), name };
    await db.categories.put(c);
    cats[name] = c.id;
  }
  const eq: Record<string, string> = {};
  const item = async (key: string, cat: string, name: string, quantity: number, dailyPrice: number, extra: Partial<Equipment> = {}) => {
    const e: Equipment = { ...base(), name, categoryId: cats[cat], quantity, dailyPrice, isKit: false, kitItems: [], code: key.toUpperCase(), barcode: 'DEMO-' + key.toUpperCase(), ...extra };
    await db.equipment.put(e);
    eq[key] = e.id;
    return e.id;
  };
  // Câblage et énergie (d'abord, pour servir d'accessoires)
  await item('xlr10', 'Câblage', 'Câble XLR 10 m', 80, 2, { weight: 0.6, location: 'Bac C1' });
  await item('xlr5', 'Câblage', 'Câble XLR 5 m', 60, 1.5, { weight: 0.4, location: 'Bac C1' });
  await item('nl4', 'Câblage', 'Câble NL4 15 m', 30, 3, { weight: 1.5, location: 'Bac C2' });
  await item('dmx', 'Câblage', 'Câble DMX 10 m', 50, 2, { weight: 0.5, location: 'Bac C3' });
  await item('pc16', 'Énergie', 'Rallonge 16 A 10 m', 40, 3, { weight: 1.8, location: 'Bac E1', inspectionMonths: 12 });
  await item('p17', 'Énergie', 'Rallonge P17 32 A tétra 25 m', 8, 12, { weight: 9, location: 'Rack E2', inspectionMonths: 12 });
  await item('distro', 'Énergie', 'Armoire de distribution 63 A', 3, 45, { weight: 28, location: 'Rack E3', inspectionMonths: 12, replacementValue: 1800 });
  // Son
  await item('x12', 'Son', 'Enceinte L-Acoustics X12', 8, 45, { weight: 20, replacementValue: 3200, location: 'Rack S1', inspectionMonths: 12, accessories: [{ equipmentId: eq.nl4, qty: 1, free: true }] });
  await item('sub', 'Son', 'Caisson SB18', 4, 60, { weight: 52, replacementValue: 4100, location: 'Rack S2', accessories: [{ equipmentId: eq.nl4, qty: 1, free: true }] });
  await item('ampli', 'Son', 'Amplificateur LA4X', 3, 70, { weight: 13, replacementValue: 5500, location: 'Rack S3', inspectionMonths: 12, trackSerials: true });
  await item('cl5', 'Son', 'Console Yamaha CL5', 1, 250, { weight: 36, replacementValue: 22000, location: 'Flight F1', trackSerials: true, inspectionMonths: 12 });
  await item('qu16', 'Son', 'Console Allen & Heath Qu-16', 2, 80, { weight: 12, replacementValue: 2300, location: 'Flight F2', trackSerials: true });
  await item('sm58', 'Son', 'Micro Shure SM58', 16, 5, { weight: 0.3, location: 'Valise M1', accessories: [{ equipmentId: eq.xlr10, qty: 1, free: true }] });
  await item('hf', 'Son', 'Micro HF Shure ULX-D main', 6, 35, { weight: 1.2, replacementValue: 1400, location: 'Valise M2', trackSerials: true });
  await item('di', 'Son', 'Boîte de direct DI passive', 10, 4, { weight: 0.5, location: 'Valise M1' });
  await item('pied', 'Son', 'Pied de micro perche', 20, 3, { weight: 2.5, location: 'Bac S4' });
  // Lumière
  await item('par', 'Lumière', 'Projecteur PAR LED 18×10 W', 32, 8.5, { weight: 3.2, location: 'Rack L1', inspectionMonths: 12, accessories: [{ equipmentId: eq.dmx, qty: 1, free: true }, { equipmentId: eq.pc16, qty: 1, free: true }] });
  await item('lyre', 'Lumière', 'Lyre wash Robe LEDWash 600', 8, 55, { weight: 15, replacementValue: 4500, location: 'Flight L2', inspectionMonths: 12, trackSerials: true, accessories: [{ equipmentId: eq.dmx, qty: 1, free: true }] });
  await item('spot', 'Lumière', 'Lyre spot Robe Esprite', 4, 95, { weight: 28, replacementValue: 9000, location: 'Flight L3', inspectionMonths: 12, trackSerials: true });
  await item('grandma', 'Lumière', 'Console grandMA3 compact', 1, 220, { weight: 25, replacementValue: 18000, location: 'Flight L4', trackSerials: true });
  await item('fumee', 'Lumière', 'Machine à brouillard', 4, 30, { weight: 8, location: 'Bac L5', inspectionMonths: 12 });
  // Vidéo
  await item('vp', 'Vidéo', 'Vidéoprojecteur 10 000 lm', 2, 180, { weight: 18, replacementValue: 9500, location: 'Flight V1', trackSerials: true });
  await item('ecran', 'Vidéo', 'Écran de projection 4 × 3 m', 3, 60, { weight: 22, location: 'Rack V2' });
  await item('tv', 'Vidéo', 'Écran TV 65″ sur pied', 6, 75, { weight: 30, location: 'Rack V3' });
  // Structure
  await item('truss', 'Structure', 'Truss 3 m triangulaire', 24, 12, { weight: 14, location: 'Zone T' });
  await item('tour', 'Structure', 'Tour de levage 5 m', 4, 40, { weight: 60, location: 'Zone T', inspectionMonths: 12 });
  await item('pratic', 'Structure', 'Praticable 2 × 1 m', 30, 15, { weight: 25, location: 'Zone P' });
  // Consommables
  await item('gaffer', 'Consommables', 'Gaffer noir 50 mm', 40, 12, { kind: 'vente', costPrice: 6.5, location: 'Étagère X1' });
  await item('piles', 'Consommables', 'Piles AA (lot de 24)', 25, 18, { kind: 'vente', costPrice: 9, location: 'Étagère X1' });
  await item('gel', 'Consommables', 'Feuille de gélatine couleur', 60, 7, { kind: 'vente', costPrice: 3.2, location: 'Étagère X2' });
  // Kits
  await item('kitconf', 'Son', 'Pack conférence (2 enceintes + console + 2 micros)', 0, 160, {
    isKit: true, kitItems: [{ equipmentId: eq.x12, qty: 2 }, { equipmentId: eq.qu16, qty: 1 }, { equipmentId: eq.sm58, qty: 2 }, { equipmentId: eq.pied, qty: 2 }],
  });
  await item('kitpar', 'Lumière', 'Pack ambiance 8 PAR LED', 0, 60, { isKit: true, kitItems: [{ equipmentId: eq.par, qty: 8 }] });

  // Unités pour le matériel suivi par numéro de série
  const serials: [string, number, string][] = [['ampli', 3, 'LA4X'], ['cl5', 1, 'CL5'], ['qu16', 2, 'QU16'], ['hf', 6, 'ULXD'], ['lyre', 8, 'LW600'], ['spot', 4, 'ESP'], ['grandma', 1, 'MA3'], ['vp', 2, 'VP10K']];
  for (const [key, n, prefix] of serials) {
    for (let i = 1; i <= n; i++) {
      const serial = `${prefix}-${String(1000 + i)}`;
      await db.units.put({ ...base(), equipmentId: eq[key], serial, barcode: 'SN-' + serial, status: 'ok', lastInspection: dayOnly(-300 - i * 10) });
    }
  }
  // Une lyre en réparation, un contrôle bientôt dû
  const lyreUnit = (await db.units.where({ equipmentId: eq.lyre }).first())!;
  await db.repairs.put({ ...base(), equipmentId: eq.lyre, unitId: lyreUnit.id, qty: 1, start: at(-5), end: at(10), status: 'ouvert', description: 'Ventilateur bruyant, à remplacer', cost: 85, supplierId: undefined });
  await db.repairs.put({ ...base(), equipmentId: eq.sm58, qty: 2, start: at(-40), end: at(-30), status: 'termine', description: 'Grilles enfoncées', cost: 24 });
  await db.inspections.put({ ...base(), equipmentId: eq.distro, date: dayOnly(-350), result: 'ok', by: 'Électricien agréé (démo)' });

  /* ---------- Équipe et véhicules ---------- */
  const person = async (name: string, role: string, dailyRate: number, costRate: number, external = false, phone = '+32 470 00 00 00') => {
    const p = { ...base(), name, role, dailyRate, costRate, external, phone, email: `${name.split(' ')[0].toLowerCase()}@exemple.be` };
    await db.people.put(p);
    return p.id;
  };
  const pLucas = await person('Lucas Dubois (démo)', 'Régisseur son', 380, 0);
  const pEmma = await person('Emma Petit (démo)', 'Éclairagiste', 360, 0);
  const pHugo = await person('Hugo Laurent (démo)', 'Technicien polyvalent', 280, 0);
  const pLea = await person('Léa Moreau (démo)', 'Technicienne vidéo', 340, 230, true);
  const pKarim = await person('Karim Haddad (démo)', 'Rigger', 420, 300, true);
  const pTom = await person('Tom Simon (démo)', 'Roadie / chauffeur', 220, 160, true);
  await db.unavailability.put({ ...base(), personId: pEmma, start: at(12, 0), end: at(16, 23, 59), reason: 'Congés' });

  const vehicle = async (name: string, plate: string, payload: number, dailyPrice: number) => {
    const v = { ...base(), name, plate, payload, dailyPrice, seats: 3 };
    await db.vehicles.put(v);
    return v.id;
  };
  const vCamion = await vehicle('Camion 20 m³ hayon', '1-ABC-000', 1200, 180);
  const vFourgon = await vehicle('Fourgon 12 m³', '1-DEF-000', 900, 110);
  await vehicle('Utilitaire léger', '1-GHI-000', 600, 70);

  /* ---------- Projets ---------- */
  let counter = 0;
  const year = new Date().getFullYear();
  type SubDef = {
    name: string; start: string; end: string; prepStart?: string; returnEnd?: string;
    lines?: [string, number, { optional?: boolean; discount?: number }?][];
    crew?: [string, string | undefined, number, number?][];
    vehicles?: [string, string | undefined][];
  };
  const project = async (name: string, clientId: string, status: ProjectStatus, venue: string, subs: SubDef[], extra: { discount?: number; contactPerson?: string; notes?: string } = {}) => {
    const starts = subs.map((s) => s.start).sort();
    const ends = subs.map((s) => s.end).sort();
    const p = {
      ...base(), number: `P-${year}-${String(++counter).padStart(3, '0')}`, name, clientId, status, venue,
      start: starts[0], end: ends[ends.length - 1], discount: extra.discount || 0, contactPerson: extra.contactPerson, notes: extra.notes,
    };
    await db.projects.put(p);
    let order = 0;
    for (const s of subs) {
      const sp = { ...base(), projectId: p.id, name: s.name, venue, status, start: s.start, end: s.end, prepStart: s.prepStart, returnEnd: s.returnEnd, order: order++ };
      await db.subprojects.put(sp);
      let lo = 0;
      for (const [key, qty, opt] of s.lines || []) {
        const e = (await db.equipment.get(eq[key]))!;
        const lineId = uid();
        await db.lines.put({ ...base(), id: lineId, projectId: p.id, subprojectId: sp.id, equipmentId: e.id, name: e.name, qty, unitPrice: e.dailyPrice, discount: opt?.discount || 0, optional: opt?.optional, order: lo++ });
        for (const a of e.accessories || []) {
          const acc = (await db.equipment.get(a.equipmentId))!;
          await db.lines.put({ ...base(), projectId: p.id, subprojectId: sp.id, equipmentId: acc.id, name: acc.name, qty: a.qty * qty, unitPrice: a.free ? 0 : acc.dailyPrice, discount: 0, order: lo++, parentLineId: lineId, optional: opt?.optional });
        }
      }
      for (const [fn, personId, rate, cost] of s.crew || []) {
        await db.crew.put({ ...base(), projectId: p.id, subprojectId: sp.id, function: fn, personId, start: s.start, end: s.end, rate, cost, billable: true });
      }
      for (const [vehicleId, driverId] of s.vehicles || []) {
        const v = (await db.vehicles.get(vehicleId))!;
        await db.vehicleAssignments.put({ ...base(), projectId: p.id, subprojectId: sp.id, vehicleId, driverId, start: s.prepStart || s.start, end: s.returnEnd || s.end, price: v.dailyPrice, billable: true });
      }
    }
    return p.id;
  };

  // 1. Projet terminé, facturé (avec acompte)
  const pGala = await project('Gala de fin d\'année', cAgence, 'termine', 'Palais des Congrès, Liège', [
    { name: 'Montage', start: at(-20, 8), end: at(-20, 18), lines: [['truss', 12], ['tour', 4]], crew: [['Rigger', pKarim, 420, 300], ['Technicien', pHugo, 280]] },
    { name: 'Soirée', start: at(-19, 14), end: at(-19, 23, 59), prepStart: at(-21, 9), returnEnd: at(-18, 12),
      lines: [['x12', 6], ['sub', 2], ['ampli', 2], ['cl5', 1], ['hf', 4], ['lyre', 6], ['par', 16], ['grandma', 1], ['gaffer', 4], ['piles', 2]],
      crew: [['Régisseur son', pLucas, 380], ['Éclairagiste', pEmma, 360], ['Roadie', pTom, 220, 160]], vehicles: [[vCamion, pTom]] },
  ], { contactPerson: 'Nadia Benali', discount: 5 });

  // 2. Conférence confirmée la semaine prochaine
  await project('Conférence annuelle', cHotel, 'confirme', 'Hôtel Le Château, Spa', [
    { name: 'Journée', start: at(6, 7), end: at(7, 19), prepStart: at(5, 14), returnEnd: at(8, 12),
      lines: [['kitconf', 1], ['hf', 2], ['vp', 1], ['ecran', 1], ['tv', 2], ['kitpar', 1], ['pratic', 6], ['gaffer', 1, { optional: true }]],
      crew: [['Technicien son', pHugo, 280], ['Technicienne vidéo', pLea, 340, 230]], vehicles: [[vFourgon, pHugo]] },
  ], { contactPerson: 'Thomas Leclercq' });

  // 3. Festival en option, gros volume → manque d'enceintes et de lyres
  const pFest = await project('Festival des Lumières', cFestival, 'option', 'Parc de la Boverie, Liège', [
    { name: 'Montage', start: at(14, 8), end: at(14, 20), lines: [['truss', 20], ['tour', 4], ['distro', 2], ['p17', 6]], crew: [['Rigger', pKarim, 420, 300], ['Technicien', pHugo, 280], ['Technicien', undefined, 280]] },
    { name: 'Concerts', start: at(15, 12), end: at(17, 23, 59), prepStart: at(13, 9), returnEnd: at(18, 18),
      lines: [['x12', 12], ['sub', 4], ['ampli', 3], ['cl5', 1], ['qu16', 1], ['sm58', 12], ['di', 8], ['pied', 10], ['hf', 4], ['lyre', 8], ['spot', 4], ['par', 24], ['grandma', 1], ['fumee', 2], ['gaffer', 6], ['gel', 10]],
      crew: [['Régisseur son', pLucas, 380], ['Éclairagiste', pEmma, 360], ['Roadie', pTom, 220, 160]], vehicles: [[vCamion, pTom], [vFourgon, pHugo]] },
    { name: 'Démontage', start: at(18, 0, 30), end: at(18, 8), crew: [['Roadie', pTom, 220, 160], ['Rigger', pKarim, 420, 300]] },
  ], { contactPerson: 'Sophie Renard', notes: 'Accès technique par l\'entrée nord. Parking camion réservé.' });

  // 4. Mariage confirmé dans 3 semaines
  await project('Mariage Dupont-Lemaire', cDupont, 'confirme', 'Ferme de la Vallée, Esneux', [
    { name: 'Soirée', start: at(21, 16), end: at(22, 4), prepStart: at(21, 10), returnEnd: at(22, 14),
      lines: [['x12', 2], ['sub', 1], ['ampli', 1], ['qu16', 1], ['hf', 2], ['kitpar', 2], ['fumee', 1], ['lyre', 2, { optional: true }]],
      crew: [['Technicien DJ / son', pHugo, 300]], vehicles: [[vFourgon, pHugo]] },
  ]);

  // 5. Demande de devis en cours (ne bloque pas le matériel)
  await project('Spectacle de fin d\'année', cEcole, 'demande', 'Lycée Saint-Jean, Huy', [
    { name: 'Représentation', start: at(30, 17), end: at(30, 22), lines: [['kitconf', 1], ['sm58', 4], ['par', 12], ['pratic', 12]], crew: [['Technicien', undefined, 280]] },
  ], { discount: 10 });

  // 6. Marché de Noël en option sur un mois
  await project('Marché de Noël', cNamur, 'option', 'Place d\'Armes, Namur', [
    { name: 'Exploitation', start: at(25, 10), end: at(40, 22), lines: [['par', 16], ['pc16', 10], ['x12', 2], ['qu16', 1], ['distro', 1]], crew: [['Technicien d\'astreinte', pHugo, 250]] },
  ], { contactPerson: 'Julie Martin', discount: 15 });

  // 7. Séminaire annulé
  await project('Séminaire printemps', cAgence, 'annule', 'Bruxelles', [
    { name: 'Journée', start: at(9, 8), end: at(9, 18), lines: [['kitconf', 2], ['vp', 2]] },
  ]);

  // 8. Prestation en cours aujourd'hui
  await project('Salon de l\'emploi', cNamur, 'en_cours', 'Namur Expo', [
    { name: 'Salon', start: at(-1, 8), end: at(1, 19), lines: [['tv', 4], ['kitconf', 1], ['par', 8], ['gaffer', 2]], crew: [['Technicien', pLea, 340, 230]] },
  ], { contactPerson: 'Marc Lambert' });

  // Documents : devis puis acompte et facture pour le gala, devis pour d'autres
  await createDocument(pGala, 'devis');
  const dep = await createDocument(pGala, 'acompte', { percent: 30 });
  await db.docs.update(dep.id, { status: 'paye' });
  const inv = await createDocument(pGala, 'facture');
  await db.docs.update(inv.id, { status: 'envoye' });
  for (const p of await db.projects.toArray()) {
    if (p.status === 'confirme' || p.status === 'option') await createDocument(p.id, 'devis');
  }

  // Sous-location déjà demandée pour une partie du manque du festival
  const fSub = (await db.subprojects.where({ projectId: pFest }).toArray()).find((s) => s.name === 'Concerts')!;
  await db.subrentals.put({
    ...base(), number: `SL-${year}-001`, projectId: pFest, subprojectId: fSub.id, supplierId: cSono, status: 'demande',
    start: fSub.prepStart!, end: fSub.returnEnd!, lines: [{ equipmentId: eq.x12, name: 'Enceinte L-Acoustics X12', qty: 2, cost: 160 }],
  });
  await db.costs.put({ ...base(), projectId: pGala, label: 'Carburant et péages', amount: 95 });
  await db.settings.update('main', { counters: { ...(await db.settings.get('main'))!.counters, [`P-${year}`]: counter, [`SL-${year}`]: 1 } });
}
