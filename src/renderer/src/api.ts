// Accès typé à l'API exposée par le preload.

import type { ApiBureau } from '../../partage/contrat';

declare global {
  interface Window {
    brd: ApiBureau;
  }
}

export const api: ApiBureau = window.brd;

export function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
