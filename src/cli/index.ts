// Ligne de commande « brd » : le banc de comparaison et l'agent sans interface.
// Lancement : npm run brd -- <commande> [options]

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { rechercher, resumerDocument, trierDocument } from '../coeur/agent/agent';
import { creerProfil } from '../coeur/agent/profils';
import { executerBanc } from '../coeur/banc/executer';
import { chargerJeu, problemesDuJeu } from '../coeur/banc/jeu';
import { nomDuRapport, rapportMarkdown } from '../coeur/banc/rapport';
import { chargerFichierEnv, configurationDepuisEnvironnement } from '../coeur/configuration';
import { diagnostiquer } from '../coeur/diagnostic';
import { extraireTexte, formatDepuisChemin } from '../coeur/extraction/extraction';
import { indexerDossier, passagesDuDocument } from '../coeur/index/corpus';
import { LIBELLES_STATUT, type ProgressionBanc } from '../partage/banc';
import { formaterDuree, formaterNombre, formaterPourcentage, formaterUsd } from '../partage/format';
import { IDS_PROFILS, PROFILS } from '../partage/reglages';
import type { DocumentIndexe, IdProfil, Mesure } from '../partage/types';

const AIDE = `brd : agent de bureau Blow Rapide Décision

Commandes :
  comparer [--jeu <dossier>] [--profils local,hybride,reference] [--sortie <dossier>]
      Fait passer le jeu d’évaluation à chaque mode et écrit le rapport de décision.
  trier <dossier> [--profil <mode>]         Catégorie, action requise et urgence de chaque document.
  chercher <dossier> <requête> [--profil <mode>]
  resumer <fichier> [--profil <mode>]
  diagnostic                                 État d’Ollama, d’OpenRouter et de Jev.

Modes : local (Ollama), hybride (Jev + OpenRouter), reference (sans IA).
Configuration : variables d’environnement ou fichier .env (voir .env.exemple).`;

const ETAPES: Record<ProgressionBanc['etape'], string> = {
  classement: 'classement',
  recherche: 'recherche',
  resume: 'résumés'
};

function lireProfil(valeur: string | undefined, parDefaut: IdProfil): IdProfil {
  if (valeur === undefined) return parDefaut;
  if (!IDS_PROFILS.includes(valeur as IdProfil)) {
    throw new Error(`Mode inconnu « ${valeur} » : choisissez parmi ${IDS_PROFILS.join(', ')}.`);
  }
  return valeur as IdProfil;
}

function bilan(mesures: Mesure[]): string {
  const duree = mesures.reduce((s, m) => s + m.dureeMs, 0);
  const cout = mesures.reduce((s, m) => s + m.coutUsd, 0);
  const envoyes = mesures.filter((m) => m.horsMachine).reduce((s, m) => s + m.caracteresEnvoyes, 0);
  return `Temps moteur ${formaterDuree(duree)} · coût ${formaterUsd(cout)} · ${envoyes} caractères envoyés hors de la machine`;
}

async function commandeComparer(options: { jeu?: string; profils?: string; sortie?: string }): Promise<void> {
  const { reglages, secrets } = configurationDepuisEnvironnement();
  const profils = (options.profils ?? IDS_PROFILS.join(',')).split(',').map((p) => lireProfil(p.trim(), 'local'));
  const jeu = await chargerJeu(resolve(options.jeu ?? 'jeux-evaluation/demo'));
  console.log(`Jeu « ${jeu.nom} » : indexation de ${jeu.dossierDocuments}…`);
  const corpus = await indexerDossier(jeu.dossierDocuments);
  const problemes = problemesDuJeu(jeu, corpus, reglages.classement.categories);
  if (problemes.length) throw new Error(`Jeu incohérent :\n- ${problemes.join('\n- ')}`);

  const interactif = process.stdout.isTTY;
  const resultat = await executerBanc(jeu, corpus, {
    reglages,
    profils,
    fabriquerProfil: (id) => creerProfil(id, { reglages, secrets }),
    surProgression: ({ profil, etape, fait, total }) => {
      const ligne = `[${PROFILS[profil].libelle}] ${ETAPES[etape]} ${fait}/${total}`;
      if (interactif) process.stdout.write(`\r${ligne.padEnd(60)}${fait === total ? '\n' : ''}`);
      else if (fait === total) console.log(ligne);
    }
  });

  const dossierSortie = resolve(options.sortie ?? 'rapports');
  await mkdir(dossierSortie, { recursive: true });
  const base = join(dossierSortie, nomDuRapport(new Date(resultat.date)));
  await writeFile(`${base}.md`, rapportMarkdown(resultat), 'utf8');
  await writeFile(`${base}.json`, `${JSON.stringify(resultat, null, 2)}\n`, 'utf8');

  console.log('');
  for (const p of resultat.profils) {
    const qualite = p.metriques.qualite === null ? '–' : `${formaterNombre(p.metriques.qualite)}/100`;
    const statut = LIBELLES_STATUT[p.statut];
    console.log(`${p.libelle.padEnd(20)} ${statut.padEnd(13)} qualité ${qualite}${p.message ? ` (${p.message})` : ''}`);
  }
  console.log(`\n${resultat.recommandation.titre}`);
  for (const raison of resultat.recommandation.raisons) console.log(`  - ${raison}`);
  for (const avertissement of resultat.recommandation.avertissements) console.log(`  ! ${avertissement}`);
  console.log(`\nRapport : ${base}.md\nDonnées : ${base}.json`);
}

