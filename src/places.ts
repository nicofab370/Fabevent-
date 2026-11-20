import type { Contact, ContactPerson, Department, Project, VenueSpot } from './types';
import { uid } from './utils';

const join = (...xs: (string | undefined)[]) => xs.filter((x) => x && x.trim()).join(', ');

/** Adresse d'un lieu ou de l'un de ses endroits (l'endroit sans adresse reprend celle du lieu). */
export function placeAddress(venue?: Contact, spot?: VenueSpot): string {
  if (spot && (spot.address || spot.city)) return join(spot.address, spot.postalCode, spot.city);
  return venue ? join(venue.address, venue.postalCode, venue.city) : '';
}

/** « Parc de la Boverie — Scène acoustique » */
export function placeName(venue?: Contact, spot?: VenueSpot): string {
  return [venue?.company, spot?.name].filter(Boolean).join(' — ');
}

export const spotOf = (venue?: Contact, id?: string) => (id ? venue?.spots?.find((s) => s.id === id) : undefined);

/** L'endroit a-t-il une adresse différente de celle du lieu ? */
export const ownAddress = (spot?: VenueSpot) => !!(spot && (spot.address || spot.city));

/** Donne un identifiant aux interlocuteurs qui n'en ont pas encore (anciennes fiches). */
export function withPersonIds<T extends Pick<Contact, 'persons'>>(c: T): T {
  if (!c.persons?.some((p) => !p.id)) return c;
  return { ...c, persons: c.persons.map((p) => (p.id ? p : { ...p, id: uid() })) };
}

export const deptOf = (client?: Contact, id?: string): Department | undefined => (id ? client?.departments?.find((d) => d.id === id) : undefined);

/** Interlocuteur du projet (par identifiant, sinon par nom pour les anciens projets). */
export function projectPerson(client: Contact | undefined, p: Pick<Project, 'contactPersonId' | 'contactPerson'>): ContactPerson | undefined {
  return client?.persons?.find((x) => (p.contactPersonId ? x.id === p.contactPersonId : x.name === p.contactPerson));
}

/** Interlocuteurs regroupés par service (le groupe sans service en premier). */
export function personsByDepartment(client?: Contact): { dept?: Department; persons: ContactPerson[] }[] {
  if (!client) return [];
  const persons = client.persons || [];
  const depts = client.departments || [];
  const groups = [
    { dept: undefined, persons: persons.filter((x) => !x.departmentId || !depts.some((d) => d.id === x.departmentId)) },
    ...depts.map((dept) => ({ dept, persons: persons.filter((x) => x.departmentId === dept.id) })),
  ];
  return groups.filter((g) => g.dept || g.persons.length);
}

/**
 * Valeur d'une option du sélecteur « Interlocuteur » : « p:<id> » pour une personne, « d:<id> » pour un service seul.
 * Renvoie les champs du projet à mettre à jour.
 */
export function pickContact(client: Contact | undefined, value: string): Pick<Project, 'contactPerson' | 'contactPersonId' | 'departmentId'> {
  if (value.startsWith('p:') || value.startsWith('n:')) {
    const p = client?.persons?.find((x) => (value.startsWith('p:') ? x.id === value.slice(2) : x.name === value.slice(2)));
    return { contactPerson: p?.name, contactPersonId: p?.id, departmentId: p?.departmentId };
  }
  if (value.startsWith('d:')) return { contactPerson: undefined, contactPersonId: undefined, departmentId: value.slice(2) };
  return { contactPerson: undefined, contactPersonId: undefined, departmentId: undefined };
}

export function contactValue(client: Contact | undefined, p: Pick<Project, 'contactPersonId' | 'contactPerson' | 'departmentId'>): string {
  const person = projectPerson(client, p);
  if (person) return personValue(person);
  if (p.departmentId) return 'd:' + p.departmentId;
  return '';
}

export const personValue = (p: ContactPerson) => (p.id ? 'p:' + p.id : 'n:' + p.name);
