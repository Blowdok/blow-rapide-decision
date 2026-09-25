// Petits composants d'interface réutilisés par les écrans.

import type { ReactNode } from 'react';
import { formaterDuree, formaterEntier, formaterPourcentage, formaterUsd } from '../../partage/format';
import type { Mesure } from '../../partage/types';
import { useApplication } from './contexte';

export function BarreProgression({ fait, total, libelle }: { fait: number; total: number; libelle: string }) {
  return (
    <div className="progression" role="status" aria-live="polite">
      <div className="progression-libelle">
        <span>{libelle}</span>
        <span>
          {fait}/{total}
        </span>
      </div>
      <progress max={Math.max(total, 1)} value={fait} />
    </div>
  );
}

/** Probabilité sous forme de jauge horizontale ; `aide` dit ce qu'elle mesure. */
export function Jauge({ valeur, libelle, aide }: { valeur: number; libelle?: string; aide?: string }) {
  const niveau = valeur >= 0.75 ? 'haute' : valeur >= 0.5 ? 'moyenne' : 'basse';
  const pourcentage = formaterPourcentage(valeur);
  return (
    <div className="jauge" data-infobulle={aide ? `${aide} : ${pourcentage}.` : `${libelle ?? 'Probabilité'} : ${pourcentage} selon l’agent.`}>
      {libelle && <span className="jauge-libelle">{libelle}</span>}
      <span className="jauge-piste">
        <span className={`jauge-valeur jauge-${niveau}`} style={{ width: `${Math.round(valeur * 100)}%` }} />
      </span>
      <span className="jauge-texte">{formaterPourcentage(valeur)}</span>
    </div>
  );
}

export function Message({ type, children }: { type: 'erreur' | 'info' | 'succes' | 'alerte'; children: ReactNode }) {
  return (
    <div className={`message message-${type}`} role={type === 'erreur' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Sujet de l'aide qui explique comment réparer une erreur, s'il y en a un. */
function sujetDeLErreur(message: string): string | null {
  if (/ollama/i.test(message)) return 'ollama';
  if (/openrouter|typesafe|clé|crédit/i.test(message)) return 'openrouter';
  return null;
}

/** Message d'erreur suivi, quand c'est utile, d'un lien vers l'aide qui explique quoi faire. */
export function MessageErreur({ message }: { message: string }) {
  const { allerA } = useApplication();
  const sujet = sujetDeLErreur(message);
  return (
    <Message type="erreur">
      {message}
      {sujet && (
        <>
          {' '}
          <button
            type="button"
            className="lien"
            onClick={() => allerA('aide', sujet)}
            data-infobulle="Ouvre l’aide qui explique comment régler ce problème."
          >
            Comment faire ?
          </button>
        </>
      )}
    </Message>
  );
}

export function Pastille({
  ton,
  infobulle,
  children
}: {
  ton: 'neutre' | 'accent' | 'succes' | 'alerte' | 'danger';
  /** Ce que signifie la pastille, affiché au survol. */
  infobulle?: string;
  children: ReactNode;
}) {
  return (
    <span className={`pastille pastille-${ton}`} {...(infobulle ? { 'data-infobulle': infobulle } : {})}>
      {children}
    </span>
  );
}

/** Bilan d'une opération, en clair : qui l'a faite, en combien de temps, pour quel coût, et ce qui a quitté le PC. */
export function BilanMesures({ mesures }: { mesures: Mesure[] }) {
  const duree = mesures.reduce((s, m) => s + m.dureeMs, 0);
  const cout = mesures.reduce((s, m) => s + m.coutUsd, 0);
  const distantes = mesures.filter((m) => m.horsMachine);
  const envoyes = distantes.reduce((s, m) => s + m.caracteresEnvoyes, 0);
  const masques = distantes.reduce((s, m) => s + m.elementsMasques, 0);
  const moteurs = [...new Set(mesures.map((m) => `${m.moteur} (${m.modele})`))].join(', ');
  return (
    <p
      className="bilan"
      data-infobulle="Qui a fait ce travail, en combien de temps, pour quel coût, et ce qui a quitté ce PC. Le détail des envois est dans Réglages, rubrique Confidentialité."
    >
      Fait par {moteurs} en {formaterDuree(duree)} · {cout > 0 ? `coût ${formaterUsd(cout)}` : 'gratuit'} ·{' '}
      {distantes.length
        ? `${formaterEntier(envoyes)} caractères envoyés sur Internet, ${formaterEntier(masques)} données personnelles masquées`
        : 'rien n’a quitté ce PC'}
    </p>
  );
}

const LIBELLES_URGENCE = ['Aucune', 'Bientôt', 'Urgente'];
const AIDES_URGENCE = ['Rien à faire, ou pas de délai', 'À traiter dans les semaines qui viennent', 'Échéance proche, relance ou pénalités'];

export function libelleUrgence(note: number): string {
  return LIBELLES_URGENCE[Math.min(2, Math.max(0, Math.round(note)))] ?? '';
}

export function Urgence({ note }: { note: number }) {
  const niveau = Math.min(2, Math.max(0, Math.round(note)));
  const ton = (['neutre', 'alerte', 'danger'] as const)[niveau] ?? 'neutre';
  return (
    <Pastille ton={ton} infobulle={`Urgence : ${AIDES_URGENCE[niveau]?.toLowerCase() ?? ''}.`}>
      {libelleUrgence(note)}
    </Pastille>
  );
}
