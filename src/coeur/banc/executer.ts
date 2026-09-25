// Exécution du banc : chaque mode passe le même jeu d'évaluation, avec les
// mêmes questions et les mêmes documents ; seuls les moteurs changent.

import type {
  JeuEvaluation,
  ProgressionBanc,
  ResultatBanc,
  ResultatClassement,
  ResultatProfil,
  ResultatRechercheBanc,
  ResultatResumeBanc,
  SemantiqueBanc
} from '../../partage/banc';
import { TIRET } from '../../partage/format';
import { PROFILS, type Reglages } from '../../partage/reglages';
import type { DocumentIndexe, IdProfil, Mesure } from '../../partage/types';
import { rechercher, resumerDocument, trierDocument } from '../agent/agent';
import type { Profil } from '../agent/profils';
import { chercherPassages, type Corpus, trouverCandidats } from '../index/corpus';
import { depuis } from '../moteurs/types';
import { executerParLots } from '../outils/concurrence';
import { ErreurJeu } from './jeu';
import { calculerMetriques, evaluerFaits, rangDuPremierPertinent } from './metriques';
import { recommander } from './recommandation';

export interface OptionsBanc {
  reglages: Reglages;
  profils: IdProfil[];
  /** Construit les moteurs d'un profil ; une erreur rend le profil indisponible. */
  fabriquerProfil: (id: IdProfil) => Profil;
  surProgression?: (progression: ProgressionBanc) => void;
  signal?: AbortSignal;
  maintenant?: () => Date;
}

/** Échecs consécutifs, sans aucun succès, qui interrompent un mode (serveur éteint, clé refusée…). */
export const ECHECS_AVANT_ARRET = 3;

class Garde {
  succes = 0;
  echecs = 0;
  derniereErreur = '';

  get interrompu(): boolean {
    return this.succes === 0 && this.echecs >= ECHECS_AVANT_ARRET;
  }
}

type Evaluation<T> = { valeur: T; dureeMs: number } | { erreur: string; dureeMs: number };

async function evaluer<T>(garde: Garde, signal: AbortSignal | undefined, tache: () => Promise<T>): Promise<Evaluation<T>> {
  if (garde.interrompu) return { erreur: 'Non évalué : mode interrompu après plusieurs échecs.', dureeMs: 0 };
  signal?.throwIfAborted();
  const debut = performance.now();
  try {
    const valeur = await tache();
    garde.succes++;
    return { valeur, dureeMs: depuis(debut) };
  } catch (erreur) {
    if (signal?.aborted) throw erreur;
    garde.echecs++;
    garde.derniereErreur = (erreur as Error).message;
    return { erreur: garde.derniereErreur, dureeMs: depuis(debut) };
  }
}

const coutDe = (mesures: Mesure[]): number => mesures.reduce((somme, m) => somme + m.coutUsd, 0);
const uniques = (ids: string[]): string[] => [...new Set(ids)];

function documentDuJeu(documents: Map<string, DocumentIndexe>, id: string): DocumentIndexe {
  const document = documents.get(id);
  if (!document) throw new ErreurJeu(`Document « ${id} » absent du dossier indexé.`);
  return document;
}

