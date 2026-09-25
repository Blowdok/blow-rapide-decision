// Recommandation transparente : le mode local l'emporte tant que l'écart de
// qualité avec le mode hybride reste dans la tolérance du jeu ; au-delà, le
// mode hybride est recommandé, avec son coût et ce qu'il envoie hors de la machine.

import { LIBELLES_STATUT, type Recommandation, type ResultatProfil } from '../../partage/banc';
import { finPhrase, formaterDuree, formaterEntier, formaterNombre, formaterUsd } from '../../partage/format';

/** En dessous, le jeu est trop petit pour trancher sereinement. */
export const DOCUMENTS_CONSEILLES = 20;

const points = (n: number): string => `${formaterNombre(n)} point${Math.abs(n) >= 2 ? 's' : ''}`;

export function recommander(profils: ResultatProfil[], toleranceQualite: number, nombreDocuments: number): Recommandation {
  const avertissements: string[] = [];
  for (const p of profils) {
    if (p.statut !== 'termine') {
      avertissements.push(finPhrase(`Mode ${p.libelle} ${LIBELLES_STATUT[p.statut]} : ${p.message ?? 'raison inconnue'}`));
    } else if (p.message) {
      // Des erreurs isolées comptent comme des réponses fausses : sa qualité est peut-être sous-estimée.
      avertissements.push(finPhrase(`Mode ${p.libelle} : ${p.message}`));
    }
  }
  if (nombreDocuments < DOCUMENTS_CONSEILLES) {
    avertissements.push(
      `Jeu de ${nombreDocuments} documents : résultat indicatif. Visez ${DOCUMENTS_CONSEILLES} à 50 documents représentatifs pour trancher.`
    );
  }

  const disponible = (id: ResultatProfil['profil']): (ResultatProfil & { q: number }) | undefined => {
    const p = profils.find((x) => x.profil === id && x.statut === 'termine' && x.metriques.qualite !== null);
    return p ? { ...p, q: p.metriques.qualite as number } : undefined;
  };
  const local = disponible('local');
  const hybride = disponible('hybride');
  const reference = disponible('reference');

  let recommande: (ResultatProfil & { q: number }) | undefined;
  let titre: string;
  const raisons: string[] = [];

  if (local && hybride) {
    const ecart = hybride.q - local.q;
    const envoye = hybride.metriques.confidentialite;
    const coutHybride = formaterUsd(hybride.metriques.cout.pour1000DocumentsUsd);
    if (ecart <= toleranceQualite) {
      recommande = local;
      titre = 'Mode recommandé : local';
      raisons.push(
        `Qualité : ${formaterNombre(local.q)}/100 en local contre ${formaterNombre(hybride.q)}/100 en hybride. ` +
          (ecart > 0
            ? `L’écart de ${points(ecart)} reste dans la tolérance de ${formaterNombre(toleranceQualite)}.`
            : 'Le local fait au moins aussi bien.'),
        `Confidentialité : rien ne quitte la machine, contre ${formaterEntier(envoye.caracteresEnvoyes)} caractères envoyés en hybride pendant ce banc.`,
        `Coût d’usage nul, contre environ ${coutHybride} pour 1 000 documents triés et résumés en hybride.`
      );
    } else {
      recommande = hybride;
      titre = 'Mode recommandé : hybride';
      raisons.push(
        `Qualité : ${formaterNombre(hybride.q)}/100 en hybride contre ${formaterNombre(local.q)}/100 en local, soit ${points(ecart)} de plus, au-delà de la tolérance de ${formaterNombre(toleranceQualite)}.`,
        `Coût estimé : ${coutHybride} pour 1 000 documents triés et résumés.`,
        `Confidentialité : ${formaterEntier(envoye.caracteresEnvoyes)} caractères envoyés hors de la machine pendant ce banc, ` +
          `${formaterEntier(envoye.elementsMasques)} données personnelles masquées avant envoi.`
      );
      if (envoye.caracteresEnvoyes > 0 && envoye.elementsMasques === 0) {
        avertissements.push('Aucune donnée personnelle masquée en hybride : vérifiez que le masquage est activé.');
      }
    }
    raisons.push(
      `Vitesse : un triage prend ${formaterDuree(local.metriques.temps.triageMoyenMs)} en local contre ${formaterDuree(hybride.metriques.temps.triageMoyenMs)} en hybride.`
    );
  } else if (local || hybride) {
    recommande = local ?? hybride;
    titre = `Comparaison incomplète : seul le mode ${recommande?.libelle ?? ''} a tourné`;
    raisons.push(`Qualité du mode ${recommande?.libelle} : ${formaterNombre(recommande?.q ?? null)}/100.`);
    avertissements.push('Relancez le banc une fois les deux modes disponibles pour trancher.');
  } else {
    titre = "Aucun mode IA n’a pu tourner";
    avertissements.push('Vérifiez Ollama (mode local) et la clé OpenRouter (mode hybride) dans les réglages.');
  }

  if (recommande && reference) {
    const gain = recommande.q - reference.q;
    raisons.push(`Apport de l’IA : ${gain >= 0 ? '+' : ''}${points(gain)} par rapport à la référence sans IA.`);
    if (gain < toleranceQualite) {
      avertissements.push(
        `L’IA ne fait guère mieux que la référence sans IA sur ce jeu (${points(gain)}) : enrichissez le jeu avant de trancher.`
      );
    }
  }

  return { profil: recommande?.profil ?? null, titre, raisons, avertissements };
}
