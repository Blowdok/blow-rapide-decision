// Parcours de l'application réelle, tel qu'un débutant le suit : accueil,
// lecture d'un dossier, classement, résumé, recherche, comparaison, réglages
// et aide. Sans clé ni serveur Ollama, seul le mode « Référence sans IA » peut
// aboutir : c'est lui que le parcours utilise.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import type { ApiBureau } from '../src/partage/contrat';

const RACINE = resolve(import.meta.dirname, '..');
const DOCUMENTS_DEMO = join(RACINE, 'jeux-evaluation', 'demo', 'documents');
/** Dossier facultatif où enregistrer des captures d'écran. */
const CAPTURES = process.env.BRD_CAPTURES;

// Un seul parcours : après un échec, les étapes suivantes n'ont pas de sens.
test.describe.configure({ mode: 'serial' });

let application: ElectronApplication;
let fenetre: Page;
let donnees: string;

/** Bouton du menu latéral : les écrans restent montés, et l'aide contient aussi des liens « Documents »… */
const menu = (nom: RegExp) => fenetre.getByRole('navigation', { name: 'Écrans' }).getByRole('button', { name: nom });

/**
 * Éléments visibles avec lesquels on agit (boutons, champs, liens, choix) et
 * qui n'ont pas de bulle d'information, sur l'écran affiché.
 */
function elementsSansInfobulle(): Promise<string[]> {
  // Évalué dans la page : les tests sont typés sans le DOM.
  return fenetre.evaluate(`[...document.querySelectorAll('button, input, select, textarea, a[href], summary, [role="radio"]')]
    .filter((e) => e.getClientRects().length > 0 && !e.closest('[data-infobulle]'))
    .map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim().slice(0, 60))`);
}

async function capturer(nom: string): Promise<void> {
  if (CAPTURES) await fenetre.screenshot({ path: join(CAPTURES, `${nom}.png`) });
}

