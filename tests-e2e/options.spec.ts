// Parcours des options facultatives, face à un serveur qui imite Ollama :
// lecture OCR d'un PDF scanné, recherche par le sens, puis annulation d'une
// lecture de dossier trop longue. Aucun vrai modèle n'est nécessaire.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import type { ApiBureau } from '../src/partage/contrat';
import { creerPdfPages, imageScannee } from '../tests/outils/fabriques';
import { vecteurConcepts } from '../tests/outils/plongements';

const RACINE = resolve(import.meta.dirname, '..');
const CAPTURES = process.env.BRD_CAPTURES;

test.describe.configure({ mode: 'serial' });

let application: ElectronApplication;
let fenetre: Page;
let donnees: string;
let documents: string;
let serveur: Server;
/** Délai de lecture d'une page par le faux modèle de vision. */
let lenteurOcrMs = 0;

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

async function lireCorps(requete: IncomingMessage): Promise<Record<string, unknown>> {
  const morceaux: Buffer[] = [];
  for await (const morceau of requete) morceaux.push(morceau as Buffer);
  return morceaux.length ? (JSON.parse(Buffer.concat(morceaux).toString('utf8')) as Record<string, unknown>) : {};
}

/** Serveur qui répond comme Ollama : modèles installés, plongements, lecture d'images. */
function demarrerFauxOllama(): Promise<string> {
  serveur = createServer(async (requete, reponse) => {
    const corps = await lireCorps(requete);
    const json = (valeur: unknown): void => {
      reponse.writeHead(200, { 'content-type': 'application/json' });
      reponse.end(JSON.stringify(valeur));
    };
    if (requete.url === '/api/tags') {
      json({ models: ['embeddinggemma:latest', 'minicpm-v4.6:1b', 'qwen3.5:4b'].map((name) => ({ name })) });
    } else if (requete.url === '/api/embed') {
      json({ model: 'embeddinggemma', embeddings: (corps.input as string[]).map(vecteurConcepts) });
    } else if (requete.url === '/api/chat') {
      await new Promise((r) => setTimeout(r, lenteurOcrMs));
      json({ model: 'minicpm-v4.6:1b', message: { role: 'assistant', content: 'AVIS DE TAXE FONCIÈRE 2026\nMontant : 1 234 €' } });
    } else {
      reponse.writeHead(404).end();
    }
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}`)));
}

test.beforeAll(async () => {
  donnees = await mkdtemp(join(tmpdir(), 'brd-e2e-options-'));
  documents = await mkdtemp(join(tmpdir(), 'brd-e2e-documents-'));
  await writeFile(join(documents, 'avis-scanne.pdf'), creerPdfPages([{ image: imageScannee() }]));
  await writeFile(join(documents, 'bulletin-septembre.txt'), 'Bulletin de paie de septembre : salaire brut 2 400 euros.');
  await writeFile(join(documents, 'garage-dupont.txt'), 'Facture du garage Dupont : révision de la voiture.');
  const url = await demarrerFauxOllama();

  application = await electron.launch({
    args: [RACINE, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    colorScheme: null,
    env: { ...process.env, BRD_DOSSIER_DONNEES: donnees, OPENROUTER_API_KEY: '', TYPESAFE_API_KEY: '' }
  });
  fenetre = await application.firstWindow();
  await fenetre.setViewportSize({ width: 1320, height: 860 });
  // Mode sans IA : seules les options appellent le faux Ollama.
  await fenetre.evaluate(
    (adresse) =>
      (globalThis as unknown as { brd: ApiBureau }).brd.reglages.enregistrer({
        profil: 'reference',
        ollama: { url: adresse },
        semantique: { active: true },
        ocr: { active: true }
      }),
    url
  );
});

test.afterAll(async () => {
  await application?.close();
  serveur?.closeAllConnections();
  serveur?.close();
  await rm(donnees, { recursive: true, force: true });
  await rm(documents, { recursive: true, force: true });
});

test('lit le PDF scanné par OCR et prépare la recherche sémantique', async () => {
  // Le sélecteur de dossier est une boîte de dialogue native : on passe par l'API exposée.
  await fenetre.evaluate((dossier) => (globalThis as unknown as { brd: ApiBureau }).brd.dossier.indexer(dossier), documents);
  await fenetre.reload();
  await expect(fenetre.getByText('Recherche par le sens prête : 3 passages, modèle embeddinggemma.')).toBeVisible();
  const ligne = fenetre.getByRole('row', { name: /avis-scanne\.pdf/ });
  await expect(ligne).toContainText('OCR');
  await ligne.click();
  await expect(fenetre.locator('.fiche .meta')).toContainText('1 page(s) lue(s) par OCR');
  await fenetre.locator('.fiche summary').click();
  await expect(fenetre.locator('.apercu')).toContainText('Montant : 1 234 €');
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('options-01-documents');
});

test('trouve un document par le sens, sans mot commun', async () => {
  await menu(/^Recherche/).click();
  await expect(fenetre.getByText('La recherche comprend aussi les mots de sens proche (option activée).')).toBeVisible();
  await fenetre.getByRole('searchbox', { name: 'Requête' }).fill('rémunération');
  await fenetre.getByRole('button', { name: 'Chercher' }).click();
  const premier = fenetre.locator('.resultat').first();
  await expect(premier).toContainText('bulletin-septembre.txt');
  await expect(premier).toContainText('Trouvé par le sens');
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('options-02-recherche');
});

test('affiche les options actives dans les réglages', async () => {
  await menu(/^Réglages/).click();
  const options = fenetre.getByRole('region', { name: 'Options locales facultatives' });
  await expect(options.getByRole('checkbox', { name: /Recherche par le sens/ })).toBeChecked();
  await expect(options.getByRole('checkbox', { name: /Lecture des PDF scannés/ })).toBeChecked();
  // Modèles présents dans le faux Ollama : aucune alerte.
  await expect(options.getByText(/Modèle absent/)).toHaveCount(0);
  await options.scrollIntoViewIfNeeded();
  await capturer('options-03-reglages');
});

test('annule une lecture OCR trop longue, même après un détour par l’aide', async () => {
  lenteurOcrMs = 60_000;
  await writeFile(join(documents, 'releve-scanne.pdf'), creerPdfPages([{ image: imageScannee(500, 700) }]));
  await menu(/^Documents/).click();
  await fenetre.getByRole('button', { name: 'Actualiser' }).click();
  await expect(fenetre.getByText('Lecture OCR de releve-scanne.pdf : page 1 sur 1')).toBeVisible();
  // La lecture continue pendant la visite d'un autre écran ; au retour, son bouton Annuler attend toujours.
  await menu(/^Aide/).click();
  await expect(fenetre.getByRole('heading', { name: 'Aide', exact: true })).toBeVisible();
  await menu(/^Documents/).click();
  await expect(fenetre.getByText('Lecture OCR de releve-scanne.pdf : page 1 sur 1')).toBeVisible();
  expect(await elementsSansInfobulle()).toEqual([]);
  await capturer('options-04-lecture-ocr');
  await fenetre.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(fenetre.getByText('Lecture du dossier annulée.')).toBeVisible();
  await expect(fenetre.getByRole('row', { name: /bulletin-septembre\.txt/ })).toBeVisible();
  await expect(fenetre.getByRole('row', { name: /releve-scanne\.pdf/ })).toHaveCount(0);
});
