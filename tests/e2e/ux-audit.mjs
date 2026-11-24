/*
 * Audit UX « comme un utilisateur » avant production :
 * - chaque page du menu, onglets de projet, fiches, modales, écran de connexion, vue document, recherche globale
 * - sur mobile 390 px (tactile) et ordinateur 1400 px
 * - signale : page qui défile de côté, éléments hors écran, texte tronqué dans un champ/bouton (scrollWidth > clientWidth),
 *   police < 11 px, et sur mobile les cibles tactiles < 40 px (échec < 32 px)
 * - sauvegarde une capture d'écran par page dans tests/e2e/ux-shots/
 * Usage : npm run build && node tests/e2e/ux-audit.mjs [--strict]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 5700 + Math.floor(Math.random() * 300);
const U = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(U)).ok) break; } catch { /* pas prêt */ } await new Promise((r) => setTimeout(r, 250)); }
mkdirSync('tests/e2e/ux-shots', { recursive: true });
const browser = await chromium.launch();

const routes = ['', 'projets', 'planning', 'materiel', 'entrepot', 'penuries', 'souslocations', 'transferts', 'maintenance', 'contacts', 'lieux', 'equipe',
  'attribution', 'vehicules', 'comptabilite', 'rapports', 'import', 'modeles', 'modeles?onglet=mails', 'parametres', 'etiquettes', 'inventaire', 'checklists'];
const projectTabs = ['Général', 'Planning', 'Équipement', 'Équipe & transport', 'Sous-locations & commandes', 'Coûts supplémentaires', 'Finances & documents', 'Registre'];

const viewports = [
  { name: 'mobile', ctx: { ...devices['iPhone 13'] }, tactile: true },
  { name: 'desktop', ctx: { viewport: { width: 1400, height: 950 } }, tactile: false },
];

let totalProblems = 0, totalPages = 0;
for (const v of viewports) {
  const ctx = await browser.newContext(v.ctx);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGEERROR', v.name, e.message.slice(0, 120)));
  await page.goto(U);
  await page.click('text=Essayer avec des données de démo');
  await page.waitForSelector('.demo-badge', { timeout: 20000 });
  await page.waitForTimeout(800);

  const audit = (modals = false) => page.evaluate(({ tactile, modals }) => {
    const W = window.innerWidth;
    const out = { pageOverflow: document.documentElement.scrollWidth - W, beyond: [], clipped: [], tiny: [], touch: [], fail: [] };
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
    const label = (el) => {
      const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.title || el.name || el.type || '').trim().replace(/\s+/g, ' ').slice(0, 44);
      return `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''} « ${t} »`;
    };
    const roots = modals ? ['main', '.modal-bg', '.gs', '.login-bg'] : ['main'];
    for (const root of roots) {
      const rootEl = document.querySelector(root);
      if (!rootEl) continue;
      for (const el of rootEl.querySelectorAll('*')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        if (r.right > W + 1 && !inScroller(el) && !['svg', 'path', 'circle', 'option', 'br'].includes(tag)) {
          if (!el.parentElement || el.parentElement.getBoundingClientRect().right <= W + 1) out.beyond.push(`${label(el)} → +${Math.round(r.right - W)} px`);
        }
        const s = getComputedStyle(el);
        // texte tronqué : champ avec une valeur qui dépasse, ou bouton/étiquette en overflow hidden
        if ((tag === 'input' || tag === 'textarea') && el.value && el.scrollWidth > el.clientWidth + 2 && !inScroller(el)) {
          out.clipped.push(`${label(el)} valeur tronquée (${el.scrollWidth - el.clientWidth} px perdus)`);
        }
        if ((tag === 'button' || tag === 'a' || tag === 'span' || tag === 'td' || tag === 'th') && el.childNodes.length && s.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 2 && !inScroller(el)) {
          const txt = (el.textContent || '').trim().slice(0, 30);
          if (txt) out.clipped.push(`${label(el)} tronqué « ${txt}… »`);
        }
        // police trop petite (hors aperçu d'étiquette .lab, rendu à l'échelle d'impression)
        if (tag !== 'svg' && !el.closest('.lab') && !el.closest('.doc') && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(s.fontSize) < 11) {
          out.tiny.push(`${label(el)} font ${s.fontSize} px`);
        }
        // cibles tactiles (mobile) — les puces du calendrier (.ev) sont denses : seuil 24 px
        if (tactile) {
          const interactive = tag === 'button' || tag === 'select' || tag === 'a' || (tag === 'input' && !['checkbox', 'radio', 'hidden', 'file'].includes(el.type)) || tag === 'textarea' || tag === 'label';
          if (interactive && !inScroller(el)) {
            const isEv = el.classList.contains('ev');
            if (r.height < (isEv ? 24 : 32)) out.fail.push(`${label(el)} (${Math.round(r.width)}×${Math.round(r.height)}) < ${isEv ? 24 : 32} px`);
            else if (!isEv && r.height < 40) out.touch.push(`${label(el)} (${Math.round(r.width)}×${Math.round(r.height)})`);
            if ((tag === 'input' || tag === 'select') && r.width < 44) out.fail.push(`${label(el)} ${Math.round(r.width)} px de large < 44 px`);
          }
        }
      }
    }
    return out;
  }, { tactile: v.tactile, modals });

  const report = [];
  let shotIdx = 0;
  const check = async (name, modals = false, shot = true) => {
    await page.waitForTimeout(500);
    const a = await audit(modals);
    const hard = a.pageOverflow > 1 || a.beyond.length || a.tiny.length || a.fail.length;
    const problems = hard || a.clipped.length || a.touch.length;
    if (problems) report.push({ name, hard, ...a });
    if (shot) await page.screenshot({ path: `tests/e2e/ux-shots/${v.name}-${String(shotIdx++).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png` });
    return problems;
  };
  for (const r of routes) { await page.goto(U + '#/' + r); await page.waitForTimeout(700); await check('/' + r); }
  // projet + tous les onglets
  await page.goto(U + '#/projets'); await page.waitForTimeout(600);
  await page.click('text=Festival des Lumières'); await page.waitForSelector('.project-tabs');
  for (const t of projectTabs) {
    const b = page.locator(`.project-tabs button:text-is("${t}")`);
    if (!(await b.count())) continue;
    await b.click(); await check('projet › ' + t);
  }
  // vue document (facture)
  const docRow = page.locator('table.list tr.click', { hasText: /F-\d{4}/ }).first();
  if (await docRow.count()) { await docRow.click(); await page.waitForSelector('.doc'); await check('document facture'); }
  // fiche matériel
  await page.goto(U + '#/materiel'); await page.waitForTimeout(600);
  await page.locator('table.list tr:not(.kit-child)', { hasText: 'Amplificateur LA4X' }).first().click(); await check('fiche matériel');
  // checklist ouverte
  await page.goto(U + '#/entrepot'); await page.waitForTimeout(600);
  await page.locator('table.list tr.click').first().click(); await page.waitForSelector('.checklist-scan'); await check('checklist');
  // modales
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
  await openModal('parametres', 'button:has-text("+ Nouvelle base")', 'modale nouvelle base');
  // recherche globale (Ctrl+K)
  await page.goto(U + '#/'); await page.waitForTimeout(600);
  await page.keyboard.press('Control+k'); await page.waitForSelector('.gs'); await page.locator('.gs input').fill('ampli');
  await page.waitForTimeout(400); await check('recherche globale', true);
  await page.keyboard.press('Escape');

  console.log(`\n== ${v.name} ==`);
  for (const r of report) {
    console.log(`\n### ${r.name}${r.pageOverflow > 1 ? ` — LA PAGE DÉFILE DE CÔTÉ (+${r.pageOverflow} px)` : ''}`);
    for (const x of r.beyond.slice(0, 10)) console.log('  dépasse : ' + x);
    for (const x of r.clipped.slice(0, 10)) console.log('  tronqué  : ' + x);
    for (const x of r.tiny.slice(0, 6)) console.log('  police   : ' + x);
    for (const x of r.fail.slice(0, 10)) console.log('  ÉCHEC    : ' + x);
    for (const x of r.touch.slice(0, 8)) console.log('  cible<40 : ' + x);
  }
  const n = routes.length + projectTabs.length + 4 + 5 + 1;
  console.log(`${report.length} page(s) avec des problèmes sur ${n} — ${v.name}`);
  totalProblems += report.filter((r) => r.hard).length;
  totalPages += n;
  await ctx.close();
}

