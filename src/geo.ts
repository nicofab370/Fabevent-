/**
 * Distance routière dépôt → lieu, via OpenStreetMap (sans clé) :
 * géocodage Nominatim puis itinéraire OSRM. Nécessite une connexion.
 */
import type { Settings, Vehicle, VehicleAssignment } from './types';
import { daysBetween, round2 } from './utils';

async function geocode(address: string): Promise<{ lat: number; lon: number }> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, { headers: { 'Accept-Language': 'fr' } });
  if (!r.ok) throw new Error('service de cartographie indisponible');
  const j = (await r.json()) as { lat: string; lon: string }[];
  if (!j.length) throw new Error(`adresse introuvable : « ${address} »`);
  return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface Route { km: number; minutes: number; estimated: boolean }

/** Distance et durée en voiture ; repli sur une estimation (vol d'oiseau × 1,3) si l'itinéraire échoue. */
export async function drivingRoute(from: string, to: string): Promise<Route> {
  if (!navigator.onLine) throw new Error('pas de connexion internet : saisis les km à la main');
  const a = await geocode(from);
  await new Promise((r) => setTimeout(r, 1100)); // 1 requête/seconde maximum (règles Nominatim)
  const b = await geocode(to);
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
    const j = (await r.json()) as { code: string; routes?: { distance: number; duration: number }[] };
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error('itinéraire introuvable');
    return { km: Math.round(j.routes[0].distance / 1000), minutes: Math.round(j.routes[0].duration / 60), estimated: false };
  } catch {
    const km = Math.round(haversineKm(a, b) * 1.3);
    return { km, minutes: Math.round(km / 70 * 60), estimated: true };
  }
}

/** Km facturés : distance × 2 (aller + retour) × nombre d'allers-retours. */
export function tripKm(distanceKm: number | undefined, trips: number) {
  return Math.round((distanceKm || 0) * 2 * trips);
}

export function perKmFor(v: Pick<VehicleAssignment, 'perKm'>, vehicle: Vehicle | undefined, s: Settings) {
  return v.perKm ?? vehicle?.pricePerKm ?? s.pricePerKm ?? 0;
}

/** Prix d'un transport : forfait journalier du véhicule × jours + km × prix au km. */
export function vehiclePrice(v: Pick<VehicleAssignment, 'start' | 'end' | 'km' | 'perKm'>, vehicle: Vehicle | undefined, s: Settings) {
  return round2((vehicle?.dailyPrice || 0) * daysBetween(v.start, v.end) + (v.km || 0) * perKmFor(v, vehicle, s));
}
