# RAD 0003 — Jev décide, un LLM rédige : modes local et hybride

Date : 25 septembre 2026. Décisions de Blowdok :

- au cadrage, « OpenRouter » comme fournisseur cloud du mode hybride, et « faire recherche sur Jev » ;
- ensuite, les modèles. En local, des petits modèles déjà installés, car sur son PC « les 7b, 8b et + seront difficile ». En hybride, « pour OpenRouter choisi qwen-3.8-flash et Jev bien entendu ».

Le reste découle de la recherche et reste une proposition à valider.

## Contexte

Recherche du 25 septembre 2026 :

- Jev est le modèle « System One » de TypeSafe AI, lancé le 15 septembre 2026. Il ne rédige pas : il renvoie des décisions typées, avec probabilités et confiance. Trois types : oui ou non (`noul`), choix d'une étiquette (`choice`), note sur une échelle (`score`).
- Tarif public : 0,042 $ par million de jetons d'entrée, sortie gratuite. Latence annoncée : 70 à 500 ms. Limites : 64 000 jetons pour l'état et toutes les questions, 32 000 pour l'état et la plus longue question.
- Service hébergé uniquement, sans version locale officielle. Des modèles communautaires « OpenJev » (GGUF pour Ollama) existent ; ils n'ont pas été évalués.
- L'anglais est la langue la mieux traitée ; les autres langues le sont moins bien. La qualité en français doit donc être mesurée.
- SDK officiel : `@typesafe-ai/sdk` 0.6.0, publié sur npm par TypeSafe. OpenRouter sert Jev par la même API (`/api/v1/systemone`), avec la même clé que ses LLM, et renvoie le coût réel de chaque appel.
- Ollama 0.12.11 et plus renvoie les log-probabilités des jetons générés.
- Modèles installés sur le PC de Blowdok, sans les modèles de 7B et plus : `qwen3.5:4b`, `gemma3:4b`, `nemotron-3-nano:4b`, `granite4.2:3b`, `falcon3:3b`, `gemma4:e2b`, `minicpm-v4.6:1b` (vision), `embeddinggemma` et `nomic-embed-text-v2-moe` (plongements vectoriels).
- Qwen3.5 4B couvre 201 langues et dialectes ; il réfléchit par défaut, et Ollama coupe cette réflexion avec `think: false`.
- Qwen3.8 Flash (`qwen/qwen3.8-flash` sur OpenRouter), d'Alibaba, est sorti le 26 août 2026. Tarif : 0,15 $ par million de jetons d'entrée et 0,47 $ en sortie. C'est un modèle à raisonnement, servi par un seul fournisseur. Ses jetons de raisonnement comptent dans la limite `max_tokens`.

## Décision

- **Mode local** : tout reste sur la machine. Ollama décide et rédige avec `qwen3.5:4b` : un seul modèle chargé en mémoire. Les autres petits modèles installés restent au choix dans les réglages. Pour décider, chaque option reçoit une lettre ; les log-probabilités de la réponse donnent une distribution sur les options. Le mode local fournit ainsi des probabilités et une confiance comparables à celles de Jev.
- **Mode hybride** : extraction et index restent locaux. Jev décide (tri, pertinence) via OpenRouter, modèle `jev-latest`. Qwen3.8 Flash (`qwen/qwen3.8-flash`) rédige les résumés, raisonnement désactivé (`reasoning.enabled: false`). Si le modèle impose son raisonnement, le moteur le réduit au minimum et élargit la limite de jetons. L'accès direct à TypeSafe reste possible avec une clé TypeSafe.
- Avant tout envoi hors de la machine : masquage réversible des courriels, téléphones, IBAN, cartes bancaires (contrôle de Luhn) et numéros de sécurité sociale. OpenRouter exclut par défaut les fournisseurs qui collectent les données (`data_collection: deny`) ; la rétention nulle (ZDR) est en option.
- **Référence sans IA** : des heuristiques lexicales mesurent ce que l'IA apporte vraiment.
- Tous les modes répondent aux mêmes questions : triage en un seul appel de décision (catégorie, action requise, urgence de 0 à 2) et pertinence d'un passage pour une requête (oui ou non).

## Conséquences

- Le mode hybride exige une clé OpenRouter. Sans clé, il est marqué indisponible sans bloquer le reste.
- Qwen3.8 Flash n'a qu'un fournisseur. S'il est classé comme collectant les données, le refus de collecte bloque les résumés hybrides. L'erreur indique alors le réglage à décocher ; à Blowdok de choisir entre ce réglage et un autre modèle.
- Le masquage ne couvre ni les noms de personnes ni les adresses postales.
- Les temps du mode local dépendent du PC de Blowdok.
- Reste à évaluer :
  - les autres petits modèles installés, comparés un par un dans le banc ;
  - un modèle OpenJev local comme moteur de décision ;
  - les modèles de plongement (`embeddinggemma`, `nomic-embed-text-v2-moe`) pour une recherche sémantique ;
  - `minicpm-v4.6:1b` pour lire les PDF scannés.
- Ces deux dernières pistes sont devenues des options facultatives : [RAD 0005](0005-options-semantique-et-ocr.md).
