// Petits composants d'interface réutilisés par les écrans.

import type { ReactNode } from 'react';
import { formaterDuree, formaterEntier, formaterPourcentage, formaterUsd } from '../../partage/format';
import type { Mesure } from '../../partage/types';

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

/** Probabilité sous forme de jauge horizontale. */
export function Jauge({ valeur, libelle }: { valeur: number; libelle?: string }) {
  const niveau = valeur >= 0.75 ? 'haute' : valeur >= 0.5 ? 'moyenne' : 'basse';
  return (
    <div className="jauge" title={formaterPourcentage(valeur)}>
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

export function Pastille({ ton, children }: { ton: 'neutre' | 'accent' | 'succes' | 'alerte' | 'danger'; children: ReactNode }) {
  return <span className={`pastille pastille-${ton}`}>{children}</span>;
}

/** Bilan d'une opération : temps, coût, données envoyées hors de la machine. */
export function BilanMesures({ mesures }: { mesures: Mesure[] }) {
  const duree = mesures.reduce((s, m) => s + m.dureeMs, 0);
  const cout = mesures.reduce((s, m) => s + m.coutUsd, 0);
  const distantes = mesures.filter((m) => m.horsMachine);
  const envoyes = distantes.reduce((s, m) => s + m.caracteresEnvoyes, 0);
  const masques = distantes.reduce((s, m) => s + m.elementsMasques, 0);
  const moteurs = [...new Set(mesures.map((m) => `${m.moteur} (${m.modele})`))].join(', ');
  return (
    <p className="bilan">
      {moteurs} · {formaterDuree(duree)} · {formaterUsd(cout)} ·{' '}
      {distantes.length
        ? `${formaterEntier(envoyes)} caractères envoyés hors de la machine, ${formaterEntier(masques)} données masquées`
        : 'rien n’a quitté la machine'}
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
    <span title={AIDES_URGENCE[niveau]}>
      <Pastille ton={ton}>{libelleUrgence(note)}</Pastille>
    </span>
  );
}
