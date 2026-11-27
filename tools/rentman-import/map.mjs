/**
 * Conversion des données Rentman (API v3) en fiches FabEvent.
 * Entrée : les collections Rentman telles que l'API les renvoie ({ projects: [...], subprojects: [...], … }).
 * Sortie : { data: { contacts, categories, equipment, units, people, vehicles, projects, subprojects, lines, crew, vehicleAssignments }, report }.
 *
 * Chaque fiche reçoit un identifiant stable « rm-<type>-<id Rentman> » : réimporter met à jour au lieu de dupliquer.
 * L'API ne renvoie pas toujours les mêmes champs selon le compte : chaque valeur est cherchée sous plusieurs noms,
 * et ce qui manque est compté dans le rapport (rien n'est inventé).
 */

/** "/contacts/12" ou { id: 12 } → 12 */
export const refId = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') return v.id ?? null;
  const m = String(v).match(/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
};
const pick = (o, ...keys) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
const num = (v, d = 0) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : d; };
const str = (v) => (v == null ? undefined : String(v).trim() || undefined);
/** date Rentman (« 2026-06-01T08:00:00+02:00 ») → heure locale FabEvent « 2026-06-01T08:00 » */
export const localTime = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) ? v.slice(0, 16) : undefined);
const id = (type, rid) => `rm-${type}-${rid}`;

/** Statut Rentman (son nom, dans la langue du compte) → statut FabEvent. */
export function mapStatus(name) {
  const n = String(name || '').toLowerCase();
  if (/annul|cancel|geannul/.test(n)) return 'annule';
  if (/retour|return|terug|teruggebracht|clôtur|closed|finished|afgerond/.test(n)) return 'termine';
  if (/en cours|on location|op locatie|prepped|préparé|uitgegeven|out|sortie/.test(n)) return 'en_cours';
  if (/confirm|bevestig/.test(n)) return 'confirme';
  if (/option|optie/.test(n)) return 'option';
  if (/concept|brouillon|draft/.test(n)) return 'brouillon';
  return 'demande';
}
const STATUS_RANK = { annule: 0, demande: 1, brouillon: 2, option: 3, confirme: 4, en_cours: 5, execute: 6, termine: 7 };

/** Remise Rentman : fraction (0,15) ou pourcentage (15) → pourcentage. */
const pct = (v) => { const n = num(v); return n > 0 && n <= 1 ? Math.round(n * 10000) / 100 : n; };