async function executerProfil(id: IdProfil, jeu: JeuEvaluation, corpus: Corpus, options: OptionsBanc): Promise<ResultatProfil> {
  const { reglages, signal } = options;
  const libelle = PROFILS[id].libelle;
  let profil: Profil;
  try {
    profil = options.fabriquerProfil(id);
  } catch (erreur) {
    return {
      profil: id,
      libelle,
      moteurs: { decision: TIRET, redaction: TIRET },
      statut: 'indisponible',
      message: (erreur as Error).message,
      classement: [],
      recherche: [],
      resume: [],
      mesures: [],
      metriques: calculerMetriques([], [], [], [], 0)
    };
  }

  const documents = new Map(corpus.documents.map((d) => [d.id, d]));
  const garde = new Garde();
  const mesures: Mesure[] = [];
  const parallele = profil.decision.horsMachine ? 4 : 1;
  const debut = performance.now();
  const progression = (etape: ProgressionBanc['etape'], total: number): (() => void) => {
    let fait = 0;
    return () => options.surProgression?.({ profil: id, etape, fait: ++fait, total });
  };

  const avancerClassement = progression('classement', jeu.classement.length);
  const classement = await executerParLots(jeu.classement, parallele, async (attendu): Promise<ResultatClassement> => {
    const r = await evaluer(garde, signal, () =>
      trierDocument(documentDuJeu(documents, attendu.document), profil, reglages, signal ? { signal } : {})
    );
    avancerClassement();
    if ('erreur' in r) return { attendu, dureeMs: r.dureeMs, coutUsd: 0, erreur: r.erreur };
    const triage = r.valeur;
    mesures.push(...triage.mesures);
    return {
      attendu,
      obtenu: {
        categorie: triage.categorie,
        confiance: triage.confiance,
        probabiliteAction: triage.probabiliteAction,
        urgence: triage.urgence,
        aVerifier: triage.aVerifier
      },
      categorieJuste: triage.categorie === attendu.categorie,
      ...(attendu.action !== undefined ? { actionJuste: triage.actionRequise === attendu.action } : {}),
      ...(attendu.urgence !== undefined ? { urgenceJuste: Math.round(triage.urgence) === attendu.urgence } : {}),
      dureeMs: r.dureeMs,
      coutUsd: coutDe(triage.mesures)
    };
  });

  // Une recherche parallélise déjà ses décisions : les requêtes passent une à une.
  const avancerRecherche = progression('recherche', jeu.recherche.length);
  const recherche = await executerParLots(jeu.recherche, 1, async (attente): Promise<ResultatRechercheBanc> => {
    const r = await evaluer(garde, signal, () =>
      rechercher(corpus, attente.requete, profil, reglages, signal ? { signal } : {})
    );
    avancerRecherche();
    const base = { requete: attente.requete, pertinents: attente.pertinents };
    if ('erreur' in r) return { ...base, documentsObtenus: [], rangPertinent: null, dureeMs: r.dureeMs, coutUsd: 0, erreur: r.erreur };
    mesures.push(...r.valeur.mesures);
    const documentsObtenus = uniques(r.valeur.resultats.map((x) => x.passage.documentId));
    return {
      ...base,
      documentsObtenus,
      rangPertinent: rangDuPremierPertinent(documentsObtenus, attente.pertinents),
      dureeMs: r.dureeMs,
      coutUsd: coutDe(r.valeur.mesures)
    };
  });

  const avancerResume = progression('resume', jeu.resume.length);
  const resume = await executerParLots(jeu.resume, parallele > 1 ? 2 : 1, async (attente): Promise<ResultatResumeBanc> => {
    const r = await evaluer(garde, signal, () =>
      resumerDocument(documentDuJeu(documents, attente.document), profil, reglages, signal ? { signal } : {})
    );
    avancerResume();
    const base = { document: attente.document, faitsTotal: attente.faits.length };
    if ('erreur' in r) {
      return {
        ...base,
        faitsTrouves: 0,
        faitsManquants: attente.faits.map((f) => f[0] ?? ''),
        mots: 0,
        dureeMs: r.dureeMs,
        coutUsd: 0,
        erreur: r.erreur
      };
    }
    mesures.push(...r.valeur.mesures);
    const { trouves, manquants } = evaluerFaits(r.valeur.texte, attente.faits);
    return {
      ...base,
      texte: r.valeur.texte,
      faitsTrouves: trouves,
      faitsManquants: manquants,
      mots: r.valeur.texte.split(/\s+/).filter(Boolean).length,
      dureeMs: r.dureeMs,
      coutUsd: coutDe(r.valeur.mesures)
    };
  });

  const erreurs = [...classement, ...recherche, ...resume].filter((e) => e.erreur).length;
  // Un mode interrompu n'a rien réussi : son indice de qualité n'aurait pas de sens.
  const metriques = calculerMetriques(classement, recherche, resume, mesures, depuis(debut));
  return {
    profil: id,
    libelle,
    moteurs: {
      decision: `${profil.decision.nom} (${profil.decision.modele})`,
      redaction: `${profil.redaction.nom} (${profil.redaction.modele})`
    },
    statut: garde.interrompu ? 'interrompu' : 'termine',
    ...(garde.interrompu
      ? { message: garde.derniereErreur }
      : erreurs
        ? { message: `${erreurs} élément(s) en erreur ; dernière erreur : ${garde.derniereErreur}` }
        : {}),
    classement,
    recherche,
    resume,
    mesures,
    metriques: garde.interrompu ? { ...metriques, qualite: null } : metriques
  };
}

