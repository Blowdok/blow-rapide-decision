# RAD 0006 — L'interface s'adresse à un débutant

Date : 25 septembre 2026. Décision de Blowdok : « L'interface doit être intuitive pour qu'un débutant novice puisse utiliser ».

## Contexte

- La première interface parlait le langage du code : « indexer », « trier », « rang lexical », « jetons », « ZDR », « plongement ».
- Tous les réglages tenaient sur une page, du plus simple (la clé OpenRouter) au plus technique (taille de contexte, seuils, catégories).
- Au premier lancement, rien n'indiquait par où commencer. Le mode par défaut est Local : sans Ollama, la première action échouait avec un message technique.
- Aucune aide n'était intégrée : installer Ollama ou obtenir une clé OpenRouter supposait de lire le README.

## Décision

- **Accueil en trois étapes** quand aucun dossier n'est ouvert : vérifier que l'agent est prêt, choisir un dossier, puis classer, chercher et résumer.
- **« L'agent est-il prêt ? »** :
  - à l'ouverture de l'accueil et des réglages, l'agent vérifie les services utiles au mode choisi, sans aucun appel payant ;
  - il donne un verdict simple (« Prêt » ou « À faire »), le conseil pour réparer et un lien vers l'aide ;
  - un bouton propose le mode sans IA en attendant.
- **Écran Aide** : questions courantes en langage simple, dans des blocs repliables. Il couvre les premiers pas, le choix du mode, l'installation d'Ollama, la clé OpenRouter, la confidentialité, la confiance, les options, la comparaison et les problèmes courants. Les commandes se copient d'un clic. Les liens « Comment faire ? » et « Quel mode choisir ? » l'ouvrent sur la bonne question.
- **Vocabulaire simple dans l'interface** :
  - « Classer » plutôt que « trier », « Actualiser » et « lecture du dossier » plutôt qu'« indexer » ;
  - « Action à faire », « Répond à la question » ;
  - « Trouvé par les mots » ou « par le sens » à la place des rangs, gardés dans l'infobulle ;
  - « ce PC », « sur Internet », « gratuit ».

  Le code, la ligne de commande et les rapports du banc gardent leurs termes techniques.
- **Réglages** :
  - l'essentiel d'abord : préparation, clé OpenRouter, confidentialité, options ;
  - modèles, seuils, catégories et paramètres techniques n'apparaissent qu'avec « Afficher les réglages avancés », un choix mémorisé ;
  - la barre « Enregistrer » reste visible et signale les modifications à enregistrer.
- **Guidage pas à pas** :
  - l'étape suivante est indiquée (« Classer les N documents ») et les documents « à vérifier » sont signalés ;
  - la recherche propose trois questions d'exemple cliquables ;
  - une erreur liée à Ollama ou à une clé renvoie vers l'aide.

## Conséquences

- Un débutant peut démarrer seul. S'il n'a pas Ollama, il est dirigé vers l'installation ou vers le mode sans IA.
- L'écran Comparaison et le rapport du banc restent techniques : ils servent à trancher entre les modes.
- Le texte de l'aide doit suivre l'application : modèles par défaut, noms des boutons.
- Reste à faire : observer un vrai débutant suivre les trois étapes sans aide, et noter où il bloque.
