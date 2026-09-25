// Fabriques de fichiers de test : PDF et DOCX minimaux, dossiers temporaires.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

/** Échappe une chaîne pour un littéral PDF entre parenthèses. */
function chainePdf(texte: string): string {
  return texte.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * PDF d'une page, police standard Helvetica en WinAnsi (accents latins
 * compris), une ligne de texte par élément.
 */
export function creerPdf(lignes: string[]): Buffer {
  const texte = lignes.map((ligne) => `(${chainePdf(ligne)}) Tj T*`).join('\n');
  const flux = `BT\n/F1 12 Tf\n50 800 Td\n16 TL\n${texte}\nET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  let contenu = '%PDF-1.4\n';
  const positions: number[] = [];
  objets.forEach((objet, i) => {
    positions.push(Buffer.byteLength(contenu, 'latin1'));
    contenu += `${i + 1} 0 obj\n${objet}\nendobj\n`;
  });
  const debutXref = Buffer.byteLength(contenu, 'latin1');
  contenu += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const position of positions) contenu += `${String(position).padStart(10, '0')} 00000 n \n`;
  contenu += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`;
  return Buffer.from(contenu, 'latin1');
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
