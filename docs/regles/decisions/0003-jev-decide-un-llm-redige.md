# RAD 0003 — Jev décide, un LLM rédige : modes local et hybride

Date : 25 septembre 2026. Décisions de Blowdok au cadrage : « OpenRouter » comme fournisseur cloud du mode hybride, et « faire recherche sur Jev ». Le reste découle de cette recherche ; c'est une proposition à valider.

## Contexte

Recherche du 25 septembre 2026 :

- Jev est le modèle « System One » de TypeSafe AI, lancé le 15 septembre 2026. Il ne rédige pas : il renvoie des décisions typées, avec probabilités et confiance. Trois types : oui ou non (`noul`), choix d'une étiquette (`choice`), note sur une échelle (`score`).
- Tarif public : 0,042 $ par million de jetons d'entrée, sortie gratuite. Latence annoncée : 70 à 500 ms. Limites : 64 000 jetons pour l'état et toutes les questions, 32 000 pour l'état et la plus longue question.
- Service hébergé uniquement, sans version locale officielle. Des modèles communautaires « OpenJev » (GGUF pour Ollama) existent ; ils n'ont pas été évalués.
- L'anglais est la langue la mieux traitée ; les autres langues le sont moins bien. La qualité en français doit donc être mesurée.
- SDK officiel : `@typesafe-ai/sdk` 0.6.0, publié sur npm par TypeSafe. OpenRouter sert Jev par la même API (`/api/v1/systemone`), avec la même clé que ses LLM, et renvoie le coût réel de chaque appel.
- Ollama 0.12.11 et plus renvoie les log-probabilités des jetons générés.

## Décision

- **Mode local** : tout reste sur la machine. Ollama décide et rédige (modèle par défaut `qwen3:8b`, réglable). Pour décider, chaque option reçoit une lettre ; les log-probabilités de la réponse donnent une distribution sur les options. Le mode local fournit ainsi des probabilités et une confiance comparables à celles de Jev.
- **Mode hybride** : extraction et index restent locaux. Jev décide (tri, pertinence) via OpenRouter, modèle `jev-latest`. Un LLM OpenRouter rédige les résumés, par défaut `~anthropic/claude-sonnet-latest`. L'accès direct à TypeSafe reste possible avec une clé TypeSafe.
- Avant tout envoi hors de la machine : masquage réversible des courriels, téléphones, IBAN, cartes bancaires (contrôle de Luhn) et numéros de sécurité sociale. OpenRouter exclut par défaut les fournisseurs qui collectent les données (`data_collection: deny`) ; la rétention nulle (ZDR) est en option.
- **Référence sans IA** : des heuristiques lexicales mesurent ce que l'IA apporte vraiment.
- Tous les modes répondent aux mêmes questions : triage en un seul appel de décision (catégorie, action requise, urgence de 0 à 2) et pertinence d'un passage pour une requête (oui ou non).

## Conséquences

- Le mode hybride exige une clé OpenRouter. Sans clé, il est marqué indisponible sans bloquer le reste.
- Le masquage ne couvre ni les noms de personnes ni les adresses postales.
- Le mode local demande un PC capable de faire tourner le modèle choisi ; les temps mesurés dépendent de cette machine.
- Reste à évaluer : un modèle OpenJev local comme moteur de décision, et un LLM local plus léger pour les résumés.
