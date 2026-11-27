/** Petit compte Rentman fictif, au format de l'API v3 (références « /type/id », dates avec fuseau). */
export const RENTMAN = {
  statuses: [{ id: 1, name: 'Option' }, { id: 2, name: 'Confirmé' }, { id: 3, name: 'Annulé' }],
  contacts: [
    { id: 10, displayname: 'Ville de Liège', email_1: 'events@liege.be', phone_1: '04 221 00 00', visit_street: 'Place du Marché', visit_number: '2', visit_postalcode: '4000', visit_city: 'Liège', visit_country: 'be', vat_code: 'BE0207319313' },
    { id: 11, displayname: 'Salle La Boverie', visit_street: 'Parc de la Boverie', visit_number: '3', visit_postalcode: '4020', visit_city: 'Liège' },
  ],
  contactpersons: [{ id: 100, contact: '/contacts/10', firstname: 'Anne', lastname: 'Dupont', email: 'anne@liege.be', function: 'Régie' }],
  folders: [{ id: 1, name: 'Son', parent: null }, { id: 2, name: 'Micros', parent: '/folders/1' }, { id: 3, name: 'Sans fil', parent: '/folders/2' }],
  equipment: [
    { id: 500, name: 'Shure SM58', code: 'SM58', folder: '/folders/2', quantity: 12, price: 5, weight: 0.3, new_price: 120 },
    { id: 501, name: 'L-Acoustics X12', code: 'X12', folder: '/folders/1', quantity: 8, price: 45, weight: 20 },
    { id: 502, name: 'Pack voix', code: 'PV', folder: '/folders/1', price: 20 },
    { id: 503, name: 'Gaffer', code: 'GAF', rental_sales: 'sale', price: 9 },
  ],
  equipmentsetscontent: [{ id: 1, equipment_set: '/equipment/502', equipment: '/equipment/500', quantity: 2 }],
  serialnumbers: [{ id: 900, equipment: '/equipment/501', serial: 'X12-001', ref: '1', active: true }, { id: 901, equipment: '/equipment/501', serial: 'X12-002', ref: '2', active: false }],
  crewmembers: [{ id: 70, displayname: 'Karim B.', email: 'karim@ex.be', phone: '0470' }],
  vehicles: [{ id: 80, name: 'Camion 20 m³', license_plate: '1-ABC-123' }],
  projects: [{ id: 300, number: '2026-041', name: 'Fête de la musique', customer: '/contacts/10', location: '/contacts/11', reference: 'BC-77', usageperiod_start: '2026-06-21T14:00:00+02:00', usageperiod_end: '2026-06-21T23:30:00+02:00', cust_contact: '/contactpersons/100' }],
  subprojects: [
    { id: 310, project: '/projects/300', name: 'Grande scène', order: 1, status: '/statuses/2', planperiod_start: '2026-06-21T08:00:00+02:00', planperiod_end: '2026-06-22T02:00:00+02:00', usageperiod_start: '2026-06-21T14:00:00+02:00', usageperiod_end: '2026-06-21T23:30:00+02:00' },
    { id: 311, project: '/projects/300', name: 'Scène B', order: 2, status: '/statuses/3' },
  ],
  projectequipmentgroup: [{ id: 400, name: 'Son', order: 1, subproject: '/subprojects/310' }],
  projectequipment: [
    { id: 600, project: '/projects/300', equipment: '/equipment/501', equipment_group: '/projectequipmentgroup/400', quantity: 4, quantity_total: 4, unit_price: 45, discount: 0.1, order: 1, internal_remark: 'Prendre les housses' },
    { id: 601, project: '/projects/300', equipment: '/equipment/502', equipment_group: '/projectequipmentgroup/400', quantity_total: 1, unit_price: 20, order: 2 },
    { id: 602, project: '/projects/300', equipment: '/equipment/500', equipment_group: '/projectequipmentgroup/400', parent: '/projectequipment/601', quantity_total: 2, unit_price: 0, order: 3 },
    { id: 603, project: '/projects/300', equipment: '/equipment/503', equipment_group: '/projectequipmentgroup/400', quantity_total: 2, unit_price: 9, is_option: true, order: 4 },
  ],
  projectfunctions: [{ id: 700, project: '/projects/300', subproject: '/subprojects/310', name: 'Ingé son', quantity: 2, price: 350, planperiod_start: '2026-06-21T12:00:00+02:00', planperiod_end: '2026-06-22T00:30:00+02:00' }],
  projectcrew: [{ id: 710, function: '/projectfunctions/700', crewmember: '/crewmembers/70' }],
  projectvehicles: [{ id: 800, project: '/projects/300', subproject: '/subprojects/310', vehicle: '/vehicles/80', planperiod_start: '2026-06-21T07:00:00+02:00', planperiod_end: '2026-06-22T03:00:00+02:00' }],
};