test.beforeAll(async () => {
  donnees = await mkdtemp(join(tmpdir(), 'brd-e2e-'));
  application = await electron.launch({
    // Le bac à sable de Chromium refuse l'utilisateur root (conteneurs d'intégration continue).
    args: [RACINE, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    // Playwright imposerait sinon un thème clair : c'est l'application qui doit décider.
    colorScheme: null,
    env: {
      ...process.env,
      BRD_DOSSIER_DONNEES: donnees,
      OPENROUTER_API_KEY: '',
      TYPESAFE_API_KEY: ''
    }
  });
  fenetre = await application.firstWindow();
  await fenetre.setViewportSize({ width: 1320, height: 860 });
});

test.afterAll(async () => {
  await application?.close();
  await rm(donnees, { recursive: true, force: true });
});

test('accueille le débutant en trois étapes, en mode local par défaut', async () => {
  await expect(fenetre).toHaveTitle('Blow Rapide Décision');
  await expect(fenetre.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true');
  await expect(fenetre.getByText('Tout reste sur ce PC', { exact: true })).toBeVisible();
  await expect(fenetre.getByRole('heading', { name: 'Bienvenue ! Trois étapes pour commencer' })).toBeVisible();
  // L'agent vérifie tout seul si le mode choisi peut fonctionner, et dit quoi faire sinon.
  // Les écrans restent montés : seul celui qui est affiché compte.
  await expect(fenetre.locator('.preparation-verdict:visible')).toContainText(/Prêt|À faire/);
  await expect(fenetre.getByRole('button', { name: 'Vérifier à nouveau' })).toBeVisible();
  await expect(fenetre.getByRole('button', { name: 'Choisir un dossier…' })).toBeVisible();
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('01-accueil');
});

test('indexe la démo, trie et résume en mode référence', async () => {
  // Le sélecteur de dossier est une boîte de dialogue native : on passe par l'API exposée.
  await fenetre.evaluate(
    (dossier) => (globalThis as unknown as { brd: ApiBureau }).brd.dossier.indexer(dossier),
    DOCUMENTS_DEMO
  );
  await fenetre.reload();
  await fenetre.getByRole('radio', { name: 'Référence sans IA' }).click();
  await expect(fenetre.getByText('Hors ligne, sans IA')).toBeVisible();

  await expect(fenetre.getByText(/^Étape suivante : cliquez sur « Classer les 12 documents »/)).toBeVisible();
  await fenetre.getByRole('button', { name: 'Classer les 12 documents' }).click();
  await expect(fenetre.getByRole('row', { name: /facture-imprimerie-lumen\.txt/ })).toContainText('Facture');

  await fenetre.getByRole('row', { name: /contrat-maintenance-site\.txt/ }).click();
  await fenetre.getByRole('button', { name: 'Résumer', exact: true }).click();
  await expect(fenetre.getByRole('heading', { name: 'Résumé' })).toBeVisible();
  await expect(fenetre.locator('.texte-resume')).toContainText('180 € HT par mois');
  await expect(fenetre.getByText(/rien n’a quitté ce PC/).first()).toBeVisible();
  await fenetre.locator('.fiche summary').click();
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('02-documents');
});

test('cherche un passage, d’abord avec une question d’exemple', async () => {
  await menu(/^Recherche/).click();
  await fenetre.getByRole('button', { name: 'Combien coûte la maintenance du site ?' }).click();
  await expect(fenetre.getByRole('searchbox', { name: 'Requête' })).toHaveValue('Combien coûte la maintenance du site ?');
  await expect(fenetre.locator('.resultat').first()).toBeVisible();

  await fenetre.getByRole('searchbox', { name: 'Requête' }).fill('date limite pour payer la taxe foncière');
  await fenetre.getByRole('button', { name: 'Chercher' }).click();
  await expect(fenetre.locator('.resultat').first()).toContainText('avis-taxe-fonciere-2026.txt');
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('03-recherche');
});

test('compare les modes et explique pourquoi aucun mode IA n’a tourné', async () => {
  await menu(/^Comparaison/).click();
  await expect(fenetre.getByRole('textbox', { name: 'Dossier des documents d’examen' })).toHaveValue(/jeux-evaluation[\\/]demo$/);
  await fenetre.getByRole('button', { name: 'Lancer la comparaison' }).click();
  await expect(fenetre.getByRole('heading', { name: 'Aucun mode IA n’a pu tourner' })).toBeVisible({ timeout: 60_000 });
  await expect(fenetre.getByText(/Mode Hybride indisponible : Clé OpenRouter manquante/)).toBeVisible();
  await expect(fenetre.getByRole('row', { name: /Indice de qualité/ })).toBeVisible();
  for (const resume of await fenetre.locator('.bloc > summary:visible').all()) await resume.click();
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('04-comparaison');
});

test('vérifie les services depuis les réglages, réglages avancés repliés', async () => {
  await menu(/^Réglages/).click();
  await fenetre.getByRole('button', { name: 'Vérifier à nouveau' }).click();
  await expect(fenetre.locator('.diagnostic:visible li')).toHaveCount(3);
  await expect(fenetre.locator('.diagnostic:visible')).toContainText('Clé absente : le mode hybride est indisponible.');
  // Le débutant ne voit que l'essentiel ; le reste attend une case à cocher.
  await expect(fenetre.getByRole('textbox', { name: 'Adresse du serveur' })).toHaveCount(0);
  await capturer('05-reglages');
});

test('garde les options facultatives désactivées, et avance sans leurs modèles', async () => {
  const options = fenetre.getByRole('region', { name: 'Options locales facultatives' });
  const semantique = options.getByRole('checkbox', { name: /Recherche par le sens/ });
  await expect(semantique).not.toBeChecked();
  await expect(options.getByRole('checkbox', { name: /Lecture des PDF scannés/ })).not.toBeChecked();

  // Option activée, mais Ollama injoignable : l'indexation aboutit quand même, avec un avis.
  await semantique.check();
  await fenetre.getByRole('checkbox', { name: 'Afficher les réglages avancés' }).check();
  expect(await elementsSansInfobulle()).toEqual([]);
  await fenetre.getByRole('textbox', { name: 'Adresse du serveur' }).fill('http://127.0.0.1:9');
  await fenetre.locator('.titre-ecran').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(fenetre.getByText('Réglages enregistrés.')).toBeVisible();
  await capturer('06-options');

  await menu(/^Documents/).click();
  await fenetre.getByRole('button', { name: 'Actualiser' }).click();
  await expect(fenetre.getByText(/^Recherche sémantique indisponible : Ollama est injoignable/)).toBeVisible();
  await expect(fenetre.getByRole('row', { name: /facture-imprimerie-lumen\.txt/ })).toBeVisible();

  await menu(/^Recherche/).click();
  await fenetre.getByRole('searchbox', { name: 'Requête' }).fill('date limite pour payer la taxe foncière');
  await fenetre.getByRole('button', { name: 'Chercher' }).click();
  await expect(fenetre.locator('.resultat').first()).toContainText('avis-taxe-fonciere-2026.txt');
  await expect(fenetre.getByText(/Actualisez le dossier une fois le problème réglé/)).toBeVisible();
});

test('ouvre l’aide sur la bonne question', async () => {
  await fenetre.getByRole('button', { name: 'Quel mode choisir ?' }).click();
  await expect(fenetre.getByRole('heading', { name: 'Aide', exact: true })).toBeVisible();
  await expect(fenetre.locator('#aide-modes')).toHaveAttribute('open', '');
  await expect(fenetre.locator('#aide-modes')).toContainText('Référence sans IA');
  await fenetre.getByText('Installer Ollama (mode Local)').click();
  await expect(fenetre.locator('#aide-ollama .commande code')).toHaveText('ollama pull qwen3.5:4b');
  // Toutes les réponses ouvertes : leurs boutons et leurs liens passent aussi à l'audit.
  const questions = fenetre.locator('details.question');
  for (let i = 0; i < (await questions.count()); i++) {
    const question = questions.nth(i);
    if ((await question.getAttribute('open')) === null) await question.locator('summary').click();
  }
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('07-aide');
});

test('explique chaque bouton dans une bulle, au survol comme au clavier', async () => {
  await menu(/^Documents/).click();
  const bulle = fenetre.getByRole('tooltip');
  await fenetre.getByRole('button', { name: 'Actualiser' }).hover();
  await expect(bulle).toHaveText('Relit le dossier : fichiers ajoutés ou modifiés, options activées dans Réglages.');
  await capturer('08-infobulle');
  // Au clavier, la bulle vient tout de suite ; les lecteurs d'écran la lisent comme description.
  const changer = fenetre.getByRole('button', { name: 'Changer de dossier…' });
  await changer.focus();
  await expect(bulle).toHaveText('Choisir un autre dossier de documents.');
  await expect(changer).toHaveAccessibleDescription('Choisir un autre dossier de documents.');
  await fenetre.keyboard.press('Escape');
  await expect(bulle).toHaveCount(0);
});

test('bascule le thème : sombre, clair, puis système', async () => {
  const sombre = () =>
    fenetre.evaluate(
      () =>
        (globalThis as unknown as { matchMedia(requete: string): { matches: boolean } }).matchMedia(
          '(prefers-color-scheme: dark)'
        ).matches
    );
  const themeEnregistre = () =>
    fenetre.evaluate(async () => (await (globalThis as unknown as { brd: ApiBureau }).brd.reglages.lire()).reglages.apparence.theme);
  const theme = fenetre.getByRole('radiogroup', { name: 'Thème' });

  await menu(/^Documents/).click();
  await theme.getByRole('radio', { name: 'Sombre' }).click();
  await expect(theme.getByRole('radio', { name: 'Sombre' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(sombre).toBe(true);
  expect(await themeEnregistre()).toBe('sombre');
  await capturer('09-documents-sombre');
  await menu(/^Comparaison/).click();
  await capturer('10-comparaison-sombre');

  await theme.getByRole('radio', { name: 'Clair' }).click();
  await expect.poll(sombre).toBe(false);

  await theme.getByRole('radio', { name: 'Système' }).click();
  await expect(theme.getByRole('radio', { name: 'Système' })).toHaveAttribute('aria-checked', 'true');
  expect(await themeEnregistre()).toBe('systeme');
});
