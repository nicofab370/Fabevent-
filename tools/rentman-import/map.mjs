/**
 * Conversion des données Rentman (API v3) en fiches FabEvent.
 * Entrée : les collections Rentman telles que l'API les renvoie ({ projects: [...], subprojects: [...], … }).
 * Sortie : { data: { contacts, categories, equipment, units, people, vehicles, projects, subprojects, lines, crew, vehicleAssignments,
 *   costs, subrentals, repairs, unavailability, appointments, docs, settings }, files, report }.
 * files : les fichiers Rentman à télécharger (documents des projets et de l'équipe, photos du matériel), que export.mjs
 * récupère à part (fichiers « -fichiers-N.json ») pour ne pas alourdir le fichier principal.
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
/** plus grande valeur numérique parmi plusieurs champs (un champ à 0 ne masque pas les suivants) */
const maxOf = (o, ...keys) => Math.max(0, ...keys.map((k) => num(o?.[k])));
const num = (v, d = 0) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : d; };
const str = (v) => (v == null ? undefined : String(v).trim() || undefined);
/** date Rentman (« 2026-06-01T08:00:00+02:00 ») → heure locale FabEvent « 2026-06-01T08:00 » */
export const localTime = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) ? v.slice(0, 16) : undefined);
const id = (type, rid) => `rm-${type}-${rid}`;
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
const round2 = (n) => Math.round(n * 100) / 100;
/** "/projects/12" → ['projects', 12] */
export const refType = (v) => { const m = typeof v === 'string' && v.match(/([a-z_]+)\/(\d+)\/?$/i); return m ? [m[1].toLowerCase(), Number(m[2])] : null; };

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
/** Bloc de planning Rentman (son nom) → type de créneau FabEvent. */
export function periodKind(name) {
  const n = String(name || '').toLowerCase();
  if (/d[ée]montage|afbouw|break ?down|tear ?down|abbau|load ?out|get ?out|d[ée]charg/.test(n)) return 'demontage';
  if (/montage|opbouw|build ?up|set ?up|aufbau|load ?in|get ?in|install|charg/.test(n)) return 'montage';
  if (/show|event|[ée]v[ée]nement|prestation|concert|spectacle|repr[ée]sentation|voorstelling|uitvoering|op locatie|jour j|live/.test(n)) return 'prestation';
  return 'autre';
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
  const suppliers = new Set([...(rm.subrentals || []).map((s) => refId(pick(s, 'supplier', 'contact'))), ...(rm.costs || []).map((c) => refId(pick(c, 'supplier', 'contact')))].filter(Boolean));
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
    // adresse postale / de facturation : reprise seulement si elle diffère de l'adresse de visite
    const addr = (c, k) => {
      const a = { address: str([c[`${k}_street`], c[`${k}_number`]].filter(Boolean).join(' ')), postalCode: str(c[`${k}_postalcode`]), city: str(c[`${k}_city`]), country: str(c[`${k}_country`])?.toUpperCase().slice(0, 2) };
      const same = a.address === str([c.visit_street, c.visit_number].filter(Boolean).join(' ')) && a.city === str(c.visit_city);
      return a.address && !same ? a : undefined;
    };
    const isSup = !isLoc && suppliers.has(c.id) && !customers.has(c.id);
    const lang = String(pick(c, 'language', 'lang') || '').toLowerCase().slice(0, 2);
    const discEq = pct(pick(c, 'discount_rental', 'default_discount', 'discount'));
    const street = [pick(c, 'visit_street', 'mailing_street', 'invoice_street'), pick(c, 'visit_number', 'mailing_number', 'invoice_number')].filter(Boolean).join(' ');
    const company = str(pick(c, 'displayname', 'name')) || [c.firstname, c.surname].filter(Boolean).join(' ') || `Contact ${c.id}`;
    return {
      id: id('c', c.id), ...base(c), type: isLoc ? 'lieu' : isSup ? 'fournisseur' : 'client', company,
      firstName: str(c.firstname), lastName: str(pick(c, 'surname', 'lastname')),
      email: str(pick(c, 'email_1', 'email')), phone: str(pick(c, 'phone_1', 'phone', 'mobilephone')),
      address: str(street), postalCode: str(pick(c, 'visit_postalcode', 'mailing_postalcode', 'invoice_postalcode')),
      city: str(pick(c, 'visit_city', 'mailing_city', 'invoice_city')), country: str(pick(c, 'visit_country', 'mailing_country', 'country'))?.toUpperCase().slice(0, 2),
      vatNumber: str(pick(c, 'vat_code', 'vat_number')), siret: str(pick(c, 'coc_code', 'chamber_of_commerce')),
      persons: personsOf.get(c.id), notes: str(pick(c, 'remark', 'notes')),
      paymentDays: num(pick(c, 'payment_term', 'paymentterm', 'invoice_term', 'payment_days')) || undefined,
      language: ['fr', 'nl', 'en'].includes(lang) ? lang : undefined,
      discounts: discEq > 0 ? { equipment: discEq } : undefined,
      email2: str(c.email_2), phone2: str(c.phone_2), website: str(c.website), iban: str(c.bank_account), bic: str(c.bic),
      accountingCode: str(c.accounting_code), purchaseNumber: str(c.purchase_number),
      warning: str(c.contact_warning), autoProjectNote: str([pick(c, 'projectnote_title'), pick(c, 'projectnote')].filter(Boolean).join(' — ')),
      postalAddress: addr(c, 'mailing'), billingAddress: addr(c, 'invoice'),
      distanceKm: isLoc ? num(c.distance) || undefined : undefined, travelMinutes: isLoc ? num(c.travel_time) || undefined : undefined,
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
  const accOf = new Map();
  for (const a of rm.accessories || []) {
    const parent = refId(pick(a, 'equipment', 'parent_equipment', 'parent')), child = refId(pick(a, 'accessory', 'child_equipment', 'linked_equipment', 'accessory_equipment'));
    if (!parent || !child || parent === child) continue;
    const auto = pick(a, 'automatic', 'is_automatic', 'auto_add', 'add_automatically');
    const inPrice = pick(a, 'include_in_price', 'in_price', 'price_included', 'free', 'is_free');
    accOf.set(parent, [...(accOf.get(parent) || []), {
      equipmentId: id('e', child), qty: Math.max(1, num(pick(a, 'quantity'), 1)),
      free: inPrice === undefined ? true : bool(inPrice), optional: auto !== undefined && !bool(auto) ? true : undefined,
    }]);
  }
  const unitsOf = new Map();
  for (const u of rm.serialnumbers || []) { const e = refId(u.equipment); if (e) unitsOf.set(e, (unitsOf.get(e) || 0) + 1); }
  // stock calculé à partir des mouvements de stock (achats, pertes, corrections…), si la fiche de l'article n'en donne pas
  const moved = new Map();
  for (const m of rm.stockmovements || []) { const e = refId(m.equipment); if (e) moved.set(e, (moved.get(e) || 0) + num(pick(m, 'amount', 'quantity', 'quantity_change', 'change', 'mutation'))); }
  const QTY = ['current_quantity', 'current_quantity_excl_cases', 'quantity', 'quantity_total', 'stock', 'stock_quantity', 'total_quantity', 'total_stock', 'stock_total', 'in_stock', 'quantity_in_stock', 'amount'];
  let fromMoves = 0, zero = 0;
  const equipment = (rm.equipment || []).map((e) => {
    const kit = kitItems.get(e.id);
    const sale = /sale|verkoop|vente/i.test(String(pick(e, 'rental_sales', 'type') || ''));
    return {
      id: id('e', e.id), ...base(e), name: str(pick(e, 'displayname', 'name')) || `Article ${e.id}`, code: str(e.code),
      categoryId: refId(e.folder) ? id('f', refId(e.folder)) : undefined,
      quantity: (() => {
        const q = unitsOf.get(e.id) || Math.round(maxOf(e, ...QTY)); // numéroté : une unité par numéro de série
        if (q) return q;
        const m = Math.max(0, Math.round(moved.get(e.id) || 0));
        if (m) fromMoves++; else if (!kit?.length) zero++;
        return m;
      })(),
      dailyPrice: num(pick(e, 'price', 'rental_price', 'unit_price')),
      costPrice: num(pick(e, 'purchase_price')) || undefined,
      replacementValue: num(pick(e, 'new_price', 'replacement_value', 'value')) || undefined,
      weight: num(pick(e, 'weight')) || undefined,
      // dimensions (cm) et consommation (W), si renseignées dans Rentman
      dims: (() => { const d = { l: num(pick(e, 'length', 'depth')), w: num(e.width), h: num(e.height) }; return d.l && d.w && d.h ? d : undefined; })(),
      power: num(pick(e, 'power', 'power_consumption', 'wattage')) || undefined,
      kind: sale ? 'vente' : undefined,
      isKit: !!kit?.length, kitItems: kit || [], accessories: accOf.get(e.id),
      trackSerials: unitsOf.has(e.id) || undefined,
      barcode: str(Array.isArray(e.qrcodes) ? e.qrcodes[0] : pick(e, 'qrcodes', 'barcode')),
      location: str(pick(e, 'location_in_warehouse', 'warehouse_location')),
      notes: str([pick(e, 'internal_remark', 'remark', 'notes'), e.external_remark].filter(Boolean).join('\n')),
      defaultGroup: str(e.defaultgroup && typeof e.defaultgroup === 'string' && !String(e.defaultgroup).startsWith('/') ? e.defaultgroup : undefined),
      packedPer: num(e.packed_per) > 1 ? num(e.packed_per) : undefined,
      originCountry: str(e.country_of_origin)?.toUpperCase().slice(0, 2),
      unit: str(e.unit && !String(e.unit).startsWith('/') ? e.unit : undefined),
      hideInPicker: e.in_planner === false || undefined,
      criticalStock: num(e.critical_stock_level) || undefined,
      isSurface: e.surface_article === true || undefined,
      factorGroupId: refId(e.factor_group) ? id('fg', refId(e.factor_group)) : undefined,
      
      archived: e.active === false || e.in_archive === true || undefined,
      tags: ['rentman'],
    };
  });
  const eqName = new Map(equipment.map((e) => [e.id, e.name]));
  if (fromMoves) warn(`${fromMoves} article(s) : stock calculé à partir des mouvements de stock`);
  if (zero) warn(`${zero} article(s) sans aucune quantité dans Rentman (stock à 0)`);
  const units = (rm.serialnumbers || []).filter((u) => refId(u.equipment)).map((u, i) => ({
    id: id('u', u.id), ...base(u), equipmentId: id('e', refId(u.equipment)), number: num(u.ref) || undefined,
    serial: str(pick(u, 'serial', 'ref')) || `RM-${u.id}`, barcode: str(Array.isArray(u.qrcodes) ? u.qrcodes[0] : u.qrcodes),
    status: u.active === false ? 'hs' : 'ok', history: str(u.remark) ? [{ at: now, text: `Remarque Rentman : ${str(u.remark)}` }] : undefined, _i: i,
  })).map(({ _i, ...u }) => u);

  /* ---------- équipe, véhicules ---------- */
  // équipe non lue (clé API sans accès au personnel) : techniciens repris des postes, rendez-vous et disponibilités, avec leur nom seulement
  if (!(rm.crewmembers || []).length) {
    const seen = new Map();
    for (const c of [...(rm.projectcrew || []), ...(rm.appointmentcrew || []), ...(rm.crewavailability || [])]) {
      const pid = refId(pick(c, 'crewmember', 'crew', 'member'));
      if (!pid) continue;
      const name = str(pick(c, 'crewmember_name', 'crew_name', 'name_crewmember', 'displayname'));
      if (!seen.has(pid) || (name && !seen.get(pid).displayname)) seen.set(pid, { id: pid, displayname: name, remark: "Repris d'un poste Rentman : la clé API n'a pas accès à la fiche de l'équipe (coordonnées à compléter)." });
    }
    if (seen.size) {
      rm = { ...rm, crewmembers: [...seen.values()] };
      warn(`${seen.size} technicien(s) repris des postes, avec leur nom seulement : la clé API n'a pas accès à l'équipe`);
    }
  }
  const people = (rm.crewmembers || []).map((p) => ({
    id: id('p', p.id), ...base(p), name: str(pick(p, 'displayname')) || [p.firstname, p.lastname].filter(Boolean).join(' ') || `Technicien Rentman ${p.id}`,
    email: str(pick(p, 'email', 'email_1')), phone: str(pick(p, 'phone', 'mobilephone', 'phone_1')), city: str(pick(p, 'city', 'visit_city', 'street_city')),
    role: str(pick(p, 'function', 'job_title', 'jobtitle')), vatNumber: str(pick(p, 'vat_code', 'vat_number')),
    drivingLicense: str(p.driving_license), birthDate: str(p.birthdate)?.slice(0, 10), emergencyContact: str(p.emergency_contact), company: str(p.company_name), iban: str(p.bank),
    contract: str(p.contract) || str(p.contract_date) ? { type: str(p.contract), start: str(p.contract_date)?.slice(0, 10) } : undefined,
    inactive: p.active === false || undefined,
    notes: str([pick(p, 'remark', 'notes'), [pick(p, 'street'), pick(p, 'number', 'housenumber')].filter(Boolean).join(' '), pick(p, 'postalcode', 'zipcode')].filter(Boolean).join(' · ')),
    dailyRate: num(pick(p, 'day_rate', 'dayrate', 'default_rate')), costRate: num(pick(p, 'day_cost', 'cost_rate', 'purchase_rate')) || undefined,
    hourlyRate: num(pick(p, 'hourly_rate', 'hour_rate')) || undefined,
    external: /freelance|extern|sous-trait|zzp/i.test(String(pick(p, 'type', 'contract', 'contract_type') || '')),
  }));
  const vehicles = (rm.vehicles || []).map((v) => ({ id: id('v', v.id), ...base(v), name: str(pick(v, 'displayname', 'name')) || `Véhicule ${v.id}`, plate: str(pick(v, 'license_plate', 'plate')), seats: num(pick(v, 'seats')) || undefined,
    payload: num(pick(v, 'payload', 'max_load', 'capacity')) || undefined, dailyPrice: num(pick(v, 'price', 'daily_price', 'day_price')),
    pricePerKm: num(pick(v, 'price_per_km', 'km_price', 'kilometer_price')) || undefined, notes: str(pick(v, 'remark', 'notes')) }));

  /* ---------- types de projet, dépôts (emplacements de stock) : ajoutés aux paramètres ---------- */
  const ptypes = byId(rm.projecttypes);
  const projectTypes = (rm.projecttypes || []).map((t) => ({ name: str(pick(t, 'name', 'displayname')), color: str(t.color) || '#64748b' })).filter((t) => t.name);
  const depots = (rm.stocklocations || []).map((l) => ({
    id: id('d', l.id), name: str(pick(l, 'name', 'displayname')) || `Dépôt ${l.id}`,
    street: str([pick(l, 'street', 'address'), pick(l, 'number', 'housenumber')].filter(Boolean).join(' ')), postalCode: str(pick(l, 'postalcode', 'zipcode')),
    city: str(l.city), country: str(l.country)?.toUpperCase().slice(0, 2),
  }));

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
  // chargé de projet (membre de l'équipe) et tâches des projets
  const accountManagers = new Map((rm.crewmembers || []).map((c) => [c.id, str(pick(c, 'displayname')) || [c.firstname, c.lastname].filter(Boolean).join(' ')]));
  const tasksOf = new Map();
  for (const t of rm.tasks || []) {
    const [tt, rid] = refType(t.item) || [];
    const pid = (tt === 'projects' || String(t.itemtype).toLowerCase() === 'project') ? (rid || refId(t.item)) : null;
    if (!pid) continue;
    const done = !!t.completed_at || /done|completed|klaar|termin/i.test(String(t.status || ''));
    tasksOf.set(pid, [...(tasksOf.get(pid) || []), { id: id('t', t.id), text: str(pick(t, 'name', 'displayname')) || 'Tâche', done, doneAt: done ? localIso(t.completed_at) || undefined : undefined,
      due: localTime(t.deadline)?.slice(0, 10), priority: /high|hoog|haute/i.test(String(t.priority || '')) ? 'haute' : /low|laag|basse/i.test(String(t.priority || '')) ? 'basse' : undefined }]);
  }
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
        order: num(s.order, i + 1), notes: str(pick(s, 'remark', 'description')),
      });
    });
    if (best === 'annule' && subs.some((s) => subStatus(s) !== 'annule')) best = 'demande';
    const venueId = refId(p.location) ? id('c', refId(p.location)) : undefined;
    const cp = refId(pick(p, 'cust_contact', 'customer_contact', 'contactperson'));
    // remises : sur le projet, sinon sur son premier sous-projet (Rentman les règle par sous-projet)
    const disc = (k) => pct(pick(p, k) ?? subs.map((s) => pick(s, k)).find((v) => v !== undefined));
    const partDiscounts = Object.fromEntries(Object.entries({ materiel: 'discount_rental', personnel: 'discount_crew', transport: 'discount_transport', frais: 'discount_additional_costs' })
      .map(([part, k]) => [part, disc(k)]).filter(([, v]) => v > 0));
    const ptype = ptypes.get(refId(pick(p, 'project_type', 'projecttype')));
    return {
      id: id('p', p.id), ...base(p), number: str(pick(p, 'number', 'reference_number')) || `R-${p.id}`, name: str(pick(p, 'name', 'displayname')) || `Projet ${p.id}`,
      clientId: refId(p.customer) ? id('c', refId(p.customer)) : undefined, venueId, venue: venueId ? contactName.get(venueId) : undefined,
      contactPersonId: cp ? id('cp', cp) : undefined,
      status: subs.every((s) => subStatus(s) === 'annule') ? 'annule' : best, start, end, discount: disc('discount_total') || 0,
      partDiscounts: Object.keys(partDiscounts).length ? partDiscounts : undefined, insurancePct: pct(pick(p, 'insurance_rate', 'insurance')) || undefined,
      typeName: str(ptype && pick(ptype, 'name', 'displayname')),
      externalRef: str(p.reference), color: str(p.color), notes: str(pick(p, 'remark', 'description')),
      manager: str(p.account_manager_name) || accountManagers.get(refId(p.account_manager)),
      tasks: tasksOf.get(p.id),
      tags: ['rentman'],
    };
  });
  const firstSubOf = new Map(subprojects.map((s) => [s.projectId, s.id]).reverse());

  /* ---------- planning : blocs de planning du personnel (montage, show, démontage…) → créneaux du sous-projet ---------- */
  const subById = new Map(subprojects.map((s) => [s.id, s]));
  const groupPeriod = new Map();
  for (const g of rm.projectfunctiongroups || []) {
    const sp = refId(g.subproject), pid = refId(g.project);
    const sub = subById.get(sp ? id('s', sp) : pid ? firstSubOf.get(id('p', pid)) : undefined);
    const start = localTime(pick(g, 'planperiod_start', 'usageperiod_start', 'start')), end = localTime(pick(g, 'planperiod_end', 'usageperiod_end', 'end'));
    if (!sub || !start || !end) continue;
    const name = str(pick(g, 'name', 'displayname')) || 'Créneau';
    const period = { id: id('pg', g.id), name, kind: periodKind(name), start, end };
    (sub.periods ||= []).push(period);
    groupPeriod.set(g.id, period.id);
  }
  for (const sub of subprojects) {
    if (!sub.periods?.length) continue;
    // période d'utilisation de Rentman gardée comme prestation si aucun bloc n'en est une ; préparation et retour gardés aussi
    if (!sub.periods.some((p) => p.kind === 'prestation')) sub.periods.push({ id: `${sub.id}-usage`, name: 'Prestation', kind: 'prestation', start: sub.start, end: sub.end });
    // préparation et retour de Rentman : seulement ce qui dépasse les blocs de planning
    const first = sub.periods.reduce((a, p) => (p.start < a ? p.start : a), sub.periods[0].start);
    const last = sub.periods.reduce((a, p) => (p.end > a ? p.end : a), sub.periods[0].end);
    if (sub.prepStart && sub.prepStart < first) sub.periods.push({ id: `${sub.id}-prep`, name: 'Préparation', kind: 'autre', start: sub.prepStart, end: first });
    if (sub.returnEnd && sub.returnEnd > last) sub.periods.push({ id: `${sub.id}-retour`, name: 'Retour', kind: 'autre', start: last, end: sub.returnEnd });
    // comme FabEvent : dates du sous-projet déduites des créneaux (prestations = utilisation, le reste = préparation / retour)
    const ps = sub.periods.filter((p) => p.end > p.start).sort((a, b) => a.start.localeCompare(b.start));
    const used = ps.filter((p) => p.kind === 'prestation');
    const allStart = ps[0].start, allEnd = ps.reduce((a, p) => (p.end > a ? p.end : a), ps[0].end);
    sub.periods = ps;
    sub.start = used[0].start; sub.end = used.reduce((a, p) => (p.end > a ? p.end : a), used[0].end);
    sub.prepStart = allStart < sub.start ? allStart : undefined; sub.returnEnd = allEnd > sub.end ? allEnd : undefined;
  }

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
      qty: maxOf(l, 'quantity_total', 'quantity', 'quantity_planned'), unitPrice: num(pick(l, 'unit_price', 'price')), catalogPrice: undefined,
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
    const gp = sub?.periods?.find((p) => p.id === groupPeriod.get(refId(pick(f, 'group', 'functiongroup', 'function_group'))));
    const start = localTime(pick(f, 'planperiod_start', 'usageperiod_start')) || gp?.start || sub?.start, end = localTime(pick(f, 'planperiod_end', 'usageperiod_end')) || gp?.end || sub?.end;
    const assigned = crewByFn.get(f.id) || [];
    const n = Math.max(1, num(f.quantity, 1), assigned.length);
    const rate = num(pick(f, 'price', 'unit_price', 'price_per_unit'));
    for (let k = 0; k < n; k++) {
      const a = assigned[k];
      crew.push({
        id: id('cr', `${f.id}-${k}`), ...base(f), projectId, subprojectId, periodId: groupPeriod.get(refId(pick(f, 'group', 'functiongroup', 'function_group'))), personId: a && refId(pick(a, 'crewmember', 'crew', 'member')) ? id('p', refId(pick(a, 'crewmember', 'crew', 'member'))) : undefined,
        function: str(f.name) || 'Poste', start: localTime(pick(a || {}, 'planperiod_start', 'usageperiod_start')) || start, end: localTime(pick(a || {}, 'planperiod_end', 'usageperiod_end')) || end,
        rate, billable: rate > 0, cost: num(pick(a || {}, 'cost', 'purchase_cost', 'costs', 'cost_rate')) || undefined,
        notes: str(pick(a || {}, 'remark')) || str(pick(f, 'remark')),
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

  /* ---------- ce qui se rattache à un projet : par le projet, sinon par le sous-projet ---------- */
  const subProj = new Map((rm.subprojects || []).map((s) => [s.id, refId(s.project)]));
  const lineProj = new Map(peq.map((l) => [l.id, refId(l.project) || subProj.get(refId(l.subproject)) || subProj.get(groupSub.get(refId(l.equipment_group)))]));
  const projOf = (o) => { const p = refId(o.project) || subProj.get(refId(o.subproject)); return p ? id('p', p) : undefined; };
  const projById = new Map(projects.map((p) => [p.id, p]));
  const subOf = (o) => (refId(o.subproject) ? id('s', refId(o.subproject)) : undefined);

  /* ---------- coûts supplémentaires ---------- */
  const costs = (rm.costs || []).map((c) => {
    const projectId = projOf(c);
    if (!projectId) { warn(`Coût ${c.id} sans projet : ignoré`); return null; }
    const qty = num(pick(c, 'quantity', 'amount'), 1) || 1;
    const price = num(pick(c, 'sale_price', 'price', 'unit_price'));
    const cost = num(pick(c, 'purchase_price', 'cost', 'costs', 'purchase_cost'));
    const sup = refId(pick(c, 'supplier', 'contact'));
    return {
      id: id('k', c.id), ...base(c), projectId, label: str(pick(c, 'name', 'displayname')) || 'Coût', qty,
      amount: round2(cost * qty), price: price || undefined, billable: price > 0,
      supplierId: sup ? id('c', sup) : undefined, supplierName: sup ? contactName.get(id('c', sup)) : undefined,
      category: str(pick(c, 'category', 'type')), vatRate: num(pick(c, 'vat_rate', 'tax_percentage')) || undefined,
    };
  }).filter(Boolean);

  /* ---------- sous-locations ---------- */
  const srLines = new Map();
  for (const l of rm.subrentalequipment || []) {
    const sr = refId(l.subrental);
    if (!sr) continue;
    const e = refId(l.equipment);
    srLines.set(sr, [...(srLines.get(sr) || []), {
      equipmentId: e ? id('e', e) : undefined, name: str(pick(l, 'name', 'displayname')) || (e ? eqName.get(id('e', e)) : undefined) || 'Article',
      qty: maxOf(l, 'quantity_total', 'quantity', 'quantity_planned'), cost: num(pick(l, 'unit_price', 'price', 'purchase_price')),
      _proj: lineProj.get(refId(pick(l, 'project_equipment', 'projectequipment', 'linked_equipment'))),
    }]);
  }
  const subrentals = (rm.subrentals || []).map((s) => {
    const ls = srLines.get(s.id) || [];
    const rp = refId(s.project) || subProj.get(refId(s.subproject)) || ls.map((l) => l._proj).find(Boolean);
    if (!rp) { warn(`Sous-location ${s.id} sans projet : ignorée`); return null; }
    const projectId = id('p', rp), p = projById.get(projectId);
    const sup = refId(pick(s, 'supplier', 'contact'));
    const n = String(statuses.get(refId(s.status))?.name ?? s.status_name ?? s.status ?? '').toLowerCase();
    const status = /annul|cancel/.test(n) ? 'annule' : /retour|return|terug/.test(n) ? 'retourne' : /reçu|recu|receiv|ontvang|out|sorti/.test(n) ? 'recu' : /confirm|bevestig/.test(n) ? 'confirme' : 'demande';
    return {
      id: id('sr', s.id), ...base(s), number: str(pick(s, 'number', 'reference')) || `RM-SL-${s.id}`, projectId, subprojectId: subOf(s),
      supplierId: sup ? id('c', sup) : undefined, status,
      start: localTime(pick(s, 'usageperiod_start', 'planperiod_start')) || p?.start || now.slice(0, 16),
      end: localTime(pick(s, 'usageperiod_end', 'planperiod_end')) || p?.end || now.slice(0, 16),
      lines: ls.map(({ _proj, ...l }) => l), notes: str([pick(s, 'name', 'displayname'), pick(s, 'remark')].filter(Boolean).join(' — ')),
    };
  }).filter(Boolean);

  /* ---------- réparations ---------- */
  const unitEq = new Map((rm.serialnumbers || []).map((u) => [u.id, refId(u.equipment)]));
  const repairs = (rm.repairs || []).map((r) => {
    const u = refId(pick(r, 'serialnumber', 'serial_number'));
    const e = refId(r.equipment) || unitEq.get(u);
    if (!e) { warn(`Réparation ${r.id} sans article : ignorée`); return null; }
    const start = localTime(pick(r, 'repairperiod_start', 'start', 'date')) || localTime(r.created) || now.slice(0, 16);
    const end = localTime(pick(r, 'repairperiod_end', 'end'));
    const sup = refId(pick(r, 'repairman', 'repairer', 'contact', 'supplier'));
    return {
      id: id('r', r.id), ...base(r), equipmentId: id('e', e), unitId: u ? id('u', u) : undefined, qty: num(pick(r, 'amount', 'quantity'), 1) || 1,
      start, end, status: end && end <= now.slice(0, 16) ? 'termine' : 'ouvert',
      description: str([pick(r, 'name', 'displayname'), pick(r, 'remark', 'description')].filter(Boolean).join(' — ')) || 'Réparation',
      cost: num(pick(r, 'costs', 'cost', 'price')), supplierId: sup ? id('c', sup) : undefined,
    };
  }).filter(Boolean);

  /* ---------- indisponibilités de l'équipe ---------- */
  const unavailability = (rm.crewavailability || []).map((a) => {
    const p = refId(pick(a, 'crewmember', 'crew', 'member'));
    const st = String(pick(a, 'status', 'availability', 'type') ?? '').toLowerCase();
    // seules les périodes « indisponible » (une disponibilité déclarée n'en est pas une)
    if (!p || (/avail|beschikbaar|dispon/.test(st) && !/un|niet|indis|non/.test(st))) return null;
    const start = localTime(pick(a, 'start', 'startdate', 'date_start', 'planperiod_start')), end = localTime(pick(a, 'end', 'enddate', 'date_end', 'planperiod_end')) || start;
    if (!start) return null;
    return { id: id('na', a.id), ...base(a), personId: id('p', p), start, end, reason: str(pick(a, 'remark', 'name', 'description')) };
  }).filter(Boolean);

  /* ---------- rendez-vous ---------- */
  const apptCrew = new Map();
  for (const c of rm.appointmentcrew || []) { const ap = refId(c.appointment), p = refId(pick(c, 'crewmember', 'crew', 'member')); if (ap && p) apptCrew.set(ap, [...(apptCrew.get(ap) || []), id('p', p)]); }
  const appointments = (rm.appointments || []).map((a) => {
    const start = localTime(pick(a, 'start', 'planperiod_start'));
    if (!start) return null;
    return {
      id: id('ap', a.id), ...base(a), title: str(pick(a, 'name', 'displayname')) || 'Rendez-vous', start, end: localTime(pick(a, 'end', 'planperiod_end')) || start,
      location: str(pick(a, 'location', 'address')), personIds: apptCrew.get(a.id), notes: str(pick(a, 'remark', 'description')), projectId: projOf(a),
    };
  }).filter(Boolean);

  /* ---------- devis et factures (montants, numéros, état ; les PDF viennent avec les fichiers) ---------- */
  const docs = [];
  const mkDoc = (o, kind) => {
    const projectId = projOf(o), p = projById.get(projectId);
    if (!p) { warn(`${kind === 'devis' ? 'Devis' : 'Facture'} ${o.id} sans projet : ignoré(e)`); return; }
    let ht = num(pick(o, 'price', 'price_excl_vat', 'total_price', 'amount_excl_vat', 'total_excl_vat', 'subtotal'));
    let ttc = num(pick(o, 'price_incl_vat', 'total_price_incl_vat', 'amount_incl_vat', 'total_incl_vat', 'total')) || ht;
    const type = kind === 'facture' && (ht < 0 || /credit|avoir/i.test(String(pick(o, 'type', 'invoice_type') || ''))) ? 'avoir' : kind;
    ht = Math.abs(ht); ttc = Math.abs(ttc);
    const number = str(pick(o, 'number', 'displayname', 'name')) || `RM-${o.id}`;
    const st = String(pick(o, 'status', 'payment_status') ?? '').toLowerCase();
    const status = kind === 'devis'
      ? (bool(o.accepted) || /accept|signed|akkoord|getekend/.test(st) ? 'accepte' : /refus|declin|afgewezen/.test(st) ? 'refuse' : 'envoye')
      : (bool(pick(o, 'paid', 'is_paid')) || /paid|payé|betaald/.test(st) ? 'paye' : 'envoye');
    const payments = kind === 'facture' ? (rm.payments || []).filter((x) => refId(x.invoice) === o.id && num(x.amount)).map((x) => ({ id: id('pay', x.id), date: (localIso(x.moment) || now).slice(0, 10), amount: round2(num(x.amount)), method: str(x.payment_import_source) || undefined, note: str(x.description) })) : [];
    docs.push({
      id: id(kind === 'devis' ? 'dq' : 'di', o.id), ...base(o), projectId, type, number, version: 1, status, note: 'Importé de Rentman',
      payments: payments.length ? payments : undefined,
      snapshot: {
        company: null, project: { number: p.number, name: p.name, venue: p.venue, start: p.start, end: p.end, discount: 0, externalRef: p.externalRef },
        subprojects: [], simpleLines: [{ label: `${p.name} (Rentman ${number})`, ht }],
        totalHT: ht, discountAmount: 0, vatRate: ht ? round2(((ttc - ht) / ht) * 100) : 0, vat: round2(ttc - ht), totalTTC: ttc,
        issuedAt: localIso(pick(o, 'date', 'invoice_date', 'quote_date', 'created')) || now,
        dueDate: localTime(pick(o, 'expiration', 'expiration_date', 'due_date'))?.slice(0, 10), hidePrices: false,
      },
    });
  };
  for (const q of rm.quotes || []) mkDoc(q, 'devis');
  for (const f of rm.invoices || []) mkDoc(f, 'facture');

  /* ---------- fichiers (documents des projets et de l'équipe) et photos du matériel ---------- */
  const fileTypes = { project: 'projects', subproject: 'subprojects', crew: 'crewmembers', crewmember: 'crewmembers', equipment: 'equipment', contact: 'contacts' };
  const photoOf = new Map((rm.equipment || []).map((e) => [refId(pick(e, 'image', 'photo', 'picture')), id('e', e.id)]).filter(([f]) => f));
  const files = [];
  let otherFiles = 0;
  for (const f of rm.files || []) {
    let [t, rid] = refType(pick(f, 'item', 'file_item', 'owner')) || [];
    if (!t && f.itemtype && refId(f.item)) { t = fileTypes[String(f.itemtype).toLowerCase()]; rid = refId(f.item); }
    const url = str(pick(f, 'url', 'download_url', 'path'));
    const meta = { fileId: f.id, url, name: str(pick(f, 'name', 'displayname', 'filename')) || `fichier-${f.id}`, type: str(pick(f, 'type', 'mime_type', 'mimetype')) || 'application/octet-stream', size: num(f.size), createdAt: localIso(f.created) || now };
    if (photoOf.has(f.id)) files.push({ ...meta, photoOf: photoOf.get(f.id) });
    else if (t === 'projects' || t === 'subprojects') { const pid = t === 'projects' ? rid : subProj.get(rid); if (pid) files.push({ ...meta, projectId: id('p', pid) }); else otherFiles++; }
    else if (t === 'crewmembers' || t === 'crew') files.push({ ...meta, projectId: '', personId: id('p', rid) });
    else if (t === 'equipment' && !photoOf.size) files.push({ ...meta, photoOf: id('e', rid) });
    else otherFiles++;
  }
  if (otherFiles) warn(`${otherFiles} fichier(s) rattaché(s) à autre chose qu'un projet, un membre de l'équipe ou un article : non repris`);

  // grilles de coefficients (groupes de facteurs : de N jours à M jours → coefficient) et comptes comptables
  const factorGroups = (rm.factorgroups || []).map((g) => {
    const rows = (rm.factors || []).filter((f) => refId(f.factor_group) === g.id).sort((a, b) => num(a.from_days) - num(b.from_days));
    const factors = [];
    for (const f of rows) for (let d = Math.max(1, num(f.from_days)); d <= Math.min(60, num(f.to_days) || num(f.from_days)); d++) factors[d - 1] = num(f.factor);
    const list = factors.map((x, i) => x ?? factors[i - 1] ?? 1);
    const last = list.length > 1 ? round2(list[list.length - 1] - list[list.length - 2]) : 0.5;
    return { id: id('fg', g.id), name: str(pick(g, 'name', 'displayname')) || `Grille ${g.id}`, factors: list.length ? list : [1], extraPerDay: last > 0 ? last : 0.5 };
  });
  const ledgers = (rm.ledgercodes || []).filter((l) => str(l.code)).map((l) => ({ id: id('lg', l.id), name: str(pick(l, 'displayname', 'name')) || str(l.code), code: str(l.code), side: l.is_debit && !l.is_credit ? 'debit' : 'credit' }));
  const settings = (projectTypes.length || depots.length || factorGroups.length || ledgers.length) ? [{ id: 'rm-settings', projectTypes, depots, factorGroups, ledgers }] : [];
  const data = { contacts, categories, equipment, units, people, vehicles, projects, subprojects, lines, crew, vehicleAssignments, costs, subrentals, repairs, unavailability, appointments, docs, settings };
  for (const [k, v] of Object.entries(data)) report.counts[k] = v.length;
  // liens vers des fiches absentes (droits de la clé API, collection non lue…)
  const has = (list) => new Set(list.map((x) => x.id));
  const eqIds = has(equipment), cIds = has(contacts), pIds = has(people);
  const missEq = lines.filter((l) => l.equipmentId && !eqIds.has(l.equipmentId)).length;
  if (missEq) warn(`${missEq} ligne(s) de matériel pointent vers un article absent de l'export (gardées comme lignes libres)`);
  for (const l of lines) if (l.equipmentId && !eqIds.has(l.equipmentId)) l.equipmentId = undefined;
  for (const p of projects) { if (p.clientId && !cIds.has(p.clientId)) p.clientId = undefined; if (p.venueId && !cIds.has(p.venueId)) p.venueId = undefined; }
  const lost = crew.filter((c) => c.personId && !pIds.has(c.personId)).length;
  if (lost) warn(`${lost} poste(s) avec un technicien absent de l'export (équipe non lue avec cette clé ?) : gardés sans technicien`);
  for (const c of crew) if (c.personId && !pIds.has(c.personId)) c.personId = undefined;
  for (const x of [...costs, ...subrentals, ...repairs]) if (x.supplierId && !cIds.has(x.supplierId)) x.supplierId = undefined;
  for (const sr of subrentals) for (const l of sr.lines) if (l.equipmentId && !eqIds.has(l.equipmentId)) l.equipmentId = undefined;
  for (const a of appointments) if (a.personIds) a.personIds = a.personIds.filter((p) => pIds.has(p));
  const repOk = repairs.filter((r) => eqIds.has(r.equipmentId));
  if (repOk.length < repairs.length) warn(`${repairs.length - repOk.length} réparation(s) d'un article absent de l'export : ignorée(s)`);
  data.repairs = repOk;
  data.unavailability = unavailability.filter((u) => pIds.has(u.personId));
  for (const e of equipment) if (e.accessories) { e.accessories = e.accessories.filter((a) => eqIds.has(a.equipmentId)); if (!e.accessories.length) e.accessories = undefined; }
  report.counts.repairs = data.repairs.length; report.counts.unavailability = data.unavailability.length;
  report.counts.settings = projectTypes.length + depots.length + factorGroups.length + ledgers.length;
  report.counts.files = files.filter((f) => !f.photoOf).length; report.counts.photos = files.filter((f) => f.photoOf).length;
  return { data, files, report };
}

function localIso(v) {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
