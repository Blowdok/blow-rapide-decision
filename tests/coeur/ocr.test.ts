import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemblerPages, extraireDocument, type OptionsOcr } from '../../src/coeur/extraction/extraction';
import { depuisPdfJs, encoderPng, type ImageBrute, reduire, simplifier } from '../../src/coeur/extraction/images';
import { indexerDossier } from '../../src/coeur/index/corpus';
import { CONSIGNE_OCR, LecteurOcrOllama, nettoyerTranscription } from '../../src/coeur/moteurs/ocr';
import { CacheFichiers, CacheMemoire } from '../../src/coeur/outils/cache';
import { creerPdf, creerPdfPages, dossierTemporaire, imageScannee } from '../outils/fabriques';
import { type AppelEnregistre, fauxFetch, reponseJson } from '../outils/faux-fetch';

let dossier: string;
let nettoyer: () => Promise<void>;

beforeEach(async () => {
  ({ chemin: dossier, nettoyer } = await dossierTemporaire());
});
afterEach(async () => {
  await nettoyer();
});

/** Blocs d'un PNG, contrôle d'intégrité vérifié. */
function lirePng(png: Buffer): Array<{ type: string; donnees: Buffer }> {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const blocs: Array<{ type: string; donnees: Buffer }> = [];
  for (let position = 8; position < png.length; ) {
    const longueur = png.readUInt32BE(position);
    const type = png.toString('latin1', position + 4, position + 8);
    const donnees = png.subarray(position + 8, position + 8 + longueur);
    expect(png.readUInt32BE(position + 8 + longueur)).toBe(crc32(donnees, crc32(Buffer.from(type, 'latin1'))));
    blocs.push({ type, donnees });
    position += 12 + longueur;
  }
  return blocs;
}

/** Moteur de vision simulé : chaque appel lit la page suivante. */
function visionSimulee(...textes: string[]): { lecteur: LecteurOcrOllama; appels: AppelEnregistre[] } {
  let lue = 0;
  const { fetch, appels } = fauxFetch(() =>
    reponseJson({
      model: 'minicpm-v4.6:1b',
      message: { role: 'assistant', content: textes[Math.min(lue++, textes.length - 1)] },
      prompt_eval_count: 700,
      eval_count: 40
    })
  );
  return { lecteur: new LecteurOcrOllama({ url: 'http://127.0.0.1:11434', modele: 'minicpm-v4.6:1b', fetch }), appels };
}

