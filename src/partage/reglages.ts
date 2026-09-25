// Réglages de l'agent, valeurs par défaut et fusion. Sans dépendance à Node.

import type { Categorie, IdProfil } from './types';

export type AccesJev = 'openrouter' | 'typesafe';

/** Thème de l'interface : celui du système, ou imposé. */
export type Theme = 'systeme' | 'clair' | 'sombre';

export const THEMES: Record<Theme, string> = { systeme: 'Système', clair: 'Clair', sombre: 'Sombre' };

export interface Reglages {
  /** Mode utilisé par l'application. */
  profil: IdProfil;
  apparence: {
    theme: Theme;
  };
  ollama: {
    url: string;
    modeleDecision: string;
    modeleResume: string;
    /** Taille de contexte demandée aux modèles locaux, en jetons. */
    contexte: number;
  };
  openrouter: {
    modeleResume: string;
    /** Exclut les fournisseurs qui conservent ou réutilisent les requêtes. */
    refuserCollecte: boolean;
    /** N'accepte que des fournisseurs à rétention nulle. */
    exigerZdr: boolean;
  };
  jev: {
    acces: AccesJev;
    modele: string;
  };
  confidentialite: {
    /** Masque les données personnelles avant tout envoi hors de la machine. */
    masquage: boolean;
  };
  classement: {
    categories: Categorie[];
    /** Sous ce seuil de confiance, le document est marqué « à vérifier ». */
    seuilConfiance: number;
    /** Caractères du document soumis à la décision. */
    caracteresMax: number;
  };
  recherche: {
    /** Passages retenus par la recherche lexicale avant la décision de pertinence. */
    candidats: number;
    /** Résultats affichés. */
    resultats: number;
  };
  resume: {
    /** Au-delà, le document est résumé par parties puis synthétisé. */
    caracteresParPartie: number;
    maxJetons: number;
  };
}

export interface Secrets {
  cleOpenRouter?: string;
  cleTypeSafe?: string;
}

export const CATEGORIES_PAR_DEFAUT: Categorie[] = [
  { id: 'facture', libelle: 'Facture', description: 'demande de paiement pour un bien ou un service fourni, note de frais, avis d’échéance.' },
  { id: 'devis', libelle: 'Devis', description: 'proposition commerciale, offre de prix ou bon de commande, avant engagement.' },
  { id: 'contrat', libelle: 'Contrat', description: 'contrat, convention, conditions générales ou avenant qui engage des parties.' },
  { id: 'administratif', libelle: 'Administratif', description: 'courrier d’une administration : impôts, Urssaf, CAF, mairie, assurance maladie, préfecture.' },
  { id: 'banque-assurance', libelle: 'Banque et assurance', description: 'relevé bancaire, prêt, échéancier, attestation ou avis d’assurance.' },
  { id: 'rh', libelle: 'Ressources humaines', description: 'fiche de paie, contrat de travail, candidature, CV, congés, arrêt de travail.' },
  { id: 'compte-rendu', libelle: 'Compte rendu', description: 'compte rendu ou notes de réunion, rapport, procès-verbal.' },
  { id: 'autre', libelle: 'Autre', description: 'document qui n’entre dans aucune autre catégorie.' }
];

export const REGLAGES_PAR_DEFAUT: Reglages = {
  profil: 'local',
  apparence: { theme: 'systeme' },
  ollama: { url: 'http://127.0.0.1:11434', modeleDecision: 'qwen3:8b', modeleResume: 'qwen3:8b', contexte: 8192 },
  openrouter: { modeleResume: '~anthropic/claude-sonnet-latest', refuserCollecte: true, exigerZdr: false },
  jev: { acces: 'openrouter', modele: 'jev-latest' },
  confidentialite: { masquage: true },
  classement: { categories: CATEGORIES_PAR_DEFAUT, seuilConfiance: 0.6, caracteresMax: 6000 },
  recherche: { candidats: 12, resultats: 8 },
  resume: { caracteresParPartie: 12_000, maxJetons: 800 }
};

export const PROFILS: Record<IdProfil, { libelle: string; description: string }> = {
  local: {
    libelle: 'Local',
    description: 'Tout reste sur ce PC : Ollama décide et résume.'
  },
  hybride: {
    libelle: 'Hybride',
    description:
      'Jev décide et un modèle OpenRouter résume ; des extraits partent sur Internet, données personnelles masquées.'
  },
  reference: {
    libelle: 'Référence sans IA',
    description: 'Heuristiques lexicales : point de comparaison, hors ligne et instantané.'
  }
};

export const IDS_PROFILS = Object.keys(PROFILS) as IdProfil[];

export type ReglagesPartiels = {
  [S in keyof Reglages]?: Reglages[S] extends object ? Partial<Reglages[S]> : Reglages[S];
};

const borner = (valeur: number, min: number, max: number): number => Math.min(max, Math.max(min, valeur));

/** Garde la valeur de base si la nouvelle n'est pas un nombre fini (champ vidé, JSON abîmé). */
const fini = (valeur: unknown, base: number): number => (typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : base);

/** Fusionne des réglages partiels dans une base, en bornant les valeurs numériques. */
export function fusionnerReglages(base: Reglages, partiel: ReglagesPartiels = {}): Reglages {
  const r: Reglages = {
    profil: partiel.profil && partiel.profil in PROFILS ? partiel.profil : base.profil,
    apparence: { ...base.apparence, ...partiel.apparence },
    ollama: { ...base.ollama, ...partiel.ollama },
    openrouter: { ...base.openrouter, ...partiel.openrouter },
    jev: { ...base.jev, ...partiel.jev },
    confidentialite: { ...base.confidentialite, ...partiel.confidentialite },
    classement: { ...base.classement, ...partiel.classement },
    recherche: { ...base.recherche, ...partiel.recherche },
    resume: { ...base.resume, ...partiel.resume }
  };
  r.ollama.contexte = Math.round(borner(fini(r.ollama.contexte, base.ollama.contexte), 2048, 262_144));
  r.classement.seuilConfiance = borner(fini(r.classement.seuilConfiance, base.classement.seuilConfiance), 0, 1);
  r.classement.caracteresMax = Math.round(borner(fini(r.classement.caracteresMax, base.classement.caracteresMax), 500, 100_000));
  r.recherche.candidats = Math.round(borner(fini(r.recherche.candidats, base.recherche.candidats), 1, 50));
  r.recherche.resultats = Math.round(borner(fini(r.recherche.resultats, base.recherche.resultats), 1, r.recherche.candidats));
  r.resume.caracteresParPartie = Math.round(
    borner(fini(r.resume.caracteresParPartie, base.resume.caracteresParPartie), 1000, 100_000)
  );
  r.resume.maxJetons = Math.round(borner(fini(r.resume.maxJetons, base.resume.maxJetons), 100, 8000));
  if (r.jev.acces !== 'openrouter' && r.jev.acces !== 'typesafe') r.jev.acces = base.jev.acces;
  if (!(r.apparence.theme in THEMES)) r.apparence.theme = base.apparence.theme;
  // Catégories : identifiant et libellé obligatoires, identifiants uniques.
  const vues = new Set<string>();
  r.classement.categories = r.classement.categories
    .map((c) => ({
      id: String(c.id ?? '').trim(),
      libelle: String(c.libelle ?? '').trim(),
      description: String(c.description ?? '').trim()
    }))
    .filter((c) => c.id && c.libelle && !vues.has(c.id) && vues.add(c.id));
  if (r.classement.categories.length < 2) r.classement.categories = base.classement.categories;
  return r;
}
