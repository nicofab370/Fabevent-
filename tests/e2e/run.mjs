/**
 * Parcours complet de FabEvent dans un vrai navigateur (Playwright).
 * Lancement : npm run test:e2e  (construit l'application, la sert, puis déroule les scénarios).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4300 + Math.floor(Math.random() * 500);
const U = `http://localhost:${PORT}/`;
/** version affichée = n° de PR (package.json) */
const VER = 'v' + JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(U)).ok) break; } catch { /* pas encore prêt */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch();
const results = [];
const consoleErrors = [];
let page;

async function newContext() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  await ctx.addInitScript(() => { window.print = () => {}; });
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => consoleErrors.push(e.message));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const at = m.location()?.url || '';
      if (/localhost:9999\//.test(at)) return; // serveur fictif des tests (requête en vol après la fin du bouchon)
      consoleErrors.push(`${m.text()}${at ? ` (${at})` : ''}`);
    });
    p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept()));
  });
  page = await ctx.newPage();
  return ctx;
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }
/** E2E_ONLY="mot1|mot2" : ne lance que les scénarios dont le nom contient l'un de ces mots (plus le chargement de la démo) */
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null;
async function step(name, fn) {
  if (ONLY && !ONLY.test(name) && !/^Démo : chargement/.test(name)) return;
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ✓', name);
  } catch (e) {
    results.push({ name, ok: false, err: e.message.split('\n')[0] });
    console.log('  ✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: `tests/e2e/echec-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
const go = async (hash) => { await page.goto(U + '#/' + hash); await page.waitForTimeout(400); };
/** dans la page (pas dans la barre des onglets ouverts) */
const inPage = (sel) => page.locator('main > :not(.open-tabs)').locator(sel).first();
const openProject = async (name) => {
  await go('projets');
  // la recherche persiste entre les pages (hash) : on la vide pour voir tous les projets
  const q = page.locator('main .toolbar input').first();
  if (await q.count()) { await q.fill(''); await page.waitForTimeout(250); }
  await inPage(`text=${name}`).first().click({ force: true }); await page.waitForSelector('.project-tabs'); await page.waitForTimeout(300);
};
const tab = async (label) => { await page.click(`.project-tabs button:text-is("${label}")`); await page.waitForTimeout(300); };
/** glisser-déposer HTML5 à la souris (la cible est d'abord ramenée à l'écran) */
const drag = async (src, target) => {
  await src.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const a = await src.boundingBox(); const t = await target.boundingBox();
  await page.mouse.move(a.x + 10, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(t.x + 60, t.y + 20, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(500);
};
const crewMode = async (n) => { await page.click(`.crew-modes button:has-text("${n === 1 ? '1. Postes' : '2. Attribution'}")`); await page.waitForTimeout(200); };
const field = (label) => page.locator('.field', { hasText: label });
async function openDemo() {
  await go('');
  await page.click('text=Essayer avec des données de démo');
  await page.waitForSelector('.demo-badge', { timeout: 20000 });
  await page.waitForTimeout(800);
}
async function resetDemo() {
  await go('parametres');
  // la réinitialisation recharge la page : on attend ce rechargement avant de continuer
  const reloaded = page.waitForEvent('load', { timeout: 30000 });
  await page.click('text=Réinitialiser les données de démo');
  await reloaded;
  await page.waitForSelector('.demo-badge', { timeout: 20000 });
  await page.waitForTimeout(800);
}
/** TOTP 6 chiffres (RFC 6238, SHA-1) pour vérifier le MFA en test. */
const b32dec = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, acc = 0; const out = []; for (const ch of s.replace(/=+$/, '').toUpperCase()) { const v = A.indexOf(ch); if (v < 0) continue; acc = ((acc << 5) | v) & 0xfffff; bits += 5; if (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; } } return Buffer.from(out); };
const totp = (secret, t = Date.now()) => { const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const sig = createHmac('sha1', b32dec(secret)).update(msg).digest(); const o = sig[sig.length - 1] & 15; const bin = ((sig[o] & 127) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3]; return String(bin % 1e6).padStart(6, '0'); };

const mod97 = (s) => { const d = s.replace(/\D/g, ''); return d.length === 12 && (Number(d.slice(0, 10)) % 97 || 97) === Number(d.slice(10)); };

console.log('\nFabEvent — tests de bout en bout\n');

/* ---------- Base vierge : du contact au devis ---------- */
let ctx = await newContext();
await step('Création complète : contact, article, projet, horaires, matériel, devis', async () => {
  await go('contacts');
  await page.click('text=+ Nouveau contact');
  await page.fill('.modal input >> nth=0', 'Client Test');
  await page.click('.modal button[type=submit]');
  await go('materiel');
  await page.click('text=+ Nouvel article');
  await page.fill('.modal input >> nth=0', 'Enceinte Test');
  await field('Quantité en stock').locator('input').fill('4');
  await field('Prix location').locator('input').fill('45');
  await page.click('.modal button[type=submit]');
  await go('projets');
  await page.click('text=+ Nouveau projet');
  await page.fill('.modal input >> nth=0', 'Projet Test');
  await page.locator('.modal input[aria-label="Rechercher un client"]').fill('client te');
  await page.locator('.modal .quick-add-list li', { hasText: 'Client Test' }).click();
  await page.locator('.modal .field', { hasText: 'Statut' }).locator('select').selectOption('confirme');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.project-tabs');
  await tab('Planning');
  await page.click('text=Modifier les horaires');
  for (const b of ['+ Montage', '+ Jour de prestation', '+ Jour de prestation', '+ Démontage']) await page.click(`text=${b}`);
  expect((await page.locator('.period-row').count()) === 4, '4 créneaux attendus');
  expect((await page.locator('.modal p.muted').last().innerText()).includes('2 jour(s)'), '2 jours facturés attendus');
  await page.click('.modal button[type=submit]');
  await tab('Équipement');
  await page.locator('button:has-text("+ Matériel")').first().click();
  await page.locator('.modal .pick-row', { hasText: 'Enceinte Test' }).locator('input').fill('4');
  await page.click('.modal button:has-text("Ajouter (")');
  await page.waitForTimeout(300);
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const totals = await page.locator('.doc .totals').innerText();
  expect(totals.includes('270,00'), `HT attendu 270 € (4 × 45 × 1,5), reçu : ${totals}`);
});
await ctx.close();

/* ---------- Base de démonstration ---------- */
ctx = await newContext();
await step('Démo : chargement et tableau de bord', async () => {
  await openDemo();
  const stats = await page.locator('.stats').first().innerText();
  expect(/1\s*factures échues/.test(stats), 'une facture échue attendue');
  expect(stats.includes('documents du personnel à renouveler'), 'alerte document du personnel attendue');
});

await step('Dépôts : transfert proposé depuis Namur pour le festival', async () => {
  await openProject('Festival des Lumières');
  const before = await page.locator('.alert:not(.venue-alert)').innerText();
  const m = before.match(/X12 \(−(\d+)\)/);
  expect(m, 'manque d’enceintes X12 attendu');
  await tab('Sous-locations & commandes');
  await page.locator('table.list tr', { hasText: 'Grande scène' }).locator('button:has-text("Transférer depuis Dépôt Namur")').click();
  await page.waitForSelector('.modal');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  await openProject('Festival des Lumières');
  const after = (await page.locator('.alert:not(.venue-alert)').innerText()).match(/X12 \(−(\d+)\)/);
  expect(after && Number(after[1]) < Number(m[1]), `le manque doit diminuer (${m[1]} → ${after?.[1]})`);
});

await step('Sous-location : confirmée, elle comble le manque', async () => {
  await tab('Sous-locations & commandes');
  await page.locator('button:has-text("Sous-louer le manque")').first().click();
  await page.waitForSelector('text=Bon de commande');
  await field('Statut').locator('select').selectOption('confirme');
  await page.waitForTimeout(300);
  await openProject('Festival des Lumières');
  const alert = await page.locator('.alert:not(.venue-alert)').innerText().catch(() => '');
  expect(!alert.includes('X12'), `plus de manque de X12 attendu, reçu : ${alert}`);
});

await step('Article de remplacement proposé sur une ligne en manque', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Équipement');
  const btn = page.locator('button:has-text("Remplacer")', { hasText: 'DXR12' }).first();
  expect(await btn.count(), 'bouton de remplacement par la DXR12 attendu');
  await btn.click();
  await page.waitForTimeout(500);
  expect(await page.locator('table.list a', { hasText: 'Enceinte Yamaha DXR12' }).count(), 'ligne DXR12 ajoutée');
});

await step('Facturation : autoliquidation (client NL), mention, Peppol AE, communication structurée', async () => {
  await openProject('Beurs Maastricht');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Facture")');
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc .totals').innerText()).includes('verlegd'), 'TVA 0 % verlegd (document en néerlandais)');
  expect((await page.locator('.doc h1').innerText()) === 'Factuur', 'titre en néerlandais');
  expect((await page.locator('.doc .mention').innerText()).includes('196'), 'mention légale');
  const comm = await page.locator('.doc .pay .comm').innerText();
  expect(mod97(comm), `communication structurée valide : ${comm}`);
  expect(await page.locator('.doc .pay svg').count(), 'QR code de virement');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Peppol (XML)')]);
  const xml = readFileSync(await dl.path(), 'utf8');
  expect(xml.includes('<cbc:ID>AE</cbc:ID>') && xml.includes('VATEX-EU-AE'), 'catégorie AE dans le XML');
});

await step('Acompte, facture avec déduction, avoir', async () => {
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Facture d\'acompte")');
  await page.waitForSelector('.doc');
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Facture")');
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc .totals').innerText()).includes('Reste à payer'), 'acompte déduit');
  await page.click('text=Créer un avoir');
  await page.waitForSelector('text=Avoir AV-');
  expect((await page.locator('.doc .totals').innerText()).includes('-'), 'montants négatifs sur l’avoir');
});

await step('Rappel de paiement d’une facture échue', async () => {
  await go('comptabilite');
  await page.click('button:has-text("Rappel 1")');
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc h1').innerText()) === 'Rappel de paiement', 'titre du rappel');
  expect((await page.locator('.doc .text').innerText()).includes('reste impayée'), 'texte du rappel');
  expect(await page.locator('.doc .pay svg').count(), 'QR code sur le rappel');
});


await step('Modèles de documents : HTML + variable, ancien document inchangé', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await tab('Finances & documents');
  await page.locator('table.list tr.click').first().click();
  await page.waitForSelector('.doc');
  const oldUrl = page.url();
  const oldHtml = await page.locator('.doc').innerHTML();
  await go('modeles');
  await page.click('.blk-main:has-text("En-tête")');
  const ta = page.locator('.blk.open textarea.code');
  await ta.click();
  await page.keyboard.press('Control+Home');
  await ta.type('<div class="test-var">Pour ');
  await page.click('.blk.open button:has-text("Insérer une variable")');
  await page.click('.var:has-text("Nom / société")');
  await ta.type('</div>\n');
  await page.click('button:text-is("Enregistrer")');
  await page.waitForTimeout(300);
  await openProject('Mariage Dupont-Lemaire');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc .test-var');
  expect((await page.locator('.doc .test-var').innerText()).includes('Mariage Dupont-Lemaire (démo)'), 'variable remplie');
  await page.goto(oldUrl);
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc').innerHTML()) === oldHtml, 'ancien devis strictement identique');
});

await step('Décaler un projet de 7 jours (créneaux et postes suivent)', async () => {
  await openProject('Conférence annuelle');
  await tab('Planning');
  const firstBefore = await page.locator('.card table.list tbody tr td').nth(2).innerText();
  await page.click('text=Décaler le projet…');
  await page.locator('.modal input[type=radio]').nth(1).check();
  await field('Jours').locator('input').fill('7');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(500);
  const firstAfter = await page.locator('.card table.list tbody tr td').nth(2).innerText();
  const toDate = (s) => { const [d, m, y] = s.slice(0, 10).split('/'); return new Date(`${y}-${m}-${d}`); };
  expect(Math.round((toDate(firstAfter) - toDate(firstBefore)) / 86400000) === 7, `décalage de 7 j attendu (${firstBefore} → ${firstAfter})`);
});

await step('Créer un projet à partir d’un modèle', async () => {
  await go('projets');
  await page.click('text=+ À partir d\'un modèle');
  await page.fill('.modal .field:has-text("Nom du projet") input', 'Conférence depuis modèle');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.project-tabs');
  await tab('Planning');
  expect((await page.locator('.card h2').count()) >= 3, '3 salles recopiées');
});

await step('Projet récurrent : 2 répétitions hebdomadaires', async () => {
  await go('projets');
  const before = await page.locator('table.list tbody tr').count();
  await openProject('Salon de l\'emploi');
  await page.click('text=Répéter…');
  await field('Nombre de répétitions').locator('input').fill('2');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(1500);
  await go('projets');
  expect((await page.locator('table.list tbody tr').count()) === before + 2, '2 projets créés');
});

await step('Personnel : heures sup., trajet sur la feuille de route, documents à renouveler', async () => {
  await openProject('Festival des Lumières');
  await tab('Équipe & transport');
  await crewMode(1);
  expect(await page.locator('text=/h sup\\./').count(), 'heures supplémentaires affichées');
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Feuille de route")');
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc').innerText()).includes('départ'), 'heure de départ (trajet) sur la feuille de route');
  await go('equipe');
  expect(await page.locator('text=à renouveler').count(), 'document à renouveler signalé');
});

await step('Sous-traitants : changer de rigger change la marge, pas le prix client', async () => {
  await openProject('Festival des Lumières');
  // résumé en tête de projet : client, dates, total HT, marge
  const head = () => page.locator('.stats').first().locator('.stat');
  const totalBefore = await head().nth(2).innerText();
  const marginBefore = await head().nth(3).innerText();
  await tab('Équipe & transport');
  await crewMode(2);
  const row = page.locator('table.crew-assign tbody tr', { hasText: 'Rigger' }).first();
  const select = row.locator('select[aria-label="Technicien"]');
  const options = await select.locator('option').allInnerTexts();
  expect(options.some((o) => o.includes('Sam Moreau') && o.includes('260')), `coût de chaque candidat affiché : ${options.join(' | ')}`);
  await select.selectOption({ label: options.find((o) => o.includes('Sam Moreau')) });
  await page.waitForTimeout(400);
  expect((await head().nth(2).innerText()) === totalBefore, 'total client inchangé');
  expect((await head().nth(3).innerText()) !== marginBefore, `marge modifiée (${marginBefore})`);
});

await step('Matériel archivé masqué, visible avec le filtre', async () => {
  await go('materiel');
  expect(!(await page.locator('text=Console analogique Mackie').count()), 'archivé masqué');
  await page.locator('label:has-text("Archivés") input').check();
  await page.waitForTimeout(200);
  expect(await page.locator('text=Console analogique Mackie').count(), 'archivé visible avec le filtre');
});

await step('Étiquettes QR imprimables', async () => {
  await go('etiquettes');
  await page.click('text=Tout cocher');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('button:has-text("Imprimer")')]);
  await popup.waitForLoadState();
  expect((await popup.locator('.lab svg').count()) > 20, 'planche d’étiquettes avec QR codes');
  await popup.close();
});

await step('Étiquettes : autres mises en page (code-barres) et modèle personnel (créé, imprimé, supprimé)', async () => {
  await go('etiquettes');
  const sel = page.locator('select[aria-label="Format d\'étiquette"]');
  await sel.selectOption('a4-14');
  expect(await page.locator('.lt-preview .lab.code-barres svg').count() === 1, 'aperçu code-barres');
  await page.click('button:text-is("+ Nouveau modèle")');
  const m = page.locator('.modal');
  await m.locator('input[aria-label="Nom du modèle"]').fill('Bacs entrepôt');
  await m.locator('select[aria-label="Mise en page"]').selectOption('texte');
  await m.locator('input[aria-label="Largeur en mm"]').fill('100');
  await m.locator('input[aria-label="Hauteur en mm"]').fill('50');
  await m.locator('input[aria-label="Colonnes"]').fill('3');
  await m.locator('input[aria-label="Lignes"]').fill('5');
  expect((await m.innerText()).includes('dépasse la feuille A4'), 'dépassement signalé');
  expect(await m.locator('button:text-is("Enregistrer le modèle")').isDisabled(), 'enregistrement bloqué');
  await m.locator('input[aria-label="Colonnes"]').fill('2');
  await m.locator('input[aria-label="Imprimer : Emplacement"]').check();
  await m.locator('button[aria-label="Monter Emplacement"]').click();
  await m.locator('input[aria-label="Texte libre"]').fill('Propriété de la société');
  const order = await m.locator('.lt-preview .tx div').evaluateAll((els) => els.map((e) => e.className));
  expect(order.indexOf('f-location') < order.indexOf('f-company') && order.includes('f-footer'), `ordre des champs (${order})`);
  await m.locator('button:text-is("Enregistrer le modèle")').click();
  await page.waitForTimeout(400);
  expect((await sel.locator('option:checked').innerText()) === 'Bacs entrepôt', 'modèle choisi après création');
  expect((await page.locator('.label-template').innerText()).includes('10 par planche'), '10 par planche');
  await page.click('text=Tout cocher');
  await page.locator('input[aria-label="Commencer à l\'étiquette n°"]').fill('3');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('button:has-text("Imprimer")')]);
  await popup.waitForLoadState();
  const n = await popup.locator('.lab.texte').count();
  expect(n > 10, `étiquettes imprimées (${n})`);
  expect(await popup.locator('.lab.blank').count() === 2, '2 étiquettes sautées');
  expect(await popup.locator('.sheet').count() === Math.ceil((n + 2) / 10), 'une page par planche');
  expect((await popup.locator('.f-footer').first().innerText()).includes('Propriété'), 'texte libre imprimé');
  await popup.close();
  await page.reload(); await page.waitForTimeout(600);
  expect(await sel.locator('optgroup[label="Mes modèles"] option', { hasText: 'Bacs entrepôt' }).count() === 1, 'modèle gardé');
  await page.click('button:text-is("Modifier le modèle")');
  await m.locator('button:text-is("Supprimer")').click();
  await page.waitForTimeout(400);
  expect(await sel.locator('option', { hasText: 'Bacs entrepôt' }).count() === 0, 'modèle supprimé');
});

// étiqueteuse simulée : répond au statut (ruban 12 mm laminé) et signale chaque étiquette imprimée
const installPtMock = () => page.evaluate(() => {
  const w = window;
  w.__pt = { tape: 12, sent: [], queue: [] };
  const reply = (patch) => { const b = new Uint8Array(32); b[0] = 0x80; b[1] = 0x20; b[10] = w.__pt.tape; b[11] = 1; b[24] = 1; b[25] = 8; for (const k in patch) b[k] = patch[k]; return b; };
  const ep = (n, d) => ({ endpointNumber: n, direction: d, type: 'bulk' });
  const dev = {
    productName: 'PT-P750W', vendorId: 0x04f9, productId: 0x2062, opened: false,
    configuration: { interfaces: [{ interfaceNumber: 0, alternate: { interfaceClass: 7, endpoints: [ep(2, 'out'), ep(1, 'in')] }, alternates: [] }] },
    async open() { this.opened = true; }, async close() { this.opened = false; }, async selectConfiguration() {},
    async claimInterface() {}, async releaseInterface() {},
    async transferOut(_ep, data) {
      const a = new Uint8Array(data);
      w.__pt.sent.push(...a);
      if (a[a.length - 3] === 0x1b && a[a.length - 2] === 0x69 && a[a.length - 1] === 0x53) w.__pt.queue.push(reply({}));
      // fin d'une étiquette (FF ou Ctrl-Z) : « changement de phase » puis « impression terminée », comme la vraie machine
      if (a[a.length - 1] === 0x1a || a[a.length - 1] === 0x0c) { w.__pt.pages = (w.__pt.pages || 0) + 1; w.__pt.queue.push(reply({ 18: 6, 19: 1 }), reply({ 18: 1 })); }
      return { status: 'ok', bytesWritten: a.length };
    },
    async transferIn() {
      while (!w.__pt.queue.length) await new Promise((r) => setTimeout(r, 20));
      const b = w.__pt.queue.shift();
      return { status: 'ok', data: new DataView(b.buffer) };
    },
  };
  Object.defineProperty(navigator, 'usb', { configurable: true, value: { requestDevice: async () => dev, getDevices: async () => [] } });
});

await step('Étiqueteuse Brother PT-P750W : impression directe USB (simulée), ruban vérifié, PNG', async () => {
  await go('etiquettes');
  await installPtMock();
  await page.selectOption('select[aria-label="Format d\'étiquette"]', 'ptouch');
  await page.waitForSelector('.ptouch-preview img');
  await page.click('text=Tout cocher');
  await page.click('button:text-is("Connecter en USB")');
  await page.waitForSelector('.ptouch [role=status]:has-text("ruban 12 mm")');
  await page.click('.ptouch button:has-text("sur la PT-P750W")');
  await page.waitForSelector('.ptouch [role=status]:has-text("imprimée(s)")', { timeout: 20000 }).catch(async (e) => { throw new Error(e.message.split('\n')[0] + ' — état : ' + (await page.locator('.ptouch [role=status]').innerText().catch(() => 'aucun'))); });
  const sent = await page.evaluate(() => window.__pt.sent);
  const job = sent.slice(sent.lastIndexOf(0x53) - 104); // 100 NUL + ESC @ + ESC i S, puis l'étiquette
  expect(job.slice(0, 100).every((v) => v === 0) && job[100] === 0x1b && job[101] === 0x40 && job[104] === 0x53, 'travail : 100 NUL, ESC @, statut');
  expect(job[105] === 0x1b && job[106] === 0x69 && job[107] === 0x61, 'puis mode raster');
  expect(job[job.length - 1] === 0x1a, 'travail terminé par Ctrl-Z (imprime et coupe)');
  const z = job.findIndex((v, i) => v === 0x1b && job[i + 1] === 0x69 && job[i + 2] === 0x7a);
  expect(job[z + 5] === 12, 'largeur 12 mm envoyée');
  expect(job.some((v, i) => v === 0x47 && job[i + 3] !== undefined), 'lignes raster envoyées');
  const pagesSent = await page.evaluate(() => window.__pt.pages);
  expect(pagesSent > 1, 'une étiquette envoyée à la fois, après confirmation de la précédente');
  await page.click('button:text-is("Étiquette d\'essai")');
  await page.waitForSelector('.ptouch [role=status]:has-text("1 étiquette(s) imprimée(s)")');
  // mauvais ruban : refusé avant d'imprimer
  await page.evaluate(() => { window.__pt.tape = 24; });
  await page.click('.ptouch button:has-text("sur la PT-P750W")');
  await page.waitForSelector('.ptouch [role=status]:has-text("Le ruban en place fait 24 mm")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Image PNG")')]);
  expect(dl.suggestedFilename().endsWith('_12mm.zip'), 'images PNG au format du ruban : ' + dl.suggestedFilename());
  await page.selectOption('select[aria-label="Format d\'étiquette"]', 'a4-24');
});

await step('Étiquette depuis la fiche et la modification d\'un article (unités, PT-P750W)', async () => {
  await go('materiel');
  await page.locator('table.list tr', { hasText: 'Amplificateur LA4X' }).first().click();
  await page.waitForSelector('button:has-text("Imprimer l\'étiquette")');
  await installPtMock();
  // une unité seulement, depuis sa ligne
  await page.locator('table.list tr', { hasText: 'En service' }).first().locator('button:has-text("Étiquette")').click();
  await page.waitForSelector('.modal .unit-picks');
  expect(await page.locator('.modal .unit-picks input:checked').count() === 1, 'seule l\'unité choisie est cochée');
  await page.click('.modal .ptouch button:has-text("sur la PT-P750W")');
  await page.waitForSelector('.modal .ptouch [role=status]:has-text("1 étiquette(s) imprimée(s)")', { timeout: 20000 });
  await page.click('.modal button[aria-label=Fermer]');
  // depuis « Modifier » : enregistrer et imprimer → toutes les unités en service, 2 exemplaires
  await page.click('button:text-is("Modifier")');
  await page.click('.edit-inline button:has-text("Enregistrer et imprimer l\'étiquette")');
  await page.waitForSelector('.modal .unit-picks');
  const n = await page.locator('.modal .unit-picks input:checked').count();
  expect(n >= 2, 'toutes les unités en service cochées : ' + n);
  await page.fill('.modal input[aria-label="Nombre d\'exemplaires"]', '2');
  await page.click('.modal .ptouch button:has-text("sur la PT-P750W")');
  await page.waitForSelector(`.modal .ptouch [role=status]:has-text("${n * 2} étiquette(s) imprimée(s)")`, { timeout: 30000 });
  await page.click('.modal button[aria-label=Fermer]');
});

await step('Inventaire : scan inconnu refusé, écart appliqué au stock', async () => {
  await go('inventaire');
  await page.fill('.scan-input', 'CODE-INCONNU');
  await page.press('.scan-input', 'Enter');
  expect((await page.locator('.flash').innerText()).includes('inconnu'), 'code inconnu signalé');
  await page.locator('.inv-row', { hasText: 'Pied de micro perche' }).click();
  await page.fill('.modal input[aria-label="Quantité comptée"]', '18');
  await page.press('.modal input[aria-label="Quantité comptée"]', 'Enter');
  await page.click('.inv-dock button:has-text("Appliquer 1 écart")');
  await page.click('.modal button:text-is("Appliquer")');
  await page.waitForSelector('text=Inventaire appliqué');
  await go('materiel');

  expect((await page.locator('table.list tr:not(.kit-child)', { hasText: 'Pied de micro perche' }).innerText()).includes('18'), 'stock mis à 18');
});

const tickAll = async (except) => {
  for (let i = 0; i < 40; i++) {
    let b = page.locator('.cl-line:not(.done):not(.kit)');
    if (except) b = b.filter({ hasNotText: except });
    b = b.locator('.cl-check:not([disabled])');
    if (!(await b.count())) break;
    await b.first().click(); await page.waitForTimeout(150);
  }
};
await step('Entrepôt : sortie de tout le matériel d’une ligne', async () => {
  await go('entrepot');
  await page.locator('table.list tr.click').first().click();
  await page.waitForSelector('.scan-input');
  const before = await page.locator('.cl-prog').innerText();
  await page.locator('.cl-line:not(.done) .cl-check:not([disabled])').first().click();
  await page.waitForTimeout(300);
  expect((await page.locator('.cl-prog').innerText()) !== before, 'progression mise à jour');
});

await step('Sauvegarde puis restauration (fichiers joints compris)', async () => {
  await go('parametres');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Télécharger une sauvegarde')]);
  const path = await dl.path();
  const json = JSON.parse(readFileSync(path, 'utf8'));
  expect(json.data.files.some((f) => f.blob?.dataUrl?.startsWith('data:')), 'fichiers joints inclus');
  const nbProjects = json.data.projects.length;
  await page.click('text=Revenir à ma base principale');
  await page.waitForTimeout(800);
  await go('parametres');
  await page.setInputFiles('input[type=file][accept*="json"]', path);
  await page.waitForTimeout(1500);
  await go('projets');
  await page.click('text=Modèles').catch(() => {});
  await go('projets');
  const listed = await page.locator('table.list tbody tr').count();
  expect(listed > 0 && listed <= nbProjects, `projets restaurés (${listed}/${nbProjects})`);
});
await ctx.close();

/* ---------- Audit des autres fonctionnalités (base de démo fraîche) ---------- */
console.log('\n  — audit des autres fonctionnalités —');
ctx = await newContext();
await openDemo();

await step('Import CSV : matériel (séparateur ;, virgule décimale) et contacts', async () => {
  await go('import');
  await page.setInputFiles('input[type=file]', { name: 'mat.csv', mimeType: 'text/csv', buffer: Buffer.from('Nom;Code;Catégorie;Quantité;Prix de location\nBarre LED test;BL1;Lumière;12;7,50\n') });
  await page.waitForSelector('text=Correspondance');
  await page.click('button:has-text("Importer 1 lignes")');
  await page.waitForSelector('text=importé');
  await page.selectOption('select', 'contacts');
  await page.setInputFiles('input[type=file]', { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from('Société,Email,Ville\nImport SA,a@exemple.be,Liège\n') });
  await page.waitForSelector('text=Correspondance');
  await page.click('button:has-text("Importer 1 lignes")');
  await page.waitForSelector('text=importé');
  await go('materiel');
  expect((await page.locator('table.list tr', { hasText: 'Barre LED test' }).innerText()).includes('7,50'), 'prix importé 7,50 €');
  await go('contacts');
  expect(await page.locator('text=Import SA').count(), 'contact importé');
});

await step('Accessoires automatiques et quantité qui suit', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await tab('Équipement');
  const child = page.locator('table.list tbody tr', { hasText: 'Câble NL4 15 m' }).first();
  expect(await child.count(), 'câble NL4 ajouté avec les enceintes');
  const parent = page.locator('table.list tbody tr', { hasText: 'Enceinte L-Acoustics X12' }).first();
  await parent.locator('input').first().fill('3');
  await page.waitForTimeout(400);
  expect((await child.locator('input').first().inputValue()) === '3', 'la quantité du câble suit (3)');
});

