// Extraction du texte des documents locaux : texte brut, Markdown, PDF, Word.
// Tout se passe sur la machine, aucun contenu n'est envoyé ailleurs.

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import type { FormatDocument } from '../../partage/types';
import { nettoyerTexte } from '../texte/decoupage';

const FORMATS: Record<string, FormatDocument> = {
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
  '.pdf': 'pdf',
  '.docx': 'docx'
};

/** Extensions prises en charge, avec le point. */
export const EXTENSIONS_PRISES_EN_CHARGE = Object.keys(FORMATS);

export function formatDepuisChemin(chemin: string): FormatDocument | null {
  return FORMATS[extname(chemin).toLowerCase()] ?? null;
}

/** Décode en UTF-8, ou en Windows-1252 pour les vieux fichiers texte français. */
export function decoderTexte(octets: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

async function extrairePdf(octets: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(octets);
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function extraireDocx(octets: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: octets });
  return value;
}

/** Texte nettoyé d'un fichier ; lève une erreur si le format est illisible. */
export async function extraireTexte(chemin: string, format: FormatDocument): Promise<string> {
  const octets = await readFile(chemin);
  switch (format) {
    case 'txt':
    case 'md':
      return nettoyerTexte(decoderTexte(octets));
    case 'pdf':
      return nettoyerTexte(await extrairePdf(new Uint8Array(octets)));
    case 'docx':
      return nettoyerTexte(await extraireDocx(octets));
  }
}
