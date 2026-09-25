// Mise en forme française des nombres, durées et montants. Sans dépendance à Node.

const entier = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const pourcent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });

export const TIRET = '–';

export function formaterEntier(n: number): string {
  return entier.format(n);
}

export function formaterNombre(n: number | null, decimales = 1): string {
  if (n === null) return TIRET;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimales }).format(n);
}

export function formaterPourcentage(taux: number | null): string {
  return taux === null ? TIRET : pourcent.format(taux);
}

/** « 850 ms », « 2,3 s », « 2 min 10 s ». */
export function formaterDuree(ms: number | null): string {
  if (ms === null) return TIRET;
  if (ms < 1000) return `${entier.format(ms)} ms`;
  if (ms < 60_000) return `${decimal.format(ms / 1000)} s`;
  const minutes = Math.floor(ms / 60_000);
  const secondes = Math.round((ms % 60_000) / 1000);
  return secondes ? `${minutes} min ${secondes} s` : `${minutes} min`;
}

/** Montant en dollars : deux chiffres significatifs sous le centime. */
export function formaterUsd(usd: number | null): string {
  if (usd === null) return TIRET;
  if (usd === 0) return '0 $';
  const options: Intl.NumberFormatOptions =
    Math.abs(usd) < 0.01 ? { maximumSignificantDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `${new Intl.NumberFormat('fr-FR', options).format(usd)} $`;
}

/** Termine une phrase par un point, sauf si elle finit déjà par une ponctuation forte. */
export function finPhrase(texte: string): string {
  const net = texte.trim();
  return /[.!?…]$/.test(net) ? net : `${net}.`;
}
