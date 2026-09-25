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
- 25 septembre 2026, à la demande de Blowdok (« implémente ses deux pistes en option, pas une obligation pour fonctionner »), deux options locales, désactivées par défaut ([RAD 0005](decisions/0005-options-semantique-et-ocr.md)) :
  - recherche sémantique avec `embeddinggemma` (ou `nomic-embed-text-v2-moe`), fusionnée avec BM25 ;
  - lecture des PDF scannés avec `minicpm-v4.6:1b`.

  Sans leurs modèles, l'agent fonctionne comme avant ; un échec laisse un avis. L'indexation peut maintenant être annulée.
- 25 septembre 2026, à la demande de Blowdok (« L'interface doit être intuitive pour qu'un débutant novice puisse utiliser »), l'interface s'adresse à un débutant ([RAD 0006](decisions/0006-interface-pour-debutant.md)) :
  - un accueil en trois étapes vérifie que l'agent est prêt ;
  - un écran Aide répond aux questions courantes ;
  - le vocabulaire est simplifié (« Classer », « Actualiser ») et les réglages techniques sont repliés.
- 25 septembre 2026, une relecture critique des options a relevé six défauts, tous corrigés :
  - mémoire de la lecture OCR ;
  - cache fragile ;
  - bouton Annuler perdu après un changement d'écran ;
  - scans en bandes, en masques ou tournés mal lus ;
  - repli de la recherche sémantique ;
  - limite de pages consommée par les pages blanches.
- 25 septembre 2026, à la demande de Blowdok, la PR #1 est fusionnée dans `main`.
- 25 septembre 2026, à la demande de Blowdok (« N'oublie pas les bulles d'informations au survol des boutons, icônes, libellé… »), chaque bouton, champ, lien, pastille et critère s'explique dans une bulle ([RAD 0006](decisions/0006-interface-pour-debutant.md)). À sa demande, ce travail est fusionné dans `main` (PR #2).
- 25 septembre 2026, après le signalement d’une clé refusée sous Hyprland, Electron sélectionne `gnome-libsecret` uniquement dans cet environnement; le refus de stockage en clair reste en place ([RAD 0007](decisions/0007-trousseau-hyprland.md)). Aucune clé réelle n’a été saisie.
- 25 septembre 2026, Blowdok a précisé que « classer » devait conduire à un rangement concret. L’écran Documents propose maintenant un aperçu éditable, envoie les résultats incertains vers « À vérifier », puis crée une copie rangée avec un bilan CSV; les sources ne sont jamais déplacées ([RAD 0008](decisions/0008-copie-classee-apres-validation.md)).
- Vérifications : `npm run typecheck`, 176 tests unitaires, compilation de production et 13 tests E2E passent; la copie du corpus de démonstration est testée et les originaux restent présents.
- Aucun appel réel à Jev/OpenRouter ni aucun document personnel n’a été utilisé pour cette livraison. La qualité de Jev sur les documents de Blowdok et son coût restent à évaluer après accord pour l’envoi et la dépense. Les changements de cette livraison ont été fusionnés en fast-forward dans `main` et poussés sur `origin/main`.

## Prochaine action

1. Sur le PC de Blowdok, ouvrir l’application si nécessaire, puis lancer le jeu fictif de 12 documents en mode « Référence sans IA », préparer la copie vers un dossier temporaire et vérifier le bilan CSV ainsi que l’intégrité des sources.
2. Si Blowdok veut évaluer Jev, saisir la clé OpenRouter dans les réglages de l’application, lancer le diagnostic, puis autoriser explicitement l’envoi et le coût avant tout essai Hybride. Commencer par le jeu fictif; aucune clé dans le chat.
3. Comparer les trois modes sur le jeu de démonstration et juger la qualité des décisions de Jev en français, son coût et les résultats « à vérifier ». Si Jev ne bat pas clairement le modèle local ou la référence, ne pas le retenir pour le tri réel.
4. N’essayer le mode Hybride sur des documents personnels qu’après accord explicite sur les données envoyées et la dépense; vérifier l’aperçu, corriger les destinations, puis confirmer la copie.
5. Comparer les autres petits modèles locaux (`gemma3:4b`, `granite4.2:3b`, `gemma4:e2b`) dans Réglages et le banc.
6. Constituer, si Blowdok l’autorise, un jeu d’évaluation représentatif de 20 à 50 documents, puis valider la tolérance de 5 points et les critères du banc ([RAD 0004](decisions/0004-banc-de-decision.md)).
7. Faire suivre l’accueil en trois étapes à un débutant sans aide ([RAD 0006](decisions/0006-interface-pour-debutant.md)) et essayer les options locales ([RAD 0005](decisions/0005-options-semantique-et-ocr.md)).

## Décisions

- [RAD 0001 — Création du projet](decisions/0001-creation-du-projet.md).
- [RAD 0002 — Application de bureau Electron en TypeScript](decisions/0002-application-de-bureau-electron.md).
- [RAD 0003 — Jev décide, un LLM rédige : modes local et hybride](decisions/0003-jev-decide-un-llm-redige.md).
- [RAD 0004 — Un banc de décision tranche entre local et hybride](decisions/0004-banc-de-decision.md).
- [RAD 0005 — Recherche sémantique et lecture des PDF scannés, en options locales](decisions/0005-options-semantique-et-ocr.md).
- [RAD 0006 — L'interface s'adresse à un débutant](decisions/0006-interface-pour-debutant.md).
- [RAD 0007 — Utiliser Secret Service sous Hyprland pour protéger les clés](decisions/0007-trousseau-hyprland.md).
- [RAD 0008 — Prévisualiser puis créer une copie rangée](decisions/0008-copie-classee-apres-validation.md).
