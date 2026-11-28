import type { CustomRole, Permission, Role, User } from './types';

/** Pages accessibles par rôle (préfixes de routes). */
const ROLE_PATHS: Record<Role, string[]> = {
  admin: ['/'],
  warehouse: ['/entrepot', '/checklists', '/inventaire', '/materiel', '/transferts', '/penuries', '/q/'],
  subcontractor: ['/attribution', '/planning', '/materiel', '/q/'],
};
export const ROLE_DEFAULT: Record<Role, string> = { admin: '/', warehouse: '/entrepot', subcontractor: '/attribution' };

/** Rôles personnalisés (Paramètres), mis à jour par l'application quand les paramètres changent. */
let customRoles: CustomRole[] = [];
let currentCustom: CustomRole | undefined;
export function setCustomRoles(list: CustomRole[] = [], user?: User | null) {
  customRoles = list;
  currentCustom = user?.customRoleId && user.role !== 'admin' ? list.find((r) => r.id === user.customRoleId) : undefined;
}
const customOf = (u?: User | null) => (u?.customRoleId && u.role !== 'admin' ? customRoles.find((r) => r.id === u.customRoleId) : undefined);
const inPaths = (path: string, ps: string[]) => ps.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'));

export function pathAllowed(path: string, role: Role): boolean {
  if (currentCustom && role === currentCustom.base) return path === '/notifications' || path.startsWith('/q/') || inPaths(path, currentCustom.paths);
  const ps = ROLE_PATHS[role];
  return ps[0] === '/' ? true : inPaths(path, ps);
}
/** Page d'accueil d'un rôle (rôle personnalisé : sa première page). */
export const roleHome = (role: Role) => (currentCustom && role === currentCustom.base && currentCustom.paths[0]) || ROLE_DEFAULT[role];
/** Droit coché sur le rôle personnalisé de l'utilisateur (sinon : selon son rôle standard). */
export const hasPerm = (u: User | null | undefined, p: Permission, fallback: boolean) => { const c = customOf(u); return c ? c.perms.includes(p) : fallback; };

/** L'entrepôt voit/modifie le matériel mais jamais les prix. */
export const canEditPrices = (u: User | null | undefined) => hasPerm(u, 'prix', u?.role === 'admin');
/** Seul l'admin supprime des articles / gère les utilisateurs. */
export const canDeleteEquipment = (u: User | null | undefined) => hasPerm(u, 'supprimer', u?.role === 'admin');
/** Le sous-traitant ne modifie rien (lecture seule). */
export const canEditEquipment = (u: User | null | undefined) => u?.role !== 'subcontractor';
/** Gestion des comptes : admin seulement. */
export const canManageUsers = (u: User | null | undefined) => hasPerm(u, 'configuration', u?.role === 'admin');
