# Continuité de blow-rapide-decision

Mise à jour : 25 septembre 2026. À lire au début de chaque session, à mettre à jour à la fin.

## État actuel

- Projet créé le 25 septembre 2026 par `/structure-projet` à partir de `blow-modele-projet`. Projet de Blowdok. Dépôt : https://github.com/Blowdok/blow-rapide-decision (public).
- 25 septembre 2026, cadrage avec Blowdok : TypeScript/Node, application de bureau, OpenRouter pour le mode hybride. La recherche sur Jev (TypeSafe AI, modèle de décision lancé le 15 septembre 2026) a fixé son rôle : Jev décide, un LLM rédige ([RAD 0003](decisions/0003-jev-decide-un-llm-redige.md)).
- 25 septembre 2026, première version construite sur la branche `blow/pensive-faraday-eyqk3l` :
  - application de bureau Electron en français (Documents, Recherche, Comparaison, Réglages), thème clair, sombre ou système ;
  - modes local (Ollama), hybride (Jev et OpenRouter, avec masquage des données personnelles) et référence sans IA ;
  - banc de décision local/hybride, avec un jeu de démonstration de 12 documents fictifs ;
  - ligne de commande `brd`.
- 25 septembre 2026, modèles choisis par Blowdok ([RAD 0003](decisions/0003-jev-decide-un-llm-redige.md)) : son PC ne fait pas bien tourner les modèles de 7B et plus.
  - Local : `qwen3.5:4b` pour décider et résumer.
  - Hybride : Jev pour décider, Qwen3.8 Flash (`qwen/qwen3.8-flash`) sur OpenRouter pour résumer, raisonnement désactivé.
- Vérifications : typage, 110 tests unitaires et les 6 étapes du parcours de bout en bout de l'application passent.
- Aucun essai réel avec Ollama, OpenRouter ou Jev : l'environnement de construction n'avait ni serveur Ollama ni clé API. Seuls le mode référence et des réponses simulées au format documenté ont tourné.

## Prochaine action

1. Sur le PC de Blowdok : `npm install`, clé OpenRouter dans les réglages, puis `npm run brd -- diagnostic` ; `qwen3.5:4b` y est déjà installé.
2. Lancer la comparaison des trois modes sur le jeu de démonstration et relire le rapport, en particulier la qualité de Jev en français. Si les résumés hybrides échouent sur la confidentialité (Qwen3.8 Flash n'a qu'un fournisseur), choisir entre décocher le refus de collecte et changer de modèle.
3. Comparer les autres petits modèles locaux (`gemma3:4b`, `granite4.2:3b`, `gemma4:e2b`) en changeant le modèle dans Réglages puis en relançant la comparaison.
4. Constituer un jeu d'évaluation de 20 à 50 vrais documents représentatifs, puis trancher local ou hybride avec le banc.
5. Valider la tolérance de 5 points et les critères du banc ([RAD 0004](decisions/0004-banc-de-decision.md)).
6. Pistes : recherche sémantique avec les modèles de plongement déjà installés (`embeddinggemma`, `nomic-embed-text-v2-moe`), lecture des PDF scannés avec `minicpm-v4.6:1b`.

## Décisions

- [RAD 0001 — Création du projet](decisions/0001-creation-du-projet.md).
- [RAD 0002 — Application de bureau Electron en TypeScript](decisions/0002-application-de-bureau-electron.md).
- [RAD 0003 — Jev décide, un LLM rédige : modes local et hybride](decisions/0003-jev-decide-un-llm-redige.md).
- [RAD 0004 — Un banc de décision tranche entre local et hybride](decisions/0004-banc-de-decision.md).
