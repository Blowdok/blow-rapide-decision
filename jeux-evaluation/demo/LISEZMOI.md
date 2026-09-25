# Jeu d'évaluation « Démo bureau »

Douze documents **entièrement fictifs** d'une agence web imaginaire, l'Atelier Web Horizon. Personnes, entreprises, adresses, IBAN, numéros de téléphone (plages réservées à la fiction) et de sécurité sociale sont inventés. Les courriers d'organismes réels (impôts, Urssaf) sont des imitations écrites pour le test, pas de vrais documents.

Plusieurs documents contiennent volontairement des données personnelles (courriels, téléphones, IBAN, numéro de sécurité sociale) : le banc vérifie ainsi le masquage du mode hybride.

## Contenu

- `documents/` : les fichiers indexés par l'agent.
- `jeu.json` : les réponses attendues.
  - `classement` : catégorie, action requise (`true` ou `false`) et urgence (0, 1 ou 2) de chaque document ; l'urgence est omise quand elle prête à débat.
  - `recherche` : des requêtes et les documents qui y répondent.
  - `resume` : pour quelques documents, les faits qu'un bon résumé doit citer ; chaque fait liste ses variantes acceptées, comparées sans accents ni casse.
  - `criteres.toleranceQualite` : écart de qualité, en points sur 100, sous lequel le mode local est préféré.

## Créer son propre jeu

Copier ce dossier, remplacer les documents par un échantillon représentatif des vrais documents (vingt à cinquante suffisent pour trancher), puis adapter `jeu.json`. Les catégories attendues doivent exister dans les réglages de l'agent.
