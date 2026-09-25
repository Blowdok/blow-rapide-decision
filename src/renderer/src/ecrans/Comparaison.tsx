import { useEffect, useState } from 'react';
import type { ResultatComparaison } from '../../../partage/contrat';
import { PROFILS } from '../../../partage/reglages';
import { celluleClassement, libelleAttente, lignesSynthese, phrasesSansDecision } from '../../../partage/synthese';
import type { IdProfil } from '../../../partage/types';
import { api, messageErreur } from '../api';
import { BarreProgression, Message } from '../composants';
import { useApplication } from '../contexte';

const ETAPES = { classement: 'classement', recherche: 'recherche', resume: 'résumés' } as const;

function Resultats({ comparaison }: { comparaison: ResultatComparaison }) {
  const { resultat } = comparaison;
  const { recommandation, profils } = resultat;
  const reference = profils.find((p) => p.classement.length);
  // Classement fusionné sans décision, quand la recherche sémantique (option) a servi.
  const fusionnee = resultat.semantique?.recherche.length ? resultat.semantique.recherche : null;
  const rang = (r: { rangPertinent: number | null; erreur?: string } | undefined) =>
    !r ? '–' : r.erreur ? 'erreur' : (r.rangPertinent ?? 'absent');
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
      {phrasesSansDecision(resultat).map((phrase) => (
        <p key={phrase} className="indice">
          {phrase}
        </p>
      ))}

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
                  {fusionnee && <th>Lexical et sémantique</th>}
                  {profils.map((p) => (
                    <th key={p.profil}>{p.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultat.rechercheLexicale.map((r, i) => (
                  <tr key={r.requete}>
                    <td>{r.requete}</td>
                    <td>{rang(r)}</td>
                    {fusionnee && <td>{rang(fusionnee[i])}</td>}
                    {profils.map((p) => (
                      <td key={p.profil}>{rang(p.recherche[i])}</td>
                    ))}
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
      <p className="consigne">
        Vous hésitez entre Local et Hybride ? La comparaison fait passer le même examen à chaque mode, sur des documents
        d’exemple dont on connaît les bonnes réponses. Elle mesure la justesse, le temps, le coût et ce qui part sur Internet,
        puis recommande un mode. Comptez quelques minutes.
      </p>
      <p className="indice">
        Le mode Local demande Ollama, le mode Hybride une clé OpenRouter : un mode qui n’est pas prêt est simplement signalé.
        Le mode Local reste recommandé tant que l’Hybride ne fait pas nettement mieux.
      </p>

      <div className="formulaire">
        <label className="champ">
          <span>Documents d’examen</span>
          <span className="ligne">
            <input type="text" value={jeu} onChange={(e) => definirJeu(e.target.value)} aria-label="Dossier des documents d’examen" />
            <button type="button" onClick={() => void choisirJeu()} disabled={enCours}>
              Choisir…
            </button>
          </span>
        </label>
        <p className="indice">Par défaut, le jeu de démonstration fourni : 12 documents fictifs d’une petite agence web.</p>
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
