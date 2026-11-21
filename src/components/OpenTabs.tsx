import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { currentWorkspace, db } from '../db';
import { Icon, type IconName } from './Icon';

/*
 * Onglets des fiches ouvertes (comme dans Rentman) : chaque projet, article, lieu, sous-location,
 * checklist ou document ouvert reste en onglet en haut de l'écran. On peut revenir à la liste
 * puis rouvrir la fiche d'un clic, sur le même onglet interne (?onglet=…) et au même endroit de la page.
 * Mémorisé par base, dans ce navigateur.
 */

interface OpenTab { key: string; path: string; scroll?: number }

const KINDS: { re: RegExp; kind: string; icon: IconName; list: string }[] = [
  { re: /^\/projets\/([^/]+)$/, kind: 'projet', icon: 'folder', list: '/projets' },
  { re: /^\/materiel\/([^/]+)$/, kind: 'materiel', icon: 'box', list: '/materiel' },
  { re: /^\/lieux\/([^/]+)$/, kind: 'lieu', icon: 'building', list: '/lieux' },
  { re: /^\/souslocations\/([^/]+)$/, kind: 'sousloc', icon: 'swap', list: '/souslocations' },
  { re: /^\/entrepot\/([^/]+)$/, kind: 'prepa', icon: 'scan', list: '/entrepot' },
  { re: /^\/checklists\/([^/]+)$/, kind: 'checklist', icon: 'checklist', list: '/checklists' },
  { re: /^\/documents\/([^/]+)$/, kind: 'document', icon: 'file', list: '/projets' },
];
const MAX = 12;

const parse = (pathname: string) => {
  for (const k of KINDS) {
    const m = pathname.match(k.re);
    if (m) return { ...k, id: decodeURIComponent(m[1]), key: `${k.kind}:${decodeURIComponent(m[1])}` };
  }
  return null;
};
const kindOf = (key: string) => KINDS.find((k) => key.startsWith(k.kind + ':'))!;
const idOf = (key: string) => key.slice(key.indexOf(':') + 1);

const storeKey = () => `fabevent.tabs.${currentWorkspace()}`;
const load = (): OpenTab[] => {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey()) || '[]');
    return Array.isArray(v) ? v.filter((t) => t && typeof t.key === 'string' && typeof t.path === 'string' && KINDS.some((k) => t.key.startsWith(k.kind + ':'))) : [];
  } catch { return []; }
};
const save = (tabs: OpenTab[]) => { try { localStorage.setItem(storeKey(), JSON.stringify(tabs)); } catch { /* stockage indisponible */ } };

/** titre de l'onglet ; null si la fiche n'existe plus */
async function titleOf(key: string): Promise<string | null> {
  const id = idOf(key);
  switch (kindOf(key).kind) {
    case 'projet': { const p = await db.projects.get(id); return p ? p.name || p.number : null; }
    case 'materiel': { const e = await db.equipment.get(id); return e ? e.name : null; }
    case 'lieu': { const c = await db.contacts.get(id); return c ? c.company || 'Lieu' : null; }
    case 'sousloc': { const s = await db.subrentals.get(id); return s ? `Sous-location ${s.number}` : null; }
    case 'prepa': {
      const sp = await db.subprojects.get(id);
      if (!sp) return null;
      const p = await db.projects.get(sp.projectId);
      return `Préparation · ${p?.name || sp.name}`;
    }
    case 'checklist': { const c = await db.checklists.get(id); return c ? c.title || 'Checklist' : null; }
    case 'document': { const d = await db.docs.get(id); return d ? `Document ${d.number}` : null; }
  }
  return null;
}

export function OpenTabs() {
  const loc = useLocation();
  const nav = useNavigate();
  const [tabs, setTabs] = useState<OpenTab[]>(load);
  const ws = currentWorkspace();
  const wsRef = useRef(ws);
  const cur = parse(loc.pathname);
  const prevKey = useRef<string | null>(null);
  const restore = useRef<number | null>(null);
  const lastY = useRef(0);
  useEffect(() => {
    const on = () => { lastY.current = window.scrollY; };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // changement de base : on recharge ses onglets
  useEffect(() => { if (wsRef.current !== ws) { wsRef.current = ws; setTabs(load()); } }, [ws]);

  // la fiche affichée devient (ou reste) un onglet, avec son onglet interne
  useEffect(() => {
    const leaving = prevKey.current;
    const y = lastY.current;
    setTabs((list) => {
      let next = list.map((t) => (t.key === leaving && leaving !== cur?.key ? { ...t, scroll: y } : t));
      if (cur) {
        const path = loc.pathname + loc.search;
        const i = next.findIndex((t) => t.key === cur.key);
        if (i >= 0) next = next.map((t, j) => (j === i ? { ...t, path } : t));
        else {
          next = [...next, { key: cur.key, path }];
          while (next.length > MAX) next.splice(next.findIndex((t) => t.key !== cur.key), 1);
        }
      }
      save(next);
      return next;
    });
    prevKey.current = cur?.key ?? null;
    if (restore.current != null) {
      const s = restore.current;
      restore.current = null;
      // la page se dessine depuis la base : on attend un peu avant de redescendre
      setTimeout(() => window.scrollTo(0, s), 120);
    }
  }, [loc.pathname, loc.search, cur?.key]);

  const titles = useLiveQuery(async () => {
    const out: Record<string, string | null> = {};
    for (const t of tabs) out[t.key] = await titleOf(t.key);
    return out;
  }, [tabs.map((t) => t.key).join('|')]);

  // fiche supprimée : l'onglet disparaît
  useEffect(() => {
    if (!titles) return;
    const gone = tabs.filter((t) => titles[t.key] === null && t.key !== cur?.key).map((t) => t.key);
    if (gone.length) setTabs((l) => { const n = l.filter((t) => !gone.includes(t.key)); save(n); return n; });
  }, [titles]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (t: OpenTab) => {
    if (t.key === cur?.key) return;
    restore.current = t.scroll ?? 0;
    nav(t.path);
  };
  const close = (t: OpenTab) => {
    const i = tabs.findIndex((x) => x.key === t.key);
    const rest = tabs.filter((x) => x.key !== t.key);
    setTabs(rest);
    save(rest);
    if (t.key === cur?.key) {
      prevKey.current = null;
      const neighbour = rest[i] || rest[i - 1];
      if (neighbour) { restore.current = neighbour.scroll ?? 0; nav(neighbour.path); } else nav(kindOf(t.key).list);
    }
  };
  const closeAll = () => {
    setTabs([]); save([]);
    prevKey.current = null;
    if (cur) nav(cur.list);
  };

  if (!tabs.length) return null;
  return (
    <div className="open-tabs no-print" role="tablist" aria-label="Fiches ouvertes">
      {tabs.map((t) => {
        const active = t.key === cur?.key;
        const title = titles?.[t.key] ?? '…';
        return (
          <div key={t.key} className={'otab' + (active ? ' active' : '')} role="tab" aria-selected={active}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(t); } }}>
            <button type="button" className="otab-open" title={title} onClick={() => open(t)}>
              <Icon name={kindOf(t.key).icon} /><span>{title}</span>
            </button>
            <button type="button" className="otab-x" aria-label={`Fermer l'onglet ${title}`} onClick={() => close(t)}><Icon name="x" /></button>
          </div>
        );
      })}
      {tabs.length > 1 && <button type="button" className="otab-all" onClick={closeAll} title="Fermer tous les onglets">Tout fermer</button>}
    </div>
  );
}
