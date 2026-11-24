/**
 * Parcours « en contexte » des nouveautés : une société qui quitte Rentman.
 * Base neuve → import des 4 exports Rentman → catégories → deux projets aux mêmes dates
 * (stock restant, réservations ailleurs, fenêtre avec filtres) → client et lieu par recherche
 * → techniciens (prix horaire seul, forfait seul sur 8 h) et heures prestées → suppression de la base.
 * Lancement : npm run test:parcours
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4800 + Math.floor(Math.random() * 500);
const U = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(U)).ok) break; } catch { /* pas encore prêt */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
/** réponses aux fenêtres prompt/confirm, dans l'ordre ; sinon on accepte la valeur proposée */
const answers = [];
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(answers.length ? answers.shift() : d.defaultValue()) : d.accept()));

const results = [];
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ✓', name);
  } catch (e) {
    results.push({ name, ok: false });
    console.log('  ✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: `tests/e2e/echec-parcours-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
const txt = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ');
/** attend qu'un élément contienne un texte (les listes se remplissent en différé) */
const waitText = async (loc, s, msg) => {
  try { await loc.filter({ hasText: s }).first().waitFor({ timeout: 4000 }); } catch { throw new Error(`${msg} (${await txt(loc.first()).catch(() => 'absent')})`); }
};
const go = async (hash) => { await page.goto(U + '#/' + hash); await page.waitForTimeout(400); };
const inPage = (sel) => page.locator('main > :not(.open-tabs)').locator(sel).first();
const openProject = async (name) => { await go('projets'); await inPage(`text=${name}`).click(); await page.waitForSelector('.project-tabs'); await page.waitForTimeout(300); };
const tab = async (label) => { await page.click(`.project-tabs button:text-is("${label}")`); await page.waitForTimeout(300); };
const crewMode = async (n) => { await page.click(`.crew-modes button:has-text("${n === 1 ? '1. Postes' : '2. Attribution'}")`); await page.waitForTimeout(200); };
async function importCsv(name, csv, expectTarget, opts = {}) {
  await go('import');
  await page.setInputFiles('input[type=file]', { name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForSelector('text=Correspondance');
  const target = await page.locator('.field', { hasText: 'Que veux-tu importer' }).locator('select').inputValue();
  expect(target === expectTarget, `export reconnu comme « ${expectTarget} » (reçu ${target})`);
  if (opts.before) await opts.before();
  await page.click('button:has-text("Importer ")');
  await page.waitForSelector('.avail.ok:has-text("importé")', { timeout: 15000 });
  return txt(page.locator('.avail.ok').first());
}

/* Exports Rentman fictifs (mêmes intitulés de colonnes que les vrais exports) */
const EQUIPEMENT = [
  'Nom (dans la base de données);Code;Chemin;Quantité actuelle;Prix de location/vente;Méthode de calcul des stocks;Afficher nom (numéro de série)',
  ...['SN-001', 'SN-002', 'SN-003', 'SN-004'].map((sn) => `Micro SM58;M001;Ma société/Son/Micro;4;8,00;Sérialisé;${sn}`),
  'Console X32;C001;Ma société/Son/Console;1;150,00;Sérialisé;X32-A',
  'Enceinte K12;E001;Ma société/Son/Diffusion;6;40,00;Quantité;',
  'Projecteur LED;L001;Ma société/Lumière/Projecteurs;8;15,00;Quantité;',
].join('\n');
const CONTACTS = [
  'ID,Nom,Dossier (dossier),Ville (adresse de visite),Code postal (adresse de visite),Afficher nom (personne de contact),E-mail (personne de contact)',
  '11,Festival des Arts,Clients,Namur,5000,Julie Martin,julie@exemple.be',
  '11,Festival des Arts,Clients,Namur,5000,Paul Leroy,paul@exemple.be',
  '12,Salle Polyvalente,Lieux,Ciney,5590,,',
  '13,Salle Polyvalente,Lieux,Dinant,5500,,',
].join('\n');
const PERSONNEL = [
  'Nom complet,Type de contrat,Fonction,Nom (tarif membre du personnel),Taux de rémunération par heure (tarif membre du personnel),Taux de rémunération fixe (tarif membre du personnel)',
  'Alice Dubois,Freelance,Technicien son,Standard,30,',
  'Bruno Lambert,Salarié,Technicien son,Standard,,300',
].join('\n');
const PROJETS = [
  'Numéro,Nom,Client (client),Statut du projet,Début de la période d\'utilisation,Fin de la période d\'utilisation,Prix du projet',
  'R-2026-040,Festival importé,Festival des Arts,Confirmé,05-12-2026 10:00,05-12-2026 23:00,4500',
].join('\n');

console.log('\nFabEvent — parcours des nouveautés en contexte\n');

await step('Nouvelle base « parcours », vide', async () => {
  await go('parametres');
  await page.fill('input[placeholder="Nom de la nouvelle base"]', 'parcours');
  await page.click('text=Créer et ouvrir');
  await page.waitForTimeout(1000);
  expect((await page.locator('.ws').innerText()).includes('parcours'), 'base « parcours » active');
  await go('materiel');
  expect(await page.locator('table.list tbody tr').count() === 0, 'aucun article');
});

await step('Import Rentman Équipement : unités sérialisées regroupées, chemin sans la racine', async () => {
  const msg = await importCsv('Equipement.csv', EQUIPEMENT, 'equipment', {
    before: async () => {
      const skip = page.locator('label.check-row', { hasText: 'Ignorer le premier niveau' });
      expect(await skip.count() === 1, 'option « ignorer le premier niveau » proposée');
      await skip.locator('input').check();
      expect((await txt(skip)).includes('→ Son › Micro'), `aperçu du chemin (${await txt(skip)})`);
    },
  });
  expect(msg.includes('4 article(s) importé(s)'), `4 articles depuis 7 lignes (${msg})`);
  await go('materiel');
  const sm = await txt(page.locator('table.list tbody tr', { hasText: 'Micro SM58' }));
  expect(sm.includes('Son › Micro'), `catégorie Son › Micro (${sm})`);
  expect(/\b4\b/.test(sm), `4 en stock (${sm})`);
  expect(await page.locator('table.list tbody tr', { hasText: 'Ma société' }).count() === 0, 'la racine « Ma société » n’est pas devenue une catégorie');
});

await step('Catégories : arbre créé par l’import, ajout d’une sous-catégorie', async () => {
  await go('materiel');
  await page.click('button:has-text("Catégories")');
  const m = page.locator('.modal');
  await m.locator('input[aria-label="Nom de la catégorie Son"]').waitFor();
  const names = await m.locator('.cat-row:not(.sub) input.cat-name').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  expect(names.includes('Son') && names.includes('Lumière') && !names.includes('Ma société'), `catégories principales (${names})`);
  const son = m.locator('.cat-node', { has: page.locator('input[aria-label="Nom de la catégorie Son"]') });
  const subs = await son.locator('.cat-row.sub input.cat-name').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  expect(['Micro', 'Console', 'Diffusion'].every((s) => subs.includes(s)), `sous-catégories de Son (${subs})`);
  expect((await txt(son.locator('.cat-row').first())).includes('3 article(s)'), 'Son compte aussi ses sous-catégories');
  await son.locator('input[aria-label="Nouvelle sous-catégorie de Son"]').fill('Retours');
  await son.locator('input[aria-label="Nouvelle sous-catégorie de Son"]').press('Enter');
  await page.waitForTimeout(300);
  expect(await son.locator('input[aria-label="Nom de la sous-catégorie Retours"]').count() === 1, 'sous-catégorie ajoutée');
  await page.keyboard.press('Escape');
});

await step('Import Rentman Contacts : personnes regroupées, deux lieux homonymes gardés', async () => {
  const msg = await importCsv('Contact.csv', CONTACTS, 'contacts');
  expect(msg.includes('3'), `3 contacts (${msg})`);
  await go('contacts');
  expect(await page.locator('table.list tbody tr', { hasText: 'Salle Polyvalente' }).count() === 2, 'les deux « Salle Polyvalente » (ID Rentman différents)');
  const fest = await txt(page.locator('table.list tbody tr', { hasText: 'Festival des Arts' }));
  expect(fest.includes('Namur'), `ville du client (${fest})`);
});

await step('Import Rentman Membres du personnel : prix horaire seul, forfait seul', async () => {
  const msg = await importCsv('Personnel.csv', PERSONNEL, 'people');
  expect(msg.includes('2'), `2 techniciens (${msg})`);
});

await step('Technicien au forfait sur 8 h : heure sup. = forfait ÷ 8', async () => {
  await go('equipe');
  await page.locator('table.list tbody tr', { hasText: 'Bruno Lambert' }).locator('td a strong').first().click();
  const m = page.locator('.modal');
  await m.locator('input[aria-label="Heures du forfait journalier"]').fill('8');
  const help = await txt(m.locator('.cost-help'));
  expect(help.includes('8 h') && help.includes('37,50'), `explication du calcul (${help})`);
  await m.locator('button[type=submit]').click();
  await page.waitForTimeout(300);
  expect((await txt(page.locator('table.list tbody tr', { hasText: 'Bruno Lambert' }))).includes('forfait 8 h'), 'forfait 8 h dans la liste');
});

await step('Import Rentman Projets : statut, client relié, dates', async () => {
  const msg = await importCsv('Projet.csv', PROJETS, 'projects');
  expect(msg.includes('1 projet(s) importé(s)') && !msg.includes('sans dates'), msg);
  await go('projets');
  const row = await txt(page.locator('table.list tbody tr', { hasText: 'Festival importé' }));
  expect(row.includes('Festival des Arts') && row.includes('Confirmé'), `projet importé (${row})`);
});

await step('Nouveau projet : client choisi en tapant quelques lettres', async () => {
  await go('projets');
  await page.click('text=+ Nouveau projet');
  const m = page.locator('.modal');
  await m.locator('input').first().fill('Concert d’hiver');
  await m.locator('input[aria-label="Rechercher un client"]').fill('arts nam');
  const items = m.locator('.quick-add-list li[role=option]');
  expect(await items.count() === 1 && (await txt(items.first())).includes('Festival des Arts'), 'recherche sur le nom et la ville');
  await items.first().click();
  await m.locator('.field', { hasText: 'Statut' }).locator('select').selectOption('confirme');
  await m.locator('.field', { hasText: 'Début' }).locator('input').fill('2026-12-05T08:00');
  await m.locator('.field', { hasText: 'Fin' }).locator('input').fill('2026-12-05T20:00');
  await m.locator('button[type=submit]').click();
  await page.waitForSelector('.project-tabs');
});

await step('Lieu : deux homonymes départagés par la ville, puis fenêtre avec filtres', async () => {
  const f = page.locator('input[aria-label="Rechercher un lieu"]');
  await f.fill('polyv');
  const items = page.locator('.contact-field .quick-add-list li[role=option]');
  expect(await items.count() === 2, 'deux lieux proposés');
  const all = await items.allInnerTexts();
  expect(all.some((t) => t.includes('Ciney')) && all.some((t) => t.includes('Dinant')), `villes affichées (${all})`);
  await page.locator('.contact-field .qa-browse').click();
  const m = page.locator('.modal', { hasText: 'Choisir un lieu' });
  expect(await m.locator('input[aria-label="Rechercher dans les lieus"]').inputValue() === 'polyv', 'recherche reprise dans la fenêtre');
  await m.locator('.chip', { hasText: 'Ciney' }).click();
  expect(await m.locator('.pick-row').count() === 1, 'filtre par ville');
  await m.locator('.pick-row').first().click();
  await page.waitForTimeout(300);
  expect(await f.inputValue() === 'Salle Polyvalente', 'lieu choisi');
});

await step('Matériel : fenêtre avec catégories, « reste » après l’ajout', async () => {
  await tab('Équipement');
  await page.locator('button:has-text("+ Matériel")').first().click();
  const m = page.locator('.modal');
  await m.locator('.chip', { hasText: /^Son/ }).click();
  const subs = await m.locator('.sub-chips .chip').allInnerTexts();
  expect(subs.some((s) => s.startsWith('Micro')) && subs.some((s) => s.startsWith('Diffusion')), `sous-catégories proposées (${subs})`);
  expect(await m.locator('.pick-row', { hasText: 'Projecteur LED' }).count() === 0, 'Lumière masquée sous « Son »');
  await m.locator('.sub-chips .chip', { hasText: 'Micro' }).click();
  const row = m.locator('.pick-row', { hasText: 'Micro SM58' });
  expect((await txt(row.locator('.pick-stock'))).includes('4 dispo'), '4 dispo avant ajout');
  await row.locator('input').first().fill('3');
  expect((await txt(row.locator('.pick-stock'))).includes('reste 1'), `reste 1 après 3 (${await txt(row.locator('.pick-stock'))})`);
  await m.locator('button:has-text("Ajouter (")').click();
  await page.waitForTimeout(400);
  const line = page.locator('tr:not(.kit-child)', { hasText: 'Micro SM58' }).first();
  expect((await txt(line)).includes('1'), 'colonne Reste');
  expect(await line.locator('.use-chips').count() === 0, 'pas encore réservé ailleurs');
});

await step('Saisie rapide : « Filtres… » ouvre la fenêtre avec le texte tapé', async () => {
  await page.fill('input[aria-label="Ajouter un article"]', 'k12');
  await page.click('button:text-is("Filtres…")');
  const m = page.locator('.modal');
  expect(await m.locator('input[aria-label="Rechercher du matériel"], .picker-filters input').first().inputValue() === 'k12', 'texte repris');
  expect(await m.locator('.pick-row').count() === 1, 'une seule correspondance');
  await m.locator('.pick-row', { hasText: 'Enceinte K12' }).locator('input').first().fill('2');
  await m.locator('button:has-text("Ajouter (")').click();
  await page.waitForTimeout(400);
  expect(await page.locator('tr', { hasText: 'Enceinte K12' }).count() >= 1, 'enceintes ajoutées');
});

await step('Deuxième projet aux mêmes dates : stock restant, réservé ailleurs, manque', async () => {
  await openProject('Festival importé');
  await tab('Équipement');
  await page.locator('button:has-text("+ Matériel")').first().click();
  const m = page.locator('.modal');
  await m.locator('.picker-filters input').first().fill('sm58');
  const row = m.locator('.pick-row', { hasText: 'Micro SM58' });
  expect((await txt(row.locator('.pick-stock'))).includes('1 dispo'), `1 dispo (${await txt(row.locator('.pick-stock'))})`);
  const uses = row.locator('.use-chips');
  expect((await txt(uses)).includes('3 réservé ailleurs'), `3 réservé ailleurs (${await txt(uses)})`);
  await uses.click();
  await waitText(m.locator('.pick-uses'), 'Concert d’hiver', 'projet qui les utilise');
  await row.locator('input').first().fill('2');
  expect((await txt(row.locator('.pick-stock'))).includes('manque 1'), 'manque 1');
  await m.locator('button:has-text("Ajouter (")').click();
  await page.waitForTimeout(400);
  const line = page.locator('tr:not(.kit-child)', { hasText: 'Micro SM58' }).first();
  expect((await txt(line)).includes('manque 1'), `ligne en manque (${await txt(line)})`);
  await line.locator('.use-chips').click();

  await waitText(pop, 'Concert d’hiver', 'fenêtre des réservations ailleurs');
  await pop.locator('a', { hasText: 'Concert d’hiver' }).click();
  await page.waitForTimeout(500);
  expect((await page.locator('h1').first().innerText()).includes('Concert d’hiver'), 'lien vers l’autre projet');
});

await step('Équipe : postes de 12 h, coûts selon prix horaire seul / forfait seul, heures prestées', async () => {
  await openProject('Concert d’hiver');
  await tab('Équipe & transport');
  await crewMode(1);
  const sub = page.locator('.sub').first();
  await sub.locator('input[aria-label="Nombre de postes"]').fill('2');
  await sub.locator('input[aria-label="Fonction à ajouter"]').fill('Technicien son');
  await sub.locator('.add-posts button[type=submit]').click();
  await page.waitForTimeout(400);
  expect(await sub.locator('table.crew-posts tbody tr').count() === 2, '2 postes');
  expect((await txt(sub.locator('table.crew-posts tbody tr').first().locator('.hours-cell'))).startsWith('12 h'), 'colonne Heures : 12 h');
  await crewMode(2);
  const rows = sub.locator('table.crew-assign tbody tr');
  const pick = async (i, who, shown) => {
    const opt = rows.nth(i).locator('select[aria-label="Technicien"] option', { hasText: who });
    const label = (await opt.innerText()).replace(/\s+/g, ' ');
    expect(label.includes(shown), `${who} proposé à ${shown} (${label})`);
    await rows.nth(i).locator('select[aria-label="Technicien"]').selectOption(await opt.getAttribute('value'));
    await page.waitForTimeout(400);
  };
  await pick(0, 'Alice', '30,00 €/h');
  await pick(1, 'Bruno', '300,00 €/j');
  const r0 = await txt(rows.nth(0)); const r1 = await txt(rows.nth(1));
  // Alice : 10 h × 30 + 2 h × 30 × 1,5 = 390 ; Bruno : 300 + 4 h × 37,50 × 1,5 = 525
  expect(r0.includes('12 h dont 2 h sup.') && r0.includes('coût 390,00'), `Alice (${r0})`);
  expect(r1.includes('12 h dont 4 h sup.') && r1.includes('coût 525,00'), `Bruno (${r1})`);
  expect((await txt(rows.nth(0).locator('.cost-unit'))) === '/h' && (await txt(rows.nth(1).locator('.cost-unit'))) === '/j', 'unité du coût');
  const total = await txt(sub.locator('.crew-total'));
  expect(total.includes('24 h') && total.includes('2 postes') && total.includes('6 h sup.'), `total du sous-projet (${total})`);
  const stat = await txt(page.locator('.stat', { hasText: 'heures prestées' }));
  expect(stat.includes('24 h'), `stat heures prestées (${stat})`);
  const alice = await txt(page.locator('.crew-hours').filter({ hasText: '2 h sup.' }).first());
  expect(alice.includes('12 h') && alice.includes('1 poste'), `heures par technicien (${alice})`);
});

await step('Coût saisi à la main : garde son unité, puis retour au coût de la personne', async () => {
  const row = page.locator('.sub').first().locator('table.crew-assign tbody tr').nth(0);
  await row.locator('input[aria-label="Coût"]').fill('35');
  await page.waitForTimeout(400);
  // 10 h × 35 + 2 h × 35 × 1,5 = 455
  expect((await txt(row)).includes('coût 455,00') && (await txt(row.locator('.cost-unit'))) === '/h', `coût manuel à l’heure (${await txt(row)})`);
  await row.locator('button[title^="Revenir au coût"]').click();
  await page.waitForTimeout(400);
  expect((await txt(row)).includes('coût 390,00'), 'revenu au coût d’Alice');
});

await step('Suppression de la base « parcours »', async () => {
  await go('parametres');
  const card = page.locator('.card', { hasText: 'Bases de données' });
  answers.push('parcours');
  await card.locator('[aria-label="Supprimer la base parcours"]').click();
  await page.waitForTimeout(1200);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(!dbs.includes('fabevent_parcours'), 'base IndexedDB effacée');
  await go('parametres');
  expect((await page.locator('.ws').innerText()).includes('principal'), 'retour sur la base principale');
  expect(await page.locator('.card', { hasText: 'Bases de données' }).locator('button:text-is("parcours")').count() === 0, 'retirée de la liste');
});

await step('Aucune erreur dans la console du navigateur', async () => {
  expect(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} étapes réussies`);
process.exit(failed.length ? 1 : 0);
