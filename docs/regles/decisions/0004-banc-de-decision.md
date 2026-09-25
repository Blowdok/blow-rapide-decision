# RAD 0004 — Un banc de décision tranche entre local et hybride

Date : 25 septembre 2026. Proposition faite pendant la construction, à valider par Blowdok, en particulier la tolérance de 5 points.

## Contexte

- Le projet doit trancher vite entre mode local et mode hybride, sur des chiffres comparables.
- Le jeu de démonstration compte 12 documents fictifs d'une agence web, 11 requêtes (dont deux où la recherche lexicale seule classe mal le bon document) et 5 résumés avec leurs faits attendus.

## Décision

- Chaque mode passe le même jeu d'évaluation (`jeu.json` et son dossier `documents/`), avec les mêmes questions. Les modes tournent l'un après l'autre pour ne pas fausser les temps.
- Mesures : justesse de la catégorie, de l'action requise et de l'urgence ; rang réciproque moyen du bon document en recherche ; part des faits attendus présents dans les résumés ; temps moyens ; coût facturé et coût estimé pour 1 000 documents ; appels, caractères et données masquées envoyés hors de la machine.
- Indice de qualité sur 100 : moyenne des cinq taux de réussite. Une erreur compte comme une réponse fausse.
- Règle : le mode local est recommandé tant que l'hybride ne le dépasse pas de plus que la tolérance du jeu (5 points par défaut). Au-delà, l'hybride est recommandé, avec son coût et ce qu'il envoie. Un mode qui échoue trois fois sans aucun succès est interrompu et exclu de la recommandation.
- Rapport en Markdown et données en JSON, depuis l'écran Comparaison ou `npm run brd -- comparer`.

## Conséquences

- Le jeu de démonstration est trop petit pour trancher, et le rapport le signale : il faut 20 à 50 vrais documents représentatifs de Blowdok.
- Les faits des résumés sont vérifiés par simple présence du texte attendu, pas par un juge.
- Tolérance, critères et poids restent à confirmer par Blowdok.
