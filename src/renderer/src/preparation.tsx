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

/** `apresVerification` : appelé après chaque vérification, par exemple pour relire la liste des modèles. */
export function EtatPreparation({ apresVerification }: { apresVerification?: () => void } = {}) {
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

  // La vérification est gratuite : elle part dès l'affichage.
  useEffect(() => {
    void verifier();
  }, [verifier]);

  if (!etat) return null;
  const profil = etat.reglages.profil;
  const necessaires = NECESSAIRES[profil];
  const manquants = (services ?? []).filter((s) => necessaires.includes(s.service) && !s.ok);
  const libelle = PROFILS[profil].libelle;

  return (
    <div className="preparation" aria-live="polite">
      {services === null ? (
        <p className="preparation-verdict">{enCours ? 'Vérification en cours…' : 'Vérification impossible pour l’instant.'}</p>
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
                <Pastille ton={s.ok ? 'succes' : utile ? 'danger' : 'neutre'}>{s.ok ? 'prêt' : utile ? 'à corriger' : 'facultatif'}</Pastille>{' '}
                <strong>{s.service}</strong> : {s.detail}
                {!s.ok && utile && (
                  <span className="conseil">
                    {' '}
                    {CONSEILS[s.service].texte}{' '}
                    <button type="button" className="lien" onClick={() => allerA('aide', CONSEILS[s.service].sujet)}>
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
        <button type="button" onClick={() => void verifier()} disabled={enCours}>
          {enCours ? 'Vérification…' : 'Vérifier à nouveau'}
        </button>
        {manquants.length > 0 && (
          <button type="button" onClick={() => void enregistrerReglages({ profil: 'reference' })}>
            Essayer sans IA en attendant
          </button>
        )}
      </div>
      {erreur && <Message type="erreur">{erreur}</Message>}
    </div>
  );
}
