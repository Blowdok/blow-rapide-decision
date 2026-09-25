# blow-rapide-decision

Agent de bureau piloté par Blowdok pour rechercher, classer et résumer des documents locaux, avec Jev comme outil de décision; comparaison des modes local et hybride.

## Stack

Au 25 septembre 2026 ([RAD 0002](docs/regles/decisions/0002-application-de-bureau-electron.md), [RAD 0003](docs/regles/decisions/0003-jev-decide-un-llm-redige.md)) :

- Application de bureau **Electron 44**, construite par **electron-vite 5** (Vite 7), interface **React 19**, **TypeScript 7**.
- **Jev** (TypeSafe AI) pour les décisions en mode hybride, par le SDK officiel `@typesafe-ai/sdk`, via **OpenRouter**.
- **Ollama** pour le mode local ; **OpenRouter** pour les résumés en mode hybride.
- Extraction locale : `unpdf` (PDF), `mammoth` (Word).
- Tests : **Vitest 5** et **Playwright** (parcours de l'application réelle).

Architecture détaillée : [docs/regles/architecture.md](docs/regles/architecture.md).

## Fonctionnalités

- **Documents** : indexe un dossier (TXT, Markdown, PDF avec texte, Word), sur la machine, sans rien envoyer.
- **Triage** : pour chaque document, catégorie, action requise et urgence, avec probabilités ; sous le seuil de confiance, le document est marqué « à vérifier ».
- **Recherche** : l'index BM25 propose des passages, le moteur de décision juge la pertinence de chacun.
- **Résumé** : résumé factuel en français ; les longs documents sont résumés par parties puis synthétisés.
- **Trois modes**, choisis dans l'en-tête, qui indique toujours où partent les données :
  - **Local** : Ollama décide et rédige, rien ne quitte le PC.
  - **Hybride** : Jev décide et un LLM OpenRouter rédige ; courriels, téléphones, IBAN, cartes bancaires et numéros de sécurité sociale sont masqués avant l'envoi, puis restaurés sur la machine.
  - **Référence sans IA** : heuristiques lexicales, pour mesurer l'apport réel de l'IA.
- **Comparaison** (banc de décision) : fait passer un jeu d'évaluation à chaque mode et recommande local ou hybride selon la qualité, le temps, le coût et les données envoyées ([RAD 0004](docs/regles/decisions/0004-banc-de-decision.md)). Rapport exportable en Markdown et JSON.
- **Réglages** : modèles, clés API chiffrées par le système, catégories modifiables, seuils, diagnostic des services, journal des envois hors de la machine.
- **Thème** clair, sombre ou celui du système, au choix en bas de la barre latérale ; le choix est mémorisé.
- **Ligne de commande `brd`** : comparer, trier, chercher, résumer, diagnostic.

## Installation

Prérequis : Node.js 22.12 ou plus récent.

```bash
npm install
```

Au premier lancement, Electron télécharge son binaire.

**Mode local** : installer [Ollama](https://ollama.com) (0.12.11 ou plus récent, pour les probabilités des décisions), puis le modèle par défaut :

```bash
ollama pull qwen3:8b
```

**Mode hybride** : créer une clé OpenRouter, puis l'enregistrer dans l'écran Réglages de l'application (elle y est chiffrée par le système). Pour la ligne de commande, copier `.env.exemple` en `.env` et renseigner `OPENROUTER_API_KEY`.

## Exemples d'utilisation

Application de bureau :

```bash
npm run dev      # développement
npm start        # version construite
```

1. Documents : « Choisir un dossier… », puis « Trier les documents ».
2. Cliquer un document : probabilités du triage, bouton « Résumer », aperçu du texte.
3. Recherche : poser une question, par exemple « quand dois-je payer la taxe foncière ? ».
4. Comparaison : « Lancer la comparaison » sur le jeu de démonstration, puis « Exporter le rapport… ».

Ligne de commande :

```bash
npm run brd -- diagnostic
npm run brd -- comparer
npm run brd -- comparer --profils local,reference --jeu jeux-evaluation/demo --sortie rapports
npm run brd -- trier chemin/vers/dossier --profil local
npm run brd -- chercher chemin/vers/dossier "montant réclamé par l'Urssaf" --profil hybride
npm run brd -- resumer chemin/vers/facture.pdf --profil hybride
```

Créer son propre jeu d'évaluation : voir [jeux-evaluation/demo/LISEZMOI.md](jeux-evaluation/demo/LISEZMOI.md).

## Tests pratiques

Automatiques :

```bash
npm run typecheck
npm test                # cœur, moteurs, agent, banc, ligne de commande, service, stockage
npm run test:e2e        # parcours de l'application réelle (Linux sans écran : xvfb-run -a npm run test:e2e)
```

À la main, sur le PC de Blowdok :

1. `npm run brd -- diagnostic` : les trois services sont « ✓ » (Ollama, OpenRouter, Jev).
2. `npm run dev`, mode « Référence sans IA », dossier `jeux-evaluation/demo/documents`, « Trier les 12 documents » : chaque ligne reçoit une catégorie.
3. Même dossier en mode « Local » puis « Hybride » : les triages diffèrent selon le mode ; en hybride, le journal des envois (Réglages) liste les appels, avec les données masquées.
4. Résumer `facture-imprimerie-lumen.txt` en hybride : le journal indique deux données masquées (courriel et IBAN) ; si le résumé cite l'IBAN, c'est la vraie valeur, restaurée sur la machine.
5. Comparaison des trois modes sur le jeu de démonstration : la recommandation s'affiche, le rapport s'exporte.
