import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { extractText, getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemblerPages, extraireDocument, type OptionsOcr } from '../../src/coeur/extraction/extraction';
import {
  calqueDepuisMasque,
  calqueDepuisPdfJs,
  encoderPng,
  type ImageBrute,
  imageDeLaPage,
  reduire
} from '../../src/coeur/extraction/images';
import { indexerDossier } from '../../src/coeur/index/corpus';
import { CONSIGNE_OCR, LecteurOcrOllama, nettoyerTranscription } from '../../src/coeur/moteurs/ocr';
import { CacheFichiers, CacheMemoire, type CacheTexte } from '../../src/coeur/outils/cache';
import { creerPdf, creerPdfPages, dossierTemporaire, type ImageDeTest, imageScannee, imageUnie, type PageDeTest } from '../outils/fabriques';
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

  it('convertit les images et les masques décodés par PDF.js', () => {
    // 1 bit par pixel, largeur 10 : 2 octets par ligne, 1 pour le blanc.
    const unBit = calqueDepuisPdfJs({ width: 10, height: 2, kind: 1, data: Uint8Array.from([0xff, 0xc0, 0x00, 0x00]) });
    expect(unBit).toEqual({
      largeur: 10,
      hauteur: 2,
      gris: Uint8Array.from([...Array(10).fill(255), ...Array(10).fill(0)]),
      alpha: null
    });
    const rvba = calqueDepuisPdfJs({ width: 2, height: 1, kind: 3, data: Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]) });
    expect(rvba).toEqual({ largeur: 2, hauteur: 1, gris: Uint8Array.from([76, 0]), alpha: Uint8Array.from([255, 0]) });
    expect(calqueDepuisPdfJs({ width: 2, height: 2, data: new Uint8Array(5) })).toBeNull();

    // Masque : 0 peint l'encre (opaque), 1 laisse voir le fond (transparent).
    const masque = calqueDepuisMasque({ width: 4, height: 1, data: Uint8Array.from([0b01010000]) });
    expect(masque?.alpha).toEqual(Uint8Array.from([255, 0, 255, 0]));
  });

  it('réduit sans agrandir', () => {
    const image: ImageBrute = { largeur: 4, hauteur: 2, canaux: 1, pixels: Uint8Array.from([0, 100, 200, 200, 0, 100, 0, 0]) };
    expect(reduire(image, 2)).toEqual({ largeur: 2, hauteur: 1, canaux: 1, pixels: Uint8Array.from([50, 100]) });
    expect(reduire(image, 10)).toBe(image);
  });
});

