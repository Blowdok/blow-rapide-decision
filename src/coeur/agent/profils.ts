// Profils : quel moteur décide et quel moteur rédige, selon le mode choisi.

import { PROFILS, type Reglages, type Secrets } from '../../partage/reglages';
import type { IdProfil } from '../../partage/types';
import { avecMasquageDecision, avecMasquageRedaction } from '../confidentialite/masquage';
import { MoteurJev } from '../moteurs/jev';
import { MoteurDecisionOllama, MoteurRedactionOllama } from '../moteurs/ollama';
import { MoteurRedactionOpenRouter } from '../moteurs/openrouter';
import { MoteurDecisionReference, MoteurRedactionReference } from '../moteurs/reference';
import type { MoteurDecision, MoteurRedaction } from '../moteurs/types';

export interface Profil {
  id: IdProfil;
  libelle: string;
  decision: MoteurDecision;
  redaction: MoteurRedaction;
}

export interface OptionsProfil {
  reglages: Reglages;
  secrets: Secrets;
  /** Implémentation de `fetch` pour tous les moteurs, remplaçable pour les tests. */
  fetch?: typeof fetch;
}

/** Construit les moteurs d'un profil ; lève une erreur si une clé manque. */
export function creerProfil(id: IdProfil, { reglages, secrets, fetch }: OptionsProfil): Profil {
  const libelle = PROFILS[id].libelle;
  const avecFetch = fetch ? { fetch } : {};
  switch (id) {
    case 'local': {
      const commun = { url: reglages.ollama.url, contexte: reglages.ollama.contexte, ...avecFetch };
      return {
        id,
        libelle,
        decision: new MoteurDecisionOllama({ ...commun, modele: reglages.ollama.modeleDecision }),
        redaction: new MoteurRedactionOllama({ ...commun, modele: reglages.ollama.modeleResume })
      };
    }
    case 'hybride': {
      const cleJev = reglages.jev.acces === 'openrouter' ? secrets.cleOpenRouter : secrets.cleTypeSafe;
      const decision = new MoteurJev({
        acces: reglages.jev.acces,
        cle: cleJev ?? '',
        modele: reglages.jev.modele,
        ...avecFetch
      });
      const redaction = new MoteurRedactionOpenRouter({
        cle: secrets.cleOpenRouter ?? '',
        modele: reglages.openrouter.modeleResume,
        refuserCollecte: reglages.openrouter.refuserCollecte,
        exigerZdr: reglages.openrouter.exigerZdr,
        ...avecFetch
      });
      return reglages.confidentialite.masquage
        ? { id, libelle, decision: avecMasquageDecision(decision), redaction: avecMasquageRedaction(redaction) }
        : { id, libelle, decision, redaction };
    }
    case 'reference':
      return { id, libelle, decision: new MoteurDecisionReference(), redaction: new MoteurRedactionReference() };
  }
}
