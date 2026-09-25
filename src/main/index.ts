// Processus principal d'Electron : fenêtre sécurisée, menu français, services.

import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, nativeTheme, safeStorage, shell } from 'electron';
import { configurationDepuisEnvironnement } from '../coeur/configuration';
import { CANAUX } from '../partage/contrat';
import type { Theme } from '../partage/reglages';
import { brancherCanaux } from './ipc';
import { ServiceAgent } from './service';
import { type Chiffreur, Stockage } from './stockage';

let fenetrePrincipale: BrowserWindow | null = null;

// Dossier de données personnalisé (tests, usage portable) ; sinon le dossier du système.
if (process.env.BRD_DOSSIER_DONNEES) app.setPath('userData', process.env.BRD_DOSSIER_DONNEES);

/** Chiffrement du système ; sous Linux sans trousseau, le repli « basic_text » est refusé. */
const chiffreur: Chiffreur = {
  disponible: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  chiffrer: (texte) => safeStorage.encryptString(texte),
  dechiffrer: (donnees) => safeStorage.decryptString(donnees)
};

const SOURCES_THEME: Record<Theme, typeof nativeTheme.themeSource> = { systeme: 'system', clair: 'light', sombre: 'dark' };

/** Impose le thème à Chromium : `prefers-color-scheme` suit, menus et boîtes de dialogue aussi. */
function appliquerTheme(theme: Theme): void {
  nativeTheme.themeSource = SOURCES_THEME[theme];
}

function menuFrancais(): Menu {
  const modele: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'Fichier', submenu: [{ role: 'quit', label: 'Quitter' }] },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' }
      ]
    }
  ];
  return Menu.buildFromTemplate(modele);
}

function creerFenetre(): BrowserWindow {
  const fenetre = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'Blow Rapide Décision',
    show: false,
    // Même fond que l'interface, pour éviter un éclair blanc en thème sombre.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111418' : '#f5f6f7',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  fenetre.once('ready-to-show', () => fenetre.show());
  // Aucun lien ne s'ouvre dans l'application : les liens web partent dans le navigateur.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (evenement, url) => {
    if (url !== fenetre.webContents.getURL()) evenement.preventDefault();
  });

  const urlDev = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && urlDev) void fenetre.loadURL(urlDev);
  else void fenetre.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return fenetre;
}

app.whenReady().then(() => {
  const stockage = new Stockage(app.getPath('userData'), chiffreur);
  appliquerTheme(stockage.reglages.apparence.theme);
  const { secrets: secretsEnvironnement } = configurationDepuisEnvironnement();
  const service = new ServiceAgent({
    reglages: () => stockage.reglages,
    // Les clés enregistrées dans l'application priment sur l'environnement.
    secrets: () => ({ ...secretsEnvironnement, ...stockage.secrets }),
    envoyer: (progression) => fenetrePrincipale?.webContents.send(CANAUX.progression, progression)
  });
  brancherCanaux({
    service,
    stockage,
    fenetre: () => fenetrePrincipale,
    cheminJeuDemo: join(app.getAppPath(), 'jeux-evaluation', 'demo'),
    secretsEnvironnement,
    appliquerTheme
  });
  Menu.setApplicationMenu(menuFrancais());
  fenetrePrincipale = creerFenetre();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) fenetrePrincipale = creerFenetre();
  });
}).catch((erreur: unknown) => {
  dialog.showErrorBox('Blow Rapide Décision', `Démarrage impossible : ${(erreur as Error).message}`);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
