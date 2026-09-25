# RAD 0007 — Utiliser Secret Service sous Hyprland pour protéger les clés

Date : 25 septembre 2026. Décision technique prise après le signalement de Blowdok : l’application refusait d’enregistrer une clé sur son poste Hyprland.

## Contexte

- Sous Hyprland, Electron choisissait le backend `basic_text`, qui ne chiffre pas réellement les secrets.
- L’application refuse déjà d’enregistrer une clé Linux si `safeStorage` n’est pas disponible ou si ce backend non chiffré est sélectionné.
- Le poste dispose du service de clés système compatible avec `gnome-libsecret`.

## Décision

- Au démarrage, uniquement sous Linux quand `XDG_CURRENT_DESKTOP` contient `Hyprland`, ajouter à Electron l’option `password-store=gnome-libsecret`.
- Conserver le contrôle de `safeStorage` : si le backend chiffré n’est toujours pas disponible, l’enregistrement reste refusé.
- Ne jamais ajouter de repli en clair, ni journaliser ou versionner une clé.

## Conséquences

- Sur ce poste, le champ de clé peut être activé lorsque Secret Service est effectivement accessible; Blowdok saisit sa clé localement, jamais dans le chat.
- Les autres environnements Linux, macOS et Windows ne changent pas de backend.
- Les tests unitaires vérifient la sélection sous Hyprland et l’absence de changement ailleurs. La clé réelle n’a pas été saisie pendant le correctif.