/**
 * Classement par BM25 et recherche sémantique fusionnés, sans décision : ce
 * que la recherche sémantique (option) apporte, indépendamment des modes.
 */
async function rechercheFusionnee(jeu: JeuEvaluation, corpus: Corpus, options: OptionsBanc): Promise<SemantiqueBanc> {
  const semantique = corpus.semantique;
  if (semantique?.etat !== 'pret') {
    return {
      modele: null,
      avis: semantique?.etat === 'echec' ? semantique.message : 'index sémantique absent du corpus.',
      recherche: []
    };
  }
  const recherche = await executerParLots(jeu.recherche, 1, async (attente): Promise<ResultatRechercheBanc> => {
    options.signal?.throwIfAborted();
    const debut = performance.now();
    const trouves = await trouverCandidats(corpus, attente.requete, options.reglages.recherche.resultats, {
      semantique: true,
      ...(options.signal ? { signal: options.signal } : {})
    });
    const documentsObtenus = uniques(trouves.candidats.map((c) => c.passage.documentId));
    return {
      requete: attente.requete,
      pertinents: attente.pertinents,
      // Repli sur BM25 seul : la requête compte comme une erreur de la recherche fusionnée.
      ...(trouves.modelePlongement
        ? { documentsObtenus, rangPertinent: rangDuPremierPertinent(documentsObtenus, attente.pertinents) }
        : { documentsObtenus: [], rangPertinent: null, erreur: trouves.avis ?? 'Recherche sémantique indisponible.' }),
      dureeMs: depuis(debut),
      coutUsd: 0
    };
  });
  return { modele: semantique.modele, recherche };
}

/** Fait passer le jeu à chaque profil demandé, puis établit la recommandation. */
export async function executerBanc(jeu: JeuEvaluation, corpus: Corpus, options: OptionsBanc): Promise<ResultatBanc> {
  const { reglages } = options;
  const rechercheLexicale: ResultatRechercheBanc[] = jeu.recherche.map((attente) => {
    const debut = performance.now();
    const documentsObtenus = uniques(
      chercherPassages(corpus, attente.requete, reglages.recherche.resultats).map((c) => c.passage.documentId)
    );
    return {
      requete: attente.requete,
      pertinents: attente.pertinents,
      documentsObtenus,
      rangPertinent: rangDuPremierPertinent(documentsObtenus, attente.pertinents),
      dureeMs: depuis(debut),
      coutUsd: 0
    };
  });
  const semantique = reglages.semantique.active ? await rechercheFusionnee(jeu, corpus, options) : undefined;

  const profils: ResultatProfil[] = [];
  // Les modes passent l'un après l'autre pour ne pas fausser les temps mesurés.
  for (const id of options.profils) {
    options.signal?.throwIfAborted();
    profils.push(await executerProfil(id, jeu, corpus, options));
  }

  return {
    jeu: { nom: jeu.nom, description: jeu.description, documents: corpus.documents.length },
    date: (options.maintenant?.() ?? new Date()).toISOString(),
    toleranceQualite: jeu.criteres.toleranceQualite,
    rechercheLexicale,
    ...(semantique ? { semantique } : {}),
    profils,
    recommandation: recommander(profils, jeu.criteres.toleranceQualite, corpus.documents.length)
  };
}
