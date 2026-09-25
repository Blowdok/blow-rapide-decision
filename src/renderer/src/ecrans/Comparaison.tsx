import { useEffect, useState } from 'react';
import type { ResultatComparaison } from '../../../partage/contrat';
import { formaterNombre, formaterPourcentage } from '../../../partage/format';
import { PROFILS } from '../../../partage/reglages';
import { celluleClassement, libelleAttente, lignesSynthese, syntheseRechercheLexicale } from '../../../partage/synthese';
import type { IdProfil } from '../../../partage/types';
import { api, messageErreur } from '../api';
import { BarreProgression, Message } from '../composants';
import { useApplication } from '../contexte';

const ETAPES = { classement: 'classement', recherche: 'recherche', resume: 'résumés' } as const;

function Resultats({ comparaison }: { comparaison: ResultatComparaison }) {
  const { resultat } = comparaison;
  const { recommandation, profils } = resultat;
  const lexicale = syntheseRechercheLexicale(resultat);
  const reference = profils.find((p) => p.classement.length);
  return (
    <>
      <section className={`recommandation ${recommandation.profil ? `recommandation-${recommandation.profil}` : ''}`}>
        <h2>{recommandation.titre}</h2>
        <ul>
          {recommandation.raisons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {recommandation.avertissements.map((a) => (
          <Message key={a} type="alerte">
            {a}
          </Message>
        ))}
      </section>

      <div className="table-defilante">
        <table className="synthese">
          <thead>
            <tr>
              <th>Critère</th>
              {profils.map((p) => (
                <th key={p.profil}>{p.libelle}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignesSynthese(profils).map((ligne) => (
              <tr key={ligne.libelle} className={ligne.importante ? 'importante' : undefined}>
                <th scope="row">{ligne.libelle}</th>
                {ligne.valeurs.map((v, i) => (
                  <td key={profils[i]?.profil ?? i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="indice">
        Recherche lexicale seule, commune à tous les modes : pertinent en tête {formaterPourcentage(lexicale.enTete)}, rang
        réciproque moyen {formaterNombre(lexicale.mrr, 2)}.
      </p>

      {reference && (
        <details className="bloc">
          <summary>Classement, document par document</summary>
          <div className="table-defilante">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Attendu</th>
                  {profils.map((p) => (
                    <th key={p.profil}>{p.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reference.classement.map((c, i) => (
                  <tr key={c.attendu.document}>
                    <td>{c.attendu.document}</td>
                    <td>{libelleAttente(c)}</td>
                    {profils.map((p) => (
                      <td key={p.profil}>{celluleClassement(p.classement[i])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {resultat.rechercheLexicale.length > 0 && (
        <details className="bloc">
          <summary>Recherche, requête par requête (rang du document attendu)</summary>
          <div className="table-defilante">
            <table>
              <thead>
                <tr>
                  <th>Requête</th>
                  <th>Lexical seul</th>
                  {profils.map((p) => (
                    <th key={p.profil}>{p.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultat.rechercheLexicale.map((r, i) => (
                  <tr key={r.requete}>
                    <td>{r.requete}</td>
                    <td>{r.rangPertinent ?? 'absent'}</td>
                    {profils.map((p) => {
                      const rp = p.recherche[i];
                      return <td key={p.profil}>{!rp ? '–' : rp.erreur ? 'erreur' : (rp.rangPertinent ?? 'absent')}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

export function EcranComparaison() {
  const { progression } = useApplication();
  const [jeu, definirJeu] = useState('');
  const [profils, definirProfils] = useState<IdProfil[]>(['local', 'hybride', 'reference']);
  const [comparaison, definirComparaison] = useState<ResultatComparaison | null>(null);
  const [enCours, definirEnCours] = useState(false);
  const [erreur, definirErreur] = useState<string | null>(null);
  const [info, definirInfo] = useState<string | null>(null);

  useEffect(() => {
    void api.banc.jeuParDefaut().then(definirJeu);
  }, []);

  const basculer = (id: IdProfil) =>
    definirProfils((actuels) => (actuels.includes(id) ? actuels.filter((p) => p !== id) : [...actuels, id]));

  const lancer = async () => {
    definirEnCours(true);
    definirErreur(null);
    definirInfo(null);
    try {
      // Ordre stable : local, hybride, référence.
      const ordonnes = (Object.keys(PROFILS) as IdProfil[]).filter((p) => profils.includes(p));
      definirComparaison(await api.banc.lancer(jeu, ordonnes));
    } catch (e) {
      definirErreur(messageErreur(e));
    } finally {
      definirEnCours(false);
    }
  };

  const exporter = async () => {
    try {
      const chemin = await api.banc.exporter();
      if (chemin) definirInfo(`Rapport enregistré : ${chemin} (et les données en .json à côté).`);
    } catch (e) {
      definirErreur(messageErreur(e));
    }
  };

  const choisirJeu = async () => {
    const chemin = await api.banc.choisirJeu();
    if (chemin) definirJeu(chemin);
  };

  return (
    <section className="ecran">
      <h1>Comparaison des modes</h1>
      <p className="indice">
        Le banc fait passer le même jeu d’évaluation à chaque mode (mêmes documents, mêmes questions) et mesure qualité, temps,
        coût et données envoyées hors de la machine. Le mode local est recommandé tant que l’hybride ne le dépasse pas de plus
        que la tolérance du jeu.
      </p>

      <div className="formulaire">
        <label className="champ">
          <span>Jeu d’évaluation</span>
          <span className="ligne">
            <input type="text" value={jeu} onChange={(e) => definirJeu(e.target.value)} aria-label="Dossier du jeu d’évaluation" />
            <button type="button" onClick={() => void choisirJeu()} disabled={enCours}>
              Choisir…
            </button>
          </span>
        </label>
        <fieldset className="champ">
          <legend>Modes à comparer</legend>
          {(Object.keys(PROFILS) as IdProfil[]).map((id) => (
            <label key={id} className="case" title={PROFILS[id].description}>
              <input type="checkbox" checked={profils.includes(id)} onChange={() => basculer(id)} disabled={enCours} />
              {PROFILS[id].libelle}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button type="button" className="principal" onClick={() => void lancer()} disabled={enCours || !jeu || profils.length === 0}>
            {enCours ? 'Comparaison en cours…' : 'Lancer la comparaison'}
          </button>
          {enCours && (
            <button type="button" onClick={() => void api.banc.annuler()}>
              Annuler
            </button>
          )}
          {comparaison && !enCours && (
            <button type="button" onClick={() => void exporter()}>
              Exporter le rapport…
            </button>
          )}
        </div>
      </div>

      {enCours && progression?.type === 'banc' && (
        <BarreProgression
          fait={progression.fait}
          total={progression.total}
          libelle={`${PROFILS[progression.profil].libelle} : ${ETAPES[progression.etape]}`}
        />
      )}
      {erreur && <Message type="erreur">{erreur}</Message>}
      {info && <Message type="succes">{info}</Message>}
      {comparaison && <Resultats comparaison={comparaison} />}
    </section>
  );
}
