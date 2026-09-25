// Chargement et vérification d'un jeu d'évaluation (dossier + jeu.json).

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AttenteClassement, AttenteRecherche, AttenteResume, JeuEvaluation } from '../../partage/banc';
import type { Categorie } from '../../partage/types';
import type { Corpus } from '../index/corpus';

export class ErreurJeu extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErreurJeu';
  }
}

const estTexte = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function tableau(valeur: unknown, nom: string): unknown[] {
  if (valeur === undefined) return [];
  if (!Array.isArray(valeur)) throw new ErreurJeu(`« ${nom} » doit être une liste.`);
  return valeur;
}

function lireClassement(brut: unknown, i: number): AttenteClassement {
  const e = brut as Record<string, unknown>;
  if (!estTexte(e?.document) || !estTexte(e.categorie)) {
    throw new ErreurJeu(`classement[${i}] : « document » et « categorie » sont obligatoires.`);
  }
  if (e.action !== undefined && typeof e.action !== 'boolean') {
    throw new ErreurJeu(`classement[${i}] : « action » doit valoir true ou false.`);
  }
  if (e.urgence !== undefined && ![0, 1, 2].includes(e.urgence as number)) {
    throw new ErreurJeu(`classement[${i}] : « urgence » doit valoir 0, 1 ou 2.`);
  }
  return {
    document: e.document,
    categorie: e.categorie,
    ...(e.action !== undefined ? { action: e.action as boolean } : {}),
    ...(e.urgence !== undefined ? { urgence: e.urgence as number } : {})
  };
}

function lireRecherche(brut: unknown, i: number): AttenteRecherche {
  const e = brut as Record<string, unknown>;
  const pertinents = e?.pertinents;
  if (!estTexte(e?.requete) || !Array.isArray(pertinents) || pertinents.length === 0 || !pertinents.every(estTexte)) {
    throw new ErreurJeu(`recherche[${i}] : « requete » et une liste « pertinents » non vide sont obligatoires.`);
  }
  return { requete: e.requete, pertinents };
}

function lireResume(brut: unknown, i: number): AttenteResume {
  const e = brut as Record<string, unknown>;
  const faits = e?.faits;
  const faitsValides =
    Array.isArray(faits) && faits.length > 0 && faits.every((f) => Array.isArray(f) && f.length > 0 && f.every(estTexte));
  if (!estTexte(e?.document) || !faitsValides) {
    throw new ErreurJeu(`resume[${i}] : « document » et « faits » (listes de variantes) sont obligatoires.`);
  }
  return { document: e.document, faits: faits as string[][] };
}

/** Lit `jeu.json` dans le dossier donné et vérifie sa forme. */
export async function chargerJeu(dossier: string): Promise<JeuEvaluation> {
  const chemin = join(dossier, 'jeu.json');
  let brut: Record<string, unknown>;
  try {
    brut = JSON.parse(await readFile(chemin, 'utf8')) as Record<string, unknown>;
  } catch (erreur) {
    throw new ErreurJeu(`Lecture impossible de ${chemin} : ${(erreur as Error).message}`, { cause: erreur });
  }
  const criteres = (brut.criteres ?? {}) as Record<string, unknown>;
  const tolerance = criteres.toleranceQualite ?? 5;
  if (typeof tolerance !== 'number' || tolerance < 0 || tolerance > 100) {
    throw new ErreurJeu('« criteres.toleranceQualite » doit être un nombre entre 0 et 100.');
  }
  const jeu: JeuEvaluation = {
    nom: estTexte(brut.nom) ? brut.nom : 'Jeu sans nom',
    description: estTexte(brut.description) ? brut.description : '',
    dossierDocuments: resolve(dossier, estTexte(brut.documents) ? brut.documents : 'documents'),
    classement: tableau(brut.classement, 'classement').map(lireClassement),
    recherche: tableau(brut.recherche, 'recherche').map(lireRecherche),
    resume: tableau(brut.resume, 'resume').map(lireResume),
    criteres: { toleranceQualite: tolerance }
  };
  if (jeu.classement.length + jeu.recherche.length + jeu.resume.length === 0) {
    throw new ErreurJeu('Le jeu ne contient aucune attente : rien à évaluer.');
  }
  return jeu;
}

/** Incohérences entre le jeu, les documents indexés et les catégories réglées. */
export function problemesDuJeu(jeu: JeuEvaluation, corpus: Corpus, categories: readonly Categorie[]): string[] {
  const documents = new Set(corpus.documents.map((d) => d.id));
  const connues = new Set(categories.map((c) => c.id));
  const problemes: string[] = [];
  const verifierDocument = (id: string, ou: string): void => {
    if (!documents.has(id)) problemes.push(`${ou} : document « ${id} » introuvable ou illisible.`);
  };
  jeu.classement.forEach((a, i) => {
    verifierDocument(a.document, `classement[${i}]`);
    if (!connues.has(a.categorie)) problemes.push(`classement[${i}] : catégorie « ${a.categorie} » absente des réglages.`);
  });
  jeu.recherche.forEach((a, i) => a.pertinents.forEach((id) => verifierDocument(id, `recherche[${i}]`)));
  jeu.resume.forEach((a, i) => verifierDocument(a.document, `resume[${i}]`));
  return problemes;
}