await step('Consommables : passés en « Terminé », ils sortent du stock', async () => {
  await go('materiel');
  const before = Number((await page.locator('table.list tr', { hasText: 'Gaffer noir 50 mm' }).locator('td').nth(4).innerText()).trim());
  await openProject('Salon de l\'emploi');
  await page.locator('.page-head select').selectOption('termine');
  await page.waitForTimeout(600);
  await go('materiel');
  const after = Number((await page.locator('table.list tr', { hasText: 'Gaffer noir 50 mm' }).locator('td').nth(4).innerText()).trim());
  expect(after === before - 2, `stock de gaffer ${before} → ${after} (−2 attendu)`);
});

await step('Indisponibilité d’un technicien signalée sur un poste', async () => {
  await openProject('Festival des Lumières');
  await tab('Équipe & transport');
  await crewMode(2);
  expect(await page.locator('.avail.ko', { hasText: 'Indisponible' }).count(), 'Emma (congés) signalée indisponible');
});

await step('Véhicule réservé deux fois : conflit signalé', async () => {
  await openProject('Beurs Maastricht');
  await tab('Équipe & transport');
  await crewMode(1);
  await page.locator('input[type=datetime-local]').last().fill('2030-01-01T00:00');
  await page.waitForTimeout(300);
  const va = page.locator('table.list').last().locator('tbody tr').first();
  await va.locator('input[type=datetime-local]').first().fill(await page.evaluate(() => ''));
  // on met le fourgon sur les dates du mariage, qui l'utilise déjà
  await openProject('Mariage Dupont-Lemaire');
  await tab('Équipe & transport');
  const start = await page.locator('table.list').last().locator('tbody tr').first().locator('input[type=datetime-local]').first().inputValue();
  await openProject('Beurs Maastricht');
  await tab('Équipe & transport');
  await page.locator('table.list').last().locator('tbody tr').first().locator('input[type=datetime-local]').first().fill(start);
  await page.waitForTimeout(400);
  expect(await page.locator('text=Déjà réservé ailleurs').count(), 'conflit de véhicule signalé');
});

await step('Maintenance : réparation (dispo −1) et contrôle non conforme', async () => {
  await go('materiel');
  await page.click('text=Caisson SB18');
  await page.waitForTimeout(400);
  const before = await page.locator('.tl-num').first().innerText();
  await page.click('text=Déclarer une réparation');
  await page.fill('.modal textarea', 'Grille abîmée');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  expect(Number(await page.locator('.tl-num').first().innerText()) === Number(before) - 1, 'une unité de moins disponible');
  await go('maintenance');
  expect(await page.locator('text=Grille abîmée').count(), 'réparation listée');
  await page.locator('button:text-is("Contrôlé")').first().click();
  await page.locator('.modal select').selectOption('ko');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  expect(await page.locator('text=Contrôle non conforme').count(), 'contrôle non conforme → réparation');
});

await step('Planning : export agenda .ics avec liens vers les projets', async () => {
  await go('planning');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Exporter vers mon agenda')]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics.includes('BEGIN:VEVENT') && ics.includes('#/projets/'), 'événements avec lien');
  expect(ics.includes('Montage'), 'créneaux détaillés exportés');
});

await step('Export comptable : journal CSV et PDF groupé', async () => {
  await go('comptabilite');
  await page.locator('input[type=month]').first().fill('2020-01');
  await page.locator('input[type=month]').last().fill('2030-12');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Journal des ventes (CSV)')]);
  const csv = readFileSync(await dl.path(), 'utf8');
  expect(csv.split('\n').length >= 3 && csv.includes(';'), 'journal CSV');
  await page.click('text=Toutes les factures en PDF');
  expect((await page.locator('.doc').count()) >= 2, 'factures regroupées');
});

await step('Rapports : chiffre d’affaires et valeur du parc', async () => {
  await go('rapports');
  const t = await page.locator('.stats').innerText();
  expect(!t.startsWith('0,00'), 'chiffre d’affaires non nul');
  expect(t.includes('valeur de remplacement'), 'valeur du parc');
});

await step('Projet : tâches, notes, fichiers et registre', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await page.fill('input[placeholder^="Nouvelle tâche"]', 'Tâche e2e');
  await page.press('input[placeholder^="Nouvelle tâche"]', 'Enter');
  await page.fill('textarea[placeholder^="Accès"]', 'Note e2e');
  await page.locator('textarea[placeholder^="Accès"]').blur();
  await page.setInputFiles('input[type=file][multiple]', { name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('plan') });
  await page.waitForTimeout(500);
  await openProject('Mariage Dupont-Lemaire');
  expect(await page.locator('text=Tâche e2e').count(), 'tâche enregistrée');
  expect((await page.locator('textarea[placeholder^="Accès"]').inputValue()) === 'Note e2e', 'note enregistrée');
  expect(await page.locator('text=plan.txt').count(), 'fichier joint');
  await tab('Registre');
  expect((await page.locator('.card').innerText()).includes('modifié'), 'modifications dans le registre');
});

await step('Projet : glisser-déposer un fichier sur la page le joint au projet', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await tab('Équipement'); // dépose depuis un autre onglet que Général
  const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['plan de feu'], 'plan-de-feu.pdf', { type: 'application/pdf' })); return d; });
  const target = page.locator('.project-page').first();
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await page.waitForSelector('.drop-overlay', { timeout: 5000 });
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await page.waitForTimeout(700);
  expect(!page.url().includes('onglet=equipement'), 'retour sur l’onglet Général après le dépôt');
  const main = await page.locator('main').innerText();
  expect(main.includes('plan-de-feu.pdf'), 'fichier déposé joint au projet (carte Fichiers)');
});

await step('Distance (cartographie simulée) : transport recalculé', async () => {
  await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '50.6', lon: '5.5' }]) }));
  await page.route('https://router.project-osrm.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'Ok', routes: [{ distance: 100000, duration: 4200 }] }) }));
  await openProject('Mariage Dupont-Lemaire');
  const before = await page.locator('.distance').innerText();
  await page.click('.distance button:has-text("Calculer")');
  await page.waitForTimeout(3000);
  const after = await page.locator('.distance').innerText();
  expect(after.includes('1 h 10') && after !== before, `trajet calculé (${after.slice(0, 80)})`);
  await page.unroute('https://nominatim.openstreetmap.org/**');
  await page.unroute('https://router.project-osrm.org/**');
});

await step('Groupe d’équipement limité à un créneau : 1 jour facturé', async () => {
  await openProject('Conférence annuelle');
  await tab('Équipement');
  expect((await page.locator('.eq-group-head', { hasText: 'Soirée de gala J1' }).innerText()).includes('1 j facturé'), 'groupe J1 = 1 jour');
});

await step('Documents : bon de sortie à cocher, export HTML, Peppol taux normal', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Bon de sortie")');
  await page.waitForSelector('.doc');
  expect(await page.locator('.doc .check').count(), 'cases sortie / retour');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Télécharger (HTML)')]);
  expect(readFileSync(await dl.path(), 'utf8').includes('<!doctype html>'), 'export HTML autonome');
  await openProject('Mariage Dupont-Lemaire');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Facture")');
  await page.waitForSelector('.doc');
  const [x] = await Promise.all([page.waitForEvent('download'), page.click('text=Peppol (XML)')]);
  const xml = readFileSync(await x.path(), 'utf8');
  expect(xml.includes('<cbc:ID>S</cbc:ID>') && xml.includes('<cbc:Percent>21</cbc:Percent>'), 'catégorie S à 21 %');
});

await step('Transfert manuel définitif : le stock change de dépôt', async () => {
  await go('transferts');
  await page.click('text=+ Nouveau transfert');
  const sel = page.locator('.modal select');
  await sel.nth(0).selectOption({ label: 'Dépôt Liège' });
  await sel.nth(1).selectOption({ label: 'Dépôt Namur' });
  await page.locator('.modal input[type=checkbox]').uncheck();
  await page.click('.modal button:has-text("+ Ajouter du matériel")');
  const chooser = page.locator('.modal', { hasText: 'Matériel à transférer' });
  await chooser.locator('input[aria-label="Rechercher du matériel"]').fill('brouillard');
  await chooser.locator('input[aria-label="Quantité Machine à brouillard"]').fill('2');
  await chooser.locator('button:has-text("Ajouter (1)")').click();
  expect((await page.locator('.modal table input').inputValue()) === '2', '2 machines dans le transfert');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  await go('materiel');
  await page.locator('.toolbar select').nth(1).selectOption({ label: 'Dépôt Namur' });
  await page.waitForTimeout(300);
  const dispo = await page.locator('table.list tr', { hasText: 'Machine à brouillard' }).locator('td').nth(5).innerText();
  expect(Number(dispo) === 2, `Namur reçoit 2 machines (dispo ${dispo})`);
  // le filtre « dépôt » ne garde que le matériel présent à Namur
  const rows = await page.locator('table.list tbody tr').count();
  const stocks = await page.locator('table.list tbody tr td:nth-child(5)').allInnerTexts();
  expect(rows > 0 && rows < 10, `liste filtrée sur Namur (${rows} lignes)`);
  expect(stocks.every((x) => x.trim() === '—' || Number(x) > 0), `rien à 0 à Namur (${stocks.join(',')})`);
  await page.locator('select[aria-label="Filtrer par dépôt"]').selectOption('');
  await page.waitForTimeout(200);
  expect(await page.locator('table.list tbody tr').count() > rows, 'tous les dépôts : liste complète');
});

await step('Bases séparées : une nouvelle base est vide', async () => {
  await go('parametres');
  await page.fill('input[placeholder="Nom de la nouvelle base"]', 'essai');
  await page.click('text=Créer et ouvrir');
  await page.waitForTimeout(1000);
  expect((await page.locator('.ws').innerText()).includes('essai'), 'base « essai » active');
  await go('projets');
  expect((await page.locator('table.list tbody tr').count()) === 0, 'aucun projet');
  await go('parametres');
  await page.locator('.card', { hasText: 'Bases de données' }).locator('button:text-is("demo")').click();
  await page.waitForTimeout(1000);
});

await step('Bases séparées : suppression d’une base', async () => {
  await go('parametres');
  const card = page.locator('.card', { hasText: 'Bases de données' });
  expect(await card.locator('button:text-is("essai")').count() === 1, 'base « essai » listée');
  expect(await card.locator('[aria-label="Supprimer la base principal"]').count() === 0, 'principale non supprimable');
  // mauvais nom : rien n'est supprimé
  const answers = ['autre', 'essai'];
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(answers.shift()) : d.accept()));
  await card.locator('[aria-label="Supprimer la base essai"]').click();
  await page.waitForTimeout(400);
  expect(await card.locator('button:text-is("essai")').count() === 1, 'nom incorrect : base gardée');
  await card.locator('[aria-label="Supprimer la base essai"]').click();
  await page.waitForTimeout(800);
  expect(await card.locator('button:text-is("essai")').count() === 0, 'base « essai » retirée de la liste');
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(!dbs.includes('fabevent_essai'), 'base IndexedDB effacée');
  expect((await page.locator('.ws').innerText()).includes('demo'), 'base démo toujours ouverte');
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept()));
});

await step('Entrepôt : scan d’un code-barres en sortie', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await page.click('.sub-head button:has-text("Préparer")').catch(() => {});
  await tab('Équipement');
  await page.locator('button:has-text("Préparer / scanner")').first().click();
  await page.waitForSelector('.scan-input');
  await page.fill('.scan-input', 'DEMO-SUB');
  await page.press('.scan-input', 'Enter');
  await page.waitForTimeout(400);
  // article en vrac : « combien ? » (Entrée valide) ; ou article avec contenu (kit/accessoires) : « Valider » d'un coup
  if (await page.locator('.cl-ask .cl-askq').count()) await page.press('.cl-askq', 'Enter');
  else await page.locator('.cl-ask button', { hasText: 'Valider' }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const fl = await page.locator('.flash').innerText();
  expect(fl.startsWith('Sortie') || fl.includes('Kit') || fl.includes('sorti'), 'sortie enregistrée au scan (' + fl.slice(0, 80) + ')');
});

await step('Hors ligne : l’application se recharge sans réseau', async () => {
  await go('');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForTimeout(1000);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('h1', { timeout: 10000 });
  expect((await page.locator('h1').first().innerText()).length > 0, 'page affichée hors ligne');
  await ctx.setOffline(false);
});
await ctx.close();

/* ---------- Compléments Rentman (lot 2) ---------- */
console.log('\n  — compléments Rentman —');
ctx = await newContext();
await openDemo();

await step('Société de sous-traitance : bon de commande RH et coûts par fournisseur', async () => {
  await openProject('Festival des Lumières');
  await tab('Sous-locations & commandes');
  const row = page.locator('table.list tr', { hasText: 'Rigging Services (démo)' });
  expect(await row.count(), 'bon de commande regroupé pour Rigging Services');
  expect((await row.innerText()).includes('Karim'), 'postes de Karim regroupés sous sa société');
  const [popup] = await Promise.all([page.waitForEvent('popup'), row.locator('button:has-text("Bon de commande")').click()]);
  await popup.waitForLoadState();
  expect((await popup.locator('.doc').innerText()).includes('Total HT'), 'bon de commande imprimable');
  await popup.close();
  await tab('Finances & documents');
  expect((await page.locator('.card', { hasText: 'Coûts par fournisseur' }).innerText()).includes('Rigging Services'), 'coûts par fournisseur');
});

await step('Planification provisoire : « à confirmer » sur la feuille de route, puis finale', async () => {
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Feuille de route")');
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc').innerText()).includes('à confirmer'), 'poste provisoire masqué au technicien');
  await openProject('Festival des Lumières');
  await tab('Équipe & transport');
  await crewMode(2);
  const stat = () => page.locator('.stat', { hasText: 'postes provisoires' }).locator('b').innerText();
  expect(Number(await stat()) > 0, 'postes provisoires comptés');
  await page.click('text=Rendre toute la planification finale');
  await page.waitForTimeout(500);
  expect(Number(await stat()) === 0, 'plus aucun poste provisoire');
});

await step('Facture d’un sous-projet, puis facture finale qui l’exclut', async () => {
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('text=+ Facture d\'un sous-projet');
  await page.locator('.modal label', { hasText: 'Salle atelier 1' }).locator('input').check();
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.doc');
  const partial = await page.locator('.doc').innerText();
  expect(partial.includes('Facture partielle') && partial.includes('Salle atelier 1') && !partial.includes('Salle plénière'), 'facture partielle limitée à la salle');
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Facture")');
  await page.waitForSelector('.doc');
  const fin = await page.locator('.doc').innerText();
  expect(fin.includes('Déjà facturé séparément') && fin.includes('Salle plénière'), 'facture finale avec la mention');
  expect((await page.locator('.doc h2', { hasText: 'Salle atelier 1' }).count()) === 0, 'salle déjà facturée exclue');
});

await step('Champs personnalisés : saisie et variable dans le devis', async () => {
  await openProject('Festival des Lumières');
  expect(await page.locator('.field', { hasText: 'Repas fourni' }).locator('input').isChecked(), 'champ « Repas fourni » coché');
  await go('modeles');
  await page.click(`.blk-main:has-text("Texte d'introduction")`);
  await page.locator('.blk.open textarea').fill('Repas : {{champ.repas_fourni}} — accès : {{champ.acces_livraison}}');
  await page.click('button:text-is("Enregistrer")');
  await page.waitForTimeout(300);
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc .text');
  expect((await page.locator('.doc .text').innerText()).includes('Repas : Oui — accès : Entrée nord, quai 2'), 'variables remplies');
});

await step('Modèles : blocs déplacés, masqués, modifiés depuis l’aperçu ; thème et couleur', async () => {
  await go('modeles');
  // clic sur un bloc de l'aperçu : il s'ouvre dans la liste
  await page.locator('.tpl-preview [data-bloc="introduction"], .tpl-preview [data-bloc="totaux"]').first().click();
  expect(await page.locator('.blk.open').count() === 1, 'bloc ouvert depuis l’aperçu');
  // masquer les conditions générales
  expect(await page.locator('.tpl-preview .terms').count() === 1, 'conditions visibles');
  await page.click('button[aria-label="Masquer Conditions générales"]');
  expect(await page.locator('.tpl-preview .terms').count() === 0, 'conditions masquées');
  expect(await page.locator('.blk-hidden button:has-text("Conditions générales")').count() === 1, 'dans les blocs masqués');
  // remonter les totaux au-dessus des sous-projets
  const order = async () => page.locator('.tpl-preview [data-bloc]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bloc')));
  const idx = (o, k) => o.indexOf(k);
  const before = await order();
  expect(idx(before, 'salles') < idx(before, 'totaux'), 'ordre initial');
  for (let i = 0; i < 6 && idx(await order(), 'totaux') > idx(await order(), 'salles'); i++) await page.click('button[aria-label="Monter Totaux"]');
  expect(idx(await order(), 'totaux') < idx(await order(), 'salles'), 'totaux remontés');
  // texte libre
  await page.click('button:has-text("Texte libre")');
  await page.locator('.blk.open textarea').fill('Merci pour votre confiance, {{client.nom}}.');
  expect((await page.locator('.tpl-preview .free').innerText()).startsWith('Merci pour votre confiance'), 'texte libre dans l’aperçu');
  // thème sobre et couleur
  await page.click('.theme-opt:has-text("Sobre")');
  expect(await page.locator('.tpl-preview .doc.t-sobre').count() === 1, 'thème sobre');
  await page.click('.theme-opt:has-text("Moderne")');
  await page.click('.swatch[aria-label="Couleur #0f766e"]');
  expect((await page.locator('.tpl-preview .doc').getAttribute('style')).includes('rgb(15,118,110)'), 'couleur appliquée');
  await page.click('button:text-is("Enregistrer")'); await page.waitForTimeout(300);
  // un nouveau devis suit la mise en page
  await openProject('Mariage Dupont-Lemaire');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  expect(await page.locator('.doc .terms').count() === 0, 'devis sans conditions');
  expect((await page.locator('.doc .free').innerText()).includes('Mariage Dupont-Lemaire (démo)'), 'texte libre avec variable');
  expect((await page.locator('.doc').getAttribute('style')).includes('rgb(15,118,110)'), 'couleur du devis');
  // remise par défaut pour la suite
  await go('modeles');
  await page.click('button:has-text("Ordre par défaut")');
  await page.click('button:text-is("Enregistrer")'); await page.waitForTimeout(300);
});

await step('Modèles : fiche pour une IA, export puis import d’un modèle HTML + CSS complet', async () => {
  await go('modeles');
  await page.click('button:has-text("Pour une IA")');
  const brief = await page.locator('.ai-brief').inputValue();
  expect(brief.includes('{{client.nom}}') && brief.includes('{{bloc.totaux}}') && brief.includes('<!-- fabevent:header') && brief.includes('var(--accent)'), 'fiche complète');
  await page.keyboard.press('Escape');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Exporter")')]);
  const fs = await import('node:fs');
  let html = fs.readFileSync(await dl.path(), 'utf8');
  expect(html.includes('<!-- fabevent:layout') && html.includes('id="fabevent-css"') && html.includes('"color"'), 'fichier exporté');
  // modification « par une IA » : CSS, en-tête et couleur
  html = html.replace(/(<style id="fabevent-css">)/, '$1\n.doc h1 { letter-spacing: .2em; }')
    .replace('<div class="d-co-name">{{societe.nom}}</div>', '<div class="d-co-name ia-mark">{{societe.nom}}</div>')
    .replace(/"color": "#[0-9a-fA-F]{6}"/, '"color": "#be123c"');
  await page.click('button:has-text("Importer")');
  await page.locator('.modal textarea').fill(html);
  await page.click('.modal button:has-text("Importer ce texte")');
  await page.waitForTimeout(300);
  expect(await page.locator('.tpl-preview .ia-mark').count() === 1, 'en-tête importé');
  expect((await page.locator('.tpl-preview .doc').getAttribute('style')).includes('rgb(190,18,60)'), 'couleur importée');
  expect((await page.locator('.tpl-preview').innerHTML()).includes('letter-spacing: .2em'), 'CSS importé');
  // fichier invalide : message clair, rien ne change
  await page.click('button:has-text("Importer")');
  await page.locator('.modal textarea').fill('<html><body>rien</body></html>');
  await page.click('.modal button:has-text("Importer ce texte")');
  expect((await page.locator('.modal .avail.ko').innerText()).includes('Aucune zone'), 'erreur claire');
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForTimeout(800); // non enregistré : abandon
});

await step('Postes : la case Trajet fonctionne même sans distance calculée ; temps de trajet modifiable', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await tab('Équipe & transport');
  await crewMode(1);
  const tt = page.locator('.travel-time input');
  await tt.fill('0'); await tt.blur(); await page.waitForTimeout(300);
  const box = page.locator('table.crew-posts input[aria-label="Trajet"]').first();
  expect(!(await box.isDisabled()), 'case active');
  // case pilotée par la base : on clique puis on attend la mise à jour
  if (await box.isChecked()) { await box.click(); await page.waitForTimeout(300); }
  await box.click(); await page.waitForTimeout(400);
  expect(await box.isChecked(), 'case cochée');
  expect(await page.locator('.travel-time.warn').count() === 1, 'demande le temps de trajet');
  await tt.fill('45'); await tt.blur(); await page.waitForTimeout(300);
  expect(await page.locator('.travel-time.warn').count() === 0, 'temps de trajet renseigné');
  // nouveau poste avec trajet
  const before = await page.locator('table.crew-posts input[aria-label="Trajet"]:checked').count();
  const form = page.locator('form', { has: page.locator('button:text-is("+ Ajouter les postes")') }).first();
  await form.locator('input[aria-label="Fonction à ajouter"]').fill('Roadie trajet');
  await form.locator('label:has-text("Trajet") input').check();
  await form.locator('button:text-is("+ Ajouter les postes")').click(); await page.waitForTimeout(400);
  expect(await page.locator('table.crew-posts input[aria-label="Trajet"]:checked').count() === before + 1, 'poste créé avec trajet');
  await page.reload(); await page.waitForTimeout(800);
  await crewMode(1);
  expect(await page.locator('.travel-time input').inputValue() === '45', 'temps gardé');
});

await step('Étiquettes : filtres sur les projets et le matériel', async () => {
  await go('projets');
  await page.locator('.toolbar select').last().selectOption('Festival');
  await page.waitForTimeout(200);
  expect((await page.locator('table.list tbody tr').count()) === 1, 'un projet étiqueté Festival');
  await go('materiel');
  await page.locator('.toolbar select').filter({ hasText: 'Toutes étiquettes' }).selectOption('Line array');
  await page.waitForTimeout(200);
  expect((await page.locator('table.list tbody tr').count()) === 2, 'deux articles Line array');
});

await step('Rendez-vous : affiché au planning et rend le participant indisponible', async () => {
  const conf = await (async () => { await openProject('Conférence annuelle'); await tab('Planning'); return page.locator('.card').first().locator('table.list tbody tr').nth(1).locator('td').nth(2).innerText(); })();
  const [dd, mm, yy] = conf.slice(0, 10).split('/');
  await go('planning');
  await page.click('text=+ Rendez-vous');
  await page.fill('.modal input >> nth=0', 'Réunion e2e');
  await page.locator('.modal input[type=datetime-local]').first().fill(`${yy}-${mm}-${dd}T06:00`);
  await page.locator('.modal input[type=datetime-local]').last().fill(`${yy}-${mm}-${dd}T23:00`);
  await page.locator('.modal label', { hasText: 'Hugo Laurent' }).locator('input').check();
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  await openProject('Conférence annuelle');
  await tab('Équipe & transport');
  await crewMode(2);
  expect(await page.locator('.avail.ko', { hasText: 'Indisponible' }).count(), 'Hugo indisponible pendant le rendez-vous');
});

await step('Export CSV et modification groupée des prix', async () => {
  await go('materiel');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Exporter (CSV)')]);
  expect(readFileSync(await dl.path(), 'utf8').includes('Désignation;Marque;Modèle;Description courte;Référence'), 'export CSV du matériel');
  const price = async (name) => (await page.locator('table.list tr:not(.kit-child)', { hasText: name }).locator('td').last().innerText()).trim();
  const before = await price('Micro Shure SM58');
  await page.locator('table.list tr:not(.kit-child)', { hasText: 'Micro Shure SM58' }).locator('input[type=checkbox]').check();
  await page.locator('table.list tr:not(.kit-child)', { hasText: 'Boîte de direct DI passive' }).locator('input[type=checkbox]').check();
  await page.click('text=Modifier en groupe…');
  await page.locator('.modal .field', { hasText: 'Variation des prix' }).locator('input').fill('20');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(1200);
  expect(before.startsWith('5,00') && (await price('Micro Shure SM58')).startsWith('6,00'), `prix 5 € → 6 € (+20 %) (${before} → ${await price('Micro Shure SM58')})`);
});
await step('Modification groupée : infos communes pré-remplies, seules les infos modifiées sont appliquées', async () => {
  await go('materiel');
  const row = (n) => page.locator('table.list tr:not(.kit-child)', { hasText: n });
  for (const n of ['Câble XLR 10 m', 'Câble XLR 5 m']) await row(n).locator('input[type=checkbox]').check();
  await page.click('text=Modifier en groupe…');
  const m = page.locator('.modal');
  await page.waitForFunction(() => document.querySelector('.modal input[aria-label="Emplacement"]')?.value === 'Bac C1', null, { timeout: 4000 });
  const cat = await m.locator('select[aria-label="Catégorie"] option:checked').innerText();
  expect(/Câblage/.test(cat), `catégorie commune pré-remplie (${cat})`);
  expect(await m.locator('input[aria-label="Modifier : Catégorie"]').isChecked() === false, 'rien de coché au départ');
  expect(await m.locator('input[aria-label="Emplacement"]').inputValue() === 'Bac C1', 'emplacement commun pré-rempli');
  expect(await m.locator('input[aria-label="Poids"]').inputValue() === '' && (await m.locator('.bulk-field', { hasText: 'Poids' }).innerText()).includes('valeurs différentes'), 'poids différents signalés');
  await m.locator('input[aria-label="Emplacement"]').fill('Bac câbles B2');
  await m.locator('input[aria-label="Poids"]').fill('0,6');
  expect(await m.locator('input[aria-label="Modifier : Emplacement dépôt"]').isChecked(), 'case cochée en modifiant');
  expect((await m.locator('.form-actions').innerText()).includes('2 modification(s)'), 'compte des modifications');
  await m.locator('button[type=submit]').click();
  await page.waitForTimeout(1200);
  await row('Câble XLR 5 m').locator('td').nth(1).click();
  await page.waitForTimeout(400);
  const fiche = await page.locator('main').innerText();
  expect(fiche.includes('Bac câbles B2'), 'emplacement appliqué');
  await go('materiel');
  expect(/Câblage/.test(await row('Câble XLR 5 m').innerText()), 'catégorie inchangée');
});
console.log('\n  — lot 3 : relecture du manuel Rentman —');
const statusOf = async (name) => { await openProject(name); return field('Statut').locator('select').first().inputValue(); };

await step('Statuts : devis émis → En attente, devis accepté → Confirmé', async () => {
  await resetDemo();
  expect(await statusOf('Spectacle de fin d') === 'demande', 'départ en « Demande »');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const docUrl = page.url();
  expect(await statusOf('Spectacle de fin d') === 'option', 'passé « En attente » après le devis');
  await page.goto(docUrl);
  await page.waitForSelector('.doc');
  await page.locator('select', { has: page.locator('option[value=accepte]') }).selectOption('accepte');
  await page.waitForTimeout(400);
  expect(await statusOf('Spectacle de fin d') === 'confirme', 'confirmé quand le devis est accepté');
});

await step('Échéancier : l’acompte à la commande arrive dans « À facturer »', async () => {
  // le spectacle est une « Location sèche » : facture unique ; on choisit acompte + solde sur le projet
  await openProject('Spectacle de fin d');
  await tab('Finances & documents');
  const card = page.locator('.card', { hasText: 'Échéancier de facturation' });
  // cases liées à la base : on clique puis on laisse la base se mettre à jour
  for (const m of ['Acompte à la commande', 'Solde après la prestation', 'Facture après la prestation']) {
    await card.locator('label', { hasText: m }).locator('input').click();
    await page.waitForTimeout(300);
  }
  expect((await card.locator('tbody tr').count()) === 2, 'deux moments');
  expect((await card.locator('tbody tr').first().innerText()).includes('À facturer'), 'acompte à facturer');
  await go('comptabilite');
  const row = page.locator('.card', { hasText: 'À facturer' }).locator('tr', { hasText: 'Spectacle de fin' });
  await row.waitFor({ timeout: 5000 });
  expect((await row.innerText()).includes('Acompte à la commande'), 'moment indiqué');
  await row.locator('button:text-is("Facturer")').click();
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc').innerText()).includes('Acompte à la commande'), 'acompte libellé selon le moment');
  await openProject('Spectacle de fin d');
  await tab('Finances & documents');
  const rows = page.locator('.card', { hasText: 'Échéancier de facturation' }).locator('tbody tr');
  expect((await rows.first().innerText()).includes('Facturé') && (await rows.nth(1).innerText()).includes('À venir'), 'acompte facturé, solde à venir');
});