export function mapRentman(rm, now = new Date().toISOString()) {
  const report = { counts: {}, warnings: [] };
  const warn = (w) => { if (report.warnings.length < 200 && !report.warnings.includes(w)) report.warnings.push(w); };
  const base = (o) => ({ createdAt: localIso(pick(o, 'created')) || now, updatedAt: localIso(pick(o, 'modified', 'updated')) || now });
  const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
  const statuses = byId(rm.statuses);

  /* ---------- contacts : clients, lieux (Rentman : tout est contact) ---------- */
  const customers = new Set((rm.projects || []).map((p) => refId(p.customer)).filter(Boolean));
  const locations = new Set([...(rm.projects || []), ...(rm.subprojects || [])].map((p) => refId(p.location)).filter(Boolean));
  const personsOf = new Map();
  for (const cp of rm.contactpersons || []) {
    const cid = refId(cp.contact);
    if (!cid) continue;
    const name = str(pick(cp, 'displayname')) || [cp.firstname, cp.middle_name, cp.lastname].filter(Boolean).join(' ').trim();
    if (!name) continue;
    personsOf.set(cid, [...(personsOf.get(cid) || []), { id: id('cp', cp.id), name, role: str(pick(cp, 'function')), email: str(pick(cp, 'email', 'email_1')), phone: str(pick(cp, 'mobilephone', 'phone', 'phone_1')) }]);
  }
  const contacts = (rm.contacts || []).map((c) => {
    const isLoc = locations.has(c.id) && !customers.has(c.id);
    const street = [pick(c, 'visit_street', 'mailing_street', 'invoice_street'), pick(c, 'visit_number', 'mailing_number', 'invoice_number')].filter(Boolean).join(' ');
    const company = str(pick(c, 'displayname', 'name')) || [c.firstname, c.surname].filter(Boolean).join(' ') || `Contact ${c.id}`;
    return {
      id: id('c', c.id), ...base(c), type: isLoc ? 'lieu' : 'client', company,
      firstName: str(c.firstname), lastName: str(pick(c, 'surname', 'lastname')),
      email: str(pick(c, 'email_1', 'email')), phone: str(pick(c, 'phone_1', 'phone', 'mobilephone')),
      address: str(street), postalCode: str(pick(c, 'visit_postalcode', 'mailing_postalcode', 'invoice_postalcode')),
      city: str(pick(c, 'visit_city', 'mailing_city', 'invoice_city')), country: str(pick(c, 'visit_country', 'mailing_country', 'country'))?.toUpperCase().slice(0, 2),
      vatNumber: str(pick(c, 'vat_code', 'vat_number')), siret: str(pick(c, 'coc_code', 'chamber_of_commerce')),
      persons: personsOf.get(c.id), notes: str(pick(c, 'remark', 'notes')),
      tags: ['rentman'],
    };
  });
  const contactName = new Map(contacts.map((c) => [c.id, c.company]));

  /* ---------- catégories (dossiers) ---------- */
  const folders = byId(rm.folders);
  const top = (f) => { let x = f; for (let i = 0; i < 10 && x && refId(x.parent) && folders.get(refId(x.parent)); i++) x = folders.get(refId(x.parent)); return x; };
  const categories = (rm.folders || []).map((f) => {
    const p = refId(f.parent) && folders.get(refId(f.parent));
    // FabEvent : un seul niveau de sous-catégorie → rattachée à la catégorie principale
    const root = p ? top(p) : undefined;
    return { id: id('f', f.id), ...base(f), name: str(f.name) || `Dossier ${f.id}`, parentId: root ? id('f', root.id) : undefined };
  });

  /* ---------- matériel, kits, unités ---------- */
  const kitItems = new Map();
  for (const s of rm.equipmentsetscontent || []) {
    const kit = refId(pick(s, 'equipment_set', 'parent_equipment', 'set')), item = refId(pick(s, 'equipment', 'child_equipment'));
    if (!kit || !item) continue;
    kitItems.set(kit, [...(kitItems.get(kit) || []), { equipmentId: id('e', item), qty: Math.max(1, num(pick(s, 'quantity'), 1)) }]);
  }
  const unitsOf = new Map();
  for (const u of rm.serialnumbers || []) { const e = refId(u.equipment); if (e) unitsOf.set(e, (unitsOf.get(e) || 0) + 1); }
  const equipment = (rm.equipment || []).map((e) => {
    const kit = kitItems.get(e.id);
    const sale = /sale|verkoop|vente/i.test(String(pick(e, 'rental_sales', 'type') || ''));
    return {
      id: id('e', e.id), ...base(e), name: str(pick(e, 'displayname', 'name')) || `Article ${e.id}`, code: str(e.code),
      categoryId: refId(e.folder) ? id('f', refId(e.folder)) : undefined,
      quantity: unitsOf.get(e.id) || Math.max(0, Math.round(num(pick(e, 'quantity', 'current_quantity', 'quantity_total')))),
      dailyPrice: num(pick(e, 'price', 'rental_price', 'unit_price')),
      costPrice: num(pick(e, 'purchase_price')) || undefined,
      replacementValue: num(pick(e, 'new_price', 'replacement_value', 'value')) || undefined,
      weight: num(pick(e, 'weight')) || undefined,
      kind: sale ? 'vente' : undefined,
      isKit: !!kit?.length, kitItems: kit || [],
      trackSerials: unitsOf.has(e.id) || undefined,
      barcode: str(Array.isArray(e.qrcodes) ? e.qrcodes[0] : pick(e, 'qrcodes', 'barcode')),
      location: str(pick(e, 'location_in_warehouse', 'warehouse_location')),
      notes: str(pick(e, 'remark', 'notes')),
      archived: e.active === false || e.in_archive === true || undefined,
      tags: ['rentman'],
    };
  });
  const eqName = new Map(equipment.map((e) => [e.id, e.name]));
  const units = (rm.serialnumbers || []).filter((u) => refId(u.equipment)).map((u, i) => ({
    id: id('u', u.id), ...base(u), equipmentId: id('e', refId(u.equipment)), number: num(u.ref) || undefined,
    serial: str(pick(u, 'serial', 'ref')) || `RM-${u.id}`, barcode: str(Array.isArray(u.qrcodes) ? u.qrcodes[0] : u.qrcodes),
    status: u.active === false ? 'hs' : 'ok', history: str(u.remark) ? [{ at: now, text: `Remarque Rentman : ${str(u.remark)}` }] : undefined, _i: i,
  })).map(({ _i, ...u }) => u);

  /* ---------- équipe, véhicules ---------- */
  const people = (rm.crewmembers || []).map((p) => ({
    id: id('p', p.id), ...base(p), name: str(pick(p, 'displayname')) || [p.firstname, p.lastname].filter(Boolean).join(' ') || `Personne ${p.id}`,
    email: str(pick(p, 'email', 'email_1')), phone: str(pick(p, 'phone', 'mobilephone', 'phone_1')), city: str(pick(p, 'city', 'visit_city')),
    dailyRate: 0, external: /freelance|extern|sous-trait/i.test(String(pick(p, 'type', 'contract') || '')),
  }));
  const vehicles = (rm.vehicles || []).map((v) => ({ id: id('v', v.id), ...base(v), name: str(pick(v, 'displayname', 'name')) || `Véhicule ${v.id}`, plate: str(pick(v, 'license_plate', 'plate')), seats: num(pick(v, 'seats')) || undefined, dailyPrice: num(pick(v, 'price', 'daily_price')) }));

  /* ---------- projets, sous-projets, groupes ---------- */
  const subsOf = new Map();
  for (const s of rm.subprojects || []) { const p = refId(s.project); if (p) subsOf.set(p, [...(subsOf.get(p) || []), s]); }
  const groupsOf = new Map();
  const groupSub = new Map();
  for (const g of rm.projectequipmentgroup || []) {
    const sp = refId(g.subproject);
    if (sp) { groupSub.set(g.id, sp); groupsOf.set(sp, [...(groupsOf.get(sp) || []), { id: id('g', g.id), name: str(g.name) || 'Groupe', periodIds: [], order: num(g.order) }]); }
  }
  const subStatus = (s) => mapStatus(statuses.get(refId(s.status))?.name ?? s.status_name ?? s.status);
  const subprojects = [];
  const projects = (rm.projects || []).map((p) => {
    let subs = subsOf.get(p.id) || [];
    // projet sans sous-projet dans l'API : un sous-projet par défaut
    if (!subs.length) subs = [{ id: `p${p.id}`, project: p.id, name: str(p.name) || 'Projet', order: 1, planperiod_start: p.planperiod_start, planperiod_end: p.planperiod_end, usageperiod_start: p.usageperiod_start, usageperiod_end: p.usageperiod_end, status: p.status }];
    const start = localTime(pick(p, 'usageperiod_start', 'planperiod_start')) || localTime(pick(subs[0], 'usageperiod_start', 'planperiod_start')) || now.slice(0, 16);
    const end = localTime(pick(p, 'usageperiod_end', 'planperiod_end')) || localTime(pick(subs[0], 'usageperiod_end', 'planperiod_end')) || start;
    let best = 'annule';
    subs.forEach((s, i) => {
      const st = subStatus(s);
      if (STATUS_RANK[st] > STATUS_RANK[best] && st !== 'annule') best = st;
      const sStart = localTime(pick(s, 'usageperiod_start', 'planperiod_start')) || start, sEnd = localTime(pick(s, 'usageperiod_end', 'planperiod_end')) || end;
      subprojects.push({
        id: id('s', s.id), ...base(s), projectId: id('p', p.id), name: str(s.name) || `Sous-projet ${i + 1}`, status: st,
        start: sStart, end: sEnd,
        prepStart: localTime(s.planperiod_start) && localTime(s.planperiod_start) < sStart ? localTime(s.planperiod_start) : undefined,
        returnEnd: localTime(s.planperiod_end) && localTime(s.planperiod_end) > sEnd ? localTime(s.planperiod_end) : undefined,
        venue: refId(s.location) ? contactName.get(id('c', refId(s.location))) : undefined,
        groups: (groupsOf.get(s.id) || []).sort((a, b) => a.order - b.order).map(({ order, ...g }) => g),
        order: num(s.order, i + 1),
      });
    });
    if (best === 'annule' && subs.some((s) => subStatus(s) !== 'annule')) best = 'demande';
    const venueId = refId(p.location) ? id('c', refId(p.location)) : undefined;
    const cp = refId(pick(p, 'cust_contact', 'customer_contact', 'contactperson'));
    return {
      id: id('p', p.id), ...base(p), number: str(pick(p, 'number', 'reference_number')) || `R-${p.id}`, name: str(pick(p, 'name', 'displayname')) || `Projet ${p.id}`,
      clientId: refId(p.customer) ? id('c', refId(p.customer)) : undefined, venueId, venue: venueId ? contactName.get(venueId) : undefined,
      contactPersonId: cp ? id('cp', cp) : undefined,
      status: subs.every((s) => subStatus(s) === 'annule') ? 'annule' : best, start, end, discount: 0,
      externalRef: str(p.reference), color: str(p.color), notes: str(pick(p, 'remark', 'description')),
      tags: ['rentman'],
    };
  });
  const firstSubOf = new Map(subprojects.map((s) => [s.projectId, s.id]).reverse());

  /* ---------- lignes de matériel ---------- */
  const peq = rm.projectequipment || [];
  const kitIds = new Set(equipment.filter((e) => e.isKit).map((e) => e.id));
  const lineEq = new Map(peq.map((l) => [l.id, refId(l.equipment) ? id('e', refId(l.equipment)) : undefined]));
  const lines = peq.map((l, i) => {
    const gid = refId(l.equipment_group);
    const rSub = refId(l.subproject) || (gid ? groupSub.get(gid) : null);
    const pid = refId(l.project);
    const subprojectId = rSub ? id('s', rSub) : pid ? firstSubOf.get(id('p', pid)) : undefined;
    if (!subprojectId) { warn(`Ligne de matériel ${l.id} sans sous-projet : ignorée`); return null; }
    const projectId = pid ? id('p', pid) : subprojects.find((s) => s.id === subprojectId)?.projectId;
    const equipmentId = lineEq.get(l.id);
    const parent = refId(l.parent);
    const factor = num(pick(l, 'factor', 'staffel'), 0);
    return {
      id: id('l', l.id), ...base(l), projectId, subprojectId, equipmentId,
      name: str(l.name) || (equipmentId ? eqName.get(equipmentId) : undefined) || 'Article',
      qty: num(pick(l, 'quantity_total', 'quantity'), 1), unitPrice: num(pick(l, 'unit_price', 'price')), catalogPrice: undefined,
      discount: pct(pick(l, 'discount')), factor: factor > 0 ? factor : undefined,
      groupId: gid ? id('g', gid) : undefined, order: num(l.order, i),
      optional: !!l.is_option || undefined, parentLineId: parent ? id('l', parent) : undefined,
      kitPart: parent && kitIds.has(lineEq.get(parent)) ? true : undefined,
      remark: str(pick(l, 'external_remark', 'remark')), internalRemark: str(l.internal_remark),
    };
  }).filter(Boolean);

  /* ---------- postes (fonctions) et techniciens ---------- */
  const crewByFn = new Map();
  for (const c of rm.projectcrew || []) { const f = refId(c.function); if (f) crewByFn.set(f, [...(crewByFn.get(f) || []), c]); }
  const crew = [];
  for (const f of rm.projectfunctions || []) {
    const sp = refId(f.subproject);
    const pid = refId(f.project);
    const subprojectId = sp ? id('s', sp) : pid ? firstSubOf.get(id('p', pid)) : undefined;
    if (!subprojectId) { warn(`Poste ${f.id} sans sous-projet : ignoré`); continue; }
    const projectId = pid ? id('p', pid) : subprojects.find((s) => s.id === subprojectId)?.projectId;
    const sub = subprojects.find((s) => s.id === subprojectId);
    const start = localTime(pick(f, 'usageperiod_start', 'planperiod_start')) || sub?.start, end = localTime(pick(f, 'usageperiod_end', 'planperiod_end')) || sub?.end;
    const assigned = crewByFn.get(f.id) || [];
    const n = Math.max(1, num(f.quantity, 1), assigned.length);
    const rate = num(pick(f, 'price', 'unit_price', 'price_per_unit'));
    for (let k = 0; k < n; k++) {
      const a = assigned[k];
      crew.push({
        id: id('cr', `${f.id}-${k}`), ...base(f), projectId, subprojectId, personId: a && refId(a.crewmember) ? id('p', refId(a.crewmember)) : undefined,
        function: str(f.name) || 'Poste', start: localTime(pick(a || {}, 'planperiod_start', 'usageperiod_start')) || start, end: localTime(pick(a || {}, 'planperiod_end', 'usageperiod_end')) || end,
        rate, billable: rate > 0,
      });
    }
  }
  const vehicleAssignments = (rm.projectvehicles || []).map((v) => {
    const sp = refId(v.subproject), pid = refId(v.project);
    const subprojectId = sp ? id('s', sp) : pid ? firstSubOf.get(id('p', pid)) : undefined;
    if (!subprojectId || !refId(v.vehicle)) return null;
    const sub = subprojects.find((s) => s.id === subprojectId);
    return { id: id('va', v.id), ...base(v), projectId: pid ? id('p', pid) : sub?.projectId, subprojectId, vehicleId: id('v', refId(v.vehicle)),
      start: localTime(v.planperiod_start) || sub?.start, end: localTime(v.planperiod_end) || sub?.end, price: num(pick(v, 'price')), billable: num(pick(v, 'price')) > 0 };
  }).filter(Boolean);

  const data = { contacts, categories, equipment, units, people, vehicles, projects, subprojects, lines, crew, vehicleAssignments };
  for (const [k, v] of Object.entries(data)) report.counts[k] = v.length;
  // liens vers des fiches absentes (droits de la clé API, collection non lue…)
  const has = (list) => new Set(list.map((x) => x.id));
  const eqIds = has(equipment), cIds = has(contacts), pIds = has(people);
  const missEq = lines.filter((l) => l.equipmentId && !eqIds.has(l.equipmentId)).length;
  if (missEq) warn(`${missEq} ligne(s) de matériel pointent vers un article absent de l'export (gardées comme lignes libres)`);
  for (const l of lines) if (l.equipmentId && !eqIds.has(l.equipmentId)) l.equipmentId = undefined;
  for (const p of projects) { if (p.clientId && !cIds.has(p.clientId)) p.clientId = undefined; if (p.venueId && !cIds.has(p.venueId)) p.venueId = undefined; }
  for (const c of crew) if (c.personId && !pIds.has(c.personId)) c.personId = undefined;
  return { data, report };
}

function localIso(v) {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
