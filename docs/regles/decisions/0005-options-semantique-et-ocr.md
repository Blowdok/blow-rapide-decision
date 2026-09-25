# RAD 0005 — Recherche sémantique et lecture des PDF scannés, en options locales

Date : 25 septembre 2026. Décision de Blowdok, à propos des deux pistes notées au [RAD 0003](0003-jev-decide-un-llm-redige.md) : « implémente ses deux pistes en option, pas une obligation pour fonctionner ».

## Contexte

- Deux pistes restaient ouvertes : une recherche sémantique avec les modèles de plongement déjà installés (`embeddinggemma`, `nomic-embed-text-v2-moe`), et la lecture des PDF scannés avec `minicpm-v4.6:1b`, un modèle de vision.
- Sans elles, la recherche ne trouve que les passages qui partagent des mots avec la requête (BM25). Un PDF scanné n'a pas de texte : il est signalé, puis ignoré.
- Ollama calcule des plongements par `/api/embed` : une liste de textes, un vecteur par texte. Par défaut, un texte trop long pour le modèle est coupé (`truncate`).
- EmbeddingGemma attend une invite : `task: search result | query: …` pour une requête, `title: … | text: …` pour un document. nomic-embed-text-v2-moe attend `search_query: ` et `search_document: `, lit 512 jetons au plus et couvre une centaine de langues.
- `/api/chat` d'Ollama accepte des images en base64 dans les messages : c'est ainsi qu'un modèle de vision lit une page.
- PDF.js (par `unpdf`) décode les images d'une page. La fonction `extractImages` d'`unpdf` ignore les images à 1 bit par pixel, courantes dans les scans en noir et blanc. Le code lit donc lui-même les images décodées par PDF.js.
- L'environnement de construction n'a ni Ollama ni ces modèles. Les deux options ont été vérifiées avec des réponses simulées au format d'Ollama, sans les vrais modèles.

## Décision

- **Deux options, désactivées par défaut**, réglées dans Réglages (« Options locales facultatives ») ou, pour la ligne de commande, par `BRD_SEMANTIQUE=1` et `BRD_OCR=1`. Désactivées, elles ne changent rien : même texte extrait, mêmes résultats.
- Elles passent par l'Ollama des réglages, dans tous les modes : l'extraction et l'index restent locaux, même en mode hybride. Elles s'appliquent à la prochaine indexation d'un dossier.
- **Recherche sémantique** :
  - modèle `embeddinggemma` par défaut, avec les invites de sa famille ; `nomic-embed-text-v2-moe` reçoit les siennes, tout autre modèle le texte seul ;
  - chaque passage est plongé à l'indexation avec le nom de son document, par lots de 16. Les vecteurs restent en mémoire : une réindexation ne recalcule que les passages nouveaux ou modifiés ;
  - à chaque recherche, la requête est plongée. Les 50 premiers passages de BM25 et les 50 plus proches par le sens sont fusionnés par rang réciproque (k = 60), puis le moteur de décision juge la pertinence, comme avant.
- **Lecture des PDF scannés** :
  - une page de PDF avec moins de 40 caractères visibles est lue par `minicpm-v4.6:1b` ;
  - le code prend la plus grande image de la page (300 pixels de côté au moins), la réduit à 1 600 pixels au plus, puis l'envoie en PNG avec une consigne en français, qui évite une traduction ;
  - 10 pages au plus par document, réglable ;
  - le texte lu est gardé par page, sous une empreinte du fichier : dans le dossier de données de l'application, ou en mémoire pour la ligne de commande. Les mêmes pages ne sont pas relues.
- **Échec sans blocage** :
  - si les plongements échouent, la recherche par mots-clés prend le relais, avec un avis ;
  - si le modèle de vision échoue, la lecture OCR s'arrête pour le reste de l'indexation, et chaque PDF scanné non lu indique pourquoi ;
  - une indexation longue peut être annulée : le dossier déjà ouvert reste en place.
- **Banc** : quand la recherche sémantique est active, le rapport ajoute le classement fusionné sans décision à côté de la recherche lexicale seule. On mesure ainsi l'apport des plongements, indépendamment des modes.
- **Confidentialité** : si Ollama tourne sur une autre machine, les plongements et les pages scannées sont comptés comme des envois hors de la machine et inscrits au journal.

## Conséquences

- L'indexation dure plus longtemps avec les options : un calcul de vecteurs par passage et, pour chaque page scannée, plusieurs secondes selon le PC.
- Les vecteurs ne sont pas gardés entre deux lancements : rouvrir un dossier les recalcule.
- Limites de la lecture OCR :
  - seule la plus grande image d'une page est lue ; un scan découpé en bandes ne l'est qu'en partie ;
  - les images que PDF.js ne sait pas décoder sont ignorées ;
  - une page avec peu de texte et une grande photo peut être lue à tort ;
  - le cache garde le texte des pages scannées dans le dossier de données de l'application, sur le PC. Les noms de fichiers sont des empreintes.
- À faire sur le PC de Blowdok, avec les vrais modèles :
  - mesurer l'apport de la recherche fusionnée sur le jeu de démonstration, puis sur de vrais documents ;
  - comparer `embeddinggemma` et `nomic-embed-text-v2-moe` avec le banc ;
  - juger la lecture en français de `minicpm-v4.6:1b` sur quelques vrais scans.