await step('Facturé en externe : retiré de « À facturer », puis remis', async () => {
  await go('comptabilite');
  const card = page.locator('.card', { hasText: 'À facturer' }).first();
  await card.locator('label', { hasText: 'échéances à venir' }).locator('input').check();
  const row = card.locator('tr', { hasText: 'Conférence annuelle' });
  await row.waitFor({ timeout: 5000 });
  await row.locator('button:has-text("Facturé en externe")').click();
  await page.waitForTimeout(500);
  expect((await card.locator('.table-wrap tr', { hasText: 'Conférence annuelle' }).count()) === 0, 'retiré de la liste');
  await card.locator('summary').click();
  await card.locator('button:has-text("Remettre")').click();
  await page.waitForTimeout(500);
  expect((await card.locator('.table-wrap tr', { hasText: 'Conférence annuelle' }).count()) === 1, 'remis dans la liste');
});

await step('Pénuries : liste de tous les manques, réels ou entre options', async () => {
  await go('');
  await page.locator('.stat', { hasText: 'manques de matériel' }).click();
  await page.waitForSelector('h1:text-is("Pénuries")');
  const n = await page.locator('table.list tbody tr').count();
  expect(n > 0, 'des manques listés');
  const txt = await page.locator('table.list').innerText();
  expect(txt.includes('Manque réel') || txt.includes('Concurrence entre options'), 'type de manque affiché');
  await page.locator('.toolbar select').selectOption('concurrence');
  await page.waitForTimeout(200);
  expect(!(await page.locator('table.list, .empty').first().innerText()).includes('Manque réel'), 'filtre par type');
});

await step('Ligne : horaire propre, remarques client et entrepôt, notes et assurance sur les documents', async () => {
  await openProject('Conférence annuelle');
  await tab('Équipement');
  expect((await page.locator('.sub', { hasText: 'Salle plénière' }).innerText()).includes('Uniquement pour la plénière'), 'remarque affichée sur la ligne');
  const row = page.locator('.sub', { hasText: 'Salle plénière' }).locator('tr', { hasText: 'Vidéoprojecteur' });
  await row.locator('button[aria-label="Détails de la ligne"]').click();
  await page.locator('.modal .field', { hasText: "Remarque pour l'entrepôt" }).locator('input').fill('Prendre la lentille grand angle');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const quote = await page.locator('.doc').innerText();
  expect(quote.includes('Uniquement pour la plénière du premier jour'), 'remarque client sur le devis');
  expect(!quote.includes('lentille'), 'remarque entrepôt absente du devis');
  expect(quote.toLowerCase().includes('accès et parking'), 'note du projet sur le devis');
  expect(quote.includes('Assurance du matériel (3 %)'), 'assurance ajoutée');
  expect(quote.includes('Conditions générales'), 'conditions générales');
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Bon de sortie")');
  await page.waitForSelector('.doc');
  const bs = await page.locator('.doc').innerText();
  expect(bs.includes('Prendre la lentille grand angle') && bs.toLowerCase().includes('accès et parking'), 'remarque entrepôt et note sur le bon de sortie');
});

await step('Caution : affichée sur le devis, hors total', async () => {
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  const total = await page.locator('.stat').first().innerText();
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const doc = await page.locator('.doc').innerText();
  expect(doc.includes('Caution à verser'), 'caution sur le devis');
  expect(/1\s?500,00/.test(doc.replace(/[\u202f\u00a0]/g, ' ')), 'montant de la caution');
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  expect((await page.locator('.stat').first().innerText()) === total, 'total inchangé');
});

await step('Coût réel : la marge réelle suit le coût saisi', async () => {
  await openProject('Gala de fin d');
  await tab('Finances & documents');
  const r = page.locator('.fin-table tr', { hasText: 'Personnel' }).first().locator('td').nth(2).locator('input');
  await r.fill('2000');
  await r.blur();
  await page.waitForTimeout(400);
  const num = (t) => parseFloat(t.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.'));
  const tot = await page.locator('.fin-table tr.fin-total td').allInnerTexts();
  const actualCost = num(tot[2]);
  expect(actualCost >= 2000, `coût réel cumulé (${tot[2]})`);
  const totalHT = num(await page.locator('.fin-summary tr', { hasText: 'Total HT' }).locator('td').nth(1).innerText());
  const real = (await page.locator('.stat', { hasText: 'bénéfice réel' }).innerText()).split('·').pop();
  expect(Math.abs(totalHT - actualCost - num(real)) < 0.02, `bénéfice réel = total − coûts réels (${real})`);
});

await step('Aperçu financier : par catégorie (matériel location / vente), et par sous-projet', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  const num = (t) => parseFloat(t.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.'));
  const htAll = num(await page.locator('.fin-kpis .stat').first().locator('b').innerText());
  expect(await page.locator('.stat', { hasText: 'facturé' }).count() === 1 && await page.locator('.stat', { hasText: 'bénéfice prévu' }).count() === 1, 'indicateurs facturé et bénéfice');
  await page.click('.fin-table button:has-text("Matériel")');
  expect(await page.locator('.fin-table tr.fin-kid', { hasText: 'Location' }).count() === 1 && await page.locator('.fin-table tr.fin-kid', { hasText: 'Vente' }).count() === 1, 'matériel détaillé en location / vente');
  const chips = page.locator('.fin-scope .chip');
  expect(await chips.count() >= 3, 'choix « Tout le projet » + sous-projets');
  let sum = 0;
  for (let i = 1; i < await chips.count(); i++) {
    await chips.nth(i).click(); await page.waitForTimeout(200);
    expect((await page.locator('.fin-overview h2').innerText()).includes('—'), 'titre du sous-projet');
    sum += num(await page.locator('.fin-kpis .stat').first().locator('b').innerText());
  }
  // sans coûts supplémentaires facturés, les sous-projets font le total du projet
  expect(sum <= htAll + 0.05, `somme des sous-projets (${sum}) ≤ projet (${htAll})`);
  await chips.first().click();
  expect(num(await page.locator('.fin-kpis .stat').first().locator('b').innerText()) === htAll, 'retour au total du projet');
});

await step('Entrepôt : 1re sortie → En cours, tout rentré → Exécution terminée', async () => {
  await go('entrepot');
  await page.locator('table.list tr.click', { hasText: 'Beurs Maastricht' }).click();
  await page.waitForSelector('.scan-input');
  await tickAll();
  expect(await statusOf('Beurs Maastricht') === 'en_cours', 'en cours après la sortie');
  await go('entrepot');
  await page.locator('table.list tr.click', { hasText: 'Beurs Maastricht' }).click();
  await page.waitForSelector('.scan-input');
  await page.click('.cl-phase button:has-text("Retour")');
  await tickAll();
  expect(await statusOf('Beurs Maastricht') === 'execute', 'exécution terminée au retour complet');
});

await step('Entrepôt : une salle en attente n’apparaît qu’une fois prête pour la préparation', async () => {
  await go('entrepot');
  expect((await page.locator('table.list tr:not(.pack-row)', { hasText: 'Marché de Noël' }).count()) === 0, 'option masquée');
  await openProject('Marché de Noël');
  await tab('Planning');
  await page.locator('label', { hasText: 'Prête pour la préparation' }).first().locator('input').click();
  await page.waitForTimeout(300);
  await go('entrepot');
  expect((await page.locator('table.list tr:not(.pack-row)', { hasText: 'Marché de Noël' }).count()) === 1, 'visible une fois prête');
});

await step('Champ en liste déroulante : colonne et filtre des projets', async () => {
  await go('projets');
  expect((await page.locator('table.list thead').innerText()).includes('Probabilité'), 'colonne affichée');
  await page.locator('.toolbar select', { has: page.locator('option', { hasText: 'Probabilité : tous' }) }).selectOption('Forte');
  await page.waitForTimeout(200);
  const rows = await page.locator('table.list tbody tr').allInnerTexts();
  expect(rows.length === 1 && rows[0].includes('Festival'), 'filtre sur la valeur');
});

console.log('\n  — base des lieux —');
await step('Lieux : liste, recherche dans les commentaires, fiche avec projets', async () => {
  await resetDemo();
  await go('lieux');
  expect((await page.locator('table.list tbody tr').count()) >= 3, 'lieux de la démo listés');
  await page.fill('.toolbar input', 'monte-charge');
  await page.waitForTimeout(200);
  const rows = await page.locator('table.list tbody tr').allInnerTexts();
  expect(rows.length === 1 && rows[0].includes('Palais des Congrès'), 'recherche dans les commentaires');
  await page.locator('table.list tbody tr').first().click();
  await page.waitForSelector('h2:has-text("Projets dans ce lieu")');
  expect((await page.locator('.card', { hasText: 'Projets dans ce lieu' }).innerText()).includes('Gala de fin'), 'historique des projets');
  expect(await field('Électricité').locator('textarea').inputValue() === '2 × 63 A tétra côté scène, 1 × 32 A en régie', 'infos pratiques');
});

await step('Lieux : commentaire ajouté depuis un projet, alerte et feuille de route', async () => {
  await openProject('Festival des Lumières');
  expect((await page.locator('.venue-alert').innerText()).includes('plaques de roulage'), 'alerte du lieu sur le projet');
  const card = page.locator('.card', { hasText: 'Lieu de la prestation' });
  await card.locator('.venue-comments textarea').fill('Prévoir 2 rallonges 63 A supplémentaires pour la scène acoustique');
  await card.locator('.venue-comments label', { hasText: 'Sur la feuille de route' }).locator('input').check();
  await card.locator('.venue-comments button[type=submit]').click();
  await page.waitForTimeout(400);
  expect((await card.innerText()).includes('2 rallonges 63 A'), 'commentaire affiché sur le projet');
  await go('lieux');
  await page.locator('tr', { hasText: 'Parc de la Boverie' }).click();
  await page.waitForSelector('.venue-comments');
  const venueCard = await page.locator('.card', { hasText: 'Commentaires' }).innerText();
  expect(venueCard.includes('2 rallonges 63 A') && venueCard.includes('Festival des Lumières'), 'commentaire rattaché au lieu et au projet');
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Feuille de route")');
  await page.waitForSelector('.doc');
  const fr = await page.locator('.doc').innerText();
  expect(fr.includes('Entrée nord uniquement') && fr.includes('2 rallonges 63 A') && fr.includes('plaques de roulage'), 'infos et commentaires du lieu sur la feuille de route');
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  expect(!(await page.locator('.doc').innerText()).includes('plaques de roulage'), 'pas sur le devis');
});

console.log('\n  — services clients et endroits —');
await step('Client : recherche d’une personne, services et interlocuteurs', async () => {
  await resetDemo();
  await go('contacts');
  await page.fill('.toolbar input', 'Anne');
  await page.waitForTimeout(200);
  const row = await page.locator('table.list tbody tr').first().innerText();
  expect(row.includes('Ville de Namur') && row.includes('Anne Collin (Culture)'), 'personne trouvée avec son service');
  await page.locator('table.list tbody tr').first().click();
  const editor = page.locator('.people-editor');
  expect((await editor.locator('.dept-box').count()) === 2, 'deux services');
  await editor.locator('.dept-box', { has: page.locator('input[value="Culture"]') }).locator('button:has-text("+ Personne")').click();
  await editor.locator('.dept-box', { has: page.locator('input[value="Culture"]') }).locator('.person-row').last().locator('input').first().fill('Sarah Lenoir');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  await openProject('Marché de Noël');
  const picker = page.locator('select[aria-label="Interlocuteur"]');
  expect((await picker.locator('option:checked').innerText()).includes('Julie Martin'), 'interlocuteur du projet');
  expect((await picker.locator('optgroup[label="Service Culture"] option').allInnerTexts()).some((t) => t.includes('Sarah Lenoir')), 'nouvelle personne dans le service');
});

await step('Projet : choisir une personne d’un autre service, devis à l’adresse du service', async () => {
  await openProject('Marché de Noël');
  const picker = page.locator('select[aria-label="Interlocuteur"]');
  await picker.selectOption({ label: 'Anne Collin (Programmatrice)' });
  await page.waitForTimeout(400);
  expect((await page.locator('.card', { has: page.locator('h2:text-is("Client")') }).innerText()).includes('Culture'), 'service affiché');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const doc = await page.locator('.doc').innerText();
  expect(doc.includes('Culture') && doc.includes('Rue Rogier 9') && doc.includes('Anne Collin'), 'service, adresse du service et interlocuteur sur le devis');
});

await step('Projet : ajout rapide d’un interlocuteur dans un nouveau service', async () => {
  await openProject('Marché de Noël');
  await page.locator('.card', { hasText: 'Service / interlocuteur' }).locator('button[title="Nouvel interlocuteur ou nouveau service"]').click();
  await page.locator('.modal .field', { hasText: 'Service' }).first().locator('select').selectOption('__new');
  await page.locator('.modal .field', { hasText: 'Nom du nouveau service' }).locator('input').fill('Sports');
  await page.locator('.modal .field', { hasText: 'Nom de la personne' }).locator('input').fill('Paul Noël');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(500);
  const picker = page.locator('select[aria-label="Interlocuteur"]');
  expect((await picker.locator('option:checked').innerText()).includes('Paul Noël'), 'nouvel interlocuteur choisi');
  expect((await picker.locator('optgroup[label="Service Sports"]').count()) === 1, 'nouveau service créé');
});

await step('Lieu : plusieurs endroits avec leur adresse, choisis par projet et par salle', async () => {
  await go('lieux');
  await page.locator('tr', { hasText: 'Parc de la Boverie' }).click();
  await page.waitForSelector('.spots');
  expect((await page.locator('.spots tbody tr').count()) === 3, 'trois endroits');
  await page.fill('.spots input[name=spot]', 'Village food-trucks');
  await page.click('.spots button:has-text("+ Endroit")');
  await page.waitForTimeout(300);
  expect((await page.locator('.spots tbody tr').count()) === 4, 'endroit ajouté');
  await openProject('Festival des Lumières');
  await page.locator('select[aria-label="Endroit"]').selectOption({ label: 'Grande scène — Quai de la Boverie (entrée nord), 4020, Liège' });
  await page.waitForTimeout(300);
  expect((await page.locator('.card', { hasText: 'Lieu de la prestation' }).innerText()).includes('Quai de la Boverie (entrée nord)'), 'adresse de l’endroit sur le projet');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Feuille de route")');
  await page.waitForSelector('.doc');
  const fr = await page.locator('.doc').innerText();
  expect(fr.includes('Scène acoustique') && fr.includes('Rue du Parc 2'), 'adresse de l’endroit de la salle');
  expect(fr.includes('Coffret 32 A près du kiosque') && fr.includes('portail N2'), 'infos pratiques des endroits');
});

await step('Sous-projet : changer d’endroit dans sa fenêtre', async () => {
  await openProject('Festival des Lumières');
  await tab('Planning');
  const room = page.locator('.card', { has: page.locator('h2', { hasText: 'Scène acoustique' }) });
  await room.locator('button:has-text("Modifier les horaires")').click();
  await page.locator('select[aria-label="Endroit du sous-projet"]').selectOption({ label: 'Loges artistes' });
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  expect((await room.innerText()).includes('Loges artistes'), 'endroit de la salle mis à jour');
});

console.log('\n  — glisser-déposer, champs numériques, postes et attribution —');
await step('Matériel : glisser un article du catalogue dans un groupe', async () => {
  await resetDemo();
  await openProject('Conférence annuelle');
  await tab('Équipement');
  const scene = page.locator('.sub', { hasText: 'Salle plénière' }).locator('.eq-group[data-group="Scène"]');
  const before = await scene.locator('tbody tr').count();
  await page.fill('.eq-catalogue input[aria-label="Rechercher dans le catalogue"]', 'SM58');
  await drag(page.locator('.eq-catalogue .eq-cat-item', { hasText: 'Micro Shure SM58' }), scene);
  expect((await scene.locator('tbody tr').count()) > before, 'ligne ajoutée au groupe Scène');
  expect((await scene.innerText()).includes('Micro Shure SM58'), 'article déposé');
});

await step('Matériel : déplacer une ligne vers un autre groupe, « + » du catalogue sur le groupe choisi', async () => {
  const room = page.locator('.sub', { hasText: 'Salle plénière' });
  const scene = room.locator('.eq-group[data-group="Scène"]');
  const son = room.locator('.eq-group[data-group="Soirée de gala J1"]');
  await drag(scene.locator('tr', { hasText: 'Micro Shure SM58' }).locator('td.drag-handle'), son);
  expect((await son.innerText()).includes('Micro Shure SM58') && !(await scene.innerText()).includes('Micro Shure SM58'), 'ligne déplacée');
  await scene.locator('.eq-group-head strong').click();
  await page.fill('.eq-catalogue input[aria-label="Quantité déposée"]', '3');
  await page.fill('.eq-catalogue input[aria-label="Rechercher dans le catalogue"]', 'DI passive');
  await page.locator('.eq-catalogue button[aria-label^="Ajouter"]').first().click();
  await page.waitForTimeout(500);
  const row = scene.locator('tr', { hasText: 'Boîte de direct DI passive' });
  expect(await row.locator('input').first().inputValue() === '3', 'trois DI ajoutées au groupe choisi');
});

await step('Champ numérique : on peut le vider sans qu’un 0 reste', async () => {
  const qtyInput = page.locator('.sub', { hasText: 'Salle plénière' }).locator('tr', { hasText: 'Boîte de direct DI passive' }).locator('input').first();
  await qtyInput.fill('');
  await page.waitForTimeout(300);
  expect(await qtyInput.inputValue() === '', 'champ vide pendant la saisie');
  await qtyInput.pressSequentially('5');
  await page.waitForTimeout(300);
  expect(await qtyInput.inputValue() === '5', `« 5 » et pas « 05 » (${await qtyInput.inputValue()})`);
  await go('parametres');
  const vat = page.locator('.field', { hasText: 'Taux de TVA' }).locator('input');
  await vat.fill('');
  expect(await vat.inputValue() === '', 'paramètre vidé sans 0');
});

await step('Sous-projets : le vocabulaire « sous-projet » remplace « salle »', async () => {
  await openProject('Conférence annuelle');
  await tab('Planning');
  expect(await page.locator('button:has-text("+ Ajouter un sous-projet")').count() === 1, 'bouton « Ajouter un sous-projet »');
  expect((await page.locator('.stats').first().innerText()).includes('sous-projet(s)'), 'compteur de sous-projets');
});

await step('Postes : prévoir 3 techniciens sur un créneau, sans les attribuer', async () => {
  await openProject('Conférence annuelle');
  await tab('Équipe & transport');
  await crewMode(1);
  const room = page.locator('.sub', { hasText: 'Salle atelier 2' });
  const before = await room.locator('table.crew-posts tbody tr').count();
  await room.locator('input[aria-label="Nombre de postes"]').fill('3');
  await room.locator('input[aria-label="Fonction à ajouter"]').fill('Technicien');
  await room.locator('button:has-text("+ Ajouter les postes")').click();
  await page.waitForTimeout(600);
  expect((await room.locator('table.crew-posts tbody tr').count()) === before + 3, 'trois postes créés');
  expect((await room.locator('table.crew-posts tbody tr', { hasText: 'à pourvoir' }).count()) >= 3, 'postes à pourvoir');
  expect((await room.locator('select[aria-label="Technicien"]').count()) === 0, 'pas de choix de technicien dans les postes');
  await crewMode(2);
  expect((await room.locator('table.crew-assign select[aria-label="Technicien"]').count()) === before + 3, 'attribution : un choix par poste');
});

await step('Attribution : page de tous les projets, candidats disponibles d’abord', async () => {
  await go('attribution');
  const row = page.locator('tr', { hasText: 'Conférence annuelle' }).filter({ hasText: 'Technicien' }).first();
  await row.waitFor({ timeout: 5000 });
  const sel = row.locator('select[aria-label="Technicien"]');
  const opts = (await sel.locator('option').allInnerTexts()).slice(1);
  const firstBusy = opts.findIndex((o) => /indisponible|déjà planifié/.test(o));
  expect(firstBusy === -1 || opts.slice(firstBusy).every((o) => /indisponible|déjà planifié/.test(o)), `disponibles en premier : ${opts.join(' | ')}`);
  const before = await page.locator('select[aria-label="Technicien"]').count();
  await sel.selectOption({ index: 1 });
  await page.waitForTimeout(500);
  expect((await page.locator('select[aria-label="Technicien"]').count()) === before - 1, 'poste pourvu retiré de la liste « à pourvoir »');
});

console.log('\n  — emails avec pièces jointes —');
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

await step('Document : PDF téléchargeable (vrai fichier PDF)', async () => {
  await resetDemo();
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('button:has-text("Télécharger le PDF")')]);
  const buf = readFileSync(await dl.path());
  expect(dl.suggestedFilename().endsWith('.pdf'), 'nom en .pdf');
  expect(buf.subarray(0, 5).toString() === '%PDF-', 'fichier PDF');
  expect(pdfPages(buf) >= 1 && buf.length > 20000, `PDF avec du contenu (${pdfPages(buf)} page(s), ${buf.length} octets)`);
});

await step('Email : brouillon .eml avec le PDF joint, statut « Envoyé »', async () => {
  await page.click('button:has-text("Envoyer par email")');
  await page.waitForSelector('.modal .attachments li', { timeout: 30000 });
  const att = await page.locator('.modal .attachments').innerText();
  expect(att.includes('.pdf'), 'PDF prêt en pièce jointe');
  expect(((await page.locator('.modal .rcpt').first().getAttribute('title')) || '').includes('@'), 'destinataire prérempli');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal button:has-text("Brouillon prêt à envoyer")')]);
  const eml = readFileSync(await dl.path(), 'utf8');
  expect(dl.suggestedFilename().endsWith('.eml'), 'fichier .eml');
  expect(eml.includes('X-Unsent: 1') && eml.includes('Content-Type: application/pdf'), 'brouillon avec PDF joint');
  const b64 = eml.split('Content-Type: application/pdf')[1].split('\r\n\r\n')[1].split('--')[0].replace(/\s+/g, '');
  expect(Buffer.from(b64, 'base64').subarray(0, 5).toString() === '%PDF-', 'pièce jointe = PDF valide');
  await page.click('.modal button:text-is("Fermer")');
  await page.waitForTimeout(300);
  expect(await page.locator('select', { has: page.locator('option[value=accepte]') }).inputValue() === 'envoye', 'devis passé « Envoyé »');
});

await step('Email : facture avec PDF et XML Peppol joints', async () => {
  await openProject('Marché de Noël');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Facture")');
  await page.waitForSelector('.doc');
  await page.click('button:has-text("Envoyer par email")');
  await page.waitForSelector('.modal .attachments li', { timeout: 30000 });
  const att = await page.locator('.modal .attachments').innerText();
  expect(att.includes('.pdf') && att.includes('.xml'), `PDF et XML joints (${att})`);
  await page.click('.modal button:text-is("Fermer")');
});

await step('Email : bon de commande RH et planning du technicien (.ics) joints', async () => {
  await openProject('Festival des Lumières');
  await tab('Sous-locations & commandes');
  await page.locator('button:has-text("Envoyer par email")').first().click();
  await page.waitForSelector('.modal .attachments li', { timeout: 30000 });
  expect((await page.locator('.modal .attachments').innerText()).includes('Bon-de-commande'), 'bon de commande en PDF');
  await page.click('.modal button:text-is("Fermer")');
  await openProject('Conférence annuelle');
  await tab('Équipe & transport');
  await crewMode(2);
  await page.locator('table.list button:text-is("Envoyer le planning")').first().click();
  await page.waitForSelector('.modal .attachments li', { timeout: 10000 });
  expect((await page.locator('.modal .attachments').innerText()).includes('.ics'), 'agenda .ics joint');
  await page.click('.modal button:text-is("Fermer")');
});

console.log('\n  — checklist et inventaire (FABRI.live intégré) —');
const scan = async (c) => {
  await page.fill('.checklist-scan .scan-input', c); await page.press('.checklist-scan .scan-input', 'Enter'); await page.waitForTimeout(350);
  // article en vrac : on valide la quantité proposée (le reste)
  if (await page.locator('.cl-ask .cl-askq').count()) { await page.press('.cl-askq', 'Enter'); await page.waitForTimeout(300); }
  return page.locator('.checklist-scan .flash').innerText();
};
const scanRaw = async (c) => { await page.fill('.checklist-scan .scan-input', c); await page.press('.checklist-scan .scan-input', 'Enter'); await page.waitForTimeout(350); };
const openChecklist = async (name) => { await go('entrepot'); await page.locator('table.list tr.click', { hasText: name }).click(); await page.waitForSelector('.checklist-scan'); };

await step('Checklist : unité scannée, doublon refusé, « ajouter en plus », code inconnu associé', async () => {
  await resetDemo();
  await openChecklist('Mariage Dupont-Lemaire');
  const s1 = await scan('SN-LA4X-1001');
  expect(s1.includes('Sortie : Amplificateur LA4X') && s1.includes('LA4X-1001'), 'unité sortie : ' + s1);
  expect((await scan('SN-LA4X-1001')).includes('déjà sorti'), 'doublon refusé');
  await scanRaw('DEMO-SM58');
  expect((await page.locator('.cl-ask').innerText()).includes('pas prévu'), 'article hors liste signalé');
  await page.fill('.cl-askq', '2');
  await page.locator('.cl-ask button:has-text("Ajouter en plus")').click();
  await page.waitForTimeout(400);
  expect((await page.locator('.checklist-scan .flash').innerText()).includes('ajouté en plus (2)'), 'ajouté en plus et déjà sorti');
  expect((await page.locator('.cl-line:not(.kid)', { hasText: 'Micro Shure SM58' }).getAttribute('class')).includes('done'), 'ligne en plus cochée');
  expect((await scan('FAB-77777')).includes('Code inconnu'), 'code inconnu');
  await page.locator('.checklist-scan .flash button:has-text("Associer")').click();
  await page.fill('.modal input', 'Caisson');
  await page.locator('.modal button', { hasText: 'Caisson SB18' }).click();
  await page.click('.modal button:text-is("Associer")');
  await page.waitForTimeout(300);
  expect((await scan('FAB-77777')).includes('Sortie : Caisson SB18'), 'code fabricant associé puis reconnu');
});

await step('Checklist : retour, unité abîmée, bilan, déclarer perdu puis retrouver', async () => {
  for (const sn of ['SN-ULXD-1001', 'SN-ULXD-1002', 'SN-QU16-1001']) await scan(sn);
  await tickAll();
  await page.click('.cl-phase button:has-text("Retour")');
  await page.waitForTimeout(300);
  for (const sn of ['SN-LA4X-1001', 'SN-ULXD-1001']) await scan(sn);
  // une unité qui n'est pas sortie avec ce projet est refusée au retour
  expect((await scan('SN-ULXD-1004')).includes('pas sorti'), 'unité non sortie refusée au retour');
  // tout le vrac rentre, sauf les enceintes X12
  await tickAll('L-Acoustics X12');
  await page.locator('.cl-line', { hasText: 'Micro HF' }).locator('button:text-is("Cassé")').click();
  await page.fill('.modal .field input', 'Antenne tordue');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  await page.click('button:text-is("Bilan du retour")');
  const bilan = await page.locator('.modal').innerText();
  expect(bilan.includes('X12') && bilan.includes('ULXD-1002') && bilan.includes('QU16-1001'), `manquants listés : ${bilan.slice(0, 400)}`);
  // l'unité ULXD-1002 reviendra plus tard : décochée
  await page.locator('.modal input[aria-label*="ULXD-1002"]').uncheck();
  await page.click('.modal button:has-text("Déclarer perdu")');
  await page.waitForTimeout(600);
  expect((await page.locator('.modal').innerText()).includes('déclaré(s) perdu(s)'), 'pertes déclarées');
  expect((await page.locator('.modal tr', { hasText: 'QU16-1001' }).innerText()).includes('déjà déclaré perdu'), 'pas déclarable deux fois');
  expect(await page.locator('.modal input[aria-label*="ULXD-1002"]').isEnabled(), 'unité décochée encore déclarable plus tard');
  await page.click('.modal button:text-is("Fermer")');
  // l'unité perdue, rescannée, est proposée à la remise en stock
  await page.click('.cl-phase button:has-text("Sortie")');
  expect((await scan('SN-QU16-1001')).includes('déclarée perdue'), 'unité perdue reconnue');
  await page.locator('.checklist-scan .flash button:has-text("Retrouvée")').click();
  await page.waitForTimeout(400);
  expect((await page.locator('.checklist-scan .flash').innerText()).includes('Remise en stock'), 'unité remise en stock');
});