async function commandeTrier(dossier: string, profilId: IdProfil): Promise<void> {
  const { reglages, secrets } = configurationDepuisEnvironnement();
  const profil = creerProfil(profilId, { reglages, secrets });
  const corpus = await indexerDossier(resolve(dossier));
  for (const erreur of corpus.erreurs) console.log(`! ${erreur.chemin} : ${erreur.message}`);
  const mesures: Mesure[] = [];
  for (const document of corpus.documents) {
    const t = await trierDocument(document, profil, reglages);
    mesures.push(...t.mesures);
    const action = t.actionRequise ? 'action' : 'sans action';
    const verifier = t.aVerifier ? ' · à vérifier' : '';
    console.log(`${document.id} → ${t.categorie} (${formaterPourcentage(t.confiance)}) · ${action} · urgence ${t.urgence.toFixed(1)}${verifier}`);
  }
  console.log(`\n${corpus.documents.length} document(s) triés en mode ${profil.libelle}. ${bilan(mesures)}.`);
}

async function commandeChercher(dossier: string, requete: string, profilId: IdProfil): Promise<void> {
  const { reglages, secrets } = configurationDepuisEnvironnement();
  const profil = creerProfil(profilId, { reglages, secrets });
  const corpus = await indexerDossier(resolve(dossier));
  const recherche = await rechercher(corpus, requete, profil, reglages);
  if (!recherche.resultats.length) console.log('Aucun passage ne correspond.');
  recherche.resultats.forEach((r, i) => {
    const extrait = r.passage.texte.replace(/\s+/g, ' ').slice(0, 160);
    console.log(`${i + 1}. ${r.documentNom} · pertinence ${formaterPourcentage(r.pertinence)}\n   ${extrait}…`);
  });
  console.log(`\n${bilan(recherche.mesures)}.`);
}

async function commandeResumer(fichier: string, profilId: IdProfil): Promise<void> {
  const { reglages, secrets } = configurationDepuisEnvironnement();
  const profil = creerProfil(profilId, { reglages, secrets });
  const chemin = resolve(fichier);
  const format = formatDepuisChemin(chemin);
  if (!format) throw new Error('Format non pris en charge : txt, md, pdf ou docx attendu.');
  const texte = await extraireTexte(chemin, format);
  const infos = await stat(chemin);
  const document: DocumentIndexe = {
    id: basename(chemin),
    chemin,
    nom: basename(chemin),
    format,
    taille: infos.size,
    modifieLe: infos.mtime.toISOString(),
    texte,
    passages: passagesDuDocument(basename(chemin), texte)
  };
  const resume = await resumerDocument(document, profil, reglages);
  console.log(`${resume.texte}\n\n${bilan(resume.mesures)}.`);
}

async function commandeDiagnostic(): Promise<void> {
  const { reglages, secrets } = configurationDepuisEnvironnement();
  for (const etat of await diagnostiquer(reglages, secrets)) {
    console.log(`${etat.ok ? '✓' : '✗'} ${etat.service.padEnd(11)} ${etat.detail}`);
  }
}

async function principal(): Promise<void> {
  chargerFichierEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      jeu: { type: 'string' },
      profils: { type: 'string' },
      profil: { type: 'string' },
      sortie: { type: 'string' },
      aide: { type: 'boolean', short: 'h' }
    }
  });
  const [commande, ...args] = positionals;
  const profil = (): IdProfil => lireProfil(values.profil, 'local');
  const exiger = (nombre: number, usage: string): void => {
    if (args.length < nombre) throw new Error(`Usage : brd ${usage}`);
  };
  switch (commande) {
    case 'comparer':
      return commandeComparer(values);
    case 'trier':
      exiger(1, 'trier <dossier>');
      return commandeTrier(args[0] as string, profil());
    case 'chercher':
      exiger(2, 'chercher <dossier> <requête>');
      return commandeChercher(args[0] as string, args.slice(1).join(' '), profil());
    case 'resumer':
      exiger(1, 'resumer <fichier>');
      return commandeResumer(args[0] as string, profil());
    case 'diagnostic':
      return commandeDiagnostic();
    default:
      console.log(AIDE);
      if (commande && commande !== 'aide' && !values.aide) process.exitCode = 1;
  }
}

principal().catch((erreur: unknown) => {
  console.error(`Erreur : ${(erreur as Error).message}`);
  process.exitCode = 1;
});
