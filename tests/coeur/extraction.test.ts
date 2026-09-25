import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extraireTexte, formatDepuisChemin } from '../../src/coeur/extraction/extraction';
import { chercherPassages, indexerDossier } from '../../src/coeur/index/corpus';
import { creerDocx, creerPdf, dossierTemporaire } from '../outils/fabriques';

let dossier: string;
let nettoyer: () => Promise<void>;

beforeEach(async () => {
  ({ chemin: dossier, nettoyer } = await dossierTemporaire());
});
afterEach(async () => {
  await nettoyer();
});

describe('extraction de texte', () => {
  it('reconnaît les formats pris en charge', () => {
    expect(formatDepuisChemin('a/Facture.PDF')).toBe('pdf');
    expect(formatDepuisChemin('notes.markdown')).toBe('md');
    expect(formatDepuisChemin('photo.jpg')).toBeNull();
  });

  it('lit un texte UTF-8 et un vieux texte Windows-1252', async () => {
    const utf8 = join(dossier, 'utf8.txt');
    const ancien = join(dossier, 'ancien.txt');
    await writeFile(utf8, 'Échéance : 15 octobre', 'utf8');
    await writeFile(ancien, Buffer.from('Échéance : 15 octobre', 'latin1'));
    expect(await extraireTexte(utf8, 'txt')).toBe('Échéance : 15 octobre');
    expect(await extraireTexte(ancien, 'txt')).toBe('Échéance : 15 octobre');
  });

  it('extrait le texte d’un PDF', async () => {
    const chemin = join(dossier, 'facture.pdf');
    await writeFile(chemin, creerPdf(['Facture 2026-041', 'Montant : 1 250 euros', 'Date d’échéance : 15 octobre']));
    const texte = await extraireTexte(chemin, 'pdf');
    expect(texte).toContain('Facture 2026-041');
    expect(texte).toContain('1 250 euros');
    expect(texte).toContain('échéance');
  });

  it('extrait le texte d’un document Word', async () => {
    const chemin = join(dossier, 'contrat.docx');
    await writeFile(chemin, await creerDocx(['Contrat de maintenance', 'Durée : douze mois, à compter du 1er novembre.']));
    const texte = await extraireTexte(chemin, 'docx');
    expect(texte).toBe('Contrat de maintenance\n\nDurée : douze mois, à compter du 1er novembre.');
  });
});

describe('indexation d’un dossier', () => {
  it('indexe les formats pris en charge, sous-dossiers compris, et signale les erreurs', async () => {
    await mkdir(join(dossier, 'clients', 'dupont'), { recursive: true });
    await mkdir(join(dossier, '.cache'));
    await writeFile(join(dossier, 'clients', 'dupont', 'devis.md'), '# Devis\n\nRefonte du site : 3 200 euros HT.');
    await writeFile(join(dossier, 'facture.pdf'), creerPdf(['Facture impression flyers']));
    await writeFile(join(dossier, 'vide.txt'), '   ');
    await writeFile(join(dossier, 'casse.docx'), 'pas un zip');
    await writeFile(join(dossier, 'image.png'), 'ignorée');
    await writeFile(join(dossier, '.cache', 'cache.txt'), 'ignoré');
    await writeFile(join(dossier, '~$verrou.docx'), 'fichier de verrou Word');

    const progressions: number[] = [];
    const corpus = await indexerDossier(dossier, { surProgression: (p) => progressions.push(p.traites) });

    expect(corpus.documents.map((d) => d.id)).toEqual(['clients/dupont/devis.md', 'facture.pdf']);
    expect(corpus.erreurs.map((e) => e.chemin).sort()).toEqual(['casse.docx', 'vide.txt']);
    expect(progressions.at(-1)).toBe(4);
    expect(corpus.documents[0]?.passages[0]?.id).toBe('clients/dupont/devis.md#0');

    const [premier] = chercherPassages(corpus, 'refonte du site', 5);
    expect(premier?.passage.documentId).toBe('clients/dupont/devis.md');
    expect(premier?.rang).toBe(1);
  });

  it('retrouve un document par son nom de fichier', async () => {
    await writeFile(join(dossier, 'avis-taxe-fonciere.txt'), 'Montant à payer avant le 15 octobre.');
    await writeFile(join(dossier, 'notes.txt'), 'Réunion de lancement.');
    const corpus = await indexerDossier(dossier);
    expect(chercherPassages(corpus, 'taxe foncière', 3)[0]?.passage.documentId).toBe('avis-taxe-fonciere.txt');
  });
});