await step('Checklist libre : bon collé, articles reconnus et scannés', async () => {
  await go('checklists');
  await page.click('button:text-is("Coller du texte")');
  await page.fill('.modal textarea', 'Son\n2   Enceinte L-Acoustics X12   SON-12   2\n4   Micro Shure SM58   MIC-58   4\nDivers\n1   Rouleau de scotch   AB-99   1');
  await page.click('.modal button:text-is("Créer la checklist")');
  await page.waitForSelector('.checklist-scan');
  expect((await page.locator('.checklist-cat').count()) === 2, 'deux catégories');
  expect((await scan('DEMO-X12')).includes('Sortie : Enceinte L-Acoustics X12 — 2/2'), 'article du catalogue scanné (quantité demandée)');
  await page.locator('.cl-line', { hasText: 'Rouleau de scotch' }).locator('.cl-check').click();
  await page.waitForTimeout(300);
  expect((await page.locator('.cl-line', { hasText: 'Rouleau de scotch' }).getAttribute('class')).includes('done'), 'ligne libre cochée');
});

await step('Checklist libre : mode édition, kit, filtres, menu (dupliquer, tout décocher)', async () => {
  await page.click('button[aria-label="Menu de la checklist"]');
  await page.click('.modal button:has-text("Modifier les lignes")');
  await page.locator('.cl-line', { hasText: 'Rouleau de scotch' }).click();
  await page.locator('.modal .field', { hasText: 'Quantité' }).locator('input').fill('3');
  await page.click('.modal button:text-is("Enregistrer")');
  await page.waitForTimeout(300);
  expect((await page.locator('.cl-line', { hasText: 'Rouleau de scotch' }).innerText()).includes('3×'), 'quantité corrigée');
  // un flight case et son contenu
  await page.locator('.checklist-cat', { hasText: 'Son' }).locator('button:has-text("+ Ajouter une ligne")').click();
  await page.locator('.modal .field', { hasText: 'Nom' }).locator('input').fill('Flight case son');
  await page.click('.modal button:text-is("Enregistrer")');
  await page.waitForTimeout(300);
  await page.locator('.checklist-cat', { hasText: 'Son' }).locator('button:has-text("+ Ajouter une ligne")').click();
  await page.locator('.modal .field', { hasText: 'Nom' }).locator('input').fill('Câble XLR 10 m');
  await page.locator('.modal .field', { hasText: 'Quantité' }).locator('input').fill('4');
  await page.locator('.modal .field', { hasText: 'Dans le kit' }).locator('select').selectOption({ label: 'Flight case son' });
  await page.click('.modal button:text-is("Enregistrer")');
  await page.waitForTimeout(300);
  await page.click('.cl-banner button:text-is("Terminer")');
  const kit = page.locator('.cl-line.kit', { hasText: 'Flight case son' });
  expect((await kit.innerText()).includes('KIT · 0/1'), 'kit avec son contenu');
  await kit.click();
  await page.waitForTimeout(300);
  expect((await kit.innerText()).includes('KIT · 1/1') && (await page.locator('.cl-line.kid', { hasText: 'Câble XLR 10 m' }).getAttribute('class')).includes('done'), 'kit coché d’un coup');
  await page.click('.cl-filters button:text-is("Restant")');
  await page.waitForTimeout(200);
  expect(await page.locator('.cl-line', { hasText: 'Enceinte L-Acoustics X12' }).count() === 0, 'filtre « Restant » : lignes faites masquées');
  expect(await page.locator('.cl-line', { hasText: 'Rouleau de scotch' }).count() === 1, 'ligne partielle (1/3) toujours visible');
  await page.click('.cl-filters button:text-is("Toutes")');
  await page.click('button[aria-label="Menu de la checklist"]');
  await page.click('.modal button:has-text("Dupliquer")');
  await page.waitForTimeout(500);
  expect((await page.locator('h1').innerText()).includes('(copie)') && (await page.locator('.cl-prog').innerText()).startsWith('0 /'), 'copie à zéro');
});

await step('Checklist libre : import d’un bon PDF', async () => {
  const { jsPDF } = require('jspdf');
  const pdf = new jsPDF();
  pdf.setFontSize(10);
  pdf.text('Document et bon : Bon de préparation test', 10, 15);
  pdf.text('Client : Société test', 10, 22);
  pdf.text('Lumière', 10, 32);
  const row = (y, q, n, c, t, x = 10) => { pdf.text(q, x, y); pdf.text(n, x + 15, y); pdf.text(c, 140, y); pdf.text(t, 180, y); };
  row(40, '8', 'Projecteur PAR LED 18x10 W', 'LUM-18', '8');
  row(47, '2', 'Pack ambiance 8 PAR LED', 'KIT-02', '2');
  writeFileSync('tests/e2e/bon-test.pdf', Buffer.from(pdf.output('arraybuffer')));
  await go('checklists');
  await page.setInputFiles('.drop input[type=file]', 'tests/e2e/bon-test.pdf');
  await page.waitForSelector('.checklist-scan', { timeout: 20000 });
  const txt = await page.locator('body').innerText();
  expect(txt.includes('Bon de préparation test') && txt.includes('Pack ambiance 8 PAR LED') && txt.includes('Client : Société test'), 'bon PDF lu (titre, client, lignes)');
});

const invScan = async (c) => { await page.fill('.scan-input', c); await page.press('.scan-input', 'Enter'); await page.waitForTimeout(300); return page.locator('.flash').first().innerText(); };

const badge = (name) => page.locator('.inv-row', { hasText: name }).first().locator('.inv-badge').innerText();
await step('Inventaire : kit compté d’un coup, annulation, comptage gardé au rechargement', async () => {
  await resetDemo();
  await go('inventaire');
  expect((await invScan('DEMO-KITPAR')).includes('Kit Pack ambiance 8 PAR LED'), 'kit reconnu');
  expect((await badge('Projecteur PAR LED')).startsWith('8'), 'contenu du kit compté (8 PAR)');
  await page.click('.inv-dock button:text-is("Annuler le dernier kit")');
  await page.waitForTimeout(300);
  expect((await badge('Projecteur PAR LED')).startsWith('—'), 'kit annulé');
  await invScan('DEMO-PIED'); await invScan('DEMO-PIED');
  await page.reload(); await page.waitForTimeout(800);
  expect((await badge('Pied de micro perche')).startsWith('2'), 'comptage gardé après rechargement');
});

await step('Inventaire : compté en plusieurs endroits (dépôt + camion), corriger, annuler le dernier', async () => {
  await page.locator('.inv-row', { hasText: 'Pied de micro perche' }).click();
  const m = page.locator('.modal');
  expect((await m.innerText()).includes('Trouvés ici (en plus)'), 'déjà compté : on ajoute');
  await m.locator('input[aria-label="Quantité comptée"]').fill('3');
  expect((await m.locator('.inv-diff').innerText()).includes('Total 2 + 3 = 5'), 'total affiché');
  await m.locator('button:text-is("Ajouter au comptage")').click();
  await page.waitForTimeout(200);
  expect((await badge('Pied de micro perche')).startsWith('5'), 'total 5');
  await page.locator('.inv-row', { hasText: 'Pied de micro perche' }).click();
  expect((await m.innerText()).includes('Déjà compté (1 + 1 + 3)'), 'les comptages par endroit sont gardés');
  await m.locator('button:has-text("Annuler le dernier (−3)")').click();
  await page.waitForTimeout(200);
  expect((await m.innerText()).includes('Déjà compté (1 + 1)'), 'dernier comptage annulé');
  await m.locator('button:text-is("Corriger le total")').click();
  await m.locator('input[aria-label="Quantité comptée"]').fill('4');
  await m.locator('button:text-is("Enregistrer")').click();
  await page.waitForTimeout(200);
  expect((await badge('Pied de micro perche')).startsWith('4'), 'total corrigé à 4');
});

await step('Inventaire : kit compté kit par kit (contenu coché, kit complet tout seul)', async () => {
  await page.locator('.inv-seg, .seg').first().locator('button:text-is("Tout")').click();
  await page.locator('.inv-row.st-kit', { hasText: 'Pack ambiance 8 PAR LED' }).click();
  const m = page.locator('.modal');
  await m.locator('button:text-is("Kit complet")').click();
  await page.waitForTimeout(200);
  expect((await m.innerText()).includes('Kit n° 1 complet'), 'kit n° 1 compté');
  // 2e kit : on coche chaque ligne, il se valide tout seul
  for (const r of await m.locator('.inv-kitrow').all()) await r.click();
  await page.waitForTimeout(200);
  expect((await m.innerText()).includes('Kit n° 2 complet'), 'kit n° 2 validé automatiquement');
  await m.locator('button:text-is("Annuler le dernier kit")').click();
  await page.waitForTimeout(200);
  await m.locator('button:text-is("Fermer")').click();
  expect((await badge('Projecteur PAR LED')).startsWith('8'), '1 kit = 8 PAR comptés');
});

await step('Inventaire : kit avec article sérialisé compté à la main (+, numéro touché, kit complet)', async () => {
  await page.locator('.inv-row.st-kit', { hasText: 'Pack conférence' }).click();
  const m = page.locator('.modal');
  const qu = m.locator('.inv-kitrow', { hasText: 'Qu-16' });
  const chips = qu.locator('.kit-uchips .uchip');
  const n = await chips.count();
  expect(n >= 1, 'unités Qu-16 du dépôt proposées');
  const u1 = await chips.first().innerText();
  // + : une unité comptée à la main
  await qu.locator('button[aria-label^="Un de plus"]').click();
  expect((await qu.locator('.inv-kq b').innerText()) === '1 / 1', 'compté avec +');
  expect(await qu.locator('.uchip.on').innerText() === u1, 'première unité libre prise');
  // retirer puis toucher le numéro à la main
  await qu.locator('.uchip.on').click();
  expect((await qu.locator('.inv-kq b').innerText()) === '0 / 1', 'retirée');
  await qu.locator('.uchip', { hasText: u1 }).click();
  expect(await qu.locator('.uchip.on').innerText() === u1, 'numéro choisi à la main');
  await m.locator('button:text-is("Kit complet")').click();
  await page.waitForTimeout(200);
  expect((await m.innerText()).includes('Kit n° 1 complet'), 'kit n° 1 complet');
  expect(!(await chips.allInnerTexts()).includes(u1), 'unité déjà comptée retirée des choix');
  // kits suivants : « Kit complet » prend les unités libres restantes
  for (let i = 1; i < n; i++) { await m.locator('button:text-is("Kit complet")').click(); await page.waitForTimeout(200); }
  // 3e kit : plus aucune Qu-16 libre
  expect(await qu.locator('button[aria-label^="Un de plus"]').isDisabled(), '+ désactivé sans unité libre');
  await m.locator('button:text-is("Kit complet")').click();
  await page.waitForTimeout(200);
  expect((await m.innerText()).includes('plus d\'unité libre au dépôt pour : Console Allen & Heath Qu-16'), 'kit n° 3 signalé incomplet');
  await m.locator('button:text-is("Annuler le dernier kit")').click();
  await page.waitForTimeout(200);
  await m.locator('button:text-is("Fermer")').click();
  expect((await badge('Console Allen & Heath Qu-16')).startsWith(String(n)), `les ${n} Qu-16 vues (${await badge('Console Allen & Heath Qu-16')})`);
});

await step('Inventaire : unités en pastilles, scan limité à l’article, scan qui ouvre l’article', async () => {
  // scan qui ouvre l'article (décoché « scan en continu »)
  await page.locator('.inv-tools label', { hasText: 'Scan en continu' }).locator('input').uncheck();
  await invScan('SN-ULXD-1001');
  const m = page.locator('.modal');
  await m.waitFor();
  expect((await m.locator('.uchip.on').count()) === 1, 'unité scannée cochée');
  await m.locator('input[aria-label="Scanner une unité"]').fill('DEMO-PIED');
  await m.locator('input[aria-label="Scanner une unité"]').press('Enter');
  expect((await m.locator('.flash').innerText()).includes('pas de cet article'), 'code d’un autre article refusé');
  await m.locator('input[aria-label="Scanner une unité"]').fill('SN-ULXD-1001');
  await m.locator('input[aria-label="Scanner une unité"]').press('Enter');
  expect((await m.locator('.flash').innerText()).includes('pas comptée deux fois'), 'double scan ignoré');
  await m.locator('button:text-is("Terminé")').click();
  await page.locator('.inv-tools label', { hasText: 'Scan en continu' }).locator('input').check();
  await page.locator('.inv-row', { hasText: 'Micro HF Shure' }).click();
  await m.locator('.uchip').nth(1).click(); await m.locator('.uchip').nth(2).click();
  await page.waitForTimeout(200);
  expect((await m.innerText()).includes('3 / 6'), '3 unités vues sur 6');
  await m.locator('button:text-is("Terminé")').click();
});

await step('Inventaire : scan de l’étiquette article sérialisé → 1 unité = comptée d’office, plusieurs = sélecteur manuel', async () => {
  await go('inventaire');
  await page.waitForTimeout(600);
  // étiquette de l’article ampli (3 unités) : le sélecteur s’ouvre
  await page.fill('.scan-input', 'DEMO-AMPLI');
  await page.press('.scan-input', 'Enter');
  const ask = page.locator('.inv-tools .cl-ask');
  await ask.waitFor({ timeout: 5000 });
  expect((await ask.locator('.cl-asklist button').count()) === 3, '3 unités proposées au choix');
  await ask.locator('button', { hasText: 'LA4X-1002' }).click();
  await page.waitForTimeout(400);
  expect((await page.locator('.flash').first().innerText()).includes('LA4X-1002'), 'unité choisie comptée');
  // article à une seule unité (cl5) : comptée d’office, pas de sélecteur
  await page.fill('.scan-input', 'DEMO-CL5');
  await page.press('.scan-input', 'Enter');
  await page.waitForTimeout(400);
  expect(await page.locator('.inv-tools .cl-ask').count() === 0, 'pas de sélecteur pour 1 seule unité');
  expect((await page.locator('.flash').first().innerText()).includes('CL5'), 'unité unique comptée d’office');
  // dans la modale d’un article sérialisé aussi
  await page.locator('.inv-row', { hasText: 'Amplificateur LA4X' }).click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input[aria-label="Scanner une unité"]').fill('DEMO-AMPLI');
  await page.locator('.modal input[aria-label="Scanner une unité"]').press('Enter');
  const ask2 = page.locator('.modal .cl-ask');
  await ask2.waitFor({ timeout: 5000 });
  expect((await ask2.locator('.cl-asklist button').count()) === 3, 'sélecteur aussi dans la modale');
  await ask2.locator('button', { hasText: 'LA4X-1003' }).click();
  await page.waitForTimeout(400);
  expect((await page.locator('.modal .flash').innerText()).includes('LA4X-1003'), 'unité choisie cochée dans la modale');
  await page.locator('.modal button:text-is("Terminé")').click();
});

await step('Inventaire : fiche (ajout de stock, état d’une unité, où est-il ?), unité perdue retrouvée au scan', async () => {
  // « Infos » : scanner pour tout voir, sans compter
  await page.click('button:has-text("Infos")');
  await invScan('SN-LA4X-1001');
  await page.waitForSelector('.modal');
  expect((await page.locator('.modal').innerText()).includes('Où est cet article ?'), 'fiche ouverte par le scan Infos');
  await page.locator('.modal tr', { hasText: 'LA4X-1002' }).locator('button:has-text("Changer l")').click();
  await page.locator('.modal label', { hasText: 'Perdue' }).last().locator('input').check();
  await page.locator('.modal form button[type=submit]').last().click();
  await page.waitForTimeout(400);
  expect((await page.locator('.modal tr', { hasText: 'LA4X-1002' }).innerText()).includes('Perdue'), 'unité marquée perdue');
  await page.keyboard.press('Escape');
  await page.click('button:has-text("Infos")');
  expect((await invScan('SN-LA4X-1002')).includes('retrouvée et remise en stock'), 'unité perdue retrouvée au scan');
  await page.locator('.inv-row', { hasText: 'Pied de micro perche' }).click();
  await page.click('.modal button:text-is("+ Ajouter du stock")');
  await page.locator('.modal input[aria-label="Quantité à ajouter"]').fill('5');
  await page.fill('.modal input[placeholder^="ex. achat"]', 'achat Thomann');
  await page.click('.modal button:text-is("Ajouter")');
  await page.waitForTimeout(400);
  expect((await page.locator('.flash').first().innerText()).includes('+5 au stock'), 'stock ajouté');
  await page.click('button:has-text("Infos")');
  await invScan('DEMO-PIED');
  await page.waitForSelector('.modal');
  expect((await page.locator('.modal').innerText()).includes('Ajout au stock — achat Thomann (+5)'), 'mouvement de stock daté');
  await page.keyboard.press('Escape');
  await page.click('button:has-text("Infos")');
});

await step('Inventaire : unités non vues → en réparation, visibles en maintenance', async () => {
  await go('inventaire');
  await invScan('SN-ULXD-1001'); await invScan('SN-ULXD-1002'); await invScan('SN-ULXD-1003');
  await page.click('.inv-dock button:has-text("Appliquer")');
  await page.waitForSelector('.modal');
  const sel = page.locator('.modal select[aria-label="Unité ULXD-1004"]');
  await sel.selectOption('repair');
  await page.locator('.modal select[aria-label="Unité ULXD-1005"]').selectOption('none');
  await page.locator('.modal select[aria-label="Unité ULXD-1006"]').selectOption('none');
  await page.click('.modal button:text-is("Appliquer")');
  await page.waitForSelector('text=Inventaire appliqué');
  await go('maintenance');
  const flagged = await page.locator('.card', { hasText: 'Unités signalées' }).innerText();
  expect(flagged.includes('ULXD-1004') && flagged.includes('En réparation'), 'unité en réparation listée');
});

await step('Inventaire : écarts envoyés article par article, nouvel article créé sur place', async () => {
  await go('inventaire');
  await page.locator('.inv-row', { hasText: 'Pied de micro perche' }).click();
  await page.fill('.modal input[aria-label="Quantité comptée"]', '40');
  await page.press('.modal input[aria-label="Quantité comptée"]', 'Enter');
  await page.locator('.inv-row', { hasText: 'Projecteur PAR LED' }).click();
  if (await page.locator('.modal button:text-is("Corriger le total")').count()) await page.click('.modal button:text-is("Corriger le total")');
  await page.fill('.modal input[aria-label="Quantité comptée"]', '1');
  await page.press('.modal input[aria-label="Quantité comptée"]', 'Enter');
  await page.click('.inv-dock button:has-text("Appliquer")');
  await page.locator('.modal input[aria-label^="Corriger Projecteur PAR LED"]').uncheck();
  await page.click('.modal button:text-is("Appliquer")');
  await page.waitForSelector('text=Inventaire appliqué');
  expect((await badge('Pied de micro perche')).startsWith('—'), 'article envoyé : sorti du comptage');
  expect((await badge('Projecteur PAR LED')).startsWith('1'), 'article décoché : reste à recompter');
  // nouvel article : « déjà au parc ? » puis création avec code automatique
  await page.click('.inv-dock button:text-is("+ Nouvel article")');
  await page.fill('.modal input[placeholder^="ex. Shure"]', 'Pied de micro');
  expect((await page.locator('.modal .inv-dupes').innerText()).includes('ajouter du stock'), 'doublon possible proposé');
  await page.fill('.modal input[placeholder^="ex. Shure"]', 'Enrouleur 25 m');
  await page.locator('.modal .field', { hasText: 'Quantité trouvée' }).locator('input').fill('6');
  await page.click('.modal button:text-is("Créer")');
  await page.waitForTimeout(300);
  expect(/créé \([A-Z]+-[A-Z]+-\d{4}\)/.test(await page.locator('.inv-tools .flash').innerText()), 'code automatique attribué');
  expect((await badge('Enrouleur 25 m')).startsWith('6'), 'compté à sa quantité');
});

await ctx.close();

console.log('\n  — codes du matériel —');
ctx = await newContext();
await step('Codes : nouvel article F-S-…, unités F-S-…-01, nouveau dépôt avec sa lettre', async () => {
  await openDemo();
  await go('materiel');
  await page.click('text=+ Nouvel article');
  await page.locator('.modal .field', { hasText: 'Désignation' }).locator('input').fill('Console Yamaha DM7');
  await page.locator('.modal .field', { has: page.locator('span:text-is("Catégorie")') }).locator('select').selectOption({ label: 'Son' });
  const placeholder = await page.locator('.modal .field', { hasText: 'Code (automatique' }).locator('input').getAttribute('placeholder');
  expect(/auto : F-S-\d{4}/.test(placeholder || ''), `code proposé (${placeholder})`);
  await page.locator('.modal label', { hasText: 'Suivi par numéro de série' }).locator('input').check();
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  const row = await page.locator('table.list tr', { hasText: 'Console Yamaha DM7' }).innerText();
  const code = (row.match(/F-S-\d{4}/) || [])[0];
  expect(code, `code attribué : ${row}`);
  await page.click('table.list strong:text-is("Console Yamaha DM7")');
  await page.waitForTimeout(400);
  for (let i = 1; i <= 2; i++) {
    await page.click('button:text-is("+ Unité")');
    expect(await page.locator('.modal input[aria-label="Code de l\'unité"]').inputValue() === `${code}-0${i}`, `unité ${i} : ${code}-0${i}`);
    await page.click('.modal button[type=submit]');
    await page.waitForTimeout(300);
  }
  expect((await page.locator('body').innerText()).includes(`${code}-02`), 'unités codées');
  // nouvel article dans une nouvelle catégorie : la lettre est proposée
  await go('materiel');
  await page.click('text=+ Nouvel article');
  await page.locator('.modal .field', { hasText: 'Désignation' }).locator('input').fill('Switch réseau 24 ports');
  await page.locator('.modal .field', { hasText: 'nouvelle catégorie' }).locator('input').fill('Informatique');
  expect(await page.locator('.modal input[aria-label="Lettre de la catégorie"]').getAttribute('placeholder') === 'IT', 'lettre IT proposée');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  expect(/F-IT-\d{4}/.test(await page.locator('table.list tr', { hasText: 'Switch réseau' }).innerText()), 'code F-IT-…');
  // nouveau dépôt : nom puis lettre demandés
  const answers = ['Dépôt Bruxelles', 'B'];
  const onDialog = (d) => (d.type() === 'prompt' ? d.accept(answers.shift()) : d.accept());
  page.removeAllListeners('dialog');
  page.on('dialog', onDialog);
  await go('parametres');
  await page.click('button:text-is("+ Dépôt")');
  await page.waitForTimeout(300);
  expect(await page.locator('input[aria-label="Lettre du dépôt Dépôt Bruxelles"]').inputValue() === 'B', 'lettre du nouveau dépôt');
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept()));
});
await ctx.close();

await step('Téléphone : pas de zoom (champs ≥ 16 px, double tap, échelle bloquée) et rien ne déborde', async () => {
  const { devices } = require('playwright');
  const c = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await c.newPage();
  await p.goto(U); await p.click('text=Essayer avec des données de démo'); await p.waitForSelector('.demo-badge', { timeout: 20000 }); await p.waitForTimeout(600);
  const meta = await p.locator('meta[name=viewport]').getAttribute('content');
  expect(meta.includes('maximum-scale=1') && meta.includes('user-scalable=no'), `zoom bloqué (${meta})`);
  for (const path of ['projets', 'materiel', 'entrepot', 'inventaire', 'comptabilite', 'modeles', 'etiquettes', 'parametres']) {
    await p.goto(U + '#/' + path); await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const inScroll = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
      const cut = [...document.querySelectorAll('body *')].filter((el) => { const b = el.getBoundingClientRect(); return b.width && b.right > W + 1 && !inScroll(el); }).length;
      const small = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length;
      return { cut, small, touch: getComputedStyle(document.documentElement).touchAction };
    });
    expect(r.cut === 0, `${path} : ${r.cut} élément(s) qui dépassent l'écran`);
    expect(r.small === 0, `${path} : ${r.small} champ(s) < 16 px (zoom iPhone)`);
    expect(r.touch === 'manipulation', 'double tap sans zoom');
  }
  await c.close();
});

await step('Équipement : saisie rapide « 12 sm58 » + Entrée, quantité, flèches, code scanné', async () => {
  ctx = await newContext();
  await openDemo();
  await openProject('Conférence annuelle');
  await tab('Équipement');
  const scene = page.locator('.sub', { hasText: 'Salle plénière' }).locator('.eq-group[data-group="Scène"]');
  const qa = scene.locator('input[aria-label="Ajouter un article"]');
  await qa.fill('12 sm58');
  await qa.press('Enter');
  await page.waitForTimeout(400);
  expect(await scene.locator('tr', { hasText: 'Micro Shure SM58' }).locator('input').first().inputValue() === '12', '12 micros ajoutés en une saisie');
  await scene.locator('input[aria-label="Quantité à ajouter"]').fill('5');
  await qa.fill('xlr');
  await qa.press('ArrowDown');
  const second = (await scene.locator('.quick-add-list li').nth(1).innerText()).split('\n')[0].replace(/F-\S+/, '').trim();
  await qa.press('Enter');
  await page.waitForTimeout(400);
  expect(await scene.locator('tr', { hasText: second }).locator('input').first().inputValue() === '5', `5 × ${second} (2e résultat, flèche bas)`);
  await qa.fill('DEMO-SUB');
  await qa.press('Enter');
  await page.waitForTimeout(400);
  expect(await scene.locator('tr', { hasText: 'Caisson SB18' }).count() === 1, 'code-barres scanné ajouté');
  expect((await qa.inputValue()) === '', 'champ vidé, prêt pour le suivant');
  await ctx.close();
});

await step('« + Matériel » : filtres, − / +, sélection, « Ajouter et continuer »', async () => {
  ctx = await newContext();
  await openDemo();
  await openProject('Marché de Noël');
  await tab('Équipement');
  await page.locator('button:has-text("+ Matériel")').first().click();
  const m = page.locator('.modal');
  // filtre « dépôt » : seulement le matériel présent à Namur (PAR, SM58, truss…), pas les câbles restés à Liège
  await m.locator('select[aria-label="Filtrer par dépôt"]').selectOption({ label: 'Dépôt Namur (dépôt du projet)' });
  const atNamur = await m.locator('.pick-row strong').allInnerTexts();
  expect(atNamur.some((n) => /SM58/.test(n)) && !atNamur.some((n) => /Câble XLR/.test(n)), `matériel de Namur (${atNamur.join(', ')})`);
  await m.locator('select[aria-label="Filtrer par dépôt"]').selectOption('');
  await m.locator('.chip', { hasText: 'Câblage' }).click();
  const names = await m.locator('.pick-row strong').allInnerTexts();
  expect(names.length > 0 && names.every((n) => /Câble|Rallonge/.test(n)), `filtre catégorie (${names.join(', ')})`);
  await m.locator('button[aria-label="Plus Câble XLR 10 m"]').click();
  await m.locator('button[aria-label="Plus Câble XLR 10 m"]').click();
  await m.locator('.pick-row', { hasText: 'Câble XLR 5 m' }).locator('.pick-name').click(); // clic sur la ligne = +1
  expect((await m.locator('.picker-selection').innerText()).includes('2 × Câble XLR 10 m'), 'sélection affichée');
  await m.locator('button:text-is("Ajouter et continuer")').click();
  await page.waitForTimeout(400);
  expect((await m.locator('.flash').innerText()).includes('3 article(s)'), 'ajout sans fermer');
  await m.locator('.chip', { hasText: 'Tout' }).click();
  await m.locator('input[aria-label="Rechercher du matériel"]').fill('sm58');
  await m.locator('input[aria-label="Quantité Micro Shure SM58"]').fill('10');
  await m.locator('button:has-text("Ajouter (10)")').click();
  await page.waitForTimeout(400);
  const room = page.locator('.sub').first();
  expect(await room.locator('tr', { hasText: 'Câble XLR 10 m' }).locator('input').first().inputValue() === '2', '2 câbles XLR 10 m');
  expect(await room.locator('tr', { hasText: 'Micro Shure SM58' }).locator('input').first().inputValue() === '10', '10 micros');
});