// écran de connexion (base verrouillée) dans un contexte dédié
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(U + '#/parametres');
  await page.waitForTimeout(1200);
  await page.locator('input[aria-label="Nom du nouvel utilisateur"]').fill('Nicolas');
  await page.locator('input[aria-label="Email du nouvel utilisateur"]').fill('nico@fab.be');
  await page.locator('input[aria-label="Mot de passe du nouvel utilisateur"]').fill('secret1');
  await page.locator('select[aria-label="Rôle du nouvel utilisateur"]').selectOption('admin');
  await page.click('button:text-is("+ Ajouter")');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.login-card');
  const a = await page.evaluate(() => {
    const W = window.innerWidth;
    const out = { pageOverflow: document.documentElement.scrollWidth - W, beyond: [], fail: [] };
    for (const el of document.querySelectorAll('.login-bg *')) {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') {
        if (r.right > W + 1) out.beyond.push(`${el.tagName} « ${(el.textContent || el.placeholder || '').trim().slice(0, 30)} » +${Math.round(r.right - W)} px`);
        const tag = el.tagName.toLowerCase();
        if ((tag === 'button' || tag === 'input') && r.height < 40) out.fail.push(`${tag} « ${(el.textContent || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 30)} » ${Math.round(r.height)} px`);
      }
    }
    return out;
  });
  console.log(`\n== écran de connexion (mobile) ==`);
  console.log(`overflow +${a.pageOverflow} px`, a.beyond, a.fail);
  await page.screenshot({ path: 'tests/e2e/ux-shots/mobile-login.png' });
  if (a.pageOverflow > 1 || a.beyond.length || a.fail.length) totalProblems++;
  totalPages++;
  await ctx.close();
}

console.log(`\nTotal : ${totalProblems} page(s) avec des problèmes sur ${totalPages} pages auditées (mobile + ordinateur + login)`);
await browser.close(); server.kill();
process.exit(process.argv.includes('--strict') && totalProblems ? 1 : 0);
