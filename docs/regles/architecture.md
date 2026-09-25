# Architecture de blow-rapide-decision

Mise à jour : 25 septembre 2026. Choix structurants : [RAD 0002](decisions/0002-application-de-bureau-electron.md) (stack), [RAD 0003](decisions/0003-jev-decide-un-llm-redige.md) (modes et moteurs), [RAD 0004](decisions/0004-banc-de-decision.md) (banc de décision), [RAD 0005](decisions/0005-options-semantique-et-ocr.md) (options sémantique et OCR), [RAD 0006](decisions/0006-interface-pour-debutant.md) (interface pour débutant).

## Vue d'ensemble

Application de bureau Electron en TypeScript. Le cœur, sans Electron, extrait le texte des documents, les indexe, pose des questions typées à un moteur de décision et fait rédiger les résumés par un moteur de rédaction. L'application et la ligne de commande `brd` utilisent le même cœur. Deux options locales, désactivées par défaut, complètent l'indexation : lecture OCR des PDF scannés et recherche sémantique.

```
 Interface React (rendu isolé)          Ligne de commande brd
        │ window.brd (preload)                   │
        ▼                                        │
 Processus principal : ipc → service ◄───────────┘ (appel direct)
        │
        ▼
 Cœur : extraction → index BM25 → agent (trier, rechercher, résumer) → banc
        │   (option : OCR)  (option : vecteurs, fusion)
        │                               │
        │                ┌──────────────┴───────────────┐
        │         moteur de décision              moteur de rédaction
        │   local : Ollama (lettres + log-probas)  local : Ollama
        │   hybride : Jev via OpenRouter           hybride : LLM via OpenRouter
        │   référence : recouvrement lexical       référence : résumé extractif
        ▼
 Fichiers locaux (TXT, Markdown, PDF, Word)
```

## Dossiers

