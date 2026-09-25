// Stockage local de l'application : réglages en clair, clés API chiffrées par
// le système (safeStorage d'Electron, injecté), dernier dossier ouvert.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NomCle } from '../partage/contrat';
import { fusionnerReglages, REGLAGES_PAR_DEFAUT, type Reglages, type ReglagesPartiels, type Secrets } from '../partage/reglages';

/** Chiffrement fourni par le système d'exploitation. */
export interface Chiffreur {
  disponible(): boolean;
  chiffrer(texte: string): Buffer;
  dechiffrer(donnees: Buffer): string;
}

const NOMS_CLES: NomCle[] = ['cleOpenRouter', 'cleTypeSafe'];

export class Stockage {
  readonly dossier: string;
  readonly #chiffreur: Chiffreur;
  #reglages: Reglages;
  #secrets: Secrets;
  #dernierDossier: string | null;

  constructor(dossier: string, chiffreur: Chiffreur) {
    this.dossier = dossier;
    this.#chiffreur = chiffreur;
    mkdirSync(dossier, { recursive: true });
    this.#reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, (this.#lire('reglages.json') ?? {}) as ReglagesPartiels);
    const etat = (this.#lire('etat.json') ?? {}) as { dernierDossier?: unknown };
    this.#dernierDossier = typeof etat.dernierDossier === 'string' ? etat.dernierDossier : null;
    this.#secrets = this.#chargerSecrets();
  }

  #lire(nom: string): unknown {
    try {
      return JSON.parse(readFileSync(join(this.dossier, nom), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Écriture atomique : fichier temporaire puis renommage. */
  #ecrire(nom: string, valeur: unknown): void {
    const chemin = join(this.dossier, nom);
    writeFileSync(`${chemin}.tmp`, `${JSON.stringify(valeur, null, 2)}\n`, 'utf8');
    renameSync(`${chemin}.tmp`, chemin);
  }

  #chargerSecrets(): Secrets {
    const brut = this.#lire('secrets.json') as Partial<Record<NomCle, unknown>> | null;
    if (!brut || !this.#chiffreur.disponible()) return {};
    const secrets: Secrets = {};
    for (const nom of NOMS_CLES) {
      const valeur = brut[nom];
      if (typeof valeur !== 'string') continue;
      try {
        secrets[nom] = this.#chiffreur.dechiffrer(Buffer.from(valeur, 'base64'));
      } catch {
        // Clé chiffrée sur une autre session ou une autre machine : elle est ignorée.
      }
    }
    return secrets;
  }

  get reglages(): Reglages {
    return this.#reglages;
  }

  enregistrerReglages(partiel: ReglagesPartiels): Reglages {
    this.#reglages = fusionnerReglages(this.#reglages, partiel);
    this.#ecrire('reglages.json', this.#reglages);
    return this.#reglages;
  }

  get secrets(): Secrets {
    return { ...this.#secrets };
  }

  get chiffrementDisponible(): boolean {
    return this.#chiffreur.disponible();
  }

  /** Enregistre une clé chiffrée ; une valeur vide la supprime. */
  definirCle(nom: NomCle, valeur: string): void {
    const nette = valeur.trim();
    if (nette && !this.#chiffreur.disponible()) {
      throw new Error(
        "Le chiffrement du système est indisponible : la clé ne peut pas être enregistrée. Définissez-la plutôt dans une variable d’environnement."
      );
    }
    if (nette) this.#secrets[nom] = nette;
    else delete this.#secrets[nom];
    const chiffres = Object.fromEntries(
      Object.entries(this.#secrets).map(([n, v]) => [n, this.#chiffreur.chiffrer(v).toString('base64')])
    );
    this.#ecrire('secrets.json', chiffres);
  }

  get dernierDossier(): string | null {
    return this.#dernierDossier;
  }

  set dernierDossier(chemin: string | null) {
    this.#dernierDossier = chemin;
    this.#ecrire('etat.json', { dernierDossier: chemin });
  }
}
