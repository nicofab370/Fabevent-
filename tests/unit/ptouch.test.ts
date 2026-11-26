import { describe, expect, it } from 'vitest';
import { type Bitmap, type JobOptions, TAPES, compressLine, encodePage, jobStart, packBits, parseStatus, rasterLine, tapeDots } from '../../src/ptouch';

/** Décodeur PackBits (contrôle de l'encodage). */
function unpackBits(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const n = src[i++];
    if (n < 128) { out.push(...src.subarray(i, i + n + 1)); i += n + 1; }
    else if (n > 128) { const v = src[i++]; for (let k = 0; k < 257 - n; k++) out.push(v); }
  }
  return Uint8Array.from(out);
}

/** Travail complet : début + une page par étiquette (comme l'envoi USB, page par page). */
function encodeJob(pages: Bitmap[], o: JobOptions): Uint8Array {
  const parts = [jobStart(), ...pages.map((p, i) => encodePage(p, i, i === pages.length - 1, o))];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let k = 0;
  for (const part of parts) { out.set(part, k); k += part.length; }
  return out;
}


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
  it('jamais plus de 17 octets par ligne (règle Brother) et toujours décodable', () => {
    for (let seed = 0; seed < 3000; seed++) {
      const line = Uint8Array.from({ length: 16 }, (_, i) => ((seed * 7919 + i * 104729) >> (i % 5)) % (seed % 3 ? 2 : 256));
      const c = compressLine(line);
      expect(c.length).toBeLessThanOrEqual(17);
      expect(Array.from(unpackBits(c))).toEqual(Array.from(line));
    }
    // pire cas : paires répétées alternées → envoyée en clair (0F + 16 octets)
    const worst = Uint8Array.from([1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 7, 8, 9, 9, 10, 11]);
    expect(packBits(worst).length).toBeGreaterThan(16);
    expect(hex(compressLine(worst).slice(0, 2))).toBe('0f 01');
    expect(compressLine(worst).length).toBe(17);
  });
  it('ligne blanche de 16 octets → 2 octets (F1 00)', () => {
    expect(hex(packBits(new Uint8Array(16)))).toBe('f1 00');
  });
});