describe('images des pages scannées', () => {
  it('encode un PNG valide, en niveaux de gris ou en RVB', () => {
    const gris: ImageBrute = { largeur: 3, hauteur: 2, canaux: 1, pixels: Uint8Array.from([0, 128, 255, 10, 20, 30]) };
    const blocs = lirePng(encoderPng(gris));
    expect(blocs.map((b) => b.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const entete = blocs[0]?.donnees as Buffer;
    expect([entete.readUInt32BE(0), entete.readUInt32BE(4), entete[8], entete[9]]).toEqual([3, 2, 8, 0]);
    // Chaque ligne commence par l'octet de filtre 0.
    expect([...inflateSync(blocs[1]?.donnees as Buffer)]).toEqual([0, 0, 128, 255, 0, 10, 20, 30]);

    const rvb: ImageBrute = { largeur: 1, hauteur: 1, canaux: 3, pixels: Uint8Array.from([255, 0, 0]) };
    const [enteteRvb, donneesRvb] = lirePng(encoderPng(rvb));
    expect(enteteRvb?.donnees[9]).toBe(2);
    expect([...inflateSync(donneesRvb?.donnees as Buffer)]).toEqual([0, 255, 0, 0]);
  });

  it('convertit les images décodées par PDF.js', () => {
    // 1 bit par pixel, largeur 10 : 2 octets par ligne, 1 pour le blanc.
    const unBit = depuisPdfJs({ width: 10, height: 2, kind: 1, data: Uint8Array.from([0xff, 0xc0, 0x00, 0x00]) });
    expect(unBit).toEqual({
      largeur: 10,
      hauteur: 2,
      canaux: 1,
      pixels: Uint8Array.from([...Array(10).fill(255), ...Array(10).fill(0)])
    });
    const rvba = depuisPdfJs({ width: 1, height: 1, kind: 3, data: Uint8Array.from([0, 0, 0, 0]) });
    // Pixel transparent : blanc, comme le papier.
    expect(rvba?.pixels).toEqual(Uint8Array.from([255, 255, 255]));
    expect(depuisPdfJs({ width: 2, height: 2, data: new Uint8Array(5) })).toBeNull();
  });

  it('réduit sans agrandir, puis passe en gris une image sans couleur', () => {
    const image: ImageBrute = { largeur: 4, hauteur: 2, canaux: 1, pixels: Uint8Array.from([0, 100, 200, 200, 0, 100, 0, 0]) };
    expect(reduire(image, 2)).toEqual({ largeur: 2, hauteur: 1, canaux: 1, pixels: Uint8Array.from([50, 100]) });
    expect(reduire(image, 10)).toBe(image);

    const grise: ImageBrute = { largeur: 2, hauteur: 1, canaux: 3, pixels: Uint8Array.from([9, 9, 9, 200, 200, 200]) };
    expect(simplifier(grise)).toEqual({ largeur: 2, hauteur: 1, canaux: 1, pixels: Uint8Array.from([9, 200]) });
    const coloree: ImageBrute = { largeur: 1, hauteur: 1, canaux: 3, pixels: Uint8Array.from([255, 0, 0]) };
    expect(simplifier(coloree)).toBe(coloree);
  });
});

describe('lecture OCR des PDF scannés', () => {
  it('assemble les pages exactement comme unpdf', async () => {
    const octets = creerPdfPages([{ lignes: ['Page  un', 'avec   des   espaces'] }, { lignes: ['Page deux'] }]);
    const fusion = await extractText(await getDocumentProxy(new Uint8Array(octets)), { mergePages: true });
    const pages = await extractText(await getDocumentProxy(new Uint8Array(octets)), { mergePages: false });
    expect(assemblerPages(pages.text)).toBe(fusion.text);
  });

  it('lit une page scannée avec le modèle de vision, image jointe en PNG', async () => {
    const chemin = join(dossier, 'avis-scanne.pdf');
    await writeFile(chemin, creerPdfPages([{ image: imageScannee() }]));
    const { lecteur, appels } = visionSimulee('```\nAvis de taxe foncière\nMontant : 1 234 €\n```');
    const extraction = await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 10 } });

    expect(extraction).toMatchObject({ texte: 'Avis de taxe foncière\nMontant : 1 234 €', pagesSansTexte: 1, pagesOcr: 1, pagesAuDela: 0 });
    expect(extraction.mesures).toEqual([expect.objectContaining({ operation: 'ocr', modele: 'minicpm-v4.6:1b', horsMachine: false, caracteresEnvoyes: 0 })]);
    expect(appels[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    const corps = appels[0]?.corps as { model: string; think: boolean; messages: Array<{ content: string; images: string[] }> };
    expect(corps).toMatchObject({ model: 'minicpm-v4.6:1b', think: false, stream: false });
    expect(corps.messages[0]?.content).toBe(CONSIGNE_OCR);
    // Le scan en noir et blanc part en PNG en niveaux de gris, à sa taille d'origine.
    const [entete] = lirePng(Buffer.from(corps.messages[0]?.images[0] ?? '', 'base64'));
    expect([entete?.donnees.readUInt32BE(0), entete?.donnees.readUInt32BE(4), entete?.donnees[9]]).toEqual([420, 594, 0]);
  });

  it('ne lit que les pages sans texte d’un PDF mixte', async () => {
    const chemin = join(dossier, 'contrat-signe.pdf');
    await writeFile(
      chemin,
      creerPdfPages([{ lignes: ['Contrat de maintenance du site internet, douze mois.'] }, { image: imageScannee() }])
    );
    const { lecteur, appels } = visionSimulee('Signature du client');
    const { texte, pagesOcr } = await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 10 } });
    expect(texte).toBe('Contrat de maintenance du site internet, douze mois.\nSignature du client');
    expect(pagesOcr).toBe(1);
    expect(appels).toHaveLength(1);
  });

  it('garde les pages lues en cache et respecte la limite de pages', async () => {
    const chemin = join(dossier, 'long.pdf');
    await writeFile(chemin, creerPdfPages([{ image: imageScannee() }, { image: imageScannee() }, { image: imageScannee() }]));
    const cache = new CacheMemoire();
    const { lecteur, appels } = visionSimulee('Page un', 'Page deux');
    const ocr: OptionsOcr = { lecteur, pagesMax: 2, cache };
    const pagesVues: string[] = [];
    const premiere = await extraireDocument(chemin, 'pdf', { ocr, surPageOcr: (page, pages) => pagesVues.push(`${page}/${pages}`) });
    expect(premiere).toMatchObject({ texte: 'Page un\nPage deux', pagesOcr: 2, pagesAuDela: 1 });
    expect(pagesVues).toEqual(['1/2', '2/2']);

    const seconde = await extraireDocument(chemin, 'pdf', { ocr });
    expect(seconde.texte).toBe(premiere.texte);
    expect(seconde.mesures).toEqual([]);
    expect(appels).toHaveLength(2);
  });

  it('ignore une petite image : un logo n’est pas une page scannée', async () => {
    const chemin = join(dossier, 'logo.pdf');
    await writeFile(chemin, creerPdfPages([{ image: imageScannee(120, 80) }]));
    const { lecteur, appels } = visionSimulee('jamais lu');
    const extraction = await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 10 } });
    expect(extraction).toMatchObject({ texte: '', pagesSansTexte: 1, pagesOcr: 0 });
    expect(appels).toHaveLength(0);
  });

  it('retire l’habillage des transcriptions', () => {
    expect(nettoyerTranscription('```text\nBonjour\n```')).toBe('Bonjour');
    expect(nettoyerTranscription('  Bonjour  ')).toBe('Bonjour');
  });

  it('compte l’image envoyée à un Ollama distant', async () => {
    const { fetch } = fauxFetch(reponseJson({ message: { content: 'Texte' } }));
    const lecteur = new LecteurOcrOllama({ url: 'http://192.168.1.20:11434', modele: 'minicpm-v4.6:1b', fetch });
    const png = encoderPng({ largeur: 1, hauteur: 1, canaux: 1, pixels: Uint8Array.from([255]) });
    const { mesure } = await lecteur.lire(png);
    expect(mesure).toMatchObject({ horsMachine: true, caracteresEnvoyes: CONSIGNE_OCR.length + png.toString('base64').length });
  });
});

