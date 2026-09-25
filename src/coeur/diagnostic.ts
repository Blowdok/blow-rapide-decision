// Diagnostic des services : Ollama pour le mode local, OpenRouter et Jev pour
// le mode hybride. Aucun appel payant n'est fait.

import type { EtatService } from '../partage/contrat';
import { formaterUsd } from '../partage/format';
import type { Reglages, Secrets } from '../partage/reglages';
import { listerModelesJev } from './moteurs/jev';
import { listerModelesOllama } from './moteurs/ollama';
import { verifierCleOpenRouter } from './moteurs/openrouter';

export type { EtatService };

async function etatOllama(reglages: Reglages, fetchFn: typeof fetch): Promise<EtatService> {
  try {
    const installes = await listerModelesOllama(reglages.ollama.url, fetchFn);
    const voulus = [...new Set([reglages.ollama.modeleDecision, reglages.ollama.modeleResume])];
    // Ollama ajoute « :latest » aux noms sans étiquette.
    const present = (nom: string): boolean => installes.includes(nom) || installes.includes(`${nom}:latest`);
    const absents = voulus.filter((nom) => !present(nom));
    if (absents.length) {
      return {
        service: 'Ollama',
        ok: false,
        detail: `Modèle absent : ${absents.map((nom) => `lancez « ollama pull ${nom} »`).join(', ')}.`
      };
    }
    return { service: 'Ollama', ok: true, detail: `Joignable, ${installes.length} modèle(s) installé(s), dont ${voulus.join(' et ')}.` };
  } catch (erreur) {
    return { service: 'Ollama', ok: false, detail: (erreur as Error).message };
  }
}

async function etatOpenRouter(secrets: Secrets, fetchFn: typeof fetch): Promise<EtatService> {
  if (!secrets.cleOpenRouter) {
    return { service: 'OpenRouter', ok: false, detail: 'Clé absente : le mode hybride est indisponible.' };
  }
  try {
    const { creditRestant, consommationMois } = await verifierCleOpenRouter(secrets.cleOpenRouter, fetchFn);
    const credit = creditRestant === null ? 'sans limite de crédit' : `crédit restant ${formaterUsd(creditRestant)}`;
    return { service: 'OpenRouter', ok: true, detail: `Clé valide, ${credit}, ${formaterUsd(consommationMois)} consommés ce mois-ci.` };
  } catch (erreur) {
    return { service: 'OpenRouter', ok: false, detail: (erreur as Error).message };
  }
}

async function etatJev(reglages: Reglages, secrets: Secrets, openRouter: EtatService, fetchFn: typeof fetch): Promise<EtatService> {
  if (reglages.jev.acces === 'openrouter') {
    return {
      service: 'Jev',
      ok: openRouter.ok,
      detail: openRouter.ok
        ? `Accessible par OpenRouter (modèle ${reglages.jev.modele}).`
        : 'Jev passe par OpenRouter : corrigez d’abord la clé OpenRouter.'
    };
  }
  if (!secrets.cleTypeSafe) return { service: 'Jev', ok: false, detail: 'Clé TypeSafe absente pour l’accès direct.' };
  try {
    const modeles = await listerModelesJev(secrets.cleTypeSafe, fetchFn);
    return { service: 'Jev', ok: true, detail: `Accès direct TypeSafe valide, modèles : ${modeles.join(', ') || 'aucun'}.` };
  } catch (erreur) {
    return { service: 'Jev', ok: false, detail: (erreur as Error).message };
  }
}

export async function diagnostiquer(reglages: Reglages, secrets: Secrets, fetchFn: typeof fetch = fetch): Promise<EtatService[]> {
  const [ollama, openRouter] = await Promise.all([etatOllama(reglages, fetchFn), etatOpenRouter(secrets, fetchFn)]);
  return [ollama, openRouter, await etatJev(reglages, secrets, openRouter, fetchFn)];
}
