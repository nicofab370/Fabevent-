/**
 * Parcours complet de FabEvent dans un vrai navigateur (Playwright).
 * Lancement : npm run test:e2e  (construit l'application, la sert, puis déroule les scénarios).
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4300 + Math.floor(Math.random() * 500);
const U = `http://localhost:${PORT}/`;
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
    p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept()));
  });
  page = await ctx.newPage();
  return ctx;
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function step(name, fn) {
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
const openProject = async (name) => { await go('projets'); await inPage(`text=${name}`).click(); await page.waitForSelector('.project-tabs'); await page.waitForTimeout(300); };
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
  await page.click('.modal button:has-text("Enregistrer et imprimer l\'étiquette")');
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
  expect((await page.locator('table.list tr', { hasText: 'Pied de micro perche' }).innerText()).includes('18'), 'stock mis à 18');
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
  // article en vrac : « combien ? » (le reste par défaut), Entrée valide
  await page.press('.cl-askq', 'Enter');
  await page.waitForTimeout(300);
  expect((await page.locator('.flash').innerText()).startsWith('Sortie'), 'sortie enregistrée au scan');
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
  expect(readFileSync(await dl.path(), 'utf8').includes('Désignation;Référence'), 'export CSV du matériel');
  const price = async (name) => (await page.locator('table.list tr', { hasText: name }).locator('td').last().innerText()).trim();
  const before = await price('Micro Shure SM58');
  await page.locator('table.list tr', { hasText: 'Micro Shure SM58' }).locator('input[type=checkbox]').check();
  await page.locator('table.list tr', { hasText: 'Boîte de direct DI passive' }).locator('input[type=checkbox]').check();
  await page.click('text=Modifier en groupe…');
  await page.locator('.modal .field', { hasText: 'Variation des prix' }).locator('input').fill('20');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(1200);
  expect(before.startsWith('5,00') && (await price('Micro Shure SM58')).startsWith('6,00'), `prix 5 € → 6 € (+20 %) (${before} → ${await price('Micro Shure SM58')})`);
});
await step('Modification groupée : infos communes pré-remplies, seules les infos modifiées sont appliquées', async () => {
  await go('materiel');
  const row = (n) => page.locator('table.list tr', { hasText: n });
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
  const r = page.locator('tr', { hasText: 'Personnel' }).first();
  await r.locator('input').fill('2000');
  await r.locator('input').blur();
  await page.waitForTimeout(400);
  const num = (t) => parseFloat(t.replace(/[\s\u202f\u00a0€]/g, '').replace(',', '.'));
  const cells = async (label) => (await page.locator('tr', { hasText: label }).first().locator('td').allInnerTexts());
  const sub = await cells('Sous-total');
  const totalRow = await cells('Total HT');
  const actualCost = num(sub[5]);
  expect(actualCost >= 2000, `coût réel cumulé (${sub[5]})`);
  expect(Math.abs(num(totalRow[1]) - actualCost - num(totalRow[5].split('(')[0])) < 0.02, `marge réelle = total − coût réel (${totalRow[5]})`);
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
  expect((await page.locator('table.list tr', { hasText: 'Marché de Noël' }).count()) === 0, 'option masquée');
  await openProject('Marché de Noël');
  await tab('Planning');
  await page.locator('label', { hasText: 'Prête pour la préparation' }).first().locator('input').click();
  await page.waitForTimeout(300);
  await go('entrepot');
  expect((await page.locator('table.list tr', { hasText: 'Marché de Noël' }).count()) === 1, 'visible une fois prête');
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
  expect((await scan('SN-LA4X-1001')).includes('Sortie : Amplificateur LA4X n° LA4X-1001'), 'unité sortie');
  expect((await scan('SN-LA4X-1001')).includes('déjà sorti'), 'doublon refusé');
  await scanRaw('DEMO-SM58');
  expect((await page.locator('.cl-ask').innerText()).includes('pas prévu'), 'article hors liste signalé');
  await page.fill('.cl-askq', '2');
  await page.locator('.cl-ask button:has-text("Ajouter en plus")').click();
  await page.waitForTimeout(400);
  expect((await page.locator('.checklist-scan .flash').innerText()).includes('ajouté en plus (2)'), 'ajouté en plus et déjà sorti');
  expect((await page.locator('.cl-line', { hasText: 'Micro Shure SM58' }).getAttribute('class')).includes('done'), 'ligne en plus cochée');
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
  expect(bilan.includes('L-Acoustics X12') && bilan.includes('ULXD-1002') && bilan.includes('QU16-1001'), `manquants listés : ${bilan.slice(0, 200)}`);
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

/* ---------- Synchronisation : deux appareils, le vrai serveur PHP ---------- */
const hasPhp = spawnSync('php', ['-v']).status === 0;
if (hasPhp) {
  console.log('\n  — synchronisation entre appareils (serveur PHP) —');
  const root = mkdtempSync(join(tmpdir(), 'fabweb-'));
  cpSync('dist', root, { recursive: true });
  mkdirSync(join(root, 'api'));
  cpSync('server/sync.php', join(root, 'api/sync.php'));
  cpSync('server/mail.php', join(root, 'api/mail.php'));
  cpSync('server/public.php', join(root, 'api/public.php'));
  const OUTBOX = mkdtempSync(join(tmpdir(), 'fabmail-'));
  const SPORT = PORT + 700;
  const php = spawn('php', ['-S', `127.0.0.1:${SPORT}`, '-t', root], {
    env: { ...process.env, FABEVENT_AUTH: resolve('tests/server/auth-stub.php'), FABEVENT_DATA: mkdtempSync(join(tmpdir(), 'fabdata-')), FABEVENT_MAIL_OUTBOX: OUTBOX }, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));
  const SU = `http://127.0.0.1:${SPORT}/`;
  const device = async (user) => {
    const c = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await c.addCookies([{ name: 'testuser', value: user, url: SU }]);
    await c.addInitScript(() => { try { if (!localStorage.getItem('fab.sync.url')) localStorage.setItem('fab.sync.url', 'api/sync.php'); } catch {} });
    const p = await c.newPage();
    p.on('pageerror', (e) => consoleErrors.push(e.message));
    p.on('dialog', (d) => d.accept());
    return { c, p };
  };
  const syncOn = async (p) => { await p.goto(SU + '#/parametres'); await p.click('button:text-is("Synchroniser maintenant")'); await p.waitForTimeout(1500); };
  const A = await device('nico');
  const B = await device('collegue');
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
await ctx.close();

await step('Aucune erreur dans la console du navigateur', async () => {
  expect(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis`);
process.exit(failed.length ? 1 : 0);