describe('Ligne raster', () => {
  it('table officielle Brother : marges gauche/droite en points (§ 2.3.5)', () => {
    const official: Record<number, [number, number]> = { 3.5: [52, 24], 6: [48, 32], 9: [39, 50], 12: [29, 70], 18: [8, 112], 24: [0, 128] };
    for (const t of TAPES) {
      const [margin, dots] = official[t.mm];
      expect(t.dots).toBe(dots);
      const l = rasterLine(band(1, t.dots, () => true), 0);
      const on = [...Array(128).keys()].filter((d) => l[d >> 3] & (0x80 >> (d & 7)));
      expect(on[0]).toBe(margin); // premier point imprimé = marge gauche officielle
      expect(127 - on[on.length - 1]).toBe(margin); // marge droite identique
      expect(on.length).toBe(dots);
    }
  });
  it('ruban 12 mm : points 29 à 98', () => {
    expect(tapeDots(12)).toBe(70);
    expect(hex(rasterLine(band(1, 70, () => true), 0))).toBe('00 00 00 07 ff ff ff ff ff ff ff ff e0 00 00 00');
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
  const job = encodeJob([b, b], { tapeMm: 12 });

  it('commence par 100 octets nuls, ESC @ et le mode raster', () => {
    expect(job.slice(0, 100).every((v) => v === 0)).toBe(true);
    expect(hex(job.slice(100, 106))).toBe('1b 40 1b 69 61 01');
  });
  it('envoie les infos d\'impression comme l\'exemple Brother : largeur 12 mm, 40 lignes, 1re page puis suivante', () => {
    const i = indexOf(job, [0x1b, 0x69, 0x7a]);
    expect(hex(job.slice(i, i + 13))).toBe('1b 69 7a 84 00 0c 00 28 00 00 00 00 00');
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
  it('chaque étiquette répète les codes de contrôle (mode raster, infos, coupe, marge 2 mm)', () => {
    let n = 0;
    for (let k = indexOf(job, [0x1b, 0x69, 0x61, 0x01]); k >= 0; k = indexOf(job, [0x1b, 0x69, 0x61, 0x01], k + 1)) n++;
    expect(n).toBe(2);
    expect(indexOf(job, [0x1b, 0x69, 0x21])).toBe(-1); // ESC i ! non géré par la P750W : jamais envoyé
    const tiny = encodeJob([b], { tapeMm: 12, marginDots: 2 });
    expect(indexOf(tiny, [0x1b, 0x69, 0x64, 0x0e, 0x00])).toBeGreaterThan(0); // marge ramenée au minimum de 2 mm
  });
  it('options : demi-découpe, chaînage, sans découpe', () => {
    const half = encodeJob([b], { tapeMm: 12, halfCut: true });
    expect(indexOf(half, [0x1b, 0x69, 0x4b, 0x0c])).toBeGreaterThan(0);
    const chain = encodeJob([b], { tapeMm: 24, chain: true, autoCut: false });
    expect(indexOf(chain, [0x1b, 0x69, 0x4b, 0x00])).toBeGreaterThan(0);
    expect(indexOf(chain, [0x1b, 0x69, 0x4d, 0x00])).toBeGreaterThan(0);
    expect(indexOf(chain, [0x1b, 0x69, 0x41])).toBe(-1);
    const i = indexOf(chain, [0x1b, 0x69, 0x7a]);
    expect(chain[i + 3]).toBe(0x84);
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

/** Décodeur strict écrit d'après la doc Brother : refuse tout octet inattendu. */
function decodeStrict(job: Uint8Array) {
  let i = 0;
  const pages: { lines: Uint8Array[]; declared: number; tape: number; cut: number; adv: number; margin: number; end: number }[] = [];
  let cur: (typeof pages)[number] | null = null;
  let nul = 0;
  while (job[i] === 0) { nul++; i++; }
  if (nul !== 100) throw new Error('100 NUL attendus');
  if (job[i] !== 0x1b || job[i + 1] !== 0x40) throw new Error('ESC @ attendu');
  i += 2;
  while (i < job.length) {
    const b = job[i];
    if (b === 0x1b && job[i + 1] === 0x69) {
      const c = job[i + 2];
      if (c === 0x61) { cur = { lines: [], declared: 0, tape: 0, cut: -1, adv: -1, margin: -1, end: 0 }; i += 4; }
      else if (c === 0x7a) { cur!.tape = job[i + 5]; cur!.declared = job[i + 7] | (job[i + 8] << 8) | (job[i + 9] << 16) | (job[i + 10] << 24); i += 13; }
      else if (c === 0x4d) { cur!.cut = job[i + 3]; i += 4; }
      else if (c === 0x41) { i += 4; }
      else if (c === 0x4b) { cur!.adv = job[i + 3]; i += 4; }
      else if (c === 0x64) { cur!.margin = job[i + 3] | (job[i + 4] << 8); i += 5; }
      else throw new Error(`commande ESC i ${c.toString(16)} inattendue à ${i}`);
    } else if (b === 0x4d) { if (job[i + 1] !== 0x02) throw new Error('compression'); i += 2; }
    else if (b === 0x47) {
      const k = job[i + 1] | (job[i + 2] << 8);
      if (k > 17 || k < 1) throw new Error(`ligne G de ${k} octets`);
      const line = unpackBits(job.slice(i + 3, i + 3 + k));
      if (line.length !== 16) throw new Error(`ligne décompressée de ${line.length} octets`);
      cur!.lines.push(line); i += 3 + k;
    } else if (b === 0x5a) { cur!.lines.push(new Uint8Array(16)); i++; }
    else if (b === 0x0c || b === 0x1a) { cur!.end = b; pages.push(cur!); cur = null; i++; }
    else throw new Error(`octet ${b.toString(16)} inattendu à ${i}`);
  }
  if (cur) throw new Error('étiquette sans commande d\'impression');
  return pages;
}

describe('Décodage strict d\'un travail (comme la machine)', () => {
  it('chaque octet est une commande valide et l\'image décodée est identique', () => {
    // motif façon QR : damier pseudo-aléatoire, colonnes vides en tête et en fin
    for (const t of TAPES) {
      const b = band(260, t.dots, (x, y) => x > 5 && x < 250 && ((x * 31 + y * 17 + ((x * y) >> 3)) % 7 < 3));
      const pages = decodeStrict(encodeJob([b, b, b], { tapeMm: t.mm }));
      expect(pages.length).toBe(3);
      expect(pages.map((p) => p.end)).toEqual([0x0c, 0x0c, 0x1a]); // FF, FF, puis Ctrl-Z (avance + coupe)
      for (const p of pages) {
        expect(p.tape).toBe(t.mm === 3.5 ? 4 : t.mm); // 3,5 mm est codé « 4 » par la machine
        expect(p.declared).toBe(260); // nombre de lignes annoncé = envoyé : la machine n'avance pas plus
        expect(p.lines.length).toBe(260);
        expect(p.cut).toBe(0x40);
        expect(p.adv).toBe(0x08);
        expect(p.margin).toBe(14);
        const top = (128 - t.dots) / 2;
        for (let x = 0; x < 260; x++) for (let y = 0; y < 128; y++) {
          const bit = (p.lines[x][y >> 3] >> (7 - (y & 7))) & 1;
          const want = y >= top && y < top + t.dots ? b.data[(y - top) * 260 + x] : 0;
          if (bit !== want) throw new Error(`${t.mm} mm : point (${x}, ${y}) faux`);
        }
      }
    }
  });
});
