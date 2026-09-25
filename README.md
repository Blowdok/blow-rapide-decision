# blow-rapide-decision

Agent de bureau piloté par Blowdok pour rechercher, classer et résumer des documents locaux, avec Jev comme outil de décision; comparaison des modes local et hybride.

## Stack

Au 25 septembre 2026 ([RAD 0002](docs/regles/decisions/0002-application-de-bureau-electron.md), [RAD 0003](docs/regles/decisions/0003-jev-decide-un-llm-redige.md), [RAD 0005](docs/regles/decisions/0005-options-semantique-et-ocr.md)) :

- Application de bureau **Electron 44**, construite par **electron-vite 5** (Vite 7), interface **React 19**, **TypeScript 7**.
- **Jev** (TypeSafe AI) pour les décisions en mode hybride, par le SDK officiel `@typesafe-ai/sdk`, via **OpenRouter**.
- **Ollama** pour le mode local, avec `qwen3.5:4b` par défaut pour décider et résumer.
- **OpenRouter** pour les résumés en mode hybride, avec Qwen3.8 Flash (`qwen/qwen3.8-flash`), raisonnement désactivé.
- Extraction locale : `unpdf` (PDF), `mammoth` (Word).
- En option, par Ollama : `embeddinggemma` pour la recherche sémantique, `minicpm-v4.6:1b` pour lire les PDF scannés.
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
- **Options locales facultatives**, désactivées par défaut ([RAD 0005](docs/regles/decisions/0005-options-semantique-et-ocr.md)) : sans leurs modèles, l'agent fonctionne comme avant.
  - **Recherche sémantique** : un modèle de plongement d'Ollama retrouve les passages proches par le sens, même sans mot commun avec la requête ; ils rejoignent ceux de BM25.
  - **Lecture des PDF scannés** : un modèle de vision d'Ollama lit les pages sans texte (10 pages par document au plus, réglable). Le texte lu est gardé pour ne pas relire les mêmes pages.
  - Un échec (Ollama éteint, modèle absent) laisse un avis, sans bloquer. Une indexation longue peut être annulée.
- **Thème** clair, sombre ou celui du système, au choix en bas de la barre latérale ; le choix est mémorisé.
- **Ligne de commande `brd`** : comparer, trier, chercher, résumer, diagnostic.

## Installation

Prérequis : Node.js 22.12 ou plus récent.

```bash
npm install
```

Au premier lancement, Electron télécharge son binaire.

**Mode local** : installer [Ollama](https://ollama.com) (0.12.11 ou plus récent, pour les probabilités des décisions), puis le modèle par défaut, s'il n'est pas déjà là :

```bash
ollama pull qwen3.5:4b
```

Le modèle par défaut vise un PC modeste. D'autres petits modèles se choisissent dans Réglages : `gemma3:4b`, `granite4.2:3b`, `gemma4:e2b`… La Comparaison mesure l'effet du changement.

**Options facultatives** (tous les modes) : les cocher dans Réglages, « Options locales facultatives », puis réindexer le dossier. Modèles par défaut, s'ils ne sont pas déjà installés :

```bash
ollama pull embeddinggemma      # recherche sémantique (ou nomic-embed-text-v2-moe)
ollama pull minicpm-v4.6:1b     # lecture des PDF scannés
```

**Mode hybride** : créer une clé OpenRouter, puis l'enregistrer dans l'écran Réglages de l'application (elle y est chiffrée par le système). Pour la ligne de commande, copier `.env.exemple` en `.env` et renseigner `OPENROUTER_API_KEY`.

Qwen3.8 Flash n'a qu'un fournisseur sur OpenRouter. Si les résumés échouent avec un message sur la confidentialité, ce fournisseur est exclu par le refus de collecte. Il faut alors décocher ce réglage ou choisir un autre modèle.

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

Pour la ligne de commande, les options facultatives s'activent dans `.env` (voir `.env.exemple`) : `BRD_SEMANTIQUE=1` pour la recherche sémantique, `BRD_OCR=1` pour la lecture des PDF scannés. `BRD_OLLAMA_MODELE_PLONGEMENT`, `BRD_OLLAMA_MODELE_OCR` et `BRD_OCR_PAGES_MAX` choisissent les modèles et la limite de pages.

Créer son propre jeu d'évaluation : voir [jeux-evaluation/demo/LISEZMOI.md](jeux-evaluation/demo/LISEZMOI.md).

## Tests pratiques

Automatiques :

```bash
npm run typecheck
npm test                # cœur, moteurs, options, agent, banc, ligne de commande, service, stockage
npm run test:e2e        # application réelle, puis options face à un faux Ollama (Linux sans écran : xvfb-run -a npm run test:e2e)
```

À la main, sur le PC de Blowdok :

1. `npm run brd -- diagnostic` : les trois services sont « ✓ » (Ollama, OpenRouter, Jev).
2. `npm run dev`, mode « Référence sans IA », dossier `jeux-evaluation/demo/documents`, « Trier les 12 documents » : chaque ligne reçoit une catégorie.
3. Même dossier en mode « Local » puis « Hybride » : les triages diffèrent selon le mode ; en hybride, le journal des envois (Réglages) liste les appels, avec les données masquées.
4. Résumer `facture-imprimerie-lumen.txt` en hybride : le journal indique deux données masquées (courriel et IBAN) ; si le résumé cite l'IBAN, c'est la vraie valeur, restaurée sur la machine.
5. Comparaison des trois modes sur le jeu de démonstration : la recommandation s'affiche, le rapport s'exporte.
6. Options : cocher la recherche sémantique, réindexer (« Recherche sémantique prête » s'affiche), chercher « rémunération » : `fiche-paie-aout-2026.txt` devrait remonter, avec un rang sémantique. Relancer la Comparaison : le rapport ajoute la colonne « Lexical et sémantique ».
7. Lecture des PDF scannés : scanner une page (ou imprimer un PDF en image), la déposer dans le dossier, cocher l'option, réindexer ; le document porte la pastille « OCR » et son aperçu montre le texte lu.
