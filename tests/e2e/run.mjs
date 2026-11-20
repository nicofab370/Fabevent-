/**
 * Parcours complet de FabEvent dans un vrai navigateur (Playwright).
 * Lancement : npm run test:e2e  (construit l'application, la sert, puis déroule les scénarios).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const openProject = async (name) => { await go('projets'); await page.click(`text=${name}`); await page.waitForSelector('.project-tabs'); await page.waitForTimeout(300); };
const tab = async (label) => { await page.click(`.project-tabs button:text-is("${label}")`); await page.waitForTimeout(300); };
const field = (label) => page.locator('.field', { hasText: label });
async function openDemo() {
  await go('');
  await page.click('text=Essayer avec des données de démo');
  await page.waitForSelector('.demo-badge', { timeout: 20000 });
  await page.waitForTimeout(800);
}
async function resetDemo() {
  await go('parametres');
  await page.click('text=Réinitialiser les données de démo');
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
  await page.locator('.modal select').first().selectOption({ label: 'Client Test' });
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
  await page.locator('.modal tr', { hasText: 'Enceinte Test' }).locator('input').fill('4');
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
  const before = await page.locator('.alert').innerText();
  const m = before.match(/X12 \(−(\d+)\)/);
  expect(m, 'manque d’enceintes X12 attendu');
  await tab('Sous-locations & commandes');
  await page.locator('table.list tr', { hasText: 'Grande scène' }).locator('button:has-text("Transférer depuis Dépôt Namur")').click();
  await page.waitForSelector('.modal');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(400);
  await openProject('Festival des Lumières');
  const after = (await page.locator('.alert').innerText()).match(/X12 \(−(\d+)\)/);
  expect(after && Number(after[1]) < Number(m[1]), `le manque doit diminuer (${m[1]} → ${after?.[1]})`);
});

await step('Sous-location : confirmée, elle comble le manque', async () => {
  await tab('Sous-locations & commandes');
  await page.locator('button:has-text("Sous-louer le manque")').first().click();
  await page.waitForSelector('text=Bon de commande');
  await field('Statut').locator('select').selectOption('confirme');
  await page.waitForTimeout(300);
  await openProject('Festival des Lumières');
  const alert = await page.locator('.alert').innerText().catch(() => '');
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
  expect((await page.locator('.doc .totals').innerText()).includes('autoliquidation'), 'TVA 0 % autoliquidation');
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
  const ta = page.locator('textarea.code');
  await ta.click();
  await page.keyboard.press('Control+Home');
  await ta.type('<div class="test-var">Pour ');
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
  const row = page.locator('table.list tbody tr', { has: page.locator('input[value="Rigger"]') }).first();
  const select = row.locator('select').nth(1);
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

await step('Inventaire : scan inconnu refusé, écart appliqué au stock', async () => {
  await go('inventaire');
  await page.fill('.scan-input', 'CODE-INCONNU');
  await page.press('.scan-input', 'Enter');
  expect((await page.locator('.flash').innerText()).includes('inconnu'), 'code inconnu signalé');
  const row = page.locator('table.list tr', { hasText: 'Pied de micro perche' });
  await row.locator('input').fill('18');
  await page.click('button:has-text("Appliquer 1 écart")');
  await page.waitForSelector('text=Inventaire appliqué');
  await go('materiel');
  expect((await page.locator('table.list tr', { hasText: 'Pied de micro perche' }).innerText()).includes('18'), 'stock mis à 18');
});

await step('Entrepôt : sortie de tout le matériel d’une ligne', async () => {
  await go('entrepot');
  await page.locator('table.list tr.click').first().click();
  await page.waitForSelector('.scan-input');
  const before = await page.locator('.card p.muted').first().innerText();
  await page.locator('button:text-is("Tout")').first().click();
  await page.waitForTimeout(300);
  expect((await page.locator('.card p.muted').first().innerText()) !== before, 'progression mise à jour');
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

await step('Aucune erreur dans la console du navigateur', async () => {
  expect(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis`);
process.exit(failed.length ? 1 : 0);
