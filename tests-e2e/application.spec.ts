// Parcours de l'application réelle : fenêtre, indexation, tri, résumé,
// recherche, comparaison et réglages. Sans clé ni serveur Ollama, seul le mode
// « Référence sans IA » peut aboutir : c'est lui que le parcours utilise.

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

async function capturer(nom: string): Promise<void> {
  if (CAPTURES) await fenetre.screenshot({ path: join(CAPTURES, `${nom}.png`) });
}

test.beforeAll(async () => {
  donnees = await mkdtemp(join(tmpdir(), 'brd-e2e-'));
  application = await electron.launch({
    // Le bac à sable de Chromium refuse l'utilisateur root (conteneurs d'intégration continue).
    args: [RACINE, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
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

test('ouvre la fenêtre en français, en mode local par défaut', async () => {
  await expect(fenetre).toHaveTitle('Blow Rapide Décision');
  await expect(fenetre.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true');
  await expect(fenetre.getByText('Tout reste sur ce PC')).toBeVisible();
  await expect(fenetre.getByRole('button', { name: 'Choisir un dossier…' })).toBeVisible();
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

  await fenetre.getByRole('button', { name: 'Trier les 12 documents' }).click();
  await expect(fenetre.getByRole('row', { name: /facture-imprimerie-lumen\.txt/ })).toContainText('Facture');

  await fenetre.getByRole('row', { name: /contrat-maintenance-site\.txt/ }).click();
  await fenetre.getByRole('button', { name: 'Résumer', exact: true }).click();
  await expect(fenetre.getByRole('heading', { name: 'Résumé' })).toBeVisible();
  await expect(fenetre.locator('.texte-resume')).toContainText('180 € HT par mois');
  await expect(fenetre.getByText('rien n’a quitté la machine').first()).toBeVisible();
  await capturer('02-documents');
});

test('cherche un passage', async () => {
  await fenetre.getByRole('button', { name: /^Recherche/ }).click();
  await fenetre.getByRole('searchbox', { name: 'Requête' }).fill('date limite pour payer la taxe foncière');
  await fenetre.getByRole('button', { name: 'Chercher' }).click();
  await expect(fenetre.locator('.resultat').first()).toContainText('avis-taxe-fonciere-2026.txt');
  await capturer('03-recherche');
});

test('compare les modes et explique pourquoi aucun mode IA n’a tourné', async () => {
  await fenetre.getByRole('button', { name: /^Comparaison/ }).click();
  await expect(fenetre.getByRole('textbox', { name: 'Dossier du jeu d’évaluation' })).toHaveValue(/jeux-evaluation[\\/]demo$/);
  await fenetre.getByRole('button', { name: 'Lancer la comparaison' }).click();
  await expect(fenetre.getByRole('heading', { name: 'Aucun mode IA n’a pu tourner' })).toBeVisible({ timeout: 60_000 });
  await expect(fenetre.getByText(/Mode Hybride indisponible : Clé OpenRouter manquante/)).toBeVisible();
  await expect(fenetre.getByRole('row', { name: /Indice de qualité/ })).toBeVisible();
  await capturer('04-comparaison');
});

test('vérifie les services depuis les réglages', async () => {
  await fenetre.getByRole('button', { name: /^Réglages/ }).click();
  await fenetre.getByRole('button', { name: 'Vérifier Ollama, OpenRouter et Jev' }).click();
  await expect(fenetre.locator('.diagnostic li')).toHaveCount(3);
  await expect(fenetre.locator('.diagnostic')).toContainText('Clé absente : le mode hybride est indisponible.');
  await capturer('05-reglages');
});