describe('indexation avec lecture OCR', () => {
  it('sans l’option, signale le PDF scanné et la piste pour le lire', async () => {
    await writeFile(join(dossier, 'scan.pdf'), creerPdfPages([{ image: imageScannee() }]));
    await writeFile(join(dossier, 'notes.txt'), 'Réunion de lancement.');
    const corpus = await indexerDossier(dossier);
    expect(corpus.documents.map((d) => d.id)).toEqual(['notes.txt']);
    expect(corpus.erreurs).toEqual([
      { chemin: 'scan.pdf', message: 'Aucun texte extrait : PDF scanné ou vide. L’option de lecture des PDF scannés peut le lire.' }
    ]);
  });

  it('marque les documents lus par OCR et signale les pages au-delà de la limite', async () => {
    await writeFile(join(dossier, 'scan.pdf'), creerPdfPages([{ image: imageScannee() }, { image: imageScannee() }]));
    await writeFile(join(dossier, 'texte.pdf'), creerPdf(['Facture 2026-041 : 1 250 euros']));
    const { lecteur } = visionSimulee('Relevé de compte scanné');
    const progressions: string[] = [];
    const corpus = await indexerDossier(dossier, {
      ocr: { lecteur, pagesMax: 1 },
      surProgression: (p) => p.ocr && progressions.push(`${p.fichier} ${p.ocr.page}/${p.ocr.pages}`)
    });

    expect(corpus.documents.map((d) => [d.id, d.pagesOcr])).toEqual([
      ['scan.pdf', 1],
      ['texte.pdf', undefined]
    ]);
    expect(corpus.documents[0]?.texte).toBe('Relevé de compte scanné');
    expect(progressions).toEqual(['scan.pdf 1/1']);
    expect(corpus.avis).toEqual(['scan.pdf : 1 page(s) scannée(s) non lue(s), au-delà de la limite de 1 pages par document.']);
    expect(corpus.mesures).toHaveLength(1);
  });

  it('continue sans OCR quand Ollama est injoignable, sans réessayer à chaque fichier', async () => {
    await writeFile(join(dossier, 'a-scan.pdf'), creerPdfPages([{ image: imageScannee() }]));
    await writeFile(join(dossier, 'b-scan.pdf'), creerPdfPages([{ image: imageScannee() }]));
    await writeFile(join(dossier, 'c-notes.txt'), 'Notes de réunion.');
    const { fetch, appels } = fauxFetch(new TypeError('fetch failed'));
    const lecteur = new LecteurOcrOllama({ url: 'http://127.0.0.1:11434', modele: 'minicpm-v4.6:1b', fetch });
    const corpus = await indexerDossier(dossier, { ocr: { lecteur, pagesMax: 10 } });

    expect(appels).toHaveLength(1);
    expect(corpus.documents.map((d) => d.id)).toEqual(['c-notes.txt']);
    expect(corpus.erreurs.map((e) => e.message)).toEqual([
      'Aucun texte extrait : lecture OCR impossible. Ollama est injoignable à http://127.0.0.1:11434 : est-il lancé ?',
      'Aucun texte extrait : lecture OCR impossible. Ollama est injoignable à http://127.0.0.1:11434 : est-il lancé ?'
    ]);
    expect(corpus.avis).toEqual([
      'Lecture des PDF scannés interrompue : Ollama est injoignable à http://127.0.0.1:11434 : est-il lancé ? Les pages scannées suivantes n’ont pas été lues.'
    ]);
  });
});

describe('cache des pages lues', () => {
  it('garde les textes sur disque sous un nom qui ne révèle pas le document', async () => {
    const cache = new CacheFichiers(join(dossier, 'cache-ocr'));
    const cle = 'ocr-1|minicpm-v4.6:1b|empreinte|1';
    expect(await cache.lire(cle)).toBeNull();
    await cache.ecrire(cle, 'Avis de taxe foncière');
    expect(await cache.lire(cle)).toBe('Avis de taxe foncière');
    expect(await new CacheFichiers(join(dossier, 'cache-ocr')).lire(cle)).toBe('Avis de taxe foncière');
    expect(await readdir(join(dossier, 'cache-ocr'))).toEqual([expect.stringMatching(/^[0-9a-f]{64}\.txt$/)]);
  });
});