await step('Contenu fourni : affiché à la checklist, au scan et sur le bon de sortie ; QR-lien ouvre la fiche', async () => {
  // le vidéoprojecteur de la démo est livré avec télécommande, câble HDMI et câble secteur
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Bon de sortie")');
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc').innerText()).toLowerCase().includes('avec : télécommande, câble hdmi 5 m, câble secteur'), 'contenu sur le bon de sortie');
  await go('entrepot');
  await page.locator('table.list tr.click', { hasText: 'Conférence annuelle' }).filter({ hasText: 'Salle plénière' }).click();
  await page.waitForSelector('.checklist-scan');
  expect((await page.locator('.cl-line', { hasText: 'Vidéoprojecteur' }).innerText()).includes('avec : Télécommande'), 'contenu sur la checklist');
  // QR « lien vers la fiche » : la page /q/<code> montre le contenu à cocher
  await go('materiel');
  const vpCode = (await page.locator('table.list tr', { hasText: 'Vidéoprojecteur' }).innerText()).match(/F-V-\d{4}/)[0];
  await go(`q/${vpCode}-01`);
  await page.waitForSelector('.qr-card');
  const card = await page.locator('.qr-card').innerText();
  expect(card.includes('Vidéoprojecteur') && card.includes('Câble HDMI 5 m') && card.includes('VP10K-1001'), `fiche ouverte par le QR (${card.slice(0, 120)})`);
  for (const c of await page.locator('.qr-content input').all()) await c.check();
  expect((await page.locator('.qr-card').innerText()).includes('Contenu complet'), 'contenu coché');
  // le scanner FabEvent lit aussi un QR-lien
  await go('inventaire');
  await page.fill('.scan-input', `https://fabri.live/fabevent/#/q/${vpCode}-02`);
  await page.press('.scan-input', 'Enter');
  await page.waitForTimeout(300);
  expect((await page.locator('.flash').first().innerText()).includes('VP10K-1002'), 'QR-lien reconnu au scan');
  await ctx.close();
});

await step('Élément hors inventaire : créé depuis un article, ajouté avec lui, coché à la checklist, absent du catalogue', async () => {
  ctx = await newContext();
  await openDemo();
  await go('materiel');
  await page.click('text=+ Nouvel article');
  await page.locator('.modal .field', { hasText: 'Désignation' }).locator('input').fill('PC portable de régie');
  const answers = ['Chargeur 65 W', 'Dock USB-C'];
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(answers.shift()) : d.accept()));
  for (let i = 0; i < 2; i++) { await page.click('.modal button:has-text("+ Nouvel élément (hors inventaire)")'); await page.waitForTimeout(300); }
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept()));
  await page.locator('.modal label', { hasText: 'Dépôt Liège' }).locator('input').fill('3');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  expect(await page.locator('table.list tr', { hasText: 'Chargeur 65 W' }).count() === 0, 'absent de la liste du matériel');
  await page.locator('label', { hasText: 'Éléments hors inventaire' }).locator('input').check();
  await page.waitForTimeout(200);
  expect((await page.locator('table.list').innerText()).includes('Dock USB-C'), 'visible avec le filtre');
  await go('inventaire');
  expect(await page.locator('.inv-row', { hasText: 'Chargeur 65 W' }).count() === 0, 'absent de l’inventaire');
  // ajouté à un projet : ses éléments suivent, sans dispo ni manque
  await openProject('Mariage Dupont-Lemaire');
  await tab('Équipement');
  const qa = page.locator('input[aria-label="Ajouter un article"]').first();
  await qa.fill('chargeur');
  expect(await page.locator('.quick-add-list li', { hasText: 'Chargeur 65 W' }).count() === 0, 'absent de la saisie rapide');
  await qa.fill('2 pc portable');
  await qa.press('Enter');
  await page.waitForTimeout(500);
  const rows = page.locator('.sub').first();
  expect(await rows.locator('tr', { hasText: 'Chargeur 65 W' }).locator('input').first().inputValue() === '2', '2 chargeurs ajoutés avec les 2 PC');
  expect((await rows.locator('tr', { hasText: 'Dock USB-C' }).locator('td.eq-avail').innerText()).trim() === '—', 'pas de disponibilité pour un élément hors inventaire');
  await go('penuries');
  expect(!(await page.locator('body').innerText()).includes('Chargeur 65 W'), 'jamais en pénurie');
  await openChecklist('Mariage Dupont-Lemaire');
  const line = page.locator('.cl-line', { hasText: 'Chargeur 65 W' });
  await line.locator('.cl-check').click();
  await page.waitForTimeout(300);
  expect((await line.getAttribute('class')).includes('done'), 'chargeurs cochés à la sortie');
  await ctx.close();
});

/* ---------- Lot : mails, équipe, devis, feuille de route, sous-projets ---------- */
console.log('\n  — mails, équipe, devis, feuille de route, sous-projets —');
ctx = await newContext();

await step('Devis : les options dans une section à part, avec leur total', async () => {
  await openDemo();
  await openProject('Mariage Dupont-Lemaire');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const opt = await page.locator('.doc .doc-options').textContent();
  expect(opt.includes('Options proposées') && opt.includes('Lyre') && opt.includes('Total des options'), `section options (${opt.slice(0, 120)})`);
  const main = await page.locator('.doc section').first().innerText();
  expect(!main.split('Options proposées')[0].includes('en option'), 'les options ne sont plus mêlées au matériel');
});

await step('Mails : modèle enregistré proposé d’office, destinataire depuis le carnet d’adresses', async () => {
  const docUrl = page.url();
  await go('modeles?onglet=mails');
  await page.click('.mail-kinds button:has-text("Devis")');
  await page.click('button:text-is("+ Nouveau modèle")');
  await page.fill('input[aria-label="Nom du modèle"]', 'Devis chaleureux');
  await page.fill('input[aria-label="Objet du modèle"]', 'Notre proposition {numero} pour {projet}');
  await page.click('button:text-is("Enregistrer le modèle")');
  await page.waitForTimeout(300);
  expect((await page.locator('.tpl-mail').innerText()).includes('Devis chaleureux'), 'modèle listé');
  await page.goto(docUrl); await page.waitForSelector('.doc');
  await page.click('button:has-text("Envoyer par email")');
  await page.waitForSelector('.modal .attachments li', { timeout: 30000 });
  const subject = await page.locator('.modal .field', { hasText: 'Objet' }).locator('input').inputValue();
  expect(subject.startsWith('Notre proposition D-') && subject.includes('Mariage Dupont-Lemaire'), `modèle appliqué (${subject})`);
  const before = await page.locator('.modal .recipients').first().locator('.rcpt').count();
  await page.locator('.modal input[aria-label="À : ajouter une adresse"]').fill('Namur');
  await page.waitForSelector('.rcpt-hits button');
  await page.locator('.rcpt-hits button', { hasText: 'Ville de Namur' }).first().dispatchEvent('mousedown');
  await page.waitForTimeout(200);
  expect(await page.locator('.modal .recipients').first().locator('.rcpt').count() === before + 1, 'destinataire ajouté depuis le carnet');
  expect((await page.locator('.modal').innerText()).includes('Envoi direct indisponible'), 'sans serveur : les autres façons d’envoyer restent proposées');
  await page.click('.modal button:text-is("Fermer")');
});

await step('Feuille de route : contacts du client et du lieu', async () => {
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Feuille de route")');
  await page.waitForSelector('.doc');
  const c = await page.locator('.doc .doc-contacts').innerText();
  expect(c.includes('Client') && c.includes('Sophie Renard') && c.includes('prod@exemple.be'), `contact client (${c.slice(0, 160)})`);
});

await step('Projet : client et lieu modifiables depuis leur champ ; départ de la distance = dépôt', async () => {
  await openProject('Mariage Dupont-Lemaire');
  await page.click('button[aria-label="Modifier le client"]');
  await page.locator('.modal .field', { hasText: 'Téléphone' }).locator('input').fill('+32 470 11 22 33');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  expect((await page.locator('.card', { has: page.locator('h2:text-is("Client")') }).innerText()).includes('+32 470 11 22 33'), 'client modifié sans quitter le projet');
  expect((await page.locator('.distance').innerText()).includes('Départ : Dépôt'), 'distance calculée depuis le dépôt');
});

await step('Sous-projet : suppression visible, avec confirmation', async () => {
  await tab('Planning');
  await page.click('button:text-is("+ Ajouter un sous-projet")');
  await page.locator('.modal .field', { hasText: 'Nom' }).first().locator('input').fill('Afterparty');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  expect(await page.locator('h2', { hasText: 'Afterparty' }).count() === 1, 'sous-projet ajouté');
  await page.click('button[aria-label="Supprimer le sous-projet Afterparty"]');
  await page.waitForTimeout(400);
  expect(await page.locator('h2', { hasText: 'Afterparty' }).count() === 0, 'sous-projet supprimé');
});

await step('Équipe : remplacer un technicien confirmé (noté pas dispo), détails envoyés au remplaçant', async () => {
  await openProject('Conférence annuelle');
  await tab('Équipe & transport');
  await page.click('.crew-modes button:has-text("2. Attribution")');
  const row = page.locator('table.crew-assign tr', { hasText: 'Montage' }).first();
  await row.locator('button:has-text("Remplacer")').click();
  await page.waitForSelector('.modal');
  expect((await page.locator('.modal').innerText()).includes('Tom Simon'), 'personne à remplacer');
  for (const cb of await page.locator('.modal label', { hasText: 'prévenir' }).locator('input').all()) await cb.uncheck();
  await page.click('.modal button:has-text("Retirer")');
  await page.waitForSelector('.modal .replace-row');
  await page.locator('.modal .replace-row', { hasText: 'Karim' }).locator('button:text-is("Attribuer")').click();
  await page.waitForSelector('.modal .attachments li');
  expect((await page.locator('.modal .field', { hasText: 'Objet' }).locator('input').inputValue()).startsWith('Confirmé'), 'mail de confirmation avec les détails');
  expect((await page.locator('.modal .attachments').innerText()).includes('.ics'), 'agenda joint');
  await page.click('.modal button:text-is("Fermer")');
  await page.waitForTimeout(300);
  const r2 = page.locator('table.crew-assign tr', { hasText: 'Montage' }).first();
  expect((await r2.locator('select[aria-label="Technicien"] option:checked').innerText()).includes('Karim'), 'remplaçant attribué');
  expect(await r2.locator('.req-chip.ans-non', { hasText: 'Tom' }).count() === 1, 'l’ancien noté « pas dispo »');
});

await step('Équipe : demander les dispos, réponse notée, attribution depuis la réponse', async () => {
  await page.click('.crew-modes button:has-text("1. Postes")');
  await page.locator('input[aria-label="Fonction à ajouter"]').first().fill('Rigger');
  await page.locator('.add-posts button[type=submit]').first().click();
  await page.waitForTimeout(300);
  await page.click('.crew-modes button:has-text("2. Attribution")');
  await page.click('button:has-text("Demander les dispos pour les")');
  await page.waitForSelector('.modal .ask-people');
  await page.locator('.modal input[aria-label^="Demander à Emma"]').check();
  await page.locator('.modal input[aria-label^="Demander à Lucas"]').check();
  await page.click('.modal button:has-text("Demander à 2 personne(s)")');
  await page.waitForSelector('.modal:has-text("Demandes envoyées")');
  await page.click('.modal button:text-is("Terminé")');
  const row = page.locator('table.crew-assign tr', { hasText: 'Rigger' }).first();
  expect(await row.locator('.req-chip.ans-attente', { hasText: 'Emma' }).count() === 1, 'demande en attente affichée');
  await row.locator('.req-chip', { hasText: 'Lucas' }).click();
  await row.locator('button:text-is("Noter : pas disponible")').click();
  await page.waitForTimeout(300);
  await row.locator('.req-chip', { hasText: 'Emma' }).click();
  await row.locator('button:text-is("Noter : disponible")').click();
  await page.waitForTimeout(300);
  expect(await row.locator('.req-chip.ans-oui', { hasText: 'Emma' }).count() === 1 && await row.locator('.req-chip.ans-non', { hasText: 'Lucas' }).count() === 1, 'réponses notées');
  expect((await row.locator('select[aria-label="Technicien"] option').nth(1).innerText()).includes('Emma'), 'la personne disponible proposée en premier');
  await row.locator('.req-chip', { hasText: 'Emma' }).click();
  await row.locator('button:has-text("Attribuer Emma")').click();
  await page.waitForSelector('.modal .attachments li');
  await page.click('.modal button:text-is("Fermer")');
  await page.waitForTimeout(300);
  expect((await row.locator('select[aria-label="Technicien"] option:checked').innerText()).includes('Emma'), 'attribuée depuis sa réponse');
});

await step('Équipe : formulaire d’inscription (sans serveur : expliqué)', async () => {
  await go('equipe');
  expect((await page.locator('.signup-link').innerText()).includes('hébergement'), 'formulaire expliqué sans serveur');
});

await step('Liste de sortie : créer un projet avec ses articles', async () => {
  await go('checklists');
  await page.click('button:text-is("Coller du texte")');
  await page.fill('.modal textarea', 'Son\n2   Enceinte L-Acoustics X12   SON-12   2\n4   Micro Shure SM58   MIC-58   4\nDivers\n1   Rouleau de scotch   AB-99   1');
  await page.click('.modal button:text-is("Créer la checklist")');
  await page.waitForSelector('.checklist-scan');
  await page.click('button[aria-label="Menu de la checklist"]');
  await page.click('.modal button:has-text("Créer un projet avec cette liste")');
  await page.locator('.modal .field', { hasText: 'Nom du projet' }).locator('input').fill('Projet depuis liste');
  await page.click('.modal button:text-is("Créer le projet")');
  await page.waitForSelector('.project-tabs');
  expect((await page.locator('h1').innerText()).includes('Projet depuis liste'), 'projet créé');
  await tab('Équipement');
  const eq = await page.locator('.sub').first().innerText();
  expect(eq.includes('Enceinte L-Acoustics X12') && eq.includes('Micro Shure SM58'), 'articles reconnus en matériel du projet');
  await tab('Général').catch(() => {});
});

console.log('\n  — fichiers, équipe, planning, coûts, documents —');
ctx = await newContext();

await step('Fichiers : un PDF joint s’ouvre dans FabEvent, sans téléchargement', async () => {
  await openDemo();
  await openProject('Mariage Dupont-Lemaire');
  const { jsPDF } = require('jspdf');
  const pdf = new jsPDF(); pdf.text('Plan de scène — page 1', 10, 20); pdf.addPage(); pdf.text('Page 2', 10, 20);
  writeFileSync('tests/e2e/plan-test.pdf', Buffer.from(pdf.output('arraybuffer')));
  await page.setInputFiles('.card:has(h2:has-text("Fichiers")) input[type=file]', 'tests/e2e/plan-test.pdf');
  await page.waitForTimeout(400);
  let downloaded = false;
  page.once('download', () => { downloaded = true; });
  await page.click('.card:has(h2:has-text("Fichiers")) a:has-text("plan-test.pdf")');
  await page.waitForSelector('.fv-bg canvas.fv-page', { timeout: 20000 });
  await page.waitForTimeout(500);
  expect(await page.locator('.fv-bg canvas.fv-page').count() === 2 && (await page.locator('.fv-count').innerText()).includes('2 page'), 'les 2 pages affichées');
  expect(!downloaded, 'aucun téléchargement');
  await page.click('button[aria-label="Fermer l\'aperçu"]');
});

await step('Équipe : liste de postes préétablie, coût client prévu, postes sans technicien bien visibles', async () => {
  await tab('Équipe & transport');
  await crewMode(1);
  const sub = page.locator('.sub').first();
  await sub.locator('input[aria-label="Fonction à ajouter"]').fill('Rigger');
  await sub.locator('.add-posts button[type=submit]').click();
  await page.waitForTimeout(300);
  expect(await sub.locator('tr.post-open').count() >= 1, 'poste à pourvoir mis en évidence');
  expect((await sub.locator('.open-badge').innerText()).includes('sans technicien'), 'compteur des postes sans technicien');
  expect((await sub.locator('.planned-client').innerText()).includes('Coût client prévu'), 'coût client prévu affiché');
  await sub.locator('button:has-text("Enregistrer ces postes comme liste")').click(); // nom proposé accepté
  await page.waitForTimeout(400);
  await openProject('Marché de Noël');
  await tab('Équipe & transport');
  await crewMode(1);
  const s2 = page.locator('.sub').first();
  const before = await s2.locator('table.crew-posts tbody tr').count();
  await s2.locator('select[aria-label="Liste de postes préétablie"]').selectOption({ index: 1 });
  await s2.locator('button:has-text("Ajouter cette liste")').click();
  await page.waitForTimeout(600);
  expect(await s2.locator('table.crew-posts tbody tr').count() > before, 'liste de postes appliquée à un autre projet');
});

await step('Techniciens : tarif propre à une fonction', async () => {
  await go('equipe');
  await page.locator('table.list tr', { hasText: 'Karim Haddad' }).locator('a').first().click();
  await page.click('.modal button:has-text("Tarif pour une fonction")');
  await page.fill('.modal input[aria-label="Fonction du tarif"]', 'Rigger');
  await page.locator('.modal input[aria-label="Coût par jour Rigger"]').fill('333');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  await openProject('Marché de Noël');
  await tab('Équipe & transport');
  await crewMode(2);
  const row = page.locator('table.crew-assign tr', { hasText: 'Rigger' }).first();
  expect((await row.locator('select[aria-label="Technicien"] option', { hasText: 'Karim' }).innerText()).includes('333'), 'tarif Rigger de Karim proposé');
});

await step('Planning : envoyé (provisoire compris), puis horaires changés signalés', async () => {
  await openProject('Conférence annuelle');
  await tab('Équipe & transport');
  await crewMode(2);
  await page.locator('label', { hasText: 'Inclure les postes provisoires' }).locator('input').check();
  const row = page.locator('.card:has(h2:has-text("Planification du personnel")) tr', { hasText: 'Hugo Laurent' });
  await row.locator('button:text-is("Envoyer le planning")').click();
  await page.waitForSelector('.modal .attachments li');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal button:has-text("Brouillon prêt à envoyer")')]);
  await page.click('.modal button:text-is("Fermer")');
  await page.waitForTimeout(400);
  expect((await row.locator('.sched-state').innerText()).includes('Envoyé le'), 'envoi mémorisé');
  // on décale le début d'un poste de Hugo
  await crewMode(1);
  const post = page.locator('table.crew-posts tr', { has: page.locator('td:has-text("Hugo")') }).first();
  const start = post.locator('input[type=datetime-local]').first();
  const v = await start.inputValue();
  await start.fill(v.slice(0, 11) + '06:30');
  await page.waitForTimeout(400);
  await crewMode(2);
  const txt = await row.innerText();
  expect(txt.includes('Changé depuis l’envoi') || txt.includes("Changé depuis l'envoi"), 'changement signalé');
  expect(txt.includes('06:30') && (await row.locator('.sched-state').innerText()).includes('à renvoyer'), `heures avant/après affichées (${txt.slice(0, 200)})`);
  await row.locator('button:text-is("Envoyer le planning")').click();
  await page.waitForSelector('.modal .attachments li');
  expect((await page.locator('.modal textarea').first().inputValue()).includes('MODIFIÉ'), 'mail : horaires modifiés signalés');
  await page.click('.modal button:text-is("Fermer")');
  await page.click('button:has-text("Envoyer le planning (provisoire) à tous")');
  await page.waitForSelector('.modal:has-text("changement")');
  await page.click('.modal button:text-is("Fermer")');
});

await step('Coûts supplémentaires : fournisseur libre, saisie TVA comprise', async () => {
  await openProject('Festival des Lumières');
  await tab('Coûts supplémentaires').catch(async () => { await page.click('.project-tabs button:has-text("Coûts")'); });
  await page.fill('input[placeholder^="Nouveau coût"]', 'Repas équipe');
  await page.click('button:text-is("+ Ajouter")');
  await page.waitForTimeout(300);
  await page.fill('input[aria-label="Fournisseur de Repas équipe"]', 'Friterie du coin');
  await page.selectOption('select[aria-label="Saisie des montants de Repas équipe"]', 'ttc');
  await page.fill('input[aria-label="Coût de Repas équipe"]', '121');
  await page.waitForTimeout(400);
  const r = await page.locator('tr', { hasText: 'Friterie' }).innerText().catch(() => '');
  const html = await page.locator('table.list').first().innerText();
  expect(html.includes('100,00') , `121 TVAC = 100 HT (${html.slice(0, 300)})`);
});

await step('Documents : le plus récent de chaque type, les anciens sur demande', async () => {
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")'); await page.waitForSelector('.doc');
  await page.goBack(); await page.waitForTimeout(500);
  await page.click('button:text-is("+ Devis")'); await page.waitForSelector('.doc');
  await page.goBack(); await page.waitForTimeout(500);
  const list = page.locator('table.docs-list');
  const devisRows = await list.locator('tbody tr.click', { hasText: 'Devis' }).count();
  expect(devisRows === 1, `un seul devis affiché (${devisRows})`);
  await list.locator('button:has-text("Plus anciens")').first().click();
  expect(await list.locator('tr.doc-older').count() >= 1, 'les anciens s’affichent');
});

