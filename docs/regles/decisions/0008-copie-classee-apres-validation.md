# RAD 0008 — Prévisualiser puis créer une copie rangée

Date : 25 septembre 2026. Décision prise à la suite du retour de Blowdok : « Je croyais qu’il allait les classer lui-même » et souhait d’utiliser Jev à bon escient.

## Contexte

- Le triage existant propose une catégorie, une action et une urgence, mais ne matérialise pas le rangement dans des dossiers.
- Le rôle de Jev est de produire une décision typée sur le sens du document; le code doit appliquer le rangement, sans confondre proposition et décision irréversible.
- Les documents source peuvent être privés; l’utilisateur doit savoir quel moteur a pris la décision et ce qui sera copié.

## Décision

- Après le triage complet avec le mode sélectionné, proposer un aperçu de tous les documents lus : destination par fichier, action, urgence et confiance.
- Préremplir la destination avec la catégorie proposée; envoyer par défaut les résultats incertains dans « À vérifier ». Blowdok peut corriger chaque destination avant de confirmer.
- Demander un dossier parent, puis créer sous celui-ci un nouveau dossier portant le nom du dossier source suivi de « - classé », avec des sous-dossiers par destination et les chemins internes conservés.
- Copier les fichiers; ne jamais les déplacer, les supprimer ni remplacer une sortie existante. Refuser une destination située dans la source, un chemin relatif dangereux, un lien symbolique, ou un fichier modifié depuis son classement. Nettoyer uniquement une copie partielle créée par l’opération si elle échoue.
- Écrire dans la copie un `Bilan du classement.csv` qui conserve, par document, la catégorie proposée et retenue, l’action, l’urgence, la confiance, le moteur, le modèle et le coût observé. Neutraliser les valeurs qui pourraient devenir des formules de tableur.
- Utiliser les décisions du mode actif : Jev uniquement en mode Hybride, Ollama en mode Local, et aucun moteur IA en mode Référence. La copie et la génération du bilan ne déclenchent aucun appel réseau.

## Conséquences

- L’utilisateur voit et peut corriger les décisions avant le rangement; les originaux restent intacts.
- L’intérêt de Jev demeure à mesurer face au modèle local et à la référence, sur un jeu de documents représentatif et avec les coûts observés.
- Aucun appel Jev réel ni document personnel n’a été utilisé pour implémenter ou tester cette fonction. Un essai hybride ultérieur doit être autorisé avant l’envoi de texte à un fournisseur externe et avant tout coût.
- Si le dossier de sortie existe déjà, l’application refuse l’écrasement et demande de choisir un autre emplacement.
