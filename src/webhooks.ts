/**
 * Webhooks : à chaque événement choisi (Paramètres → Intégrations), FabEvent appelle l'adresse donnée
 * (Zapier, Make, n8n…) avec un petit JSON : {event, at, data}. Envoi « au mieux » : une erreur ne bloque rien.
 */
import { getSettings } from './db';
import type { WebhookEvent } from './types';

export async function fireWebhook(event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
  const s = await getSettings();
  const hooks = (s.webhooks || []).filter((h) => h.events.includes(event) && /^https:\/\//i.test(h.url));
  await Promise.all(hooks.map((h) =>
    // text/plain + no-cors : pas de requête préalable du navigateur, accepté par Zapier et Make
    fetch(h.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ event, at: new Date().toISOString(), company: s.company.name, data }) })
      .catch(() => undefined)));
  return hooks.length;
}
