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
}

/** Page de test : lignes de texte, image pleine page (page scannée), ou les deux. */
export interface PageDeTest {
  lignes?: string[];
  image?: ImageDeTest;
}

/**
 * PDF de plusieurs pages : texte en Helvetica WinAnsi (accents latins
 * compris), image éventuelle étirée sur toute la page comme un scan.
 */
export function creerPdfPages(pages: PageDeTest[]): Buffer {
  // Objets 1 et 2 : catalogue et arbre des pages ; objet 3 : police ; puis 3 objets par page.
  const objets: Buffer[] = [];
  const texte = (t: string): Buffer => Buffer.from(t, 'latin1');
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  objets.push(texte('<< /Type /Catalog /Pages 2 0 R >>'));
  objets.push(texte(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  objets.push(texte('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  pages.forEach((page, i) => {
    const numero = 4 + i * 3;
    const lignes = (page.lignes ?? []).map((ligne) => `(${chainePdf(ligne)}) Tj T*`).join('\n');
    const flux = [
      page.image ? 'q 595 0 0 842 0 0 cm /Im1 Do Q' : '',
      lignes ? `BT\n/F1 12 Tf\n50 800 Td\n16 TL\n${lignes}\nET` : ''
    ]
      .filter(Boolean)
      .join('\n');
    objets.push(
      texte(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${numero + 1} 0 R ` +
          `/Resources << /Font << /F1 3 0 R >>${page.image ? ` /XObject << /Im1 ${numero + 2} 0 R >>` : ''} >> >>`
      )
    );
    objets.push(texte(`<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`));
    const image = page.image;
    const donnees = image ? deflateSync(image.pixels) : Buffer.alloc(0);
    objets.push(
      image
        ? Buffer.concat([
            texte(
              `<< /Type /XObject /Subtype /Image /Width ${image.largeur} /Height ${image.hauteur} ` +
                `/ColorSpace /${image.canaux === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent ${image.bits} ` +
                `/Filter /FlateDecode /Length ${donnees.length} >>\nstream\n`
            ),
            donnees,
            texte('\nendstream')
          ])
        : texte('null')
    );
  });

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
  fin += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${taille}\n%%EOF\n`;
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
