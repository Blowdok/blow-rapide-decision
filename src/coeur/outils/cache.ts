// Cache de textes par clé : évite de relire par OCR une page déjà lue.
// En mémoire pour la ligne de commande et les tests, sur disque pour l'application.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CacheTexte {
  lire(cle: string): Promise<string | null>;
  ecrire(cle: string, texte: string): Promise<void>;
}

export class CacheMemoire implements CacheTexte {
  readonly #entrees = new Map<string, string>();

  async lire(cle: string): Promise<string | null> {
    return this.#entrees.get(cle) ?? null;
  }

  async ecrire(cle: string, texte: string): Promise<void> {
    this.#entrees.set(cle, texte);
  }
}

/**
 * Un fichier par entrée, nommé par l'empreinte de la clé : ni le nom ni le
 * chemin des documents n'apparaissent sur le disque. Une entrée illisible est
 * traitée comme absente.
 */
export class CacheFichiers implements CacheTexte {
  readonly #dossier: string;

  constructor(dossier: string) {
    this.#dossier = dossier;
  }

  #chemin(cle: string): string {
    return join(this.#dossier, `${createHash('sha256').update(cle).digest('hex')}.txt`);
  }

  async lire(cle: string): Promise<string | null> {
    try {
      return await readFile(this.#chemin(cle), 'utf8');
    } catch {
      return null;
    }
  }

  async ecrire(cle: string, texte: string): Promise<void> {
    await mkdir(this.#dossier, { recursive: true });
    const chemin = this.#chemin(cle);
    // Écriture puis renommage : une coupure ne laisse pas d'entrée tronquée.
    const provisoire = `${chemin}.${process.pid}.tmp`;
    await writeFile(provisoire, texte, 'utf8');
    await rename(provisoire, chemin);
  }
}
