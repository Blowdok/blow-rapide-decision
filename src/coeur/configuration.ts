// Configuration par variables d'environnement, pour la ligne de commande
// (l'application de bureau garde ses réglages et ses clés chiffrées à part).

import { existsSync } from 'node:fs';
import { type AccesJev, fusionnerReglages, REGLAGES_PAR_DEFAUT, type Reglages, type Secrets } from '../partage/reglages';

/** Charge un fichier `.env` s'il existe (fonction native de Node). */
export function chargerFichierEnv(chemin = '.env'): void {
  if (existsSync(chemin)) process.loadEnvFile(chemin);
}

/** Réglages et secrets lus dans l'environnement, valeurs par défaut sinon. */
export function configurationDepuisEnvironnement(env: NodeJS.ProcessEnv = process.env): {
  reglages: Reglages;
  secrets: Secrets;
} {
  const lire = (nom: string): string | undefined => env[nom]?.trim() || undefined;
  const booleen = (nom: string): boolean | undefined => {
    const valeur = lire(nom)?.toLowerCase();
    if (valeur === undefined) return undefined;
    return ['1', 'oui', 'true', 'vrai'].includes(valeur);
  };
  // Ne garde que les valeurs définies, pour ne pas écraser les défauts.
  const definies = <T extends object>(objet: T): Partial<T> =>
    Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== undefined)) as Partial<T>;

  const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, {
    ollama: definies({
      url: lire('OLLAMA_URL'),
      modeleDecision: lire('BRD_OLLAMA_MODELE_DECISION'),
      modeleResume: lire('BRD_OLLAMA_MODELE_RESUME')
    }),
    openrouter: definies({
      modeleResume: lire('BRD_OPENROUTER_MODELE_RESUME'),
      exigerZdr: booleen('BRD_OPENROUTER_ZDR')
    }),
    jev: definies({
      acces: lire('BRD_JEV_ACCES') as AccesJev | undefined,
      modele: lire('BRD_JEV_MODELE')
    }),
    confidentialite: definies({ masquage: booleen('BRD_MASQUAGE') })
  });

  return {
    reglages,
    secrets: definies({ cleOpenRouter: lire('OPENROUTER_API_KEY'), cleTypeSafe: lire('TYPESAFE_API_KEY') })
  };
}
