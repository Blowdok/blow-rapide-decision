// Parcours des options facultatives, face à un serveur qui imite Ollama :
// lecture OCR d'un PDF scanné, recherche sémantique, puis annulation d'une
// indexation trop longue. Aucun vrai modèle n'est nécessaire.

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
  await expect(fenetre.getByText('Recherche sémantique prête : 3 passages, modèle embeddinggemma.')).toBeVisible();
  const ligne = fenetre.getByRole('row', { name: /avis-scanne\.pdf/ });
  await expect(ligne).toContainText('OCR');
  await ligne.click();
  await expect(fenetre.locator('.fiche .meta')).toContainText('1 page(s) lue(s) par OCR');
  await fenetre.locator('.fiche summary').click();
  await expect(fenetre.locator('.apercu')).toContainText('Montant : 1 234 €');
  await capturer('options-01-documents');
});

test('trouve un document par le sens, sans mot commun', async () => {
  await fenetre.getByRole('button', { name: /^Recherche/ }).click();
  await expect(fenetre.getByText(/par les mots-clés et par le sens/)).toBeVisible();
  await fenetre.getByRole('searchbox', { name: 'Requête' }).fill('rémunération');
  await fenetre.getByRole('button', { name: 'Chercher' }).click();
  const premier = fenetre.locator('.resultat').first();
  await expect(premier).toContainText('bulletin-septembre.txt');
  await expect(premier).toContainText('rang lexical – · rang sémantique 1');
  await capturer('options-02-recherche');
});

test('affiche les options actives dans les réglages', async () => {
  await fenetre.getByRole('button', { name: /^Réglages/ }).click();
  const options = fenetre.getByRole('region', { name: 'Options locales facultatives' });
  await expect(options.getByRole('checkbox', { name: /Recherche sémantique/ })).toBeChecked();
  await expect(options.getByRole('checkbox', { name: /Lecture des PDF scannés/ })).toBeChecked();
  // Modèles présents dans le faux Ollama : aucune alerte.
  await expect(options.getByText(/Modèle absent/)).toHaveCount(0);
  await options.scrollIntoViewIfNeeded();
  await capturer('options-03-reglages');
});

test('annule une lecture OCR trop longue et garde le dossier ouvert', async () => {
  lenteurOcrMs = 60_000;
  await writeFile(join(documents, 'releve-scanne.pdf'), creerPdfPages([{ image: imageScannee(500, 700) }]));
  await fenetre.getByRole('button', { name: /^Documents/ }).click();
  await fenetre.getByRole('button', { name: 'Réindexer' }).click();
  await expect(fenetre.getByText('Lecture OCR de releve-scanne.pdf : page 1 sur 1')).toBeVisible();
  await capturer('options-04-lecture-ocr');
  await fenetre.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(fenetre.getByText('Indexation annulée.')).toBeVisible();
  await expect(fenetre.getByRole('row', { name: /bulletin-septembre\.txt/ })).toBeVisible();
  await expect(fenetre.getByRole('row', { name: /releve-scanne\.pdf/ })).toHaveCount(0);
});