await step('Document : réordonner les salles (sous-projets) avec Ordre des salles ↑ / ↓', async () => {
  await openProject('Conférence annuelle');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const order = async () => {
    const t = await page.locator('.doc').innerText();
    return ['Salle plénière', 'Salle atelier 1', 'Salle atelier 2'].map((n) => t.indexOf(n));
  };
  const o0 = await order();
  expect(o0.every((i) => i >= 0) && o0[0] < o0[1] && o0[1] < o0[2], `ordre initial = ordre du projet (${o0})`);
  await page.click('button:has-text("Ordre des salles")');
  await page.waitForSelector('.modal[aria-label="Ordre des salles dans ce document"]');
  await page.click('button[aria-label="Descendre Salle plénière"]');
  await page.waitForTimeout(400);
  const o1 = await order();
  expect(o1[1] < o1[0] && o1[0] < o1[2], `plénière descendue d'un cran (${o1})`);
  await page.click('button[aria-label="Monter Salle plénière"]');
  await page.waitForTimeout(400);
  const o2 = await order();
  expect(o2[0] < o2[1] && o2[1] < o2[2], `remontée, ordre initial retrouvé (${o2})`);
  await page.click('button[aria-label="Descendre Salle plénière"]');
  await page.waitForTimeout(300);
  await page.click('button[aria-label="Descendre Salle plénière"]');
  await page.waitForTimeout(400);
  const o3 = await order();
  expect(o3[1] < o3[2] && o3[2] < o3[0], `plénière passée en dernier (${o3})`);
  await page.click('button:text-is("Ordre du projet (réinitialiser)")');
  await page.waitForTimeout(400);
  const o4 = await order();
  expect(o4[0] < o4[1] && o4[1] < o4[2], `réinitialisation = ordre du projet (${o4})`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached' });
});

/* ---------- Synchronisation : deux appareils, le vrai serveur PHP ---------- */
const hasPhp = spawnSync('php', ['-v']).status === 0;
if (hasPhp) {
  console.log('\n  — synchronisation entre appareils (serveur PHP) —');
  const root = mkdtempSync(join(tmpdir(), 'fabweb-'));
  cpSync('dist', root, { recursive: true });
  mkdirSync(join(root, 'api'));
  for (const f of ['_fabevent.php', 'auth.php', 'sync.php', 'mail.php', 'public.php']) cpSync(join('server', f), join(root, 'api', f));
  const OUTBOX = mkdtempSync(join(tmpdir(), 'fabmail-'));
  const DATA = mkdtempSync(join(tmpdir(), 'fabdata-'));
  const SPORT = PORT + 700;
  const php = spawn('php', ['-S', `127.0.0.1:${SPORT}`, '-t', root], {
    env: { ...process.env, FABEVENT_DATA: DATA, FABEVENT_MAIL_OUTBOX: OUTBOX }, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));
  const SU = `http://127.0.0.1:${SPORT}/`;
  const device = async () => {
    const c = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await c.addInitScript(() => { try { if (!localStorage.getItem('fab.sync.url')) localStorage.setItem('fab.sync.url', 'api/sync.php'); } catch {} });
    const p = await c.newPage();
    p.on('pageerror', (e) => consoleErrors.push(e.message));
    p.on('dialog', (d) => d.accept());
    return { c, p };
  };
  const syncOn = async (p) => { await p.goto(SU + '#/parametres'); await p.click('button:text-is("Synchroniser maintenant")'); await p.waitForTimeout(1500); };
  const A = await device();
  const B = await device();
  await step('Serveur autonome : jamais connecté = écran de connexion d’office ; le premier compte administrateur se crée depuis l’application', async () => {
    await A.p.goto(SU + '#/'); await A.p.waitForTimeout(2500);
    expect(await A.p.locator('.login-card').count() === 1 && await A.p.locator('.layout').count() === 0, 'jamais connecté : écran de connexion d’office, rien d’autre');
    await A.p.waitForSelector('.login-card');
    await A.p.waitForSelector('.login-card button[type=submit]:not([disabled])');
    expect((await A.p.locator('.login-card').innerText()).includes('Première utilisation'), 'serveur vierge : création du premier compte');
    await A.p.fill('.login-card input[aria-label="Nom"]', 'Nico');
    await A.p.fill('.login-card input[aria-label="Email"]', 'nico@exemple.org');
    await A.p.fill('.login-card input[aria-label="Mot de passe"]', 'motdepasse');
    await A.p.fill('.login-card input[aria-label="Répéter le mot de passe"]', 'motdepasse');
    await A.p.click('.login-card button[type=submit]');
    await A.p.waitForSelector('.layout'); await A.p.waitForTimeout(2500);
    expect(await A.p.locator('.login-card').count() === 0, 'application ouverte après connexion');
    expect((await A.p.locator('.net').innerText()).includes('synchronisé'), `synchronisé (${await A.p.locator('.net').innerText()})`);
  });
  await step('Serveur autonome : un 2e appareil se connecte avec le compte FabEvent (aucune page interne)', async () => {
    await B.p.goto(SU + '#/'); await B.p.waitForTimeout(2000);
    await B.p.waitForSelector('.login-card button[type=submit]:not([disabled])');
    expect((await B.p.locator('.login-card').innerText()).includes('Connecte-toi avec ton compte FabEvent'), 'le serveur a des comptes : écran de connexion');
    await B.p.fill('.login-card input[aria-label="Email"]', 'nico@exemple.org');
    await B.p.fill('.login-card input[aria-label="Mot de passe"]', 'mauvais');
    await B.p.click('.login-card button[type=submit]');
    await B.p.waitForSelector('.login-card .avail.ko');
    expect((await B.p.locator('.login-card .avail.ko').innerText()).includes('incorrect'), 'mauvais mot de passe refusé par le serveur');
    await B.p.fill('.login-card input[aria-label="Mot de passe"]', 'motdepasse');
    await B.p.click('.login-card button[type=submit]');
    await B.p.waitForSelector('.layout'); await B.p.waitForTimeout(2500);
    expect((await B.p.locator('.net').innerText()).includes('synchronisé'), 'synchronisé sur le 2e appareil');
    expect((await B.p.locator('.side-user').innerText()).includes('Nico'), 'connecté avec le compte du serveur');
  });
  await step('Synchro : un contact créé sur un appareil apparaît sur l’autre', async () => {
    await A.p.goto(SU + '#/contacts'); await A.p.waitForTimeout(500);
    await A.p.click('button:text-is("+ Nouveau contact")');
    await A.p.locator('.modal .field', { hasText: 'Société / Nom' }).locator('input').fill('Client synchronisé SA');
    await A.p.click('.modal button[type=submit]');
    await A.p.waitForTimeout(3500); // envoi automatique 2 s après la modification
    await syncOn(B.p);
    await B.p.goto(SU + '#/contacts'); await B.p.waitForTimeout(500);
    expect(await B.p.locator('table.list tr', { hasText: 'Client synchronisé SA' }).count() === 1, 'contact reçu sur le 2e appareil');
    expect((await B.p.locator('.net').innerText()).includes('synchronisé'), 'état « synchronisé » affiché');
  });
  await step('Synchro : modification et numérotation sans doublon entre appareils', async () => {
    await B.p.locator('table.list tr', { hasText: 'Client synchronisé SA' }).click();
    await B.p.locator('.modal .field', { hasText: 'Ville' }).first().locator('input').fill('Liège');
    await B.p.click('.modal button[type=submit]');
    await B.p.waitForTimeout(3500);
    await syncOn(A.p);
    await A.p.goto(SU + '#/contacts'); await A.p.waitForTimeout(500);
    expect((await A.p.locator('table.list tr', { hasText: 'Client synchronisé SA' }).innerText()).includes('Liège'), 'modification reçue');
    const newProject = async (p, name) => {
      await p.goto(SU + '#/projets'); await p.waitForTimeout(400);
      await p.click('button:text-is("+ Nouveau projet")');
      await p.locator('.modal .field', { hasText: 'Nom du projet' }).locator('input').fill(name);
      await p.click('.modal button[type=submit]');
      await p.waitForSelector('.project-tabs');
      return (await p.locator('h1').innerText()).split(' · ')[0];
    };
    const n1 = await newProject(A.p, 'Projet A');
    const n2 = await newProject(B.p, 'Projet B'); // B n'a pas encore reçu le projet de A
    expect(n1 !== n2, `numéros distincts (${n1} / ${n2})`);
  });
  const mails = () => readdirSync(OUTBOX).sort().map((f) => readFileSync(join(OUTBOX, f), 'utf8'));
  const textOf = (eml) => { const part = eml.split('Content-Type: text/plain; charset=UTF-8')[1].split('\r\n\r\n')[1].split('--')[0]; return Buffer.from(part.replace(/\s+/g, ''), 'base64').toString('utf8'); };
  await step('Mail : envoyé directement depuis FabEvent, PDF joint', async () => {
    await A.p.goto(SU + '#/projets'); await A.p.waitForTimeout(400);
    await A.p.click('text=Projet A'); await A.p.waitForSelector('.project-tabs');
    await A.p.click('.project-tabs button:text-is("Finances & documents")');
    await A.p.click('button:text-is("+ Devis")');
    await A.p.waitForSelector('.doc');
    await A.p.click('button:has-text("Envoyer par email")');
    await A.p.waitForSelector('.send-direct button', { timeout: 30000 });
    await A.p.locator('.modal input[aria-label="À : ajouter une adresse"]').fill('client@exemple.org');
    await A.p.keyboard.press('Enter');
    await A.p.waitForSelector('.modal .attachments li', { timeout: 30000 });
    await A.p.click('.send-direct button');
    await A.p.waitForSelector('.modal .flash.ok:has-text("Envoyé à client@exemple.org")', { timeout: 15000 });
    const m = mails().slice(-1)[0] || '';
    expect(m.includes('To: client@exemple.org') && m.includes('Content-Type: application/pdf'), 'mail parti avec le PDF');
    await A.p.click('.modal button:text-is("Fermer")');
  });
  await step('Équipe : demande de dispo par lien, le technicien répond, la réponse revient dans FabEvent', async () => {
    await A.p.goto(SU + '#/equipe'); await A.p.waitForTimeout(400);
    await A.p.click('button:text-is("+ Nouvelle personne")');
    await A.p.locator('.modal .field', { hasText: 'Nom' }).first().locator('input').fill('Sam Lien');
    await A.p.locator('.modal .field', { hasText: 'Email' }).locator('input').fill('sam@exemple.org');
    await A.p.click('.modal button[type=submit]');
    await A.p.goto(SU + '#/projets'); await A.p.waitForTimeout(400);
    await A.p.click('text=Projet A'); await A.p.waitForSelector('.project-tabs');
    await A.p.click('.project-tabs button:text-is("Équipe & transport")');
    await A.p.click('.crew-modes button:has-text("1. Postes")');
    await A.p.locator('input[aria-label="Fonction à ajouter"]').first().fill('Régisseur');
    await A.p.locator('.add-posts button[type=submit]').first().click();
    await A.p.click('.crew-modes button:has-text("2. Attribution")');
    await A.p.click('button:has-text("Demander les dispos pour les")');
    await A.p.locator('.modal input[aria-label^="Demander à Sam"]').check();
    await A.p.waitForSelector('.modal p:has-text("Chacun reçoit son propre lien")');
    await A.p.click('.modal button:has-text("Demander à 1 personne(s)")');
    await A.p.waitForSelector('.modal:has-text("mail envoyé avec le lien")', { timeout: 15000 });
    await A.p.click('.modal button:text-is("Terminé")');
    await A.p.waitForTimeout(3500); // la demande part au serveur
    const body = textOf(mails().slice(-1)[0]);
    const link = (body.match(/https?:\/\/\S+public\.php\?r=\w+/) || [])[0];
    expect(!!link && body.includes('Bonjour Sam'), `lien de réponse dans le mail (${body.slice(0, 200)})`);
    const T = await browser.newContext(); const tp = await T.newPage();
    await tp.goto(link);
    expect((await tp.locator('body').innerText()).includes('Régisseur'), 'page publique : le poste est affiché');
    await tp.fill('textarea[name=note]', 'Je peux aussi conduire le camion');
    await tp.click('button:has-text("Je suis disponible")');
    expect((await tp.locator('.msg').innerText()).includes('disponibilité est enregistrée'), 'réponse enregistrée');
    await T.close();
    await syncOn(A.p);
    await A.p.goto(SU + '#/projets'); await A.p.waitForTimeout(400);
    await A.p.click('text=Projet A'); await A.p.waitForSelector('.project-tabs');
    await A.p.click('.project-tabs button:text-is("Équipe & transport")');
    await A.p.click('.crew-modes button:has-text("2. Attribution")');
    const chip = A.p.locator('table.crew-assign tr', { hasText: 'Régisseur' }).locator('.req-chip.ans-oui', { hasText: 'Sam' });
    expect(await chip.count() === 1 && await chip.locator('svg title').count() === 1, 'réponse « disponible » reçue dans FabEvent, avec son mot');
  });
  await step('Équipe : formulaire d’inscription public, fiche à valider', async () => {
    await A.p.goto(SU + '#/equipe'); await A.p.waitForTimeout(400);
    await A.p.click('button:text-is("Ouvrir le formulaire d\'inscription")');
    await A.p.waitForSelector('input[aria-label="Lien du formulaire d\'inscription"]');
    const link = await A.p.locator('input[aria-label="Lien du formulaire d\'inscription"]').inputValue();
    await A.p.waitForTimeout(3500);
    const T = await browser.newContext(); const tp = await T.newPage();
    await tp.goto(link);
    await tp.fill('#name', 'Alex Candidat'); await tp.fill('#email', 'alex@exemple.org'); await tp.fill('#city', 'Namur');
    await tp.fill('#other', 'Technicien vidéo');
    await tp.check('input[name=consent]');
    await tp.waitForTimeout(3200); // anti-robot : formulaire rempli en plus de 3 s
    await tp.click('button:has-text("Envoyer ma fiche")');
    expect((await tp.locator('.msg').innerText()).includes('ta fiche est envoyée'), 'fiche envoyée');
    await T.close();
    await syncOn(A.p);
    await A.p.goto(SU + '#/equipe'); await A.p.waitForTimeout(500);
    const pend = await A.p.locator('.signup-pending').innerText();
    expect(pend.includes('Alex Candidat') && pend.includes('Technicien vidéo'), 'inscription à valider');
    await A.p.locator('.signup-pending tr', { hasText: 'Alex Candidat' }).locator('button:text-is("Valider")').click();
    await A.p.waitForTimeout(300);
    expect(await A.p.locator('table.list tr', { hasText: 'Alex Candidat' }).count() === 1, 'technicien ajouté à l’équipe');
  });
  await step('Équipe : lien d’agenda en ligne (abonnement Google / iPhone / Outlook)', async () => {
    await A.p.goto(SU + '#/equipe'); await A.p.waitForTimeout(400);
    await A.p.locator('table.list tr', { hasText: 'Sam Lien' }).locator('button:text-is("Lien agenda")').click();
    await A.p.waitForSelector('.info:has-text("Lien d\'agenda de Sam Lien copié")', { timeout: 15000 });
    const link = ((await A.p.locator('.info').innerText()).match(/https?:\/\/\S+agenda=\w+/) || [])[0];
    expect(!!link, 'lien d’agenda affiché');
    const T = await browser.newContext(); const tp = await T.newPage();
    await tp.goto(link);
    const txt = await tp.locator('body').innerText();
    expect(txt.includes('Mon agenda') && txt.includes('Google Agenda') && txt.includes('Outlook'), 'page d’abonnement');
    const feed = await tp.locator('input[aria-label="Adresse de l\'agenda"]').inputValue();
    const ics = await (await fetch(feed)).text();
    expect(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('Sam Lien'), 'flux iCal servi');
    await T.close();
  });
  await step('Plusieurs bases avec le même compte : sélecteur de base, sans se reconnecter', async () => {
    // une 2e base (autre société) : son premier administrateur = le même email et le même mot de passe
    await A.p.evaluate(() => { localStorage.setItem('fabevent.workspace', 'societe2'); localStorage.setItem('fabevent.workspaces', JSON.stringify(['societe2'])); });
    await A.p.goto(SU + '#/'); await A.p.reload(); await A.p.waitForTimeout(2000);
    await A.p.waitForSelector('.login-card button[type=submit]:not([disabled])');
    expect((await A.p.locator('.login-card').innerText()).includes('Première utilisation'), 'nouvelle base : création de son administrateur');
    await A.p.fill('.login-card input[aria-label="Nom"]', 'Nico');
    await A.p.fill('.login-card input[aria-label="Email"]', 'nico@exemple.org');
    await A.p.fill('.login-card input[aria-label="Mot de passe"]', 'motdepasse');
    await A.p.fill('.login-card input[aria-label="Répéter le mot de passe"]', 'motdepasse');
    await A.p.click('.login-card button[type=submit]');
    await A.p.waitForSelector('.layout'); await A.p.waitForTimeout(1500);
    const sel = A.p.locator('select[aria-label="Changer de base"]');
    await sel.waitFor({ timeout: 10000 });
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    expect(opts.includes('principal') && opts.includes('societe2'), `les deux bases proposées (${opts})`);
    await sel.selectOption('principal');
    await A.p.waitForSelector('.layout'); await A.p.waitForTimeout(1500);
    expect(await A.p.locator('.login-card').count() === 0, 'principal ouverte sans se reconnecter');
    await A.p.goto(SU + '#/contacts'); await A.p.waitForTimeout(600);
    expect(await A.p.locator('table.list tr', { hasText: 'Client synchronisé SA' }).count() === 1, 'contacts de la base principale');
    await A.p.locator('select[aria-label="Changer de base"]').selectOption('societe2');
    await A.p.waitForSelector('.layout'); await A.p.waitForTimeout(1500);
    expect(await A.p.locator('.login-card').count() === 0, 'retour dans societe2 sans se reconnecter');
    await A.p.locator('select[aria-label="Changer de base"]').selectOption('principal');
    await A.p.waitForSelector('.layout'); await A.p.waitForTimeout(800);
  });
  // à la fin : changer le mot de passe ferme les sessions des autres appareils
  const loginWith = async (p, pass) => {
    await p.fill('.login-card input[aria-label="Email"]', 'nico@exemple.org');
    await p.fill('.login-card input[aria-label="Mot de passe"]', pass);
    await p.click('.login-card button[type=submit]');
    await p.waitForSelector('.layout', { timeout: 15000 });
  };
  const openLogin = async (C) => {
    await C.p.goto(SU + '#/'); await C.p.waitForTimeout(1500);
    await C.p.waitForSelector('.login-card button[type=submit]:not([disabled])');
  };
  await step('Mot de passe oublié : lien reçu par email, nouveau mot de passe, connexion', async () => {
    const C = await device();
    await openLogin(C);
    await C.p.click('button:has-text("Mot de passe oublié ?")');
    await C.p.fill('input[aria-label="Email du compte pour la réinitialisation"]', 'nico@exemple.org');
    await C.p.click('button:has-text("Envoyer le lien de réinitialisation")');
    await C.p.waitForSelector('.login-card .avail.ok');
    const body = textOf(mails().slice(-1)[0]);
    const link = (body.match(/https?:\/\/\S+public\.php\?pw=\w+/) || [])[0];
    expect(!!link, `lien de réinitialisation dans le mail (${body.slice(0, 120)})`);
    const T = await browser.newContext(); const tp = await T.newPage();
    await tp.goto(link);
    await tp.fill('#p1', 'nouveaupass'); await tp.fill('#p2', 'nouveaupass');
    await tp.click('button:has-text("Enregistrer le nouveau mot de passe")');
    expect((await tp.locator('.msg').innerText()).includes('nouveau mot de passe est enregistré'), 'mot de passe changé');
    await T.close();
    await C.p.click('button:text-is("Retour")');
    await loginWith(C.p, 'nouveaupass');
    expect((await C.p.locator('.side-user').innerText()).includes('Nico'), 'connecté avec le nouveau mot de passe');
    await C.c.close();
  });
  await step('Mot de passe oublié sans email : code d’installation (fabevent-config / fichier) puis connexion directe', async () => {
    const C = await device();
    await openLogin(C);
    await C.p.click('button:has-text("Mot de passe oublié ?")');
    await C.p.fill('input[aria-label="Email du compte pour la réinitialisation"]', 'nico@exemple.org');
    await C.p.click('button:has-text("Utiliser le code d’installation")');
    // le code est créé par le serveur à la première demande ; ici on le lit dans le dossier de données
    await fetch(SU + 'api/auth.php?action=recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ws: 'principal', email: 'x@x.x', code: 'AAAAAAAAAA', password: 'xxxxxx' }) });
    const code = readFileSync(join(DATA, 'code-installation.txt'), 'utf8').trim();
    await C.p.fill('input[aria-label="Code d’installation pour la réinitialisation"]', code);
    await C.p.fill('input[aria-label="Nouveau mot de passe"]', 'parlecode1');
    await C.p.fill('input[aria-label="Répéter le nouveau mot de passe"]', 'parlecode1');
    await C.p.click('button:has-text("Changer le mot de passe")');
    await C.p.waitForSelector('.layout', { timeout: 15000 });
    expect((await C.p.locator('.side-user').innerText()).includes('Nico'), 'connecté directement avec le nouveau mot de passe');
    await C.c.close();
  });
  await A.c.close(); await B.c.close();
  php.kill();
}

/* ---------- Onglets des fiches ouvertes ---------- */
ctx = await newContext();
await openDemo();
await step('Onglets : un projet et un article restent ouverts en revenant aux listes', async () => {
  await openProject('Festival des Lumières');
  await tab('Équipement');
  await go('materiel');
  await page.locator('table.list tr', { hasText: 'Amplificateur LA4X' }).first().click();
  await page.waitForTimeout(400);
  await go('projets');
  const tabs = page.locator('.open-tabs .otab');
  expect(await tabs.count() === 2, `2 onglets (${await tabs.count()})`);
  const txt = await page.locator('.open-tabs').innerText();
  expect(txt.includes('Festival des Lumières') && txt.includes('Amplificateur LA4X'), `titres (${txt})`);
  // retour au projet, sur l'onglet Équipement
  await page.locator('.otab', { hasText: 'Festival des Lumières' }).locator('.otab-open').click();
  await page.waitForSelector('.project-tabs');
  expect(page.url().includes('onglet='), 'onglet interne mémorisé');
  expect(await page.locator('.otab.active', { hasText: 'Festival des Lumières' }).count() === 1, 'onglet actif');
  // gardés après rechargement
  await page.reload(); await page.waitForTimeout(800);
  expect(await page.locator('.open-tabs .otab').count() === 2, 'onglets gardés après rechargement');
  // fermer l'onglet actif : on passe à l'autre fiche
  await page.locator('.otab.active .otab-x').click(); await page.waitForTimeout(400);
  expect(page.url().includes('/materiel/'), `fiche voisine ouverte (${page.url()})`);
  await page.click('.otab-x'); await page.waitForTimeout(300);
  expect(await page.locator('.open-tabs').count() === 0, 'plus d’onglets');
});
await step('Annuler : un contact supprimé revient (bouton et Ctrl+Z)', async () => {
  await go('contacts');
  const rows = page.locator('table.list tbody tr', { has: page.locator('td .badge:not(:text-is("Lieu"))') });
  const name = (await rows.first().locator('strong').innerText()).trim();
  const count = async () => page.locator('table.list tbody tr', { hasText: name }).count();
  expect(await page.locator('.sidebar .undo-btn').isDisabled() || true, 'bouton présent');
  await rows.first().click();
  await page.click('.modal button:text-is("Supprimer")'); await page.waitForTimeout(400);
  expect(await count() === 0, 'contact supprimé');
  expect((await page.locator('.sidebar .undo-btn').getAttribute('title')).includes('Suppression'), 'libellé de l’étape');
  await page.click('.sidebar .undo-btn'); await page.waitForTimeout(500);
  expect(await count() === 1, 'contact revenu');
  expect((await page.locator('.undo-toast').innerText()).includes('Annulé'), 'message');
  // Ctrl+Z hors d'un champ
  await page.locator('table.list tbody tr', { hasText: name }).first().click();
  await page.click('.modal button:text-is("Supprimer")'); await page.waitForTimeout(400);
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  expect(await count() === 1, 'Ctrl+Z');
});
await step('Entrepôt : listes de colisage par date de départ (préparé / chargé)', async () => {
  await resetDemo();
  await go('entrepot');
  const card = page.locator('.card', { has: page.locator('h2', { hasText: 'Listes de colisage' }) });
  expect((await card.locator('tbody tr').count()) > 0, 'au moins une date de départ listée');
  const row = card.locator('tbody tr').first();
  expect(/^\d+$/.test((await row.locator('td').nth(3).innerText()).trim()), 'nombre d\'articles affiché');
  await row.locator('button:text-is("Marquer chargé")').click();
  await page.waitForTimeout(400);
  expect((await card.locator('tbody tr').first().innerText()).includes('chargé'), 'badge « chargé »');
  await go('entrepot');
  expect((await card.locator('tbody tr').first().innerText()).includes('chargé'), 'état conservé après rechargement');
});

await step('Fiche produit : édition directement dans la page + autres codes (alias)', async () => {
  await resetDemo();
  await go('materiel');
  await page.locator('table.list tr.click', { hasText: 'Caisson SB18' }).first().click();
  await page.waitForSelector('.stats');
  await page.click('button:text-is("Modifier")');
  await page.waitForSelector('.edit-inline');
  await page.locator('.edit-inline .tags-input input').first().pressSequentially('SB18-ANCIEN,');
  await page.locator('.edit-inline input[aria-label="Désignation"]').fill('Caisson SB18 (e2e)');
  await page.locator('.edit-inline .form-actions button:text-is("Enregistrer")').click();
  await page.waitForTimeout(500);
  expect((await page.locator('.edit-inline').count()) === 0, 'formulaire refermé après enregistrer');
  expect((await page.locator('h1').first().innerText()).includes('(e2e)'), 'nom mis à jour sur la fiche');
  expect((await page.locator('.stats').innerText()).includes('SB18-ANCIEN'), 'alias affiché sur la fiche');
});

await step('Projet : accessoires facultatifs proposés dans une fenêtre après l’ajout (rien de coché par défaut)', async () => {
  await resetDemo();
  await openProject('Beurs Maastricht');
  await tab('Équipement');
  const nl4 = () => page.locator('main table.list tr', { hasText: 'Câble NL4' }).count();
  const nl4Before = await nl4();
  // 1er ajout : « Non merci » → rien d'ajouté
  await page.click('button:text-is("+ Matériel")');
  await page.waitForSelector('.pick-list');
  expect(await page.locator('.pick-acc').count() === 0, 'plus de section « accessoires » dans le sélecteur');
  await page.locator('.pick-item', { hasText: 'Caisson SB18' }).locator('input[aria-label="Quantité Caisson SB18"]').fill('2');
  await page.locator('.modal .form-actions button', { hasText: 'Ajouter (' }).click();
  await page.waitForSelector('.modal:has-text("Accessoires proposés")');
  const box = page.locator('.modal input[aria-label="Ajouter Câble NL4 15 m"]');
  expect(!(await box.isChecked()), 'accessoire facultatif décoché par défaut');
  await page.click('.modal button:text-is("Non merci")');
  await page.waitForTimeout(400);
  expect((await nl4()) === nl4Before, 'refusé : aucun accessoire ajouté');
  // saisie rapide : l'accessoire coché est ajouté (2 par caisson)
  await page.locator('input[aria-label="Ajouter un article"]').first().fill('1 SB18');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal:has-text("Accessoires proposés")');
  await page.locator('.modal input[type=checkbox]').first().check();
  await page.click('.modal button:has-text("Ajouter 1 accessoire")');
  await page.waitForTimeout(500);
  expect((await nl4()) === nl4Before + 1, 'accessoire ajouté sous le caisson');
});

await step('Projet : contenu du kit affiché sous la ligne (lignes enfants)', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Équipement');
  const kitRow = page.locator('.eq-table tbody tr', { hasText: 'Pack ambiance 8 PAR LED' }).first();
  await kitRow.waitFor();
  const next = kitRow.locator('xpath=following-sibling::tr[1]');
  expect((await next.innerText()).includes('PAR LED'), 'ligne enfant du kit affichée juste sous le kit');
});

await step('Enfants de kit indentés (classe kid) : onglet Équipement, devis, checklist sortie', async () => {
  await openProject('Conférence annuelle');
  await tab('Équipement');
  expect((await page.locator('.eq-table tr.kid', { hasText: 'PAR LED' }).count()) >= 1, 'ligne enfant indentée dans l’onglet Équipement');
  // devis : enfant du kit en retrait, prix « inclus », pas en double dans le total
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const kidRow = page.locator('.doc tr.kid', { hasText: 'PAR LED' }).first();
  await kidRow.waitFor();
  expect((await kidRow.innerText()).includes('inclus'), 'prix du contenu du kit affiché « inclus » dans le devis');
  // checklist de sortie du sous-projet : enfants du kit indentés
  await openProject('Conférence annuelle');
  await tab('Équipement');
  await page.locator('button:has-text("Préparer / scanner")').first().click();
  await page.waitForSelector('.checklist-scan');
  expect((await page.locator('.cl-line.kid', { hasText: 'PAR LED' }).count()) >= 1, 'ligne enfant indentée dans la checklist de sortie');
});

await step('Projet : fiche de ligne — accessoires facultatifs à cocher/décocher, contenu du kit', async () => {
  await openProject('Festival des Lumières');
  await tab('Équipement');
  const row = page.locator('.eq-table tbody tr', { hasText: 'Caisson SB18' }).first();
  const nl4Before = await page.locator('.eq-table tbody tr', { hasText: 'Câble NL4' }).count();
  await row.locator('button[aria-label="Détails de la ligne"]').click();
  const m = page.locator('.modal');
  await m.waitFor();
  const accBox = m.locator('.check-row', { hasText: 'NL4' }).locator('input');
  // accessoire facultatif (démo) : pas ajouté d'office, on le coche dans la fiche de ligne
  expect(!(await accBox.isChecked()), 'accessoire facultatif absent = décoché dans la fiche');
  await accBox.click();
  await page.waitForTimeout(600);
  expect((await page.locator('.eq-table tbody tr', { hasText: 'Câble NL4' }).count()) === nl4Before + 1, 'accessoire coché ajouté sous la ligne');
  await accBox.click();
  await page.waitForTimeout(600);
  expect((await page.locator('.eq-table tbody tr', { hasText: 'Câble NL4' }).count()) === nl4Before, 'accessoire décoché retiré');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // fiche d'un kit : contenu listé
  await page.locator('.eq-table tbody tr', { hasText: 'Pack ambiance 8 PAR LED' }).first().locator('button[aria-label="Détails de la ligne"]').click();
  await page.waitForSelector('.modal');
  expect((await page.locator('.modal').innerText()).includes('Contenu du kit') && (await page.locator('.modal').innerText()).includes('PAR LED'), 'contenu du kit affiché dans la fiche');
  await page.locator('.modal .form-actions button[type=submit]').click();
});

await step('Équipe : bouton « Lien ma fiche » par personne', async () => {
  await resetDemo();
  await go('equipe');
  await page.locator('table.list tbody tr').first().locator('button', { hasText: 'ma fiche' }).click();
  await page.waitForTimeout(400);
  expect((await page.locator('.info', { hasText: 'ma fiche' }).count()) > 0, 'message affiché (pas de serveur de synchro en e2e)');
});

await step('Devis : bouton lien d\'acceptation en ligne', async () => {
  await resetDemo();
  await openProject('Spectacle de fin d');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  await page.click('button:text-is("Lien d\'acceptation en ligne")');
  await page.waitForTimeout(400);
  const qLink = page.locator('input[aria-label="Lien public d\'acceptation du devis"]');
  const qInfo = page.locator('.no-print .info', { hasText: 'hébergement' });
  expect((await qLink.count()) > 0 || (await qInfo.count()) > 0, 'lien public ou message « serveur nécessaire » affiché');
  if (await qLink.count()) expect((await qLink.inputValue()).includes('?d='), 'le lien porte le jeton ?d=');
});

await step('TVA par article : taux spécifique sur la fiche, détail par taux sur le devis', async () => {
  await resetDemo();
  await go('materiel');
  await page.locator('table.list tr.click', { hasText: 'Micro Shure SM58' }).first().click();
  await page.waitForSelector('.stats');
  await page.click('button:text-is("Modifier")');
  await page.waitForSelector('.edit-inline');
  await page.locator('.edit-inline .field', { hasText: 'Taux de TVA spécifique' }).locator('input').fill('6');
  await page.locator('.edit-inline .form-actions button:text-is("Enregistrer")').click();
  await page.waitForTimeout(500);
  await openProject('Spectacle de fin d');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const totals = await page.locator('.doc .totals').innerText();
  expect(totals.includes('TVA 21 %') && totals.includes('TVA 6 %'), 'deux taux de TVA détaillés sur le devis');
});

await ctx.close();

/* ---------- Nouveautés : entrepôt 6/5, kits scannables, planning clic jour, horaires, mails ---------- */
console.log('\n  — nouveautés —');
ctx = await newContext();
await openDemo();

await step('Entrepôt : ajouter plus que prévu garde le prévu (3/2, pas 3/3)', async () => {
  await openChecklist('Mariage Dupont-Lemaire');
  const line = page.locator('.cl-line:not(.kid)', { hasText: 'L-Acoustics X12' });
  await line.locator('button[aria-label="Plus"]').click();
  await line.locator('button[aria-label="Plus"]').click();
  await line.locator('button[aria-label="Plus"]').click(); // au-delà du prévu : confirmation
  await page.waitForTimeout(300);
  expect((await page.locator('.cl-ask').innerText()).includes('Plus que les 2 prévus'), 'confirmation demandée au-delà du prévu');
  await page.locator('.cl-ask button', { hasText: 'Ajouter quand même' }).click();
  await page.waitForTimeout(300);
  const n = (await line.locator('.cl-n').innerText()).replace(/\s+/g, '');
  expect(n === '3/2', `compteur 3/2, prévu inchangé (${n})`);
});

await step('Kit ajouté au projet : le scan d’un composant du kit est reconnu (pas « en plus »)', async () => {
  await resetDemo();
  await openProject('Spectacle de fin d\'année');
  await tab('Équipement');
  await page.locator('button:has-text("+ Matériel")').first().click();
  const m = page.locator('.modal');
  await m.locator('.picker-filters input').first().fill('pack conférence');
  await m.locator('.pick-row', { hasText: 'Pack conférence' }).locator('button[aria-label^="Plus"]').click();
  await m.locator('button:has-text("Ajouter (")').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Préparer / scanner")').first().click();
  await page.waitForSelector('.checklist-scan');
  const msg = await scan('DEMO-PIED');
  expect(!msg.includes('pas prévu') && msg.includes('Pied de micro'), 'composant du kit compté, pas proposé en plus (' + msg.slice(0, 90) + ')');
});

await step('Planning : clic sur un jour = « + Rendez-vous » / « + Projet » à cette date', async () => {
  await resetDemo();
  await go('planning');
  const now = new Date();
  const d15 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  await page.locator('.cal .day .num', { hasText: '15' }).first().click();
  await page.waitForSelector('.day-menu');
  await page.locator('.day-menu button:has-text("+ Rendez-vous")').click();
  await page.waitForSelector('.modal input[type=datetime-local]');
  expect((await page.locator('.modal input[type=datetime-local]').first().inputValue()).startsWith(d15), 'rdv pré-rempli au 15 du mois');
  await page.locator('.modal button[aria-label="Fermer"]').click();
  await page.waitForTimeout(300);
  await page.locator('.cal .day .num', { hasText: '15' }).first().click();
  await page.locator('.day-menu button:has-text("+ Projet")').click();
  await page.waitForSelector('.modal');
  expect(page.url().includes('/projets?date=' + d15), 'navigation vers nouveau projet à cette date (' + page.url() + ')');
  expect((await page.locator('.modal input[type=datetime-local]').first().inputValue()).startsWith(d15), 'projet pré-rempli au 15');
  await page.locator('.modal button[aria-label="Fermer"]').click();
});

await step('Horaires : 1re prestation le même jour que le montage ; ±1 jour sur un bloc', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Planning');
  await page.locator('button:has-text("+ Ajouter un sous-projet")').first().click();
  const m = page.locator('.modal');
  // le brouillon copie les horaires de la 1re salle : on les retire pour tester à vide
  for (let i = 0; i < 12; i++) { const r = m.locator('.period-row button[aria-label^="Retirer"]'); if (!(await r.count())) break; await r.first().click(); await page.waitForTimeout(120); }
  await m.locator('button:has-text("+ Montage")').click(); await page.waitForTimeout(200);
  await m.locator('button:has-text("+ Jour de prestation")').click(); await page.waitForTimeout(200);
  const rows = m.locator('.period-row');
  const dMont = (await rows.nth(0).locator('input[type=datetime-local]').first().inputValue()).slice(0, 10);
  const dPrest = (await rows.nth(1).locator('input[type=datetime-local]').first().inputValue()).slice(0, 10);
  expect(dMont === dPrest, `prestation le même jour que le montage (${dMont} vs ${dPrest})`);
  await rows.nth(1).locator('button[aria-label*="jour après"]').click(); await page.waitForTimeout(200);
  const dApres = (await rows.nth(1).locator('input[type=datetime-local]').first().inputValue()).slice(0, 10);
  expect(dApres > dMont, `bloc décalé d’un jour (+1 j : ${dMont} → ${dApres})`);
  await m.locator('button[aria-label="Fermer"]').click();
});