- `src/partage/` : types du domaine, réglages par défaut, contrat IPC, mise en forme française, synthèse du banc. Sans Node ni DOM : partagé par tous les processus.
- `src/coeur/` : la logique, testable sans Electron.
  - `extraction/` : texte des TXT, Markdown (UTF-8 ou Windows-1252), PDF (`unpdf`) et Word (`mammoth`), page par page pour les PDF. Pour l'option OCR, `images.ts` recompose les pages scannées à partir de leurs images (bandes, masques, rotation), puis les réduit et les encode en PNG.
  - `texte/` : normalisation du français (accents, élisions, mots vides, racinisation minimale) et découpage en passages.
  - `index/` : index BM25, index vectoriel et fusion par rang réciproque, corpus d'un dossier et choix des passages candidats.
  - `moteurs/` : contrats `MoteurDecision` et `MoteurRedaction` ; Jev (SDK `@typesafe-ai/sdk`), Ollama, OpenRouter, référence sans IA. Pour les options : `MoteurPlongement` (Ollama `/api/embed`) et `LecteurOcr` (Ollama `/api/chat` avec image).
  - `confidentialite/` : pseudonymisation réversible avant tout envoi.
  - `agent/` : questions communes à tous les modes, consignes de résumé, profils (quel moteur pour quel mode), opérations `trierDocument`, `rechercher`, `resumerDocument`.
  - `banc/` : jeu d'évaluation, exécution, métriques, recommandation, rapport Markdown.
  - `outils/` : exécution parallèle bornée, cache des pages lues par OCR (mémoire ou fichiers).
  - `configuration.ts` (variables d'environnement de la ligne de commande), `diagnostic.ts` (état d'Ollama, modèles des options compris, d'OpenRouter et de Jev, sans appel payant), `options.ts` (moteurs des options actives).
- `src/main/` : processus principal d'Electron. `index.ts` (fenêtre, menu), `ipc.ts` (canaux), `service.ts` (corpus ouvert, caches, journal des envois ; sans Electron), `stockage.ts` (réglages, clés chiffrées).
- `src/preload/` : expose l'API `window.brd`, et rien d'autre.
- `src/renderer/` : interface React en français, pensée pour un débutant ([RAD 0006](decisions/0006-interface-pour-debutant.md)).
  - Écrans : Documents (avec un accueil en trois étapes), Recherche, Comparaison, Réglages (essentiel d'abord, réglages avancés repliés) et Aide. Ils restent montés et seul l'écran affiché est visible : une lecture de dossier, une comparaison ou des réglages en cours survivent à un changement d'écran.
  - `preparation.tsx` vérifie, sans appel payant, les services utiles au mode choisi, puis dit quoi faire.
  - `contexte.tsx` porte l'état partagé et la navigation : un lien « Comment faire ? » ouvre l'aide sur la bonne question.
  - `infobulles.tsx` affiche la bulle d'information de tout élément qui porte `data-infobulle`, au survol comme au clavier.
  - Le thème (clair, sombre, système) est imposé par le processus principal via `nativeTheme.themeSource`, que suit la requête CSS `prefers-color-scheme`.
- `src/cli/` : ligne de commande `brd` (comparer, trier, chercher, résumer, diagnostic).
- `jeux-evaluation/demo/` : jeu d'évaluation fictif (12 documents, attentes dans `jeu.json`).
- `tests/` (Vitest) et `tests-e2e/` (Playwright sur l'application construite).

## Échanges

1. **Indexation** : le service parcourt le dossier, extrait chaque fichier, le découpe en passages d'environ 1 000 caractères et remplit l'index BM25. Rien ne sort de la machine. Avec les options :
   - les pages de PDF presque sans texte sont lues par le modèle de vision d'Ollama ;
   - les passages sont plongés en vecteurs par le modèle de plongement.

   Un échec laisse un avis, sans bloquer. L'indexation peut être annulée.
2. **Triage** : un seul appel de décision par document, avec trois questions : catégorie (choix), action requise (oui ou non), urgence (note de 0 à 2). Sous le seuil de confiance, le document est marqué « à vérifier ».
3. **Recherche** : BM25 propose des passages, puis le moteur de décision juge la pertinence de chacun ; le classement final suit cette probabilité. Avec la recherche sémantique, les passages proches par le sens rejoignent ceux de BM25, fusionnés par rang réciproque.
4. **Résumé** : un appel de rédaction ; au-delà d'une partie (12 000 caractères par défaut), résumé partie par partie puis synthèse.
5. **Banc** : chaque mode passe le même jeu, l'un après l'autre ; métriques, recommandation, rapport. Avec la recherche sémantique, le rapport ajoute le classement fusionné sans décision.

Chaque appel de moteur renvoie une `Mesure` : durée, jetons, coût, caractères envoyés hors de la machine, données masquées. Le service consigne les envois dans un journal affiché dans les réglages.

## Sécurité et confidentialité

- Rendu isolé : `contextIsolation`, `sandbox`, politique de sécurité du contenu stricte, navigation et nouvelles fenêtres bloquées.
- Les canaux IPC n'acceptent que le cadre principal de la fenêtre de l'application et vérifient leurs paramètres ; seuls les fichiers du dossier indexé peuvent être ouverts.
- Clés API chiffrées par le système, jamais renvoyées à l'interface.
- Mode hybride : masquage des identifiants personnels avant envoi, marqueurs restaurés sur la machine ; fournisseurs OpenRouter qui collectent les données exclus par défaut.
- Options : avec un Ollama sur une autre machine, plongements et pages scannées comptent comme des envois hors de la machine et entrent au journal. Le texte lu par OCR est gardé dans le dossier de données de l'application, sous des noms d'empreinte.

## Tests

- `npm test` : cœur, moteurs (réseau simulé), options (plongements et OCR simulés), agent, banc, ligne de commande, service et stockage.
- `npm run test:e2e` : parcours de l'application réelle, puis parcours des options face à un faux serveur Ollama (sous Linux sans écran : `xvfb-run -a npm run test:e2e`).
