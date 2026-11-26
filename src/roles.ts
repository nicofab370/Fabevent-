import type { Role, User } from './types';

/** Pages accessibles par rôle (préfixes de routes). */
const ROLE_PATHS: Record<Role, string[]> = {
  admin: ['/'],
  warehouse: ['/entrepot', '/checklists', '/inventaire', '/materiel', '/transferts', '/penuries', '/q/'],
  subcontractor: ['/attribution', '/planning', '/materiel', '/q/'],
};
export const ROLE_DEFAULT: Record<Role, string> = { admin: '/', warehouse: '/entrepot', subcontractor: '/attribution' };

export function pathAllowed(path: string, role: Role): boolean {
  const ps = ROLE_PATHS[role];
  return ps[0] === '/' ? true : ps.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'));
}

/** L'entrepôt voit/modifie le matériel mais jamais les prix. */
export const canEditPrices = (u: User | null | undefined) => u?.role === 'admin';
/** Seul l'admin supprime des articles / gère les utilisateurs. */
export const canDeleteEquipment = (u: User | null | undefined) => u?.role === 'admin';
/** Le sous-traitant ne modifie rien (lecture seule). */
export const canEditEquipment = (u: User | null | undefined) => u?.role !== 'subcontractor';
/** Gestion des comptes : admin seulement. */
export const canManageUsers = (u: User | null | undefined) => u?.role === 'admin';
