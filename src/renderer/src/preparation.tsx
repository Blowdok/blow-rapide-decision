// « L'agent est-il prêt ? » : vérifie les services dont le mode choisi a besoin
// et dit, en termes simples, quoi faire s'il en manque un.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EtatService } from '../../partage/contrat';
import { PROFILS } from '../../partage/reglages';
import type { IdProfil } from '../../partage/types';
import { api, messageErreur } from './api';
import { Message, Pastille } from './composants';
import { useApplication } from './contexte';

/** Services dont chaque mode a besoin. */
const NECESSAIRES: Record<IdProfil, ReadonlyArray<EtatService['service']>> = {
  local: ['Ollama'],
  hybride: ['OpenRouter', 'Jev'],
  reference: []
};

/** Ce qu'est le service, en une phrase, et la page d'aide qui explique comment le préparer. */
const CONSEILS: Record<EtatService['service'], { texte: string; sujet: string }> = {
  Ollama: { texte: 'Ollama est le logiciel gratuit qui fait tourner l’IA sur ce PC.', sujet: 'ollama' },
  OpenRouter: { texte: 'Le mode hybride a besoin d’une clé OpenRouter, à coller dans Réglages.', sujet: 'openrouter' },
  Jev: { texte: 'Jev passe par la même clé OpenRouter.', sujet: 'openrouter' }
};

/**
 * `actif` : l'écran qui l'affiche est visible ; la vérification repart à chaque retour sur cet écran.
 * `apresVerification` : appelé après chaque vérification, par exemple pour relire la liste des modèles.
 */
export function EtatPreparation({ actif = true, apresVerification }: { actif?: boolean; apresVerification?: () => void }) {
  const { etat, enregistrerReglages, allerA } = useApplication();
  const [services, definirServices] = useState<EtatService[] | null>(null);
  const [enCours, definirEnCours] = useState(false);
  const [erreur, definirErreur] = useState<string | null>(null);
  // Le rappel peut changer à chaque rendu : on garde le dernier sans relancer la vérification.
  const rappel = useRef(apresVerification);
  useEffect(() => {
    rappel.current = apresVerification;
  });

  const verifier = useCallback(async () => {
    definirEnCours(true);
    definirErreur(null);
    try {
      definirServices(await api.services.diagnostic());
      rappel.current?.();
    } catch (e) {
      definirErreur(messageErreur(e));
    } finally {
      definirEnCours(false);
    }
  }, []);

  // La vérification est gratuite : elle part dès que l'écran s'affiche.
  useEffect(() => {
    if (actif) void verifier();
  }, [actif, verifier]);

  if (!etat) return null;
  const profil = etat.reglages.profil;
  const necessaires = NECESSAIRES[profil];
  const manquants = (services ?? []).filter((s) => necessaires.includes(s.service) && !s.ok);
  const libelle = PROFILS[profil].libelle;

  return (
    <div className="preparation" aria-live="polite">
      {services === null ? (
        <p className="preparation-verdict">
          {enCours ? 'Vérification en cours…' : erreur ? 'Vérification impossible pour l’instant.' : 'Pas encore vérifié.'}
        </p>
      ) : manquants.length === 0 ? (
        <p className="preparation-verdict">
          <Pastille ton="succes">Prêt</Pastille> Le mode {libelle} peut fonctionner
          {profil === 'reference' ? ' : il n’a besoin de rien d’autre.' : '.'}
        </p>
      ) : (
        <p className="preparation-verdict">
          <Pastille ton="alerte">À faire</Pastille> Le mode {libelle} n’est pas encore prêt : voir ci-dessous.
        </p>
      )}
      {services && (
        <ul className="diagnostic">
          {services.map((s) => {
            const utile = necessaires.includes(s.service);
            return (
              <li key={s.service}>
                <Pastille
                  ton={s.ok ? 'succes' : utile ? 'danger' : 'neutre'}
                  infobulle={
                    s.ok
                      ? 'Ce service répond : rien à faire.'
                      : utile
                        ? `Le mode ${libelle} a besoin de ce service : suivez le conseil à droite.`
                        : `Le mode ${libelle} n’a pas besoin de ce service : vous pouvez l’ignorer.`
                  }
                >
                  {s.ok ? 'prêt' : utile ? 'à corriger' : 'facultatif'}
                </Pastille>{' '}
                <strong>{s.service}</strong> : {s.detail}
                {!s.ok && utile && (
                  <span className="conseil">
                    {' '}
                    {CONSEILS[s.service].texte}{' '}
                    <button
                      type="button"
                      className="lien"
                      onClick={() => allerA('aide', CONSEILS[s.service].sujet)}
                      data-infobulle="Ouvre l’aide pas à pas pour préparer ce service."
                    >
                      Comment faire ?
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="actions">
        <button
          type="button"
          onClick={() => void verifier()}
          disabled={enCours}
          data-infobulle="Relance la vérification d’Ollama, d’OpenRouter et de Jev, par exemple après une installation. Gratuit."
        >
          {enCours ? 'Vérification…' : 'Vérifier à nouveau'}
        </button>
        {manquants.length > 0 && (
          <button
            type="button"
            onClick={() => void enregistrerReglages({ profil: 'reference' })}
            data-infobulle="Passe au mode Référence sans IA, qui marche sans rien installer. Vous pourrez revenir au mode choisi en haut de la fenêtre."
          >
            Essayer sans IA en attendant
          </button>
        )}
      </div>
      {erreur && <Message type="erreur">{erreur}</Message>}
    </div>
  );
}
