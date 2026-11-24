/*
 * Audit de l'affichage de chaque page, sur téléphone (390 × 844, iPhone) et sur ordinateur (1400 × 950) :
 * chaque page du menu, chaque onglet de projet et quelques fiches.
 * Signale partout : la page qui défile de côté, les éléments qui sortent de l'écran (hors tableaux défilants).
 * Sur mobile seulement : les boutons / champs trop petits pour le doigt (< 32 px de haut) et les champs trop étroits (< 44 px).
 * Usage : npm run build && node tests/e2e/mobile-audit.mjs [--strict]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 5300 + Math.floor(Math.random() * 400);
const U = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();

const routes = ['', 'projets', 'planning', 'materiel', 'entrepot', 'penuries', 'souslocations', 'transferts', 'maintenance', 'contacts', 'lieux', 'equipe',
  'attribution', 'vehicules', 'comptabilite', 'rapports', 'import', 'modeles', 'modeles?onglet=mails', 'parametres', 'etiquettes', 'inventaire', 'checklists'];
const projectTabs = ['Général', 'Planning', 'Équipement', 'Équipe & transport', 'Sous-locations & commandes', 'Coûts supplémentaires', 'Finances & documents', 'Registre'];

const viewports = [
  { name: 'mobile 390 px', ctx: { ...devices['iPhone 13'] }, tactile: true },
  { name: 'ordinateur 1400 px', ctx: { viewport: { width: 1400, height: 950 } }, tactile: false },
];

let totalProblems = 0, totalPages = 0;
for (const v of viewports) {
  const ctx = await browser.newContext(v.ctx);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(U);
  await page.click('text=Essayer avec des données de démo');
  await page.waitForSelector('.demo-badge', { timeout: 20000 });
  await page.waitForTimeout(800);

  const audit = (modals = false) => page.evaluate(({ tactile, modals }) => {
    const W = window.innerWidth;
    const out = { pageOverflow: document.documentElement.scrollWidth - W, beyond: [], small: [], narrow: [] };
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    /** dans un conteneur qui défile horizontalement (tableau large) : normal */
    const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
    const label = (el) => {
      const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.name || el.type || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''} « ${t} »`;
    };
    for (const el of document.querySelectorAll('main *')) {
      if (!vis(el) || (!modals && el.closest('.modal-bg, .fv-bg'))) continue;
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 && !inScroller(el) && !['svg', 'path', 'circle', 'option'].includes(el.tagName.toLowerCase())) {
        // on ne garde que l'élément le plus haut qui dépasse
        if (!el.parentElement || el.parentElement.getBoundingClientRect().right <= W + 1) out.beyond.push(`${label(el)} → ${Math.round(r.right - W)} px`);
      }
      if (!tactile) continue;
      const tag = el.tagName.toLowerCase();
      const interactive = tag === 'button' || tag === 'select' || (tag === 'input' && !['checkbox', 'radio', 'hidden', 'file'].includes(el.type)) || tag === 'textarea';
      if (interactive && !inScroller(el)) {
        if (r.height < 32) out.small.push(`${label(el)} (${Math.round(r.width)}×${Math.round(r.height)})`);
        if ((tag === 'input' || tag === 'select') && r.width < 44) out.narrow.push(`${label(el)} (${Math.round(r.width)} px)`);
      }
    }
    return out;
  }, { tactile: v.tactile, modals });

  const report = [];
  const check = async (name, modals = false) => {
    await page.waitForTimeout(500);
    const a = await audit(modals);
    if (a.pageOverflow > 1 || a.beyond.length || a.small.length || a.narrow.length) report.push({ name, ...a });
  };
  for (const r of routes) { await page.goto(U + '#/' + r); await page.waitForTimeout(700); await check('/' + r); }
  // pages détaillées
  await page.goto(U + '#/projets'); await page.waitForTimeout(600);
  await page.click('text=Festival des Lumières'); await page.waitForSelector('.project-tabs');
  for (const t of projectTabs) {
    const b = page.locator(`.project-tabs button:text-is("${t}")`);
    if (!(await b.count())) continue;
    await b.click(); await check('projet › ' + t);
  }
  await page.goto(U + '#/materiel'); await page.waitForTimeout(600);
  await page.locator('table.list tr:not(.kit-child)', { hasText: 'Amplificateur LA4X' }).first().click(); await check('fiche matériel');
  await page.goto(U + '#/entrepot'); await page.waitForTimeout(600);
  await page.locator('table.list tr.click').first().click(); await page.waitForSelector('.checklist-scan'); await check('checklist');
  await page.goto(U + '#/lieux'); await page.waitForTimeout(600);
  await page.locator('table.list tr.click, table.list tr a').first().click().catch(() => {}); await check('fiche lieu');
  // modales principales : ouvertes, donc auditées aussi
  const openModal = async (route, sel, name) => {
    await page.goto(U + '#/' + route); await page.waitForTimeout(600);
    const b = page.locator(`main ${sel}`).first();
    if (!(await b.count())) return;
    await b.click(); await page.waitForTimeout(500);
    await check(name, true);
    await page.locator('.modal-bg button[aria-label="Fermer"]').first().click().catch(() => {});
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  };
  await openModal('projets', 'button:has-text("+ Nouveau projet")', 'modale nouveau projet');
  await openModal('materiel', 'button:has-text("+ Nouvel article")', 'modale nouvel article');
  await openModal('contacts', 'button:has-text("+ Nouveau contact")', 'modale nouveau contact');
  await openModal('equipe', 'button:has-text("+ Nouvelle personne")', 'modale nouvelle personne');
  // modale sous-projet (horaires) depuis le planning du projet
  await page.goto(U + '#/projets'); await page.waitForTimeout(600);
  await page.click('text=Festival des Lumières'); await page.waitForSelector('.project-tabs');
  await page.locator('.project-tabs button:text-is("Planning")').click(); await page.waitForTimeout(400);
  await page.locator('main button:has-text("+ Ajouter un sous-projet")').first().click(); await page.waitForTimeout(500);
  await check('modale sous-projet (horaires)', true);
  await page.locator('.modal-bg button[aria-label="Fermer"]').first().click().catch(() => {});

  console.log(`\n== ${v.name} ==`);
  for (const r of report) {
    console.log(`\n### ${r.name}${r.pageOverflow > 1 ? ` — LA PAGE DÉFILE DE CÔTÉ (+${r.pageOverflow} px)` : ''}`);
    for (const x of r.beyond.slice(0, 12)) console.log('  dépasse : ' + x);
    for (const x of r.small.slice(0, 12)) console.log('  trop petit : ' + x);
    for (const x of r.narrow.slice(0, 8)) console.log('  trop étroit : ' + x);
  }
  const n = routes.length + projectTabs.length + 3 + 5;
  console.log(`${report.length} page(s) avec des problèmes sur ${n} — ${v.name}`);
  totalProblems += report.length; totalPages += n;
  await ctx.close();
}
console.log(`\nTotal : ${totalProblems} page(s) avec des problèmes sur ${totalPages} pages auditées (mobile + ordinateur)`);
await browser.close(); server.kill();
process.exit(process.argv.includes('--strict') && totalProblems ? 1 : 0);
