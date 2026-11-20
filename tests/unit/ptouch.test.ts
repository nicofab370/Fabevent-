import { describe, expect, it } from 'vitest';
import { type Bitmap, encodeJob, packBits, parseStatus, rasterLine, tapeDots, unpackBits } from '../../src/ptouch';

const hex = (a: ArrayLike<number>) => Array.from(a, (v) => v.toString(16).padStart(2, '0')).join(' ');
const indexOf = (hay: Uint8Array, needle: number[], from = 0) => {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
};

/** Bande de test : une colonne pleine en x = 0, rien ailleurs. */
function band(width: number, height: number, fill: (x: number, y: number) => boolean): Bitmap {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y) ? 1 : 0;
  return { width, height, data };
}

describe('PackBits', () => {
  it('compresse et décompresse sans perte', () => {
    const samples = [
      new Uint8Array(16),
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      Uint8Array.from([0, 0, 0, 0, 0xff, 0xff, 1, 2, 3, 3, 3, 0, 0, 0, 0, 9]),
      Uint8Array.from({ length: 300 }, (_, i) => (i % 7 === 0 ? 5 : i & 0xff)),
    ];
    for (const s of samples) expect(Array.from(unpackBits(packBits(s)))).toEqual(Array.from(s));
  });
  it('ligne blanche de 16 octets → 2 octets (F1 00)', () => {
    expect(hex(packBits(new Uint8Array(16)))).toBe('f1 00');
  });
});

describe('Ligne raster', () => {
  it('centre la bande sur la tête de 128 points (ruban 12 mm : points 32 à 95)', () => {
    expect(tapeDots(12)).toBe(64);
    const b = band(1, 64, () => true);
    const l = rasterLine(b, 0);
    expect(l.length).toBe(16);
    expect(hex(l)).toBe('00 00 00 00 ff ff ff ff ff ff ff ff 00 00 00 00');
  });
  it('le premier point de la bande est le bit de poids fort', () => {
    const b = band(1, 128, (_x, y) => y === 0);
    expect(rasterLine(b, 0)[0]).toBe(0x80);
    const b9 = band(1, 48, (_x, y) => y === 0); // 9 mm : décalage de 40 points
    expect(rasterLine(b9, 0)[5]).toBe(0x80);
  });
});

describe('Travail d\'impression PT-P750W', () => {
  const b = band(40, 64, (x) => x < 10);
  const job = encodeJob([b, b], { tapeMm: 12, mediaType: 0x01 });

  it('commence par 100 octets nuls, ESC @ et le mode raster', () => {
    expect(job.slice(0, 100).every((v) => v === 0)).toBe(true);
    expect(hex(job.slice(100, 106))).toBe('1b 40 1b 69 61 01');
  });
  it('envoie les infos d\'impression : largeur 12 mm, 40 lignes, 1re page puis suivante', () => {
    const i = indexOf(job, [0x1b, 0x69, 0x7a]);
    expect(hex(job.slice(i, i + 13))).toBe('1b 69 7a 86 01 0c 00 28 00 00 00 00 00');
    const j = indexOf(job, [0x1b, 0x69, 0x7a], i + 1);
    expect(job[j + 11]).toBe(1);
  });
  it('découpe auto après chaque étiquette, sans chaînage, compression', () => {
    expect(indexOf(job, [0x1b, 0x69, 0x4d, 0x40])).toBeGreaterThan(0);
    expect(indexOf(job, [0x1b, 0x69, 0x41, 0x01])).toBeGreaterThan(0);
    expect(indexOf(job, [0x1b, 0x69, 0x4b, 0x08])).toBeGreaterThan(0);
    expect(indexOf(job, [0x1b, 0x69, 0x64, 0x0e, 0x00])).toBeGreaterThan(0);
    expect(indexOf(job, [0x4d, 0x02])).toBeGreaterThan(0);
  });
  it('lignes noires en G, blanches en Z, FF entre étiquettes et Ctrl-Z à la fin', () => {
    const start = indexOf(job, [0x4d, 0x02]) + 2;
    // 10 colonnes noires : G 06 00 + PackBits(00 00 00 00 ff×8 00 00 00 00)
    expect(hex(job.slice(start, start + 3))).toBe('47 06 00');
    expect(hex(job.slice(start + 3, start + 9))).toBe('fd 00 f9 ff fd 00');
    const afterBlack = start + 10 * 9;
    expect(Array.from(job.slice(afterBlack, afterBlack + 30)).every((v) => v === 0x5a)).toBe(true);
    expect(job[afterBlack + 30]).toBe(0x0c);
    expect(job[job.length - 1]).toBe(0x1a);
    expect(job.filter((v, i) => v === 0x0c && job[i - 1] === 0x5a).length).toBe(1);
  });
  it('options : demi-découpe, chaînage, sans découpe', () => {
    const half = encodeJob([b], { tapeMm: 12, halfCut: true });
    expect(indexOf(half, [0x1b, 0x69, 0x4b, 0x0c])).toBeGreaterThan(0);
    const chain = encodeJob([b], { tapeMm: 24, chain: true, autoCut: false });
    expect(indexOf(chain, [0x1b, 0x69, 0x4b, 0x00])).toBeGreaterThan(0);
    expect(indexOf(chain, [0x1b, 0x69, 0x4d, 0x00])).toBeGreaterThan(0);
    expect(indexOf(chain, [0x1b, 0x69, 0x41])).toBe(-1);
    const i = indexOf(chain, [0x1b, 0x69, 0x7a]);
    expect(chain[i + 3]).toBe(0x84); // type de support inconnu : non contrôlé
    expect(chain[i + 5]).toBe(24);
  });
});

describe('Statut', () => {
  const reply = (patch: Record<number, number>) => {
    const b = new Uint8Array(32);
    b[0] = 0x80; b[1] = 0x20; b[2] = 0x42; b[3] = 0x30;
    for (const [k, v] of Object.entries(patch)) b[Number(k)] = v;
    return b;
  };
  it('lit la largeur et le type du ruban', () => {
    const s = parseStatus(reply({ 10: 12, 11: 0x01, 24: 0x01, 25: 0x08 }))!;
    expect(s.tapeMm).toBe(12);
    expect(s.mediaType).toBe(1);
    expect(s.errors).toEqual([]);
  });
  it('traduit les erreurs', () => {
    const s = parseStatus(reply({ 8: 0x01, 9: 0x10, 18: 0x02 }))!;
    expect(s.type).toBe(2);
    expect(s.errors).toEqual(['pas de ruban', 'capot ouvert']);
  });
  it('refuse une réponse invalide', () => {
    expect(parseStatus(new Uint8Array(10))).toBeNull();
    expect(parseStatus(new Uint8Array(32))).toBeNull();
  });
});
