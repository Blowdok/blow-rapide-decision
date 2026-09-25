// L'agent : trier, rechercher et résumer des documents avec le profil choisi.

import type { Reglages } from '../../partage/reglages';
import type { DocumentIndexe, Mesure, Recherche, ResultatRecherche, Resume, Triage } from '../../partage/types';
import { type Corpus, trouverCandidats } from '../index/corpus';
import { ErreurMoteur, lireChoix, lireNote, lireOuiNon, type OptionsAppel } from '../moteurs/types';
import { executerParLots } from '../outils/concurrence';
import { decouperEnPassages } from '../texte/decoupage';
import type { Profil } from './profils';
import { promptNotesPartie, promptResume, promptSynthese, SYSTEME_RESUME } from './prompts';
import { questionPertinence, questionsTriage } from './questions';

/** Appels simultanés : plusieurs pour un service distant, un seul pour un modèle local. */
const parallelisme = (horsMachine: boolean, distant: number): number => (horsMachine ? distant : 1);

/** Triage d'un document : catégorie, action requise et urgence, en un seul appel de décision. */
export async function trierDocument(
  document: DocumentIndexe,
  profil: Profil,
  reglages: Reglages,
  options: OptionsAppel = {}
): Promise<Triage> {
  const etat = { fichier: document.nom, extrait: document.texte.slice(0, reglages.classement.caracteresMax) };
  const { reponses, mesure } = await profil.decision.decider(etat, questionsTriage(reglages.classement.categories), options);
  const categorie = lireChoix(reponses, 'categorie');
  const action = lireOuiNon(reponses, 'action');
  const urgence = lireNote(reponses, 'urgence');
  return {
    documentId: document.id,
    profil: profil.id,
    categorie: categorie.choix,
    confiance: categorie.confiance,
    probabilites: categorie.probabilites,
    actionRequise: action.probabiliteOui >= 0.5,
    probabiliteAction: action.probabiliteOui,
    urgence: urgence.note,
    aVerifier: categorie.confiance < reglages.classement.seuilConfiance,
    mesures: [mesure]
  };
}

/**
 * Recherche en deux temps : l'index propose des passages (BM25, et en option
 * la recherche sémantique), puis le moteur de décision juge la pertinence de
 * chacun ; le classement final suit cette probabilité.
 */
export async function rechercher(
  corpus: Corpus,
  requete: string,
  profil: Profil,
  reglages: Reglages,
  options: OptionsAppel = {}
): Promise<Recherche> {
  const trouves = await trouverCandidats(corpus, requete, reglages.recherche.candidats, {
    semantique: reglages.semantique.active,
    modele: reglages.semantique.modele,
    ...(options.signal ? { signal: options.signal } : {})
  });
  const noms = new Map(corpus.documents.map((d) => [d.id, d.nom]));
  const question = questionPertinence(requete);
  const juges = await executerParLots(trouves.candidats, parallelisme(profil.decision.horsMachine, 4), async (candidat) => {
    const documentNom = noms.get(candidat.passage.documentId) ?? candidat.passage.documentId;
    const { reponses, mesure } = await profil.decision.decider(
      { document: documentNom, passage: candidat.passage.texte },
      { pertinence: question },
      options
    );
    const resultat: ResultatRecherche = {
      passage: candidat.passage,
      documentNom,
      rangLexical: candidat.rangLexical,
      rangSemantique: candidat.rangSemantique,
      pertinence: lireOuiNon(reponses, 'pertinence').probabiliteOui
    };
    return { resultat, mesure };
  });

  // Tri stable : à pertinence égale, l'ordre proposé par l'index départage.
  const resultats = juges.map((j) => j.resultat).sort((a, b) => (b.pertinence ?? 0) - (a.pertinence ?? 0));

  return {
    requete,
    profil: profil.id,
    modelePlongement: trouves.modelePlongement,
    ...(trouves.avis ? { avis: trouves.avis } : {}),
    resultats: resultats.slice(0, reglages.recherche.resultats),
    mesures: [...trouves.mesures, ...juges.map((j) => j.mesure)]
  };
}

/** Résumé d'un document ; au-delà d'une partie, résumé par parties puis synthèse. */
export async function resumerDocument(
  document: DocumentIndexe,
  profil: Profil,
  reglages: Reglages,
  options: OptionsAppel = {}
): Promise<Resume> {
  const parties = decouperEnPassages(document.texte, reglages.resume.caracteresParPartie);
  if (parties.length === 0) throw new ErreurMoteur('Document vide : rien à résumer.');
  const appel = { ...options, maxJetons: reglages.resume.maxJetons };
  const mesures: Mesure[] = [];

  if (parties.length === 1) {
    const { texte, mesure } = await profil.redaction.rediger(
      { systeme: SYSTEME_RESUME, utilisateur: promptResume(document.nom, document.texte), source: document.texte },
      appel
    );
    return { documentId: document.id, profil: profil.id, texte, parties: 1, mesures: [mesure] };
  }

  const notes = await executerParLots(parties, parallelisme(profil.redaction.horsMachine, 3), (partie, i) =>
    profil.redaction.rediger(
      { systeme: SYSTEME_RESUME, utilisateur: promptNotesPartie(document.nom, i + 1, parties.length, partie), source: partie },
      appel
    )
  );
  mesures.push(...notes.map((n) => n.mesure));
  const toutesLesNotes = notes.map((n, i) => `Partie ${i + 1} :\n${n.texte}`).join('\n\n');
  const synthese = await profil.redaction.rediger(
    { systeme: SYSTEME_RESUME, utilisateur: promptSynthese(document.nom, toutesLesNotes), source: toutesLesNotes },
    appel
  );
  mesures.push(synthese.mesure);
  return { documentId: document.id, profil: profil.id, texte: synthese.texte, parties: parties.length, mesures };
}
