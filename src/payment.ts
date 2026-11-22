/**
 * Paiement par virement : communication structurée belge et QR code EPC (SEPA).
 */
import QRCode from 'qrcode';
import type { VatRegime } from './types';

/** Communication structurée belge +++XXX/XXXX/XXXXX+++ (10 chiffres + clé modulo 97). */
export function structuredCommunication(seed: string): string {
  const digits = seed.replace(/\D/g, '').slice(-10).padStart(10, '0');
  const check = Number(digits) % 97 || 97;
  const s = digits + String(check).padStart(2, '0');
  return `+++${s.slice(0, 3)}/${s.slice(3, 7)}/${s.slice(7)}+++`;
}

export function isValidStructured(comm: string): boolean {
  const d = comm.replace(/\D/g, '');
  if (d.length !== 12) return false;
  const check = Number(d.slice(0, 10)) % 97 || 97;
  return check === Number(d.slice(10));
}

/** Contenu d'un QR code de virement SEPA (norme EPC069-12, version 002). */
export function epcPayload(p: { name: string; iban: string; bic?: string; amount: number; communication: string }): string {
  const iban = p.iban.replace(/\s/g, '').toUpperCase();
  const structured = /^\+\+\+/.test(p.communication);
  return [
    'BCD', '002', '1', 'SCT', (p.bic || '').replace(/\s/g, '').toUpperCase(), p.name.slice(0, 70), iban,
    p.amount > 0 ? `EUR${p.amount.toFixed(2)}` : '', '',
    // la communication structurée belge passe dans le champ « texte » (le champ référence est réservé au format RF)
    '', (structured ? p.communication.replace(/\D/g, '') : p.communication).slice(0, 140),
  ].join('\n');
}

/** QR code en SVG (synchrone, sans dépendance réseau). */
/** `margin` : zone blanche autour du QR, en modules (0 sur une étiquette : sa marge sert de zone blanche) */
export function qrSvg(text: string, sizePx = 120, margin = 2): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) d += `M${c + margin},${r + margin}h1v1h-1z`;
  const v = n + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="${v}" height="${v}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export const DEFAULT_VAT_MENTIONS: Record<Exclude<VatRegime, 'normal'>, string> = {
  autoliquidation: 'Autoliquidation — TVA due par le preneur (article 196 de la directive 2006/112/CE).',
  exonere: 'Exonération de TVA (article 44 du Code de la TVA).',
  hors_ue: 'Prestation hors champ de la TVA belge — preneur établi hors de l\'Union européenne (article 21, § 2 du Code de la TVA).',
};

/** Régime suggéré : client assujetti d'un autre pays de l'UE → autoliquidation. */
const EU = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
export function suggestRegime(clientCountry: string | undefined, clientVat: string | undefined, companyCountry = 'BE'): VatRegime {
  const cc = (clientCountry || clientVat?.slice(0, 2) || companyCountry).toUpperCase().slice(0, 2);
  if (cc === companyCountry.toUpperCase()) return 'normal';
  if (EU.includes(cc)) return clientVat ? 'autoliquidation' : 'normal';
  return 'hors_ue';
}
