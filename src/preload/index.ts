// Pont entre l'interface isolée et le processus principal : expose l'API
// `window.brd`, et rien d'autre.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { type ApiBureau, CANAUX, type Progression, type Reponse } from '../partage/contrat';

async function appeler<T>(canal: string, ...args: unknown[]): Promise<T> {
  const reponse = (await ipcRenderer.invoke(canal, ...args)) as Reponse<T>;
  if (!reponse.ok) throw new Error(reponse.erreur);
  return reponse.valeur;
}

const api: ApiBureau = {
  reglages: {
    lire: () => appeler(CANAUX.reglagesLire),
    enregistrer: (partiel) => appeler(CANAUX.reglagesEnregistrer, partiel),
    definirCle: (nom, valeur) => appeler(CANAUX.reglagesDefinirCle, nom, valeur)
  },
  services: {
    diagnostic: () => appeler(CANAUX.diagnostic),
    modelesOllama: () => appeler(CANAUX.modelesOllama)
  },
  dossier: {
    choisir: () => appeler(CANAUX.dossierChoisir),
    indexer: (chemin) => appeler(CANAUX.dossierIndexer, chemin),
    etat: () => appeler(CANAUX.dossierEtat)
  },
  documents: {
    lire: (id) => appeler(CANAUX.documentLire, id),
    trier: (ids) => appeler(CANAUX.documentsTrier, ids),
    resumer: (id) => appeler(CANAUX.documentResumer, id),
    ouvrir: (id) => appeler(CANAUX.documentOuvrir, id)
  },
  rechercher: (requete) => appeler(CANAUX.rechercher, requete),
  banc: {
    jeuParDefaut: () => appeler(CANAUX.bancJeuParDefaut),
    choisirJeu: () => appeler(CANAUX.bancChoisirJeu),
    lancer: (dossier, profils) => appeler(CANAUX.bancLancer, dossier, profils),
    annuler: () => appeler(CANAUX.bancAnnuler),
    exporter: () => appeler(CANAUX.bancExporter)
  },
  journal: () => appeler(CANAUX.journal),
  surProgression: (rappel) => {
    const ecouteur = (_evenement: IpcRendererEvent, progression: Progression): void => rappel(progression);
    ipcRenderer.on(CANAUX.progression, ecouteur);
    return () => {
      ipcRenderer.removeListener(CANAUX.progression, ecouteur);
    };
  }
};

contextBridge.exposeInMainWorld('brd', api);
