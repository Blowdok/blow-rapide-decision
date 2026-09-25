# RAD 0002 — Application de bureau Electron en TypeScript

Date : 25 septembre 2026. Décision de Blowdok au cadrage : « TypeScript / Node » et « Application de bureau ».

## Contexte

- L'agent travaille sur des documents locaux, piloté par Blowdok, pour un public francophone.
- Options présentées au cadrage : TypeScript/Node ou Python ; ligne de commande avec page web locale, ligne de commande seule, ou application de bureau.
- Versions vérifiées sur le registre npm le 25 septembre 2026 : Electron 44.4.5, electron-vite 5.0.0 (accepte Vite 5 à 7, pas Vite 8), Vite 7.3.6, React 19.3, TypeScript 7.0.2, Vitest 5.0.1, Playwright 1.63.
- Electron 44 ne télécharge plus son binaire à l'installation, mais au premier lancement.

## Décision

- Application Electron 44, construite par electron-vite 5 avec Vite 7.3 et React 19, en TypeScript 7 strict.
- Le cœur (`src/coeur`) ne dépend pas d'Electron : la même logique sert l'application, la ligne de commande `brd` (lancée par tsx) et les tests.
- Interface isolée : `contextIsolation` et `sandbox` actifs, aucun accès à Node dans le rendu ; tout passe par l'API `window.brd` du preload et des canaux IPC qui vérifient l'appelant et les paramètres.
- Clés API chiffrées par le système (`safeStorage`, soit DPAPI sous Windows). Sous Linux sans trousseau, l'enregistrement est refusé au profit des variables d'environnement.
- Extraction locale : `unpdf` pour les PDF, `mammoth` pour Word, texte et Markdown en UTF-8 ou Windows-1252.
- Tests : Vitest pour le cœur et le processus principal, Playwright pour le parcours de l'application réelle.

## Conséquences

- `npm run dev` lance l'application en développement. Pas encore d'installeur Windows : electron-builder reste à ajouter et à tester sur Windows.
- Vite reste en 7.x, et `@vitejs/plugin-react` en 5.2, tant qu'electron-vite n'accepte pas Vite 8.
- Pas d'OCR : un PDF scanné sans couche texte est signalé comme illisible.
- L'index vit en mémoire : un dossier est réindexé à chaque ouverture.
