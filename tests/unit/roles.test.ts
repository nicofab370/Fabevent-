import { describe, expect, it } from 'vitest';
import { canDeleteEquipment, canEditEquipment, canEditPrices, canManageUsers, pathAllowed, ROLE_DEFAULT } from '../../src/roles';
import { hashPass } from '../../src/auth';
import type { User } from '../../src/types';

const u = (role: User['role']): User => ({ id: 'u', createdAt: '', updatedAt: '', name: 'x', email: 'x@x', salt: 's', passHash: 'h', role, active: true });

describe('rôles et permissions', () => {
  it('admin : accès total, prix, suppression, utilisateurs', () => {
    expect(pathAllowed('/projets/abc', 'admin')).toBe(true);
    expect(pathAllowed('/parametres', 'admin')).toBe(true);
    expect(canEditPrices(u('admin'))).toBe(true);
    expect(canDeleteEquipment(u('admin'))).toBe(true);
    expect(canEditEquipment(u('admin'))).toBe(true);
    expect(canManageUsers(u('admin'))).toBe(true);
    expect(ROLE_DEFAULT.admin).toBe('/');
  });
  it('entrepôt : entrepôt/inventaire/matériel, pas les prix ni les suppressions', () => {
    for (const p of ['/entrepot', '/entrepot/x', '/checklists', '/inventaire', '/materiel', '/materiel/x', '/transferts', '/penuries', '/q/ABC'])
      expect(pathAllowed(p, 'warehouse')).toBe(true);
    for (const p of ['/', '/projets', '/projets/x', '/comptabilite', '/parametres', '/equipe', '/contacts'])
      expect(pathAllowed(p, 'warehouse')).toBe(false);
    expect(canEditPrices(u('warehouse'))).toBe(false);
    expect(canEditEquipment(u('warehouse'))).toBe(true);
    expect(canDeleteEquipment(u('warehouse'))).toBe(false);
    expect(canManageUsers(u('warehouse'))).toBe(false);
    expect(ROLE_DEFAULT.warehouse).toBe('/entrepot');
  });
  it('sous-traitant : seulement son planning, le planning et le matériel (lecture seule)', () => {
    for (const p of ['/attribution', '/planning', '/materiel', '/materiel/x', '/q/ABC'])
      expect(pathAllowed(p, 'subcontractor')).toBe(true);
    for (const p of ['/', '/projets', '/entrepot', '/inventaire', '/equipe', '/parametres', '/comptabilite'])
      expect(pathAllowed(p, 'subcontractor')).toBe(false);
    expect(canEditEquipment(u('subcontractor'))).toBe(false);
    expect(canEditPrices(u('subcontractor'))).toBe(false);
    expect(canManageUsers(u('subcontractor'))).toBe(false);
    expect(ROLE_DEFAULT.subcontractor).toBe('/attribution');
  });
});

describe('hachage des mots de passe', () => {
  it('déterministe avec le sel, différent sans sel', async () => {
    const h1 = await hashPass('secret', 'sel1');
    expect(h1).toBe(await hashPass('secret', 'sel1'));
    expect(h1).not.toBe(await hashPass('secret', 'sel2'));
    expect(h1).not.toBe(await hashPass('autre', 'sel1'));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