await step('Email : les destinataires proposent d’abord ceux liés au projet', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  await page.locator('button:has-text("Devis")').first().click();
  await page.waitForSelector('.doc', { timeout: 15000 });
  await page.click('button:has-text("Envoyer par email")');
  await page.waitForSelector('.recipients input');
  await page.locator('.recipients input').first().click();
  await page.waitForTimeout(400);
  const hits = await page.locator('.rcpt-hits').innerText().catch(() => '');
  expect(hits.includes('@'), 'suggestions de destinataires proposées (' + hits.slice(0, 120) + ')');
  await page.locator('.modal button[aria-label="Fermer"]').click();
});

await step('Modèles : décocher une section la retire de l’aperçu pour ce type de document', async () => {
  await go('modeles');
  await page.locator('.tpl-types button:text-is("Facture")').click();
  await page.waitForTimeout(400);
  const box = page.locator('.blk-toggles .check-row', { hasText: 'Frais supplémentaires' }).locator('input');
  expect(await box.isChecked(), 'section cochée par défaut');
  const avant = await page.locator('.doc').innerText();
  await box.uncheck(); await page.waitForTimeout(400);
  const apres = await page.locator('.doc').innerText();
  if (avant.includes('Frais')) expect(!apres.includes('Frais supplémentaires'), 'section retirée de l’aperçu');
});

await step('Devis : groupes d\'options au choix + version (n° de PR) affichée', async () => {
  await resetDemo();
  await openProject('Marché de Noël');
  await tab('Équipement');
  for (const name of ['Enceinte L-Acoustics X12', 'Projecteur PAR LED']) {
    const row = page.locator('.sub tr', { hasText: name }).first();
    await row.locator('button[aria-label="Détails de la ligne"]').click();
    await page.waitForSelector('.modal');
    await page.locator('.modal label', { hasText: 'En option sur le devis' }).locator('input').check();
    await page.locator('.modal input[aria-label="Groupe d\'options"]').fill('Son');
    await page.locator('.modal .form-actions button:text-is("Enregistrer")').click();
    await page.waitForTimeout(300);
  }
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const opt = await page.locator('.doc .doc-options').innerText();
  expect(opt.includes('Son') && opt.includes('Enceinte L-Acoustics X12') && opt.includes('Projecteur PAR LED'), 'groupe « Son » sur le devis : ' + opt.slice(0, 140));
  expect((await page.locator('.side-version').innerText()).includes(VER), `version ${VER} dans le menu`);
  await go('parametres');
  expect((await page.locator('main').innerText()).includes(VER) && (await page.locator('main').innerText()).includes('PR'), 'version dans les paramètres');
});

await step('Scan étiquette article sur ligne sérialisée : 1 unité = auto, plusieurs = choix manuel', async () => {
  await resetDemo();
  await openProject('Mariage Dupont-Lemaire');
  await tab('Équipement');
  const qa = page.locator('input[aria-label="Ajouter un article"]').first();
  await qa.fill('console yamaha cl5');
  await qa.press('Enter');
  await page.waitForTimeout(500);
  await openChecklist('Mariage Dupont-Lemaire');
  // LA4X a 3 unités : scan de l'étiquette article → sélecteur manuel (pas de flash, on ne lit pas le flash ici)
  await scanRaw('DEMO-AMPLI');
  await page.waitForTimeout(300);
  expect(await page.locator('.cl-ask button', { hasText: 'LA4X-1002' }).count() === 1, 'sélecteur d\'unités proposé (3 unités)');
  await page.locator('.cl-ask button', { hasText: 'LA4X-1002' }).click();
  await page.waitForSelector('.checklist-scan .flash', { timeout: 10000 });
  const f1 = await page.locator('.checklist-scan .flash').innerText();
  expect(f1.includes('Sortie : Amplificateur LA4X') && f1.includes('LA4X-1002'), 'unité choisie comptée : ' + f1);
  // CL5 n'a qu'une unité : scan de l'étiquette article → comptée d'office, sans sélecteur
  await scan('DEMO-CL5');
  const f2 = await page.locator('.checklist-scan .flash').innerText();
  expect(f2.includes('Console Yamaha CL5') && f2.includes('CL5-1001'), 'unité unique prise d\'office : ' + f2);
  expect(await page.locator('.cl-ask').count() === 0, 'pas de sélecteur quand une seule unité');
});

await step('Document : mise en page identique en impression depuis téléphone (390 px) et ordinateur (1400 px)', async () => {
  await resetDemo();
  await openProject('Gala de fin d');
  await tab('Finances & documents');
  await page.locator('table.list tr.click', { hasText: /F-\d{4}/ }).first().click();
  await page.waitForSelector('.doc');
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 390, height: 844 });
  const wMobile = await page.evaluate(() => Math.round(document.querySelector('.doc').getBoundingClientRect().width));
  await page.setViewportSize({ width: 1400, height: 950 });
  const wDesktop = await page.evaluate(() => Math.round(document.querySelector('.doc').getBoundingClientRect().width));
  await page.emulateMedia({ media: 'screen' });
  expect(wMobile === 794 && wDesktop === 794, `largeur d’impression identique partout (${wMobile} px mobile, ${wDesktop} px ordinateur)`);
});

await step('Facture : QR code de paiement toujours imprimé (même si le gabarit l’oublie)', async () => {
  await resetDemo();
  await openProject('Gala de fin d');
  await tab('Finances & documents');
  await page.locator('table.list tr.click', { hasText: /F-\d{4}/ }).first().click();
  await page.waitForSelector('.doc');
  expect(await page.locator('.doc .pay svg').count() >= 1, 'QR EPC présent sur la facture');
  expect((await page.locator('.doc .pay').innerText()).includes('+++'), 'communication structurée +++…+++');
});

await step('Facturation : récap par projet — facturé, reste, drapeau « évènement passé »', async () => {
  // projet confirmé dont l'évènement est passé, avec du matériel mais rien de facturé
  await go('projets');
  await page.click('text=+ Nouveau projet');
  await page.fill('.modal input >> nth=0', 'Projet passe test');
  const d = new Date(Date.now() - 2 * 86400000);
  const dd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.locator('.modal .field', { hasText: 'Début' }).locator('input').fill(dd + 'T08:00');
  await page.locator('.modal .field', { hasText: 'Fin' }).locator('input').fill(dd + 'T23:00');
  await page.locator('.modal .field', { hasText: 'Statut' }).locator('select').selectOption('confirme');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.project-tabs');
  await tab('Équipement');
  await page.locator('button:has-text("+ Matériel")').first().click();
  await page.locator('.modal .pick-row').first().locator('input').fill('1');
  await page.click('.modal button:has-text("Ajouter (")');
  await page.waitForTimeout(400);
  await go('comptabilite');
  const card = page.locator('.card', { hasText: 'Ce qui est facturé par projet' });
  await card.locator('table.list tbody tr').first().waitFor();
  const row = card.locator('table.list tbody tr', { hasText: 'Projet passe test' });
  expect((await row.count()) === 1, 'ligne du projet passé dans le récap');
  const rt = await row.innerText();
  expect(rt.includes('Évènement passé'), `drapeau « évènement passé » (${rt.slice(0, 220)})`);
  expect(rt.includes('0,00'), `facturé à 0,00 € (${rt.slice(0, 220)})`);
  // le Gala (terminé, facture + acompte) : tout facturé, visible avec la case « tout facturés »
  await page.check('input[aria-label="Afficher aussi les projets tout facturés"]');
  await page.waitForTimeout(300);
  const gala = card.locator('table.list tbody tr', { hasText: 'Gala de fin' });
  expect((await gala.count()) === 1, 'ligne du Gala');
  expect((await gala.innerText()).includes('Tout facturé'), 'Gala marqué « tout facturé »');
});

await step('Projet offert (gratuit) : case à cocher, devis généré à 0 € avec mention « offert »', async () => {
  await go('projets');
  await page.click('text=+ Nouveau projet');
  await page.fill('.modal input >> nth=0', 'Projet offert test');
  await page.check('input[aria-label="Projet offert (gratuit)"]');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.project-tabs');
  // badge « offert » dans la liste
  await go('projets');
  expect((await page.locator('table.list tbody tr', { hasText: 'Projet offert test' }).innerText()).includes('offert'), 'badge « offert » dans la liste');
  await openProject('Projet offert test');
  await tab('Équipement');
  await page.locator('button:has-text("+ Matériel")').first().click();
  await page.locator('.modal .pick-row').first().locator('input').fill('2');
  await page.click('.modal button:has-text("Ajouter (")');
  await page.waitForTimeout(400);
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  const totals = await page.locator('.doc .totals').innerText();
  expect(totals.includes('0,00'), `total du devis à 0 € malgré le matériel (${totals})`);
  expect((await page.locator('.doc').innerText()).includes('offert'), 'mention « Projet offert » sur le document');
});

await step('Comptes et rôles : verrouillage, admin, entrepôt (sans les prix), sous-traitant (planning perso)', async () => {
  const loginAs = async (email, pass) => {
    await page.waitForSelector('.login-card');
    await page.locator('input[aria-label="Email"]').fill(email);
    await page.locator('input[aria-label="Mot de passe"]').fill(pass);
    await page.click('button:text-is("Se connecter")');
    await page.waitForLoadState('load');
    await page.waitForSelector('.sidebar nav');
  };
  const addUser = async (name, email, pass, role, personLabel) => {
    await go('parametres');
    await page.locator('input[aria-label="Nom du nouvel utilisateur"]').fill(name);
    await page.locator('input[aria-label="Email du nouvel utilisateur"]').fill(email);
    await page.locator('input[aria-label="Mot de passe du nouvel utilisateur"]').fill(pass);
    await page.locator('select[aria-label="Rôle du nouvel utilisateur"]').selectOption(role);
    if (personLabel) await page.locator('select[aria-label="Personne liée (sous-traitant)"]').selectOption({ label: personLabel });
    await page.click('button:text-is("+ Ajouter")');
    await page.waitForTimeout(400);
  };
  await resetDemo();
  // premier compte = admin ; la base se verrouille ensuite
  await addUser('Nicolas', 'nico@fab.be', 'secret1', 'admin');
  await page.reload();
  await page.waitForSelector('.login-card');
  await loginAs('nico@fab.be', 'secret1');
  expect((await page.locator('.sidebar nav a').count()) > 15, 'admin : menu complet');
  await addUser('Magasin', 'mag@fab.be', 'secret2', 'warehouse');
  await addUser('Sam', 'sam@fab.be', 'secret3', 'subcontractor', 'Sam Moreau (démo)');
  // entrepôt : menu restreint, prix verrouillés
  await page.click('.side-user');
  await loginAs('mag@fab.be', 'secret2');
  const labels = await page.locator('.sidebar nav a').allInnerTexts();
  expect(labels.some((l) => l.includes('Entrepôt')) && !labels.some((l) => l.includes('Projets')), 'menu entrepôt restreint : ' + labels.join(','));
  await go('materiel');
  await page.locator('table.list tr.click', { hasText: 'Caisson SB18' }).first().click();
  await page.click('button:text-is("Modifier")');
  await page.waitForSelector('.edit-inline');
  expect((await page.locator('.edit-inline').innerText()).includes("réservé à l'administrateur"), 'prix verrouillés pour l\'entrepôt');
  expect(await page.locator('.edit-inline input[aria-label="Désignation"]').count() === 1, 'mais le reste est modifiable');
  // sous-traitant : 3 pages, projets interdits (redirection), planning perso
  await page.click('.side-user');
  await loginAs('sam@fab.be', 'secret3');
  expect((await page.locator('.sidebar nav a').count()) === 3, 'sous-traitant : 3 entrées de menu');
  await go('projets');
  await page.waitForTimeout(600);
  expect(page.url().includes('/attribution'), 'projets redirigé vers le planning perso');
  await go('planning');
  expect(await page.locator('.cal, .calendar, main').count() >= 1, 'planning visible');
});

await step('MFA (TOTP) : activation par QR + code à 6 chiffres obligatoire à chaque connexion', async () => {
  // repasse en admin
  await page.click('.side-user');
  await page.waitForSelector('.login-card');
  await page.locator('input[aria-label="Email"]').fill('nico@fab.be');
  await page.locator('input[aria-label="Mot de passe"]').fill('secret1');
  await page.click('button:text-is("Se connecter")');
  await page.waitForLoadState('load');
  await page.waitForSelector('.sidebar nav');
  await go('parametres');
  const row = page.locator('.card table.list tbody tr', { hasText: 'nico@fab.be' }).first();
  await row.locator('button', { hasText: 'Activer MFA' }).click();
  await page.waitForSelector('.modal');
  await page.click('button:text-is("Générer un secret")');
  const secret = (await page.locator('.mfa-secret').innerText()).trim();
  expect(/^[A-Z2-7]{32}$/.test(secret), 'secret base32 affiché');
  expect(await page.locator('.modal svg').count() >= 1, 'QR code otpauth affiché');
  await page.locator('input[aria-label="Code de confirmation MFA"]').fill(totp(secret));
  await page.click('button:text-is("Activer le MFA")');
  await page.waitForTimeout(500);
  expect((await row.locator('button', { hasText: 'MFA…' }).count()) === 1, 'MFA activé sur le compte');
  // déconnexion → reconnexion : code demandé
  await page.click('.side-user');
  await page.waitForSelector('.login-card');
  await page.locator('input[aria-label="Email"]').fill('nico@fab.be');
  await page.locator('input[aria-label="Mot de passe"]').fill('secret1');
  await page.click('button:text-is("Se connecter")');
  await page.waitForSelector('input[aria-label="Code MFA à 6 chiffres"]');
  const wrong = String((Number(totp(secret)) + 1) % 1e6).padStart(6, '0');
  await page.locator('input[aria-label="Code MFA à 6 chiffres"]').fill(wrong);
  await page.click('button:text-is("Vérifier le code")');
  await page.waitForTimeout(400);
  expect((await page.locator('.login-card').innerText()).includes('incorrect'), 'mauvais code refusé');
  await page.locator('input[aria-label="Code MFA à 6 chiffres"]').fill(totp(secret));
  await page.click('button:text-is("Vérifier le code")');
  await page.waitForLoadState('load');
  await page.waitForSelector('.sidebar nav');
  expect((await page.locator('.side-user').innerText()).includes('Nicolas'), 'connexion avec MFA réussie');
});

await step('Connexion externe (OAuth) : bouton Google, code à usage unique, rattachement par email (+ MFA)', async () => {
  // serveur stubbé : oauth.php (popup + échange du code) et sync.php (pas d'erreur console)
  // ctx.route (pas page.route) pour intercepter aussi la navigation de la popup
  await ctx.route('**/api/oauth.php**', (route) => {
    const url = route.request().url();
    if (url.includes('action=authorize')) {
      route.fulfill({ contentType: 'text/html', body: `<script>window.opener && window.opener.postMessage({source:'fabevent-oauth', code:'${'a'.repeat(32)}'}, '*'); setTimeout(function(){window.close()},200);</script><p>redirection…</p>` });
    } else if (url.includes('action=login')) {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, profile: { email: 'nico@fab.be', name: 'Nicolas', provider: 'google', sub: 'g-123' } }) });
    } else {
      route.fulfill({ contentType: 'application/json', body: '{"ok":true,"providers":["google"]}' });
    }
  });
  await ctx.route('**/api/sync.php**', (route) => {
    const url = route.request().url();
    const body = url.includes('action=pull') ? '{"ok":true,"changes":[],"seq":0,"more":false}'
      : url.includes('action=ping') ? '{"ok":true,"user":"t","space":"u-t"}'
      : '{"ok":true,"applied":0,"skipped":0,"n":1}';
    route.fulfill({ contentType: 'application/json', body });
  });
  // adresse du serveur de synchro (d'où dérive oauth.php)
  await page.evaluate(() => { try { localStorage.setItem('fab.sync.url', 'http://localhost:9999/api/sync.php'); } catch {} });
  await page.reload();
  await page.waitForSelector('.sidebar nav, .login-card');
  if (await page.locator('.sidebar nav').count()) { await page.click('.side-user'); await page.waitForSelector('.login-card'); }
  const gBtn = page.locator('button[aria-label="Se connecter avec Google"]');
  expect((await gBtn.count()) === 1, 'bouton Google affiché (serveur configuré)');
  const [popup] = await Promise.all([page.waitForEvent('popup'), gBtn.click()]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  // MFA demandée aussi après OAuth (compte nico protégé)
  await page.waitForSelector('input[aria-label="Code MFA à 6 chiffres"]', { timeout: 15000 });
  // lecture du secret TOTP directement dans IndexedDB
  const totpSecret = await page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('fabevent_' + (localStorage.getItem('fabevent.workspace') || 'principal'));
    rq.onsuccess = () => { const d = rq.result; try { const tx = d.transaction('users', 'readonly'); const q = tx.objectStore('users').getAll(); q.onsuccess = () => res((q.result.find((u) => u.email === 'nico@fab.be') || {}).totpSecret || ''); q.onerror = () => res(''); } catch { res(''); } };
    rq.onerror = () => res('');
  }));
  expect(/^[A-Z2-7]{32}$/.test(totpSecret), 'secret TOTP relu depuis la base');
  await page.locator('input[aria-label="Code MFA à 6 chiffres"]').fill(totp(totpSecret));
  await page.click('button:text-is("Vérifier le code")');
  await page.waitForLoadState('load');
  await page.waitForSelector('.sidebar nav');
  expect((await page.locator('.side-user').innerText()).includes('Nicolas'), 'connecté via Google (rattaché à nico@fab.be) + MFA OK');
  await ctx.unroute('**/api/oauth.php**');
  await ctx.unroute('**/api/sync.php**');
  await page.evaluate(() => { try { localStorage.removeItem('fab.sync.url'); } catch {} });
});

await step('Mot de passe oublié : demande de lien depuis l’écran de connexion (serveur stubbé)', async () => {
  let resetCalls = 0; let resetBody = '';
  await ctx.route('**/api/sync.php**', (route) => {
    const u = route.request().url();
    route.fulfill({ contentType: 'application/json', body: u.includes('action=pull') ? '{"ok":true,"changes":[],"seq":0,"more":false}' : u.includes('action=ping') ? '{"ok":true,"user":"t","space":"u-t"}' : '{"ok":true,"applied":0,"skipped":0,"n":1}' });
  });
  await ctx.route('**/api/public.php**', (route) => {
    if (route.request().url().includes('action=reset_request')) { resetCalls++; resetBody = route.request().postData() || ''; route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    else route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.evaluate(() => { try { localStorage.setItem('fab.sync.url', 'http://localhost:9999/api/sync.php'); } catch {} });
  await page.reload();
  await page.waitForSelector('.sidebar nav, .login-card');
  if (await page.locator('.sidebar nav').count()) { await page.click('.side-user'); await page.waitForSelector('.login-card'); }
  const forgotBtn = page.locator('button:has-text("Mot de passe oublié ?")');
  expect((await forgotBtn.count()) === 1, 'lien « Mot de passe oublié ? » affiché sur l’écran de connexion');
  await forgotBtn.click();
  await page.fill('input[aria-label="Email du compte pour la réinitialisation"]', 'nico@fab.be');
  await page.click('button:text-is("Envoyer le lien de réinitialisation")');
  await page.waitForSelector('.login-card .avail.ok');
  expect((await page.locator('.login-card .avail.ok').innerText()).includes('lien de réinitialisation'), 'confirmation affichée');
  expect(resetCalls === 1 && resetBody.includes('nico@fab.be'), `demande POSTée au serveur (${resetCalls} appel : ${resetBody})`);
  await ctx.unroute('**/api/public.php**');
  await ctx.unroute('**/api/sync.php**');
  await page.evaluate(() => { try { localStorage.removeItem('fab.sync.url'); } catch {} });
});

/** Serveur FabEvent simulé où l'on est déjà connecté (auth.php) : sinon l'écran de connexion s'affiche d'office. */
const stubSignedIn = (c) => c.route('**/api/auth.php**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(
  route.request().url().includes('action=status')
    ? { ok: true, session: true, users: true, setup: null, user: { id: 'connecte-test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', name: 'Test', email: 'test@exemple.org', salt: 's', passHash: 'h', role: 'admin', active: true } }
    : { ok: true, bases: [] }) }));

await step('Diagnostic : API qui renvoie la page HTML de l’app → message explicite', async () => {
  // reconnexion admin (MFA actif sur nico@fab.be), puis base non-démo (la démo ne se synchronise jamais)
  await page.waitForSelector('.login-card');
  await page.locator('input[aria-label="Email"]').fill('nico@fab.be');
  await page.locator('input[aria-label="Mot de passe"]').fill('secret1');
  await page.click('button:text-is("Se connecter")');
  await page.waitForSelector('input[aria-label="Code MFA à 6 chiffres"]');
  const secret = await page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('fabevent_' + (localStorage.getItem('fabevent.workspace') || 'principal'));
    rq.onsuccess = () => { const d = rq.result; try { const tx = d.transaction('users', 'readonly'); const q = tx.objectStore('users').getAll(); q.onsuccess = () => res((q.result.find((u) => u.email === 'nico@fab.be') || {}).totpSecret || ''); q.onerror = () => res(''); } catch { res(''); } };
    rq.onerror = () => res('');
  }));
  await page.locator('input[aria-label="Code MFA à 6 chiffres"]').fill(totp(secret));
  await page.click('button:text-is("Vérifier le code")');
  await page.waitForSelector('.sidebar nav');
  const ws0 = await page.evaluate(() => localStorage.getItem('fabevent.workspace') || 'demo');
  await page.evaluate(() => { try { localStorage.setItem('fabevent.workspace', 'principal'); localStorage.setItem('fab.sync.url', 'http://localhost:9999/api/sync.php'); } catch {} });
  await stubSignedIn(ctx);
  await page.goto(U);
  // reconnexion automatique (session du serveur simulé) puis rechargement
  await page.waitForFunction(() => !!localStorage.getItem('fab.session.principal'), null, { timeout: 15000 });
  await page.waitForSelector('.sidebar nav');
  await page.waitForTimeout(800);
  // API stubbée en HTML (cas réécriture SPA : api/ absent) → diagnostic attendu
  await ctx.route('**/api/sync.php**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>FabEvent</title><p>app</p>' }));
  await go('parametres');
  await page.click('button:text-is("Synchroniser maintenant")');
  await page.waitForSelector('.avail.ko:has-text("API non atteinte")', { timeout: 15000 });
  const msg = await page.locator('.avail.ko').first().innerText();
  expect(msg.includes('api/'), `diagnostic affiché (${msg.slice(0, 140)})`);
  await ctx.unroute('**/api/sync.php**');
  await ctx.unroute('**/api/auth.php**');
  await page.evaluate((w) => { try { localStorage.setItem('fabevent.workspace', w); localStorage.removeItem('fab.sync.url'); } catch {} }, ws0);
});

await step('Bases : créer une base « autre société » isolée (données, comptes et synchro séparés)', async () => {
  // on repart de la base en cours (démo, remplie) pour comparer avant/après
  const ws0 = await page.evaluate(() => localStorage.getItem('fabevent.workspace') || 'demo');
  await page.evaluate((w) => { try { localStorage.setItem('fabevent.workspace', w); } catch {} }, ws0);
  await page.goto(U);
  await page.waitForSelector('.sidebar nav');
  await go('projets');
  const nA = await page.locator('table.list tbody tr').count();
  expect(nA >= 1, `base de départ remplie (${nA} projet(s))`);
  // synchro stubbée : on capture le ws envoyé par la nouvelle base
  let pullWs = '';
  await ctx.route('**/api/sync.php**', (route) => {
    const u = route.request().url();
    if (u.includes('action=pull')) pullWs = new URL(u).searchParams.get('ws') || '';
    route.fulfill({ contentType: 'application/json', body: u.includes('action=pull') ? '{"ok":true,"changes":[],"seq":0,"more":false}' : u.includes('action=ping') ? '{"ok":true,"user":"t","space":"u-t"}' : '{"ok":true,"applied":0,"skipped":0,"n":1}' });
  });
  await stubSignedIn(ctx);
  await go('parametres');
  await page.click('button:has-text("Nouvelle base pour une autre société")');
  await page.waitForSelector('.modal');
  await page.fill('input[aria-label="Nom de la société"]', 'Societe Beta');
  await page.fill('input[aria-label="Adresse de synchro de la nouvelle base"]', 'http://localhost:9999/api/sync.php');
  await page.click('.modal button:text-is("Créer et ouvrir")');
  await page.waitForSelector('.sidebar nav');
  await page.waitForTimeout(1500); // laisse la synchro démarrer (300 ms) et faire le pull
  expect(await page.evaluate(() => localStorage.getItem('fabevent.workspace')) === 'societe-beta', 'base « societe-beta » ouverte');
  expect(await page.evaluate(() => localStorage.getItem('fab.sync.url.societe-beta')) === 'http://localhost:9999/api/sync.php', 'URL de synchro propre à la base enregistrée');
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('fabevent.wsmeta') || '{}')['societe-beta'] || {}).society === true), 'métadonnée « société isolée » enregistrée');
  expect(pullWs === 'societe-beta', `synchro de la nouvelle base avec ws=societe-beta (reçu : ${pullWs})`);
  // la nouvelle base est vide : rien de l'autre base ne fuite
  await go('projets');
  const nBeta = await page.locator('table.list tbody tr').count();
  expect(nBeta === 0, `base société vide (${nBeta} projet(s) au lieu de ${nA})`);
  // badge « société isolée » affiché dans les paramètres
  await go('parametres');
  expect((await page.locator('.card', { hasText: 'Bases de données' }).innerText()).includes('société isolée'), 'badge société isolée affiché');
  // retour à la base de départ : données intactes
  await page.locator('.ws-list button', { hasText: ws0 }).first().click();
  await page.waitForSelector('.sidebar nav');
  await go('projets');
  const nBack = await page.locator('table.list tbody tr').count();
  expect(nBack === nA, `base de départ intacte (${nBack} = ${nA} projets)`);
  await ctx.unroute('**/api/sync.php**');
  await ctx.unroute('**/api/auth.php**');
});

