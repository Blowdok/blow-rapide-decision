// Options locales facultatives, construites depuis les réglages : recherche
// sémantique (modèle de plongement) et lecture des PDF scannés (modèle de
// vision). Désactivées par défaut ; sans elles, l'agent fonctionne comme avant.

import type { Reglages } from '../partage/reglages';
import type { OptionsIndexation } from './index/corpus';
import { LecteurOcrOllama } from './moteurs/ocr';
import { MoteurPlongementOllama } from './moteurs/plongements';
import type { CacheTexte } from './outils/cache';

export interface DependancesOptions {
  fetch?: typeof fetch;
  /** Pages déjà lues par OCR, pour ne pas les relire à chaque indexation. */
  cacheOcr?: CacheTexte;
}

/** Moteurs des options actives, à passer à l'indexation. */
export function optionsFacultatives(
  reglages: Reglages,
  { fetch, cacheOcr }: DependancesOptions = {}
): Pick<OptionsIndexation, 'ocr' | 'plongement'> {
  const commun = { url: reglages.ollama.url, contexte: reglages.ollama.contexte, ...(fetch ? { fetch } : {}) };
  return {
    ...(reglages.ocr.active
      ? {
          ocr: {
            lecteur: new LecteurOcrOllama({ ...commun, modele: reglages.ocr.modele }),
            pagesMax: reglages.ocr.pagesMax,
            ...(cacheOcr ? { cache: cacheOcr } : {})
          }
        }
      : {}),
    ...(reglages.semantique.active ? { plongement: new MoteurPlongementOllama({ ...commun, modele: reglages.semantique.modele }) } : {})
  };
}
