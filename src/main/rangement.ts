import { constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface FichierClasse {
  cheminSource: string;
  /** Chemin relatif au dossier indexé, séparateurs `/`. */
  cheminRelatif: string;
  categorie: string;
  taille: number;
  modifieLe: string;
}

export interface OptionsCopieClassement {
  dossierSource: string;
  parentDestination: string;
  fichiers: FichierClasse[];
  rapportCsv?: string;
}

export interface ResultatCopieClassement {
  dossierDestination: string;
  fichiersCopies: number;
}

function estDans(dossier: string, chemin: string): boolean {
  const relatif = relative(dossier, chemin);
  return relatif === '' || (relatif !== '..' && !relatif.startsWith(`..${sep}`) && !isAbsolute(relatif));
}

function segmentSecurise(valeur: string, nom: string): string {
  const segment = valeur
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  if (!segment || segment === '.' || segment === '..') throw new Error(`Nom de ${nom} invalide.`);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ? `_${segment}` : segment;
}

function segmentsRelatifs(chemin: string): string[] {
  const segments = chemin.split('/');
  if (
    !chemin ||
    isAbsolute(chemin) ||
    chemin.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Chemin relatif invalide : « ${chemin} ».`);
  }
  return segments;
}

/** Copie les documents vers un nouveau dossier, sans jamais remplacer ni déplacer les originaux. */
export async function copierFichiersClasses(options: OptionsCopieClassement): Promise<ResultatCopieClassement> {
  if (options.fichiers.length === 0) throw new Error('Aucun document à copier.');

  const dossierSource = await realpath(options.dossierSource);
  const parentDestination = await realpath(options.parentDestination);
  const infosParent = await stat(parentDestination);
  if (!infosParent.isDirectory()) throw new Error('Choisissez un dossier de destination.');

  const nomSortie = `${segmentSecurise(basename(dossierSource), 'dossier source')} - classé`;
  const dossierDestination = resolve(parentDestination, nomSortie);
  if (estDans(dossierSource, dossierDestination)) {
    throw new Error('Choisissez un dossier de destination situé à l’extérieur du dossier source.');
  }

  const plans = [] as { source: string; destination: string; taille: number; modifieLe: string }[];
  const destinations = new Set<string>();
  for (const fichier of options.fichiers) {
    const segments = segmentsRelatifs(fichier.cheminRelatif);
    const source = await realpath(fichier.cheminSource);
    const relatifReel = relative(dossierSource, source);
    if (!estDans(dossierSource, source) || relatifReel.split(sep).join('/') !== fichier.cheminRelatif) {
      throw new Error(`Le fichier « ${fichier.cheminRelatif} » ne se trouve plus dans le dossier source.`);
    }

    const entree = await lstat(fichier.cheminSource);
    if (!entree.isFile() || entree.isSymbolicLink()) {
      throw new Error(`Le fichier « ${fichier.cheminRelatif} » est devenu un lien ou n’est plus un fichier normal.`);
    }
    const infos = await stat(source);
    if (infos.size !== fichier.taille || infos.mtime.toISOString() !== fichier.modifieLe) {
      throw new Error(`Le fichier « ${fichier.cheminRelatif} » a été modifié depuis son classement. Actualisez le dossier.`);
    }

    const categorie = segmentSecurise(fichier.categorie, 'catégorie');
    const destination = resolve(dossierDestination, categorie, ...segments);
    if (!estDans(dossierDestination, destination)) throw new Error(`Destination invalide pour « ${fichier.cheminRelatif} ».`);
    const cleDestination = process.platform === 'win32' ? destination.toLocaleLowerCase('en-US') : destination;
    if (destinations.has(cleDestination)) throw new Error(`Deux documents visent le même emplacement : « ${fichier.cheminRelatif} ».`);
    destinations.add(cleDestination);
    plans.push({ source, destination, taille: fichier.taille, modifieLe: fichier.modifieLe });
  }

  try {
    await mkdir(dossierDestination, { recursive: false });
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Le dossier de sortie existe déjà : « ${dossierDestination} ». Choisissez un autre emplacement.`);
    }
    throw erreur;
  }

  try {
    for (const plan of plans) {
      const informationsAvantCopie = await stat(plan.source);
      if (informationsAvantCopie.size !== plan.taille || informationsAvantCopie.mtime.toISOString() !== plan.modifieLe) {
        throw new Error('Un fichier a changé pendant la préparation. Actualisez le dossier puis recommencez.');
      }
      await mkdir(dirname(plan.destination), { recursive: true });
      await copyFile(plan.source, plan.destination, fsConstants.COPYFILE_EXCL);
    }
    if (options.rapportCsv !== undefined) {
      await writeFile(join(dossierDestination, 'Bilan du classement.csv'), options.rapportCsv, { encoding: 'utf8', flag: 'wx' });
    }
  } catch (erreur) {
    // Le dossier est neuf et a été créé par cette opération : nettoyer uniquement cette copie partielle.
    try {
      if ((await realpath(dossierDestination)) === dossierDestination) {
        await rm(dossierDestination, { recursive: true, force: true });
      }
    } catch {
      // Garder l'erreur d'origine ; les originaux ne sont jamais touchés.
    }
    throw erreur;
  }

  return { dossierDestination, fichiersCopies: plans.length };
}