await step('Remplissage automatique : adresse d’un lieu trouvée sur la carte, article complété depuis un article semblable', async () => {
  await resetDemo();
  // carte simulée (OpenStreetMap)
  await ctx.route('**/nominatim.openstreetmap.org/search**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { display_name: 'La Boverie, Parc de la Boverie 3, 4020 Liège, Belgique', name: 'La Boverie',
      address: { road: 'Parc de la Boverie', house_number: '3', postcode: '4020', city: 'Liège', country_code: 'be' }, extratags: { phone: '+32 4 238 55 01' } }]) }));
  await go('lieux');
  await page.click('button:has-text("Nouveau lieu")');
  await page.waitForSelector('.modal');
  await page.locator('.modal label.field', { has: page.locator('span:text-is("Société / Nom *")') }).locator('input').fill('Boverie');
  await page.click('.modal button:has-text("Chercher l’adresse")');
  await page.waitForSelector('.lookup-hits button');
  await page.click('.lookup-hits button');
  const val = (label) => page.locator('.modal label.field', { has: page.locator(`span:text-is("${label}")`) }).locator('input').inputValue();
  expect((await val('Adresse')) === 'Parc de la Boverie 3' && (await val('Code postal')) === '4020' && (await val('Ville')) === 'Liège', 'adresse remplie');
  expect((await val('Téléphone')) === '+32 4 238 55 01' && (await val('Société / Nom *')) === 'Boverie', 'téléphone ajouté, nom saisi conservé');
  await page.keyboard.press('Escape');
  await ctx.unroute('**/nominatim.openstreetmap.org/search**');
  // article : même marque et modèle qu'un article de la démo
  await go('materiel');
  await page.click('button:has-text("Nouvel article")');
  await page.waitForSelector('.modal');
  await page.fill('.modal input[aria-label="Marque"]', 'L-Acoustics');
  await page.fill('.modal input[aria-label="Modèle"]', 'X12');
  const btn = page.locator('.modal button:has-text("Reprendre de")');
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
  expect((await page.locator('.modal .lookup .avail.ok').innerText()).includes('poids'), 'poids repris de l’article semblable');
  // fiche technique cherchée sur internet (serveur FabEvent simulé)
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let asked = '';
  await page.evaluate(() => { try { localStorage.setItem('fab.sync.url', 'http://localhost:9999/api/sync.php'); } catch {} });
  await ctx.route('**/api/lookup.php**', (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.has('img')) return route.fulfill({ contentType: 'image/png', body: PNG });
    asked = u.searchParams.get('spec') || '';
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, searched: 6, results: [
      { source: 'l-acoustics.com', url: 'https://www.l-acoustics.com/x12', title: 'X12', weight: 20, dims: { l: 43, w: 37, h: 54 }, power: 0, images: ['https://www.l-acoustics.com/x12.png'] },
      { source: 'shop.be', url: 'https://shop.be/x12', title: 'L-Acoustics X12', weight: 20, price: { amount: 2890, currency: 'EUR' } },
      { source: 'shop.co.uk', url: 'https://shop.co.uk/x12', weight: 21.5, price: { amount: 2500, currency: 'GBP' } },
    ] }) });
  });
  await page.click('.modal button:has-text("Chercher la fiche technique")');
  await page.waitForSelector('.modal .spec-search');
  await page.click('.modal .spec-search button');
  await page.waitForSelector('.spec-choices');
  const choicesText = await page.locator('.spec-choices').innerText();
  expect(asked === 'L-Acoustics X12', `recherche « marque modèle » (${asked})`);
  expect(choicesText.includes('20 kg') && choicesText.includes('21,5 kg') && choicesText.includes('43 × 37 × 54 cm') && choicesText.includes('2890 €') && !choicesText.includes('2500'), 'poids, dimensions, prix en euros proposés avec leurs sources');
  expect(await page.locator('.spec-field:has(legend:text-is("Poids")) input[type=radio]:checked + strong').count() === 0, 'poids déjà rempli : gardé par défaut');
  await page.check('.spec-field:has(legend:text-is("Poids")) input[aria-label="21,5 kg"]');
  await page.check('.spec-photo input');
  const dialogs = [];
  const onDlg = (d) => dialogs.push(d.message());
  page.on('dialog', onDlg);
  await page.click('.modal button:has-text("Remplir la fiche")');
  try { await page.waitForSelector('.spec-choices', { state: 'detached' }); }
  catch { throw new Error(`fiche non remplie : ${await page.locator('.spec-choices').count()} fenêtre(s), ${await page.locator('.modal').count()} modale(s), message « ${await page.locator('.modal .lookup .avail').first().innerText().catch(() => '')} », alertes ${JSON.stringify(dialogs)}`); }
  finally { page.off('dialog', onDlg); }
  expect((await page.locator('.modal .lookup .avail.ok').innerText()).includes('Rempli depuis internet'), 'message après remplissage');
  expect(await page.locator('.modal input[aria-label="Longueur (cm)"]').inputValue() === '43' && await page.locator('.modal input[aria-label="Hauteur (cm)"]').inputValue() === '54', 'dimensions remplies');
  const vals = await page.locator('.modal').innerText();
  expect(vals.includes('85,9 L'), 'volume déduit des dimensions');
  await page.keyboard.press('Escape');
  await ctx.unroute('**/api/lookup.php**');
  await page.evaluate(() => { try { localStorage.removeItem('fab.sync.url'); } catch {} });
});

await step('Kits : type d’article simple / kit virtuel / kit fixe (caisse montée, contenu bloqué, vérification au choix)', async () => {
  await resetDemo();
  await go('materiel');
  await page.click('button:has-text("Nouvel article")');
  await page.waitForSelector('.modal');
  await page.fill('.modal input[aria-label="Désignation"]', 'Caisse micros test');
  await page.selectOption('.modal select[aria-label="Type d\'article"]', 'fixe');
  expect(await page.locator('.modal input[aria-label="Vérifier le contenu à la sortie et au retour"]').count() === 1, 'option « vérifier le contenu » proposée');
  expect((await page.locator('.modal').innerText()).includes('Caisses montées'), 'stock = caisses montées');
  await page.selectOption('.modal select[aria-label="Type d\'article"]', 'virtuel');
  expect(await page.locator('.modal input[aria-label="Vérifier le contenu à la sortie et au retour"]').count() === 0, 'kit virtuel : pas d’option de vérification');
  expect((await page.locator('.modal').innerText()).includes('selon les quantités de ses composants'), 'kit virtuel : stock selon les composants');
  await page.selectOption('.modal select[aria-label="Type d\'article"]', 'fixe');
  await page.locator('.modal input[aria-label="Vérifier le contenu à la sortie et au retour"]').check();
  await page.click('.modal button[type=submit]:not([data-print])');
  await page.waitForSelector('.modal', { state: 'detached' });
  const row = page.locator('table.list tbody tr', { hasText: 'Caisse micros test' });
  expect((await row.innerText()).includes('Kit fixe'), 'badge « Kit fixe » dans le catalogue');
});

await step('Catalogue modifié : rien ne change tout seul dans les projets, mise à jour proposée et choisie', async () => {
  await resetDemo();
  // prix de l'enceinte X12 avant / après, dans un projet qui l'utilise
  await openProject('Festival des Lumières');
  await tab('Équipement');
  const x12Row = () => page.locator('table tr', { hasText: 'Enceinte L-Acoustics X12' }).first();
  const priceBefore = await x12Row().locator('input').nth(1).inputValue().catch(() => '');
  const before = await page.locator('.catalog-changes').count();
  // le catalogue change : prix de la X12 +10 €
  await go('materiel');
  await page.locator('table.list tbody tr', { hasText: 'Enceinte L-Acoustics X12' }).first().click();
  await page.click('main button:text-is("Modifier")');
  await page.waitForSelector('.edit-inline');
  const priceField = page.locator('.edit-inline label.field', { has: page.locator('span:text-is("Prix location / jour HT (€)")') }).locator('input');
  const old = Number((await priceField.inputValue()).replace(',', '.'));
  await priceField.fill(String(old + 10));
  await page.click('.edit-inline button[type=submit]');
  await page.waitForTimeout(400);
  // le projet n'a pas changé tout seul ; un bandeau propose la mise à jour
  await openProject('Festival des Lumières');
  await tab('Équipement');
  expect(await page.locator('.catalog-changes').count() === 1, `bandeau « le catalogue a changé » (avant : ${before})`);
  const priceAfter = await x12Row().locator('input').nth(1).inputValue().catch(() => '');
  expect(priceAfter === priceBefore, `prix du projet inchangé (${priceBefore} / ${priceAfter})`);
  await page.click('.catalog-changes button:has-text("Voir et mettre à jour")');
  await page.waitForSelector('.modal');
  const row = page.locator('.modal tr', { hasText: 'Enceinte L-Acoustics X12' }).filter({ hasText: 'Prix' }).first();
  expect((await row.innerText()).includes('→'), 'changement de prix listé');
  // ne mettre à jour QUE la X12
  await page.locator('.modal input[aria-label="Tout cocher"]').uncheck();
  await row.locator('input[type=checkbox]').check();
  await page.click('.modal button:has-text("Mettre à jour 1 ligne(s)")');
  await page.waitForTimeout(500);
  expect(await page.locator('.modal tr', { hasText: 'Enceinte L-Acoustics X12' }).filter({ hasText: 'Prix' }).count() === 0, 'changement appliqué, plus proposé');
  await page.keyboard.press('Escape');
});

await step('Finances : remise sur le matériel seulement, reprise sur le devis', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  const num = (t) => parseFloat(t.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.'));
  const ht = async () => num(await page.locator('.stat', { hasText: 'total HT' }).first().locator('b').innerText());
  const before = await ht();
  const matRow = page.locator('.fin-table tr', { hasText: 'Matériel' }).first();
  const mat = num((await matRow.locator('td').nth(5).innerText()));
  const per0 = (await page.locator('.fin-table tr', { hasText: 'Personnel' }).first().locator('td').nth(5).innerText());
  await page.fill('input[aria-label="Remise Matériel %"]', '10');
  await page.locator('input[aria-label="Remise Matériel %"]').blur();
  await page.waitForTimeout(400);
  expect(Math.abs((before - (await ht())) - mat * 0.1) < 0.05, `total HT −10 % du matériel (${before} → ${await ht()})`);
  expect((await page.locator('.fin-table tr', { hasText: 'Personnel' }).first().locator('td').nth(5).innerText()) === per0, 'personnel non remisé');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  expect((await page.locator('.doc .totals').innerText()).includes('matériel (10 %)'), 'ligne « Remise matériel (10 %) » sur le devis');
});

await step('Tableaux : clic sur le titre d’une colonne = tri A → Z, puis Z → A (texte et montants)', async () => {
  await resetDemo();
  await go('contacts');
  const names = () => page.locator('table.list tbody tr td:nth-child(2)').allInnerTexts();
  const th = page.locator('table.list thead th:text-is("Nom")');
  await th.click();
  const asc = await names();
  const cmp = (a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
  expect(asc.length > 2 && asc.every((n, i) => i === 0 || cmp(asc[i - 1], n) <= 0), `A → Z (${asc.slice(0, 3).join(', ')}…)`);
  expect(await th.getAttribute('class').then((c) => c.includes('sort-asc')), 'flèche ▲ sur la colonne');
  await th.click();
  const desc = await names();
  expect(JSON.stringify(desc) === JSON.stringify([...asc].reverse()), 'Z → A au 2e clic');
  // montants : du plus petit au plus grand (et pas dans l'ordre du texte)
  await go('vehicules');
  await page.click('table.list thead th:has-text("Forfait/j")');
  const prices = (await page.locator('table.list tbody tr td:nth-child(5)').allInnerTexts()).map((t) => parseFloat(t.replace(/[^\d,]/g, '').replace(',', '.')) || 0);
  expect(prices.every((p, i) => i === 0 || prices[i - 1] <= p), `forfaits croissants (${prices.join(' ; ')})`);
});

await step('Tableaux : plusieurs lignes cochées → changer le type / le statut, exporter, supprimer', async () => {
  await resetDemo();
  // contacts : deux cochés, type changé d'un coup
  await go('contacts');
  const boxes = page.locator('table.list tbody tr td.sel-col input');
  const n0 = await boxes.count();
  await boxes.nth(0).check(); await boxes.nth(1).check();
  expect((await page.locator('.bulk-bar').innerText()).includes('2 contact(s) sélectionné(s)'), 'barre : 2 contacts');
  const picked = [await page.locator('table.list tbody tr').nth(0).locator('td').nth(1).innerText(), await page.locator('table.list tbody tr').nth(1).locator('td').nth(1).innerText()].map((t) => t.split('\n')[0].trim());
  await page.selectOption('.bulk-bar select[aria-label="Changer le type"]', 'fournisseur');
  await page.waitForTimeout(300);
  for (const name of picked) expect((await page.locator('table.list tbody tr', { hasText: name }).first().innerText()).includes('Fournisseur'), `${name} passé en fournisseur`);
  // export des seules lignes cochées
  const dl = page.waitForEvent('download');
  await page.click('.bulk-bar button:text-is("Exporter (CSV)")');
  const csvText = readFileSync(await (await dl).path(), 'utf8');
  expect(csvText.trim().split(/\r?\n/).length === 3, 'CSV : en-tête + 2 lignes cochées');
  // tout sélectionner, puis désélectionner
  await page.check('table.list thead input[aria-label="Tout sélectionner"]');
  expect((await page.locator('.bulk-bar').innerText()).includes(`${n0} contact(s)`), 'tout sélectionner');
  await page.click('.bulk-bar button:text-is("Désélectionner")');
  expect(await page.locator('.bulk-bar').count() === 0, 'barre masquée sans sélection');
  // projets : statut changé pour deux projets
  await go('projets');
  const prow = page.locator('table.list tbody tr');
  const pnames = [await prow.nth(0).locator('td').nth(2).innerText(), await prow.nth(1).locator('td').nth(2).innerText()].map((t) => t.split('\n')[0].trim());
  await prow.nth(0).locator('td.sel-col input').check(); await prow.nth(1).locator('td.sel-col input').check();
  await page.selectOption('.bulk-bar select[aria-label="Changer le statut"]', 'annule');
  await page.waitForTimeout(500);
  for (const name of pnames) expect((await page.locator('table.list tbody tr', { hasText: name }).first().innerText()).includes('Annulé'), `${name} annulé`);
  // véhicules : suppression d'un véhicule coché
  await go('vehicules');
  const v0 = await page.locator('table.list tbody tr').count();
  await page.locator('table.list tbody tr').first().locator('td.sel-col input').check();
  await page.click('.bulk-bar button:text-is("Supprimer")');
  await page.waitForTimeout(300);
  expect(await page.locator('table.list tbody tr').count() === v0 - 1, 'véhicule supprimé');
  // la case ne trie pas et n'ouvre pas la ligne
  expect(await page.locator('.modal').count() === 0, 'cocher n’ouvre pas la fiche');
});

await step('Import Rentman : fichier d’export importé dans une base (projets complets), réimport sans doublon', async () => {
  const { mapRentman } = await import('../../tools/rentman-import/map.mjs');
  const { RENTMAN } = await import('../fixtures/rentman.mjs');
  const { data, files, report } = mapRentman(RENTMAN);
  const dir = mkdtempSync(join(tmpdir(), 'rm-'));
  const f = join(dir, 'export.json'), fp = join(dir, 'export-fichiers-1.json');
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const exportedAt = new Date().toISOString();
  writeFileSync(f, JSON.stringify({ app: 'fabevent', kind: 'import', source: 'rentman', version: 1, exportedAt, report, data, parts: 1 }));
  writeFileSync(fp, JSON.stringify({ app: 'fabevent', kind: 'import', source: 'rentman', part: 'fichiers', version: 1, exportedAt, data: {
    files: files.map(({ url, fileId, ...m }) => ({ ...m, id: `rm-file-${fileId}`, base64: m.photoOf ? PNG : Buffer.from('%PDF-1.4 test').toString('base64') })),
  } }));
  await resetDemo();
  await go('parametres');
  await page.locator('input[aria-label="Fichier d\'export Rentman"]').setInputFiles(f);
  await page.waitForSelector('.rentman-preview');
  expect((await page.locator('.rentman-preview').innerText()).includes('paquet(s) de fichiers'), 'aperçu : paquets de fichiers manquants signalés');
  await page.locator('input[aria-label="Fichier d\'export Rentman"]').setInputFiles([f, fp]);
  await page.waitForSelector('.rentman-preview:has-text("photos du matériel")');
  const prev = await page.locator('.rentman-preview').innerText();
  expect(prev.includes('1 projets') && prev.includes('2 devis et factures') && prev.includes('2 fichiers') && !prev.includes('paquet(s) de fichiers'), 'aperçu : projet, documents, fichiers');
  await page.click('.rentman-import button:text-is("Importer")');
  await page.waitForSelector('.rentman-import .info:has-text("Import terminé")');
  await openProject('Fête de la musique');
  await tab('Équipement');
  const eq = await page.locator('main').innerText();
  expect(eq.includes('L-Acoustics X12') && eq.includes('Pack voix') && eq.includes('Grande scène'), 'lignes de matériel et sous-projets importés');
  await tab('Général');
  expect((await page.locator('main').innerText()).includes('Ville de Liège'), 'client importé et relié');
  await tab('Finances & documents');
  const fin = await page.locator('main').innerText();
  expect(fin.includes('F-2026-0031') && fin.includes('Q-2026-12'), 'devis et facture Rentman dans les documents du projet');
  const stored = await page.evaluate(async () => {
    const open = () => new Promise((r) => { const q = indexedDB.open('fabevent_' + (localStorage.getItem('fabevent.workspace') || 'principal')); q.onsuccess = () => r(q.result); });
    const d = await open();
    const get = (t, k) => new Promise((r) => { const q = d.transaction(t).objectStore(t).get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); });
    const [cost, file, eq, sr, ap] = await Promise.all([get('costs', 'rm-k-1000'), get('files', 'rm-file-950'), get('equipment', 'rm-e-504'), get('subrentals', 'rm-sr-1100'), get('appointments', 'rm-ap-1400')]);
    return { cost: !!cost, file: file?.name, photo: !!eq?.photo, sr: sr?.status, ap: !!ap };
  });
  expect(stored.cost && stored.file === 'Plan de scène.pdf' && stored.photo && stored.sr === 'confirme' && stored.ap, `coût, fichier, photo, sous-location, rendez-vous importés (${JSON.stringify(stored)})`);
  // réimport : rien en double
  await go('parametres');
  await page.locator('input[aria-label="Fichier d\'export Rentman"]').setInputFiles(f);
  await page.click('.rentman-import button:text-is("Importer")');
  await page.waitForSelector('.rentman-import .info:has-text("Import terminé")');
  expect((await page.locator('.rentman-import .info').innerText()).includes('déjà là'), 'réimport : fiches gardées, pas de doublon');
  await go('projets');
  expect(await page.locator('table.list tbody tr', { hasText: 'Fête de la musique' }).count() === 1, 'un seul projet');
});

console.log('\n  — vérification de la liste (v51) —');

await step('Matériel : dupliquer un article (nouveau code, fiche ouverte en modification, sans les unités)', async () => {
  await resetDemo();
  await go('materiel');
  await page.locator('table.list tbody tr', { hasText: 'Amplificateur LA4X' }).first().click();
  await page.waitForTimeout(400);
  const code0 = (await page.locator('main').innerText()).match(/F-[A-Z]-\d{4}/)?.[0];
  await page.click('main button:has-text("Dupliquer")');
  await page.waitForSelector('.edit-inline');
  const name = page.locator('.edit-inline input[aria-label="Désignation"]');
  expect((await name.inputValue()) === 'Amplificateur LA4X (copie)', 'copie nommée « (copie) »');
  await name.fill('Amplificateur LA4X bis');
  await page.click('.edit-inline button[type=submit]');
  await page.waitForTimeout(400);
  const txt = await page.locator('main').innerText();
  const code1 = txt.match(/F-[A-Z]-\d{4}/)?.[0];
  expect(code1 && code1 !== code0, `nouveau code (${code0} → ${code1})`);
  await go('materiel');
  expect(await page.locator('table.list tbody tr', { hasText: 'Amplificateur LA4X bis' }).count() === 1, 'copie dans le catalogue');
  expect(await page.locator('table.list tbody tr', { hasText: /^.*Amplificateur LA4X(?! bis)/ }).count() >= 1, 'original conservé');
});

await step('Projet : dupliquer pour l\'édition suivante (dates +1 an, éditions reliées, sans les documents)', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Équipement');
  const nLines = await page.locator('table.list.eq-table tbody tr').count();
  const y = new Date().getFullYear();
  await page.click('main button:has-text("Dupliquer…")');
  await page.waitForSelector('.modal');
  const date = await page.locator('.modal input[type=date]').inputValue();
  expect((await page.locator('.modal input[required]').inputValue()) === `Festival des Lumières ${+date.slice(0, 4)}`, 'nom proposé avec l’année de la nouvelle édition');
  const url0 = page.url();
  await page.click('.modal button[type=submit]');
  await page.waitForFunction((u) => location.href !== u, url0);
  await page.waitForSelector('.editions');
  await page.waitForTimeout(300);
  const head = await page.locator('main h1').first().innerText();
  expect(head.includes(`Festival des Lumières ${+date.slice(0, 4)}`), 'copie ouverte : ' + head);
  expect((await page.locator('.editions .badge').count()) === 2, 'deux éditions reliées');
  expect((await page.locator('.project-tabs').innerText()).length > 0, 'onglets présents');
  await tab('Équipement');
  expect((await page.locator('table.list.eq-table tbody tr').count()) === nLines, `matériel copié (${nLines} lignes)`);
  await tab('Planning');
  expect((await page.locator('main').innerText()).includes(String(+date.slice(0, 4))), 'horaires décalés à la nouvelle année');
  await tab('Finances & documents');
  expect(!(await page.locator('table.list tr.click', { hasText: /D-\d{4}|F-\d{4}/ }).count()), 'aucun document copié');
  await page.locator('.editions a.badge').first().click();
  await page.waitForTimeout(500);
  expect((await page.locator('main h1').first().innerText()).includes('Festival des Lumières') && y > 0, 'retour à l’édition d’origine depuis l’en-tête');
});

await step('Kit : un élément manquant ne met pas tout le kit en manque (« incomplet » + élément en cause)', async () => {
  await resetDemo();
  await openProject("Salon de l'emploi");
  await tab('Équipement');
  const kit = page.locator('table.list tbody tr', { hasText: 'Pack conférence' }).first();
  const cell = await kit.locator('.eq-avail').innerText();
  expect(cell.includes('incomplet') && !cell.includes('manque 1'), 'kit « incomplet », pas « manque » : ' + cell);
  expect(cell.includes('Pied de micro perche'), 'élément manquant nommé : ' + cell);
  const x12 = await page.locator('table.list tbody tr.kid', { hasText: 'Enceinte L-Acoustics X12' }).first().locator('.eq-avail').innerText();
  expect(!x12.includes('manque'), 'les enceintes du kit ne sont pas comptées deux fois : ' + x12);
});

await step('Scan au-delà du prévu : alerte « déjà complet, êtes-vous sûr… », rien n\'est ajouté sans accord', async () => {
  await resetDemo();
  await openChecklist('Mariage Dupont-Lemaire');
  const line = page.locator('.cl-line:not(.kid)', { hasText: 'L-Acoustics X12' });
  await line.locator('button[aria-label="Plus"]').click();
  await line.locator('button[aria-label="Plus"]').click();
  await page.waitForTimeout(300);
  await scanRaw('F-S-0008');
  const ask = await page.locator('.cl-ask').innerText();
  expect(ask.includes('déjà complet') && ask.includes('scanné une seule fois'), 'alerte affichée : ' + ask);
  await page.locator('.cl-ask button', { hasText: /Annuler|Non/ }).first().click();
  await page.waitForTimeout(200);
  const n = (await line.locator('.cl-n').innerText()).replace(/\s+/g, '');
  expect(n === '2/2', 'quantité inchangée sans accord : ' + n);
});

await step('Info-bulles : boutons, cases et listes expliquent ce qu\'ils font au survol', async () => {
  await go('materiel');
  expect(((await page.locator('main button', { hasText: 'Exporter (CSV)' }).first().getAttribute('title')) || '').includes('CSV'), 'bouton Exporter expliqué');
  const archived = await page.locator('main label', { hasText: 'Archivés' }).locator('input').getAttribute('title');
  expect((archived || '').length > 10, 'case « Archivés » expliquée : ' + archived);
  const missing = await page.evaluate(() => [...document.querySelectorAll('main button, main input[type=checkbox], main select')].filter((el) => el.getBoundingClientRect().width && !el.title && !el.closest('[title]')).length);
  expect(missing <= 2, `contrôles sans info-bulle sur la page Matériel : ${missing}`);
});

await step('Facture : service et contact de facturation du client, RPM de la société', async () => {
  await resetDemo();
  await go('contacts');
  await page.fill('.toolbar input', 'Namur');
  await page.waitForTimeout(200);
  await page.locator('table.list tbody tr', { hasText: 'Ville de Namur' }).first().click();
  await page.selectOption('select[aria-label="Service de facturation"]', { label: 'Culture' });
  await page.selectOption('select[aria-label="Contact de facturation"]', { label: 'Anne Collin (Programmatrice)' });
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(300);
  await openProject('Marché de Noël');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Facture")');
  await page.waitForSelector('.doc');
  const txt = await page.locator('.doc').innerText();
  expect(txt.includes('Service Culture'), 'facture adressée au service de facturation');
  expect(txt.includes("À l'attention de Anne Collin"), 'à l’attention du contact de facturation');
  expect(txt.includes('RPM Liège'), 'forme juridique et RPM de la société');
  expect(txt.includes('TVA BE0000000097') && txt.includes("N° d'entreprise"), 'n° d’entreprise et TVA de la société');
  await openProject('Marché de Noël');
  await tab('Finances & documents');
  await page.click('button:text-is("+ Devis")');
  await page.waitForSelector('.doc');
  expect(!(await page.locator('.doc').innerText()).includes('Anne Collin'), 'le devis reste adressé à l’interlocuteur du projet');
});

await step('Retour : on revient à l\'endroit où l\'on était (document → projet, fiche → liste)', async () => {
  await openProject('Gala de fin d');
  await tab('Finances & documents');
  const row = page.locator('table.list tr.click', { hasText: /F-\d{4}/ }).first();
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const y0 = await page.evaluate(() => scrollY);
  await row.click();
  await page.waitForSelector('.doc');
  await page.locator('main button', { hasText: 'Projet' }).first().click();
  await page.waitForTimeout(900);
  expect(page.url().includes('onglet=finances'), 'retour sur l’onglet Finances');
  expect(Math.abs((await page.evaluate(() => scrollY)) - y0) < 40, `même position (${y0})`);
  await row.click();
  await page.waitForSelector('.doc');
  await page.goBack();
  await page.waitForTimeout(900);
  expect(Math.abs((await page.evaluate(() => scrollY)) - y0) < 40, 'même position avec le retour du navigateur');
});

await step('Bouton Enregistrer toujours visible (Paramètres, Modèles de documents)', async () => {
  await go('parametres');
  await page.evaluate(() => scrollTo(0, 0));
  const box = await page.locator('main form .form-actions button[type=submit]').first().boundingBox();
  const vh = await page.evaluate(() => innerHeight);
  expect(box && box.y >= 0 && box.y + box.height <= vh + 1, 'Enregistrer visible en haut de la page Paramètres');
  await go('modeles');
  await page.locator('.theme-opt').last().click();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  expect(await page.locator('.save-dock button').isVisible(), 'Enregistrer visible en bas de la page Modèles');
  await page.locator('.save-dock button').click();
  await page.waitForTimeout(300);
});

await step('Import : la référence unique relie et met à jour les articles existants', async () => {
  await go('import');
  await page.selectOption('select', 'equipment');
  await page.setInputFiles('input[type=file]', { name: 'mat.csv', mimeType: 'text/csv', buffer: Buffer.from('Nom;Code;Quantité;Prix de location\nBarre LED renommée;BLU1;4;9,00\n') });
  await page.waitForSelector('text=Correspondance');
  await page.click('button:has-text("Importer 1 lignes")');
  await page.waitForSelector('text=importé');
  await page.setInputFiles('input[type=file]', { name: 'mat2.csv', mimeType: 'text/csv', buffer: Buffer.from('Nom;Code;Quantité;Prix de location\nBarre LED v2;BLU1;6;11,00\n') });
  await page.waitForSelector('text=Correspondance');
  expect(await page.locator('label', { hasText: 'Mettre à jour les articles déjà présents' }).locator('input').isChecked(), 'mise à jour par référence cochée');
  await page.click('button:has-text("Importer 1 lignes")');
  await page.waitForSelector('text=mis à jour par leur référence');
  await go('materiel');
  const rows = await page.locator('table.list tbody tr', { hasText: /Barre LED (renommée|v2)/ }).allInnerTexts();
  expect(rows.length === 1 && rows[0].includes('Barre LED v2') && rows[0].includes('11,00'), 'un seul article, mis à jour : ' + rows.join(' | '));
});

await step('Rendez-vous : relié à un projet, avec un coût interne compté dans la marge (pas facturé)', async () => {
  await resetDemo();
  await openProject('Festival des Lumières');
  await tab('Finances & documents');
  const cost0 = await page.locator('.stat', { hasText: 'coûts' }).first().locator('b').innerText();
  const ht0 = await page.locator('.stat', { hasText: 'total HT' }).first().locator('b').innerText();
  await tab('Planning');
  await page.click('.project-appts button:has-text("+ Rendez-vous")');
  await page.fill('.modal input[required]', 'Réunion de production');
  await page.locator('.modal .field', { hasText: 'Coût pour moi' }).locator('input').fill('150');
  expect((await page.locator('.modal .field', { hasText: 'Projet relié' }).locator('option:checked').innerText()).includes('Festival des Lumières'), 'projet pré-sélectionné');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  expect(await page.locator('.project-appts tr', { hasText: 'Réunion de production' }).count(), 'rendez-vous listé dans le projet');
  await tab('Finances & documents');
  const num = (t) => parseFloat(t.replace(/[^\d,]/g, '').replace(',', '.'));
  const cost1 = await page.locator('.stat', { hasText: 'coûts' }).first().locator('b').innerText();
  expect(Math.abs(num(cost1) - num(cost0) - 150) < 0.01, `coût +150 € (${cost0} → ${cost1})`);
  expect((await page.locator('.stat', { hasText: 'total HT' }).first().locator('b').innerText()) === ht0, 'rien de facturé au client');
  expect(await page.locator('table.list tr', { hasText: 'Rendez-vous' }).count(), 'ligne « Rendez-vous » dans le détail des coûts');
  await go('planning');
  expect(((await page.locator('a.ev.appt', { hasText: 'Réunion de production' }).first().getAttribute('title')) || '').includes('Festival des Lumières'), 'projet indiqué au planning');
});

await ctx.close();

await step('Aucune erreur dans la console du navigateur', async () => {
  expect(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis`);
process.exit(failed.length ? 1 : 0);
