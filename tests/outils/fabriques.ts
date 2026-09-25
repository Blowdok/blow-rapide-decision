// Fabriques de fichiers de test : PDF et DOCX minimaux, dossiers temporaires.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';

/** Échappe une chaîne pour un littéral PDF entre parenthèses. */
function chainePdf(texte: string): string {
  return texte.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Image d'une page de test : pixels bruts, 1 bit (1 = blanc) ou 8 bits par canal. */
export interface ImageDeTest {
  largeur: number;
  hauteur: number;
  bits: 1 | 8;
  canaux: 1 | 3;
  pixels: Buffer;
  /** Masque d'image (/ImageMask) : 0 peint l'encre, 1 laisse voir le fond. */
  masque?: boolean;
}

/** Page de test : lignes de texte, images (scan pleine page ou posées), rotation. */
export interface PageDeTest {
  lignes?: string[];
  /** Image étirée sur toute la page, comme un scan. */
  image?: ImageDeTest;
  /** Images posées dans un rectangle [x, y, largeur, hauteur], en points, origine en bas à gauche. */
  images?: Array<{ image: ImageDeTest; rectangle: [number, number, number, number] }>;
  /** Rotation de la page à l'affichage, en degrés. */
  rotation?: 0 | 90 | 180 | 270;
}

/**
 * PDF de plusieurs pages A4 : texte en Helvetica WinAnsi (accents latins
 * compris), images posées comme dans un scan.
 */
export function creerPdfPages(pages: PageDeTest[]): Buffer {
  const texte = (t: string): Buffer => Buffer.from(t, 'latin1');
  // Objet n° i + 1 ; les numéros sont réservés avant d'être remplis.
  const objets: Buffer[] = [];
  const reserver = (): number => objets.push(Buffer.alloc(0));
  const definir = (numero: number, contenu: Buffer): void => {
    objets[numero - 1] = contenu;
  };
  const catalogue = reserver();
  const arbre = reserver();
  const police = reserver();
  const numerosPages = pages.map(() => reserver());

  pages.forEach((page, i) => {
    const posees = [
      ...(page.image ? [{ image: page.image, rectangle: [0, 0, 595, 842] as [number, number, number, number] }] : []),
      ...(page.images ?? [])
    ];
    const numerosImages = posees.map(() => reserver());
    const numeroContenu = reserver();
    posees.forEach(({ image }, j) => {
      const donnees = deflateSync(image.pixels);
      const couleur = image.masque
        ? '/ImageMask true'
        : `/ColorSpace /${image.canaux === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent ${image.bits}`;
      definir(
        numerosImages[j] as number,
        Buffer.concat([
          texte(
            `<< /Type /XObject /Subtype /Image /Width ${image.largeur} /Height ${image.hauteur} ${couleur} ` +
              `/Filter /FlateDecode /Length ${donnees.length} >>\nstream\n`
          ),
          donnees,
          texte('\nendstream')
        ])
      );
    });
    const lignes = (page.lignes ?? []).map((ligne) => `(${chainePdf(ligne)}) Tj T*`).join('\n');
    const flux = [
      ...posees.map(({ image, rectangle: [x, y, l, h] }, j) => `q ${image.masque ? '0 g ' : ''}${l} 0 0 ${h} ${x} ${y} cm /Im${j} Do Q`),
      lignes ? `BT\n/F1 12 Tf\n50 800 Td\n16 TL\n${lignes}\nET` : ''
    ]
      .filter(Boolean)
      .join('\n');
    definir(numeroContenu, texte(`<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`));
    const xobjets = numerosImages.map((n, j) => `/Im${j} ${n} 0 R`).join(' ');
    definir(
      numerosPages[i] as number,
      texte(
        `<< /Type /Page /Parent ${arbre} 0 R /MediaBox [0 0 595 842]${page.rotation ? ` /Rotate ${page.rotation}` : ''} ` +
          `/Contents ${numeroContenu} 0 R /Resources << /Font << /F1 ${police} 0 R >>${xobjets ? ` /XObject << ${xobjets} >>` : ''} >> >>`
      )
    );
  });
  definir(catalogue, texte(`<< /Type /Catalog /Pages ${arbre} 0 R >>`));
  definir(arbre, texte(`<< /Type /Pages /Kids [${numerosPages.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  definir(police, texte('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));

  const morceaux: Buffer[] = [texte('%PDF-1.4\n')];
  let taille = morceaux[0]?.length ?? 0;
  const positions: number[] = [];
  objets.forEach((objet, i) => {
    positions.push(taille);
    for (const morceau of [texte(`${i + 1} 0 obj\n`), objet, texte('\nendobj\n')]) {
      morceaux.push(morceau);
      taille += morceau.length;
    }
  });
  let fin = `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const position of positions) fin += `${String(position).padStart(10, '0')} 00000 n \n`;
  fin += `trailer\n<< /Size ${objets.length + 1} /Root ${catalogue} 0 R >>\nstartxref\n${taille}\n%%EOF\n`;
  morceaux.push(texte(fin));
  return Buffer.concat(morceaux);
}

/** PDF d'une page, une ligne de texte par élément. */
export function creerPdf(lignes: string[]): Buffer {
  return creerPdfPages([{ lignes }]);
}

/** Image d'une page scannée en noir et blanc (1 bit par pixel) : un bandeau noir sur fond blanc. */
export function imageScannee(largeur = 420, hauteur = 594): ImageDeTest {
  const octetsParLigne = (largeur + 7) >> 3;
  const pixels = Buffer.alloc(octetsParLigne * hauteur, 0xff);
  for (let y = 40; y < 60; y++) pixels.fill(0x00, y * octetsParLigne, (y + 1) * octetsParLigne);
  return { largeur, hauteur, bits: 1, canaux: 1, pixels };
}

/** Image unie en niveaux de gris (8 bits), de la valeur donnée (0 noir, 255 blanc). */
export function imageUnie(largeur: number, hauteur: number, gris: number): ImageDeTest {
  return { largeur, hauteur, bits: 8, canaux: 1, pixels: Buffer.alloc(largeur * hauteur, gris) };
}

function echapperXml(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Document Word minimal, un paragraphe par élément. */
export async function creerDocx(paragraphes: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const corps = paragraphes.map((p) => `<w:p><w:r><w:t xml:space="preserve">${echapperXml(p)}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corps}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Dossier temporaire supprimé par la fonction de nettoyage renvoyée. */
export async function dossierTemporaire(): Promise<{ chemin: string; nettoyer: () => Promise<void> }> {
  const chemin = await mkdtemp(join(tmpdir(), 'brd-test-'));
  return { chemin, nettoyer: () => rm(chemin, { recursive: true, force: true }) };
}
