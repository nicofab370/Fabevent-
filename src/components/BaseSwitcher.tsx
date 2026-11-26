import { useEffect, useState } from 'react';
import { currentWorkspace } from '../db';
import { knownBases, openBase, refreshBases, type ServerBase } from '../serverAuth';

/**
 * « Base : … » en haut du menu. Si ton email a un compte (même mot de passe) dans d'autres bases du serveur,
 * y compris des bases gérées par d'autres, on passe de l'une à l'autre ici, sans se reconnecter.
 */
export function BaseSwitcher() {
  const [bases, setBases] = useState<ServerBase[]>(knownBases);
  useEffect(() => { refreshBases().then(setBases); }, []);
  const ws = currentWorkspace();
  const here = bases.find((b) => b.ws === ws);
  if (bases.length < 2 || !here) return <div className="ws">Base : {here?.name || ws}</div>;
  return (
    <label className="ws ws-switch">
      Base :{' '}
      <select value={ws} onChange={(e) => { const b = bases.find((x) => x.ws === e.target.value); if (b) openBase(b); }}
        aria-label="Changer de base" title="Bases où ton email a un compte (même mot de passe), y compris celles gérées par d'autres">
        {bases.map((b) => <option key={b.ws} value={b.ws}>{b.name}{b.role === 'warehouse' ? ' (entrepôt)' : ''}</option>)}
      </select>
    </label>
  );
}
