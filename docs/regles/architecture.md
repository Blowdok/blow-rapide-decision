# Architecture de blow-rapide-decision

Mise à jour : 25 septembre 2026. Choix structurants : [RAD 0002](decisions/0002-application-de-bureau-electron.md) (stack), [RAD 0003](decisions/0003-jev-decide-un-llm-redige.md) (modes et moteurs), [RAD 0004](decisions/0004-banc-de-decision.md) (banc de décision).

## Vue d'ensemble

Application de bureau Electron en TypeScript. Le cœur, sans Electron, extrait le texte des documents, les indexe, pose des questions typées à un moteur de décision et fait rédiger les résumés par un moteur de rédaction. L'application et la ligne de commande `brd` utilisent le même cœur.

```
 Interface React (rendu isolé)          Ligne de commande brd
        │ window.brd (preload)                   │
        ▼                                        │
 Processus principal : ipc → service ◄───────────┘ (appel direct)
        │
        ▼
 Cœur : extraction → index BM25 → agent (trier, rechercher, résumer) → banc
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
  - `extraction/` : texte des TXT, Markdown (UTF-8 ou Windows-1252), PDF (`unpdf`) et Word (`mammoth`).
  - `texte/` : normalisation du français (accents, élisions, mots vides, racinisation minimale) et découpage en passages.
  - `index/` : index BM25 et corpus d'un dossier.
  - `moteurs/` : contrats `MoteurDecision` et `MoteurRedaction` ; Jev (SDK `@typesafe-ai/sdk`), Ollama, OpenRouter, référence sans IA.
  - `confidentialite/` : pseudonymisation réversible avant tout envoi.
  - `agent/` : questions communes à tous les modes, consignes de résumé, profils (quel moteur pour quel mode), opérations `trierDocument`, `rechercher`, `resumerDocument`.
  - `banc/` : jeu d'évaluation, exécution, métriques, recommandation, rapport Markdown.
  - `configuration.ts` (variables d'environnement de la ligne de commande), `diagnostic.ts` (état d'Ollama, d'OpenRouter et de Jev, sans appel payant).
- `src/main/` : processus principal d'Electron. `index.ts` (fenêtre, menu), `ipc.ts` (canaux), `service.ts` (corpus ouvert, caches, journal des envois ; sans Electron), `stockage.ts` (réglages, clés chiffrées).
- `src/preload/` : expose l'API `window.brd`, et rien d'autre.
- `src/renderer/` : interface React en français : Documents, Recherche, Comparaison, Réglages.
- `src/cli/` : ligne de commande `brd` (comparer, trier, chercher, résumer, diagnostic).
- `jeux-evaluation/demo/` : jeu d'évaluation fictif (12 documents, attentes dans `jeu.json`).
- `tests/` (Vitest) et `tests-e2e/` (Playwright sur l'application construite).

## Échanges

1. **Indexation** : le service parcourt le dossier, extrait chaque fichier, le découpe en passages d'environ 1 000 caractères et remplit l'index BM25. Rien ne sort de la machine.
2. **Triage** : un seul appel de décision par document, avec trois questions : catégorie (choix), action requise (oui ou non), urgence (note de 0 à 2). Sous le seuil de confiance, le document est marqué « à vérifier ».
3. **Recherche** : BM25 propose des passages, puis le moteur de décision juge la pertinence de chacun ; le classement final suit cette probabilité.
4. **Résumé** : un appel de rédaction ; au-delà d'une partie (12 000 caractères par défaut), résumé partie par partie puis synthèse.
5. **Banc** : chaque mode passe le même jeu, l'un après l'autre ; métriques, recommandation, rapport.

Chaque appel de moteur renvoie une `Mesure` : durée, jetons, coût, caractères envoyés hors de la machine, données masquées. Le service consigne les envois dans un journal affiché dans les réglages.

## Sécurité et confidentialité

- Rendu isolé : `contextIsolation`, `sandbox`, politique de sécurité du contenu stricte, navigation et nouvelles fenêtres bloquées.
- Les canaux IPC n'acceptent que le cadre principal de la fenêtre de l'application et vérifient leurs paramètres ; seuls les fichiers du dossier indexé peuvent être ouverts.
- Clés API chiffrées par le système, jamais renvoyées à l'interface.
- Mode hybride : masquage des identifiants personnels avant envoi, marqueurs restaurés sur la machine ; fournisseurs OpenRouter qui collectent les données exclus par défaut.

## Tests

- `npm test` : cœur, moteurs (réseau simulé), agent, banc, ligne de commande, service et stockage.
- `npm run test:e2e` : parcours de l'application réelle (sous Linux sans écran : `xvfb-run -a npm run test:e2e`).