/** Recompose une page d'un PDF de test. */
async function recomposer(pages: PageDeTest[], numero = 1): Promise<ImageBrute | null> {
  const pdf = await getDocumentProxy(new Uint8Array(creerPdfPages(pages)));
  try {
    const { OPS } = await getResolvedPDFJS();
    return await imageDeLaPage(await pdf.getPage(numero), OPS);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const gris = (image: ImageBrute, x: number, y: number): number | undefined => image.pixels[y * image.largeur + x];

/** Masque noir et blanc dont les `lignesEncre` premières lignes sont de l'encre (bits à 0). */
function masqueDeTest(largeur: number, hauteur: number, lignesEncre: number): ImageDeTest {
  const octetsParLigne = (largeur + 7) >> 3;
  const pixels = Buffer.alloc(octetsParLigne * hauteur, 0xff);
  pixels.fill(0x00, 0, octetsParLigne * lignesEncre);
  return { largeur, hauteur, bits: 1, canaux: 1, pixels, masque: true };
}

describe('recomposition des pages scannées', () => {
  it('assemble un scan découpé en deux bandes', async () => {
    const page = await recomposer([
      {
        images: [
          { image: imageUnie(600, 421, 0), rectangle: [0, 421, 595, 421] },
          { image: imageUnie(600, 421, 128), rectangle: [0, 0, 595, 421] }
        ]
      }
    ]);
    expect(page).not.toBeNull();
    const image = page as ImageBrute;
    expect(image.largeur).toBeGreaterThanOrEqual(595);
    // La bande du haut, puis celle du bas : la page entière part en lecture.
    expect(gris(image, image.largeur >> 1, Math.round(image.hauteur * 0.2))).toBe(0);
    expect(gris(image, image.largeur >> 1, Math.round(image.hauteur * 0.8))).toBe(128);
  });

  it('lit un scan noir et blanc stocké comme masque d’image', async () => {
    const image = (await recomposer([{ image: masqueDeTest(400, 566, 40) }])) as ImageBrute;
    expect(gris(image, 297, 20)).toBe(0);
    expect(gris(image, 297, 400)).toBe(255);
  });

  it('redresse une page tournée d’un quart de tour', async () => {
    const bandeauEnHaut = imageUnie(400, 566, 255);
    bandeauEnHaut.pixels.fill(0, 0, 400 * 40);
    const image = (await recomposer([{ image: bandeauEnHaut, rotation: 90 }])) as ImageBrute;
    // Page affichée à l'horizontale : le haut du scan se retrouve à droite.
    expect([image.largeur, image.hauteur]).toEqual([842, 595]);
    expect(gris(image, 842 - 20, 297)).toBe(0);
    expect(gris(image, 20, 297)).toBe(255);
  });

  it('ignore une petite image posée sur une page blanche', async () => {
    expect(await recomposer([{ images: [{ image: imageUnie(400, 400, 0), rectangle: [50, 700, 100, 100] }] }])).toBeNull();
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
    // La page recomposée part en PNG en niveaux de gris, au format A4 (1 pixel par point au moins).
    const [entete] = lirePng(Buffer.from(corps.messages[0]?.images[0] ?? '', 'base64'));
    expect([entete?.donnees.readUInt32BE(0), entete?.donnees.readUInt32BE(4), entete?.donnees[9]]).toEqual([595, 842, 0]);
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

  it('ne compte pas les pages blanches dans la limite de pages lues', async () => {
    const chemin = join(dossier, 'pages-blanches.pdf');
    await writeFile(chemin, creerPdfPages([{}, {}, { image: imageScannee() }]));
    const { lecteur, appels } = visionSimulee('Page scannée');
    const extraction = await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 1 } });
    expect(extraction).toMatchObject({ texte: 'Page scannée', pagesSansTexte: 3, pagesOcr: 1, pagesAuDela: 0 });
    expect(appels).toHaveLength(1);
  });

  it('continue quand le cache est inutilisable', async () => {
    const chemin = join(dossier, 'scan.pdf');
    await writeFile(chemin, creerPdfPages([{ image: imageScannee() }]));
    const casse: CacheTexte = {
      lire: async () => {
        throw new Error('EACCES : accès refusé');
      },
      ecrire: async () => {
        throw new Error('ENOSPC : disque plein');
      }
    };
    const { lecteur } = visionSimulee('Texte lu');
    expect((await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 10, cache: casse } })).texte).toBe('Texte lu');
  });

  it('ne garde pas une lecture vide : la page sera relue', async () => {
    const chemin = join(dossier, 'scan.pdf');
    await writeFile(chemin, creerPdfPages([{ image: imageScannee() }]));
    const cache = new CacheMemoire();
    const { lecteur, appels } = visionSimulee('', 'Deuxième lecture');
    expect((await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 10, cache } })).texte).toBe('');
    expect((await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 10, cache } })).texte).toBe('Deuxième lecture');
    expect(appels).toHaveLength(2);
  });

  it('garde le texte natif quand la lecture échoue pour une raison imprévue', async () => {
    const chemin = join(dossier, 'contrat-signe.pdf');
    await writeFile(chemin, creerPdfPages([{ lignes: ['Contrat de maintenance du site internet, douze mois.'] }, { image: imageScannee() }]));
    const lecteur = { nom: 'Ollama', modele: 'm', horsMachine: false, lire: async () => Promise.reject(new TypeError('panne imprévue')) };
    const extraction = await extraireDocument(chemin, 'pdf', { ocr: { lecteur, pagesMax: 10 } });
    expect(extraction).toMatchObject({ texte: 'Contrat de maintenance du site internet, douze mois.', erreurOcr: 'panne imprévue' });
  });

  it('explique une réponse illisible d’Ollama', async () => {
    const { fetch } = fauxFetch(new Response('pas du JSON', { status: 200 }));
    const lecteur = new LecteurOcrOllama({ url: 'http://127.0.0.1:11434', modele: 'minicpm-v4.6:1b', fetch });
    await expect(lecteur.lire(encoderPng({ largeur: 1, hauteur: 1, canaux: 1, pixels: Uint8Array.from([255]) }))).rejects.toThrow(
      /^Réponse illisible d’Ollama/
    );
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
    expect(corpus.avis).toEqual(['scan.pdf : 1 page(s) sans texte non examinée(s), au-delà de la limite de 1 pages lues par document.']);
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
