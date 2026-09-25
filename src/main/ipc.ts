// Canaux IPC : chaque appel de l'interface est vérifié, exécuté, puis sa
// réponse (ou son erreur lisible) est renvoyée dans une enveloppe.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, shell } from 'electron';
import { nomDuRapport } from '../coeur/banc/rapport';
import { CANAUX, type EtatReglages, type NomCle, type Reponse } from '../partage/contrat';
import { IDS_PROFILS, type ReglagesPartiels, type Secrets } from '../partage/reglages';
import type { IdProfil } from '../partage/types';
import type { ServiceAgent } from './service';
import type { Stockage } from './stockage';

export interface OptionsCanaux {
  service: ServiceAgent;
  stockage: Stockage;
  fenetre: () => BrowserWindow | null;
  cheminJeuDemo: string;
  secretsEnvironnement: Secrets;
}

function texte(valeur: unknown, nom: string): string {
  if (typeof valeur !== 'string' || !valeur.trim()) throw new Error(`Paramètre « ${nom} » invalide.`);
  return valeur;
}

function objet(valeur: unknown, nom: string): Record<string, unknown> {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) throw new Error(`Paramètre « ${nom} » invalide.`);
  return valeur as Record<string, unknown>;
}

function listeProfils(valeur: unknown): IdProfil[] {
  if (!Array.isArray(valeur) || !valeur.every((p) => IDS_PROFILS.includes(p as IdProfil))) {
    throw new Error('Liste de modes invalide.');
  }
  return valeur as IdProfil[];
}

function nomCle(valeur: unknown): NomCle {
  if (valeur !== 'cleOpenRouter' && valeur !== 'cleTypeSafe') throw new Error('Nom de clé invalide.');
  return valeur;
}

export function brancherCanaux(options: OptionsCanaux): void {
  const { service, stockage, fenetre } = options;

  /** Enregistre un canal : seul le cadre principal de la fenêtre de l'application peut appeler. */
  const gerer = (canal: string, action: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(canal, async (evenement: IpcMainInvokeEvent, ...args: unknown[]): Promise<Reponse<unknown>> => {
      if (evenement.sender !== fenetre()?.webContents || evenement.senderFrame !== evenement.sender.mainFrame) {
        return { ok: false, erreur: 'Appel refusé.' };
      }
      try {
        return { ok: true, valeur: await action(...args) };
      } catch (erreur) {
        return { ok: false, erreur: (erreur as Error).message };
      }
    });
  };

  const etatReglages = (): EtatReglages => {
    const secrets = stockage.secrets;
    return {
      reglages: stockage.reglages,
      cles: { cleOpenRouter: Boolean(secrets.cleOpenRouter), cleTypeSafe: Boolean(secrets.cleTypeSafe) },
      clesEnvironnement: {
        cleOpenRouter: Boolean(options.secretsEnvironnement.cleOpenRouter),
        cleTypeSafe: Boolean(options.secretsEnvironnement.cleTypeSafe)
      },
      chiffrementDisponible: stockage.chiffrementDisponible,
      dernierDossier: stockage.dernierDossier
    };
  };

  const choisirDossier = async (titre: string): Promise<string | null> => {
    const parent = fenetre();
    const proprietes = { title: titre, properties: ['openDirectory' as const] };
    const choix = parent ? await dialog.showOpenDialog(parent, proprietes) : await dialog.showOpenDialog(proprietes);
    return choix.canceled ? null : (choix.filePaths[0] ?? null);
  };

  gerer(CANAUX.reglagesLire, () => etatReglages());
  gerer(CANAUX.reglagesEnregistrer, (partiel) => {
    stockage.enregistrerReglages(objet(partiel, 'réglages') as ReglagesPartiels);
    return etatReglages();
  });
  gerer(CANAUX.reglagesDefinirCle, (nom, valeur) => {
    stockage.definirCle(nomCle(nom), typeof valeur === 'string' ? valeur : '');
    return etatReglages();
  });

  gerer(CANAUX.diagnostic, () => service.diagnostic());
  gerer(CANAUX.modelesOllama, () => service.modelesOllama());

  gerer(CANAUX.dossierChoisir, () => choisirDossier('Dossier de documents à analyser'));
  gerer(CANAUX.dossierIndexer, async (chemin) => {
    const etat = await service.indexer(texte(chemin, 'dossier'));
    stockage.dernierDossier = etat.dossier;
    return etat;
  });
  gerer(CANAUX.dossierEtat, () => service.etatCorpus());

  gerer(CANAUX.documentLire, (id) => service.detail(texte(id, 'document')));
  gerer(CANAUX.documentsTrier, (ids) => {
    if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => typeof id === 'string'))) {
      throw new Error('Liste de documents invalide.');
    }
    return service.trier(ids as string[] | undefined);
  });
  gerer(CANAUX.documentResumer, (id) => service.resumer(texte(id, 'document')));
  gerer(CANAUX.documentOuvrir, async (id) => {
    // Seuls les fichiers du dossier indexé peuvent être ouverts.
    const erreur = await shell.openPath(service.cheminDocument(texte(id, 'document')));
    if (erreur) throw new Error(`Ouverture impossible : ${erreur}`);
  });

  gerer(CANAUX.rechercher, (requete) => service.rechercher(texte(requete, 'requête')));

  gerer(CANAUX.bancJeuParDefaut, () => options.cheminJeuDemo);
  gerer(CANAUX.bancChoisirJeu, () => choisirDossier("Dossier du jeu d’évaluation (contenant jeu.json)"));
  gerer(CANAUX.bancLancer, (dossier, profils) => service.lancerBanc(texte(dossier, 'jeu'), listeProfils(profils)));
  gerer(CANAUX.bancAnnuler, () => service.annulerBanc());
  gerer(CANAUX.bancExporter, async () => {
    const dernier = service.dernierBanc;
    if (!dernier) throw new Error('Aucune comparaison à exporter : lancez-en une.');
    const parent = fenetre();
    const proprietes = {
      title: 'Enregistrer le rapport de comparaison',
      defaultPath: join(app.getPath('documents'), `${nomDuRapport(new Date(dernier.resultat.date))}.md`),
      filters: [{ name: 'Rapport Markdown', extensions: ['md'] }]
    };
    const choix = parent ? await dialog.showSaveDialog(parent, proprietes) : await dialog.showSaveDialog(proprietes);
    if (choix.canceled || !choix.filePath) return null;
    const chemin = choix.filePath.endsWith('.md') ? choix.filePath : `${choix.filePath}.md`;
    await writeFile(chemin, dernier.rapport, 'utf8');
    await writeFile(chemin.replace(/\.md$/, '.json'), `${JSON.stringify(dernier.resultat, null, 2)}\n`, 'utf8');
    return chemin;
  });

  gerer(CANAUX.journal, () => service.journal());
}
