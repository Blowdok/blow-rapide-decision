import { useEffect, useMemo, useState } from 'react';
import type { DetailDocument, Progression } from '../../../partage/contrat';
import { formaterEntier, formaterPourcentage } from '../../../partage/format';
import { api, messageErreur } from '../api';
import { BarreProgression, BilanMesures, Jauge, Message, MessageErreur, Pastille, Urgence } from '../composants';
import { useApplication } from '../contexte';
import { EtatPreparation } from '../preparation';

type Operation = 'lecture' | 'classement' | 'resume' | null;

const taille = (octets: number): string =>
  octets < 1024 ? `${octets} o` : octets < 1_048_576 ? `${formaterEntier(octets / 1024)} Ko` : `${(octets / 1_048_576).toFixed(1).replace('.', ',')} Mo`;

/** Avancement de la lecture du dossier : fichiers, pages scannées (OCR), puis recherche par le sens (options). */
function AvancementLecture({ progression, annuler }: { progression: Progression | null; annuler: () => void }) {
  if (progression?.type !== 'indexation') return null;
  const libelle =
    progression.etape === 'plongements'
      ? 'Préparation de la recherche par le sens'
      : progression.ocr
        ? `Lecture OCR de ${progression.fichier} : page ${progression.ocr.page} sur ${progression.ocr.pages}`
        : `Lecture du dossier : ${progression.fichier}`;
  return (
    <div className="avancement">
      <BarreProgression fait={progression.traites} total={progression.total} libelle={libelle} />
      <button type="button" onClick={annuler}>
        Annuler
      </button>
    </div>
  );
}

export function EcranDocuments() {
  const { etat, corpus, definirCorpus, rafraichirCorpus, progression, allerA } = useApplication();
  const [operation, definirOperation] = useState<Operation>(null);
  const [erreur, definirErreur] = useState<string | null>(null);
  const [selection, definirSelection] = useState<string | null>(null);
  const [detail, definirDetail] = useState<DetailDocument | null>(null);
  const [filtre, definirFiltre] = useState('');
  const [seulementAVerifier, definirSeulementAVerifier] = useState(false);

  const profil = etat?.reglages.profil;
  const categories = useMemo(
    () => new Map((etat?.reglages.classement.categories ?? []).map((c) => [c.id, c.libelle])),
    [etat?.reglages.classement.categories]
  );

  // Les classements et résumés dépendent du mode : on recharge quand il change.
  useEffect(() => {
    if (profil) void rafraichirCorpus();
  }, [profil, rafraichirCorpus]);

  useEffect(() => {
    if (!selection) {
      definirDetail(null);
      return;
    }
    api.documents.lire(selection).then(definirDetail, (e: unknown) => definirErreur(messageErreur(e)));
  }, [selection, corpus]);

  const executer = async (nom: Operation, action: () => Promise<void>) => {
    definirOperation(nom);
    definirErreur(null);
    try {
      await action();
    } catch (e) {
      definirErreur(messageErreur(e));
    } finally {
      definirOperation(null);
    }
  };

  const lireDossier = (chemin: string) =>
    executer('lecture', async () => {
      const nouveau = await api.dossier.indexer(chemin);
      definirSelection(null);
      definirCorpus(nouveau);
    });
  const annulerLecture = () => void api.dossier.annuler();

  const choisirDossier = async () => {
    const chemin = await api.dossier.choisir();
    if (chemin) await lireDossier(chemin);
  };

  const classer = (ids?: string[]) =>
    executer('classement', async () => {
      try {
        await api.documents.trier(ids);
      } finally {
        // Les documents classés avant une éventuelle erreur restent affichés.
        await rafraichirCorpus();
      }
    });

  const resumer = (id: string) =>
    executer('resume', async () => {
      await api.documents.resumer(id);
      definirDetail(await api.documents.lire(id));
    });

  const documents = corpus?.documents ?? [];
  const restants = documents.filter((d) => !d.triage).length;
  const aVerifier = documents.filter((d) => d.triage?.aVerifier).length;
  const visibles = documents.filter(
    (d) => (!filtre || d.triage?.categorie === filtre) && (!seulementAVerifier || d.triage?.aVerifier)
  );

  if (!corpus) {
    return (
      <section className="ecran">
        <h1>Documents</h1>
        <div className="accueil">
          <h2>Bienvenue ! Trois étapes pour commencer</h2>
          <ol className="etapes">
            <li>
              <h3>Vérifiez que l’agent est prêt</h3>
              <EtatPreparation />
            </li>
            <li>
              <h3>Choisissez un dossier de documents</h3>
              <p>
                Factures, devis, contrats, courriers… en PDF, Word, TXT ou Markdown, sous-dossiers compris. L’agent lit les fichiers
                sur ce PC : rien n’est envoyé à cette étape.
              </p>
              <div className="actions">
                <button type="button" className="principal" disabled={operation !== null} onClick={() => void choisirDossier()}>
                  Choisir un dossier…
                </button>
                {etat?.dernierDossier && (
                  <button type="button" disabled={operation !== null} onClick={() => void lireDossier(etat.dernierDossier as string)}>
                    Rouvrir {etat.dernierDossier}
                  </button>
                )}
              </div>
              {operation === 'lecture' && <AvancementLecture progression={progression} annuler={annulerLecture} />}
              {erreur && <MessageErreur message={erreur} />}
            </li>
            <li>
              <h3>Classez, cherchez, résumez</h3>
              <p>
                L’agent donne à chaque document une catégorie, dit s’il demande une action et s’il est urgent. Posez ensuite vos
                questions dans l’écran Recherche, ou résumez un document en un clic.
              </p>
              <button type="button" className="lien" onClick={() => allerA('aide')}>
                Lire l’aide pour débuter
              </button>
            </li>
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section className="ecran ecran-documents">
      <div className="titre-ecran">
        <h1>Documents</h1>
        <span className="chemin" title={corpus.dossier}>
          {corpus.dossier}
        </span>
      </div>

      <div className="barre-outils">
        <button type="button" disabled={operation !== null} onClick={() => void choisirDossier()}>
          Changer de dossier…
        </button>
        <button
          type="button"
          disabled={operation !== null}
          onClick={() => void lireDossier(corpus.dossier)}
          title="Relire le dossier : fichiers ajoutés ou modifiés, options activées"
        >
          Actualiser
        </button>
        <button type="button" className="principal" disabled={operation !== null || restants === 0} onClick={() => void classer()}>
          {restants === 0
            ? 'Tous les documents sont classés'
            : restants === documents.length
              ? `Classer les ${restants} documents`
              : `Classer les ${restants} restants`}
        </button>
        <span className="separateur" />
        <label>
          Catégorie{' '}
          <select value={filtre} onChange={(e) => definirFiltre(e.target.value)}>
            <option value="">Toutes</option>
            {[...categories].map(([id, libelle]) => (
              <option key={id} value={id}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="case" title="Documents dont la catégorie est incertaine">
          <input type="checkbox" checked={seulementAVerifier} onChange={(e) => definirSeulementAVerifier(e.target.checked)} />À
          vérifier seulement
        </label>
      </div>

      {operation === null && documents.length > 0 && restants === documents.length && (
        <p className="indice etape-suivante">
          Étape suivante : cliquez sur « Classer les {restants} documents ». L’agent indique pour chacun sa catégorie, s’il demande
          une action (payer, répondre, signer…) et son urgence.
        </p>
      )}
      {operation === null && restants === 0 && aVerifier > 0 && (
        <p className="indice etape-suivante">
          {aVerifier} document(s) « à vérifier » : l’agent hésite sur leur catégorie. Cochez « À vérifier seulement » pour les
          revoir.
        </p>
      )}
      {operation === 'lecture' && <AvancementLecture progression={progression} annuler={annulerLecture} />}
      {operation === 'classement' && progression?.type === 'triage' && (
        <BarreProgression fait={progression.fait} total={progression.total} libelle="Classement des documents" />
      )}
      {erreur && <MessageErreur message={erreur} />}
      {corpus.avis.map((avis) => (
        <Message key={avis} type="alerte">
          {avis}
        </Message>
      ))}
      {corpus.semantique && (
        <p className="indice">
          Recherche par le sens prête : {formaterEntier(corpus.semantique.passages)} passages, modèle {corpus.semantique.modele}.
        </p>
      )}
      {corpus.erreurs.length > 0 && (
        <details className="erreurs-lecture">
          <summary>{corpus.erreurs.length} fichier(s) non lu(s)</summary>
          <ul>
            {corpus.erreurs.map((e) => (
              <li key={e.chemin}>
                <strong>{e.chemin}</strong> : {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="documents">
        <div className="table-defilante">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Catégorie</th>
                <th title="Certitude de l’agent sur la catégorie">Confiance</th>
                <th title="Le document demande-t-il une action : payer, répondre, signer ?">Action à faire</th>
                <th>Urgence</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => (
                <tr
                  key={d.id}
                  className={selection === d.id ? 'selectionnee' : undefined}
                  onClick={() => definirSelection(d.id)}
                  onKeyDown={(e) => e.key === 'Enter' && definirSelection(d.id)}
                  tabIndex={0}
                  aria-selected={selection === d.id}
                >
                  <td>
                    <span className="nom-document">{d.nom}</span>
                    {d.pagesOcr ? (
                      <span title={`${d.pagesOcr} page(s) scannée(s) lue(s) par OCR`}>
                        {' '}
                        <Pastille ton="neutre">OCR</Pastille>
                      </span>
                    ) : null}
                    {d.id !== d.nom && <span className="dossier-document">{d.id.slice(0, -d.nom.length)}</span>}
                  </td>
                  <td>
                    {d.triage ? (
                      <Pastille ton={d.triage.aVerifier ? 'alerte' : 'accent'}>
                        {categories.get(d.triage.categorie) ?? d.triage.categorie}
                      </Pastille>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td
                    className={d.triage?.aVerifier ? 'a-verifier' : undefined}
                    title={d.triage?.aVerifier ? 'À vérifier : l’agent hésite sur la catégorie' : undefined}
                  >
                    {d.triage ? `${formaterPourcentage(d.triage.confiance)}${d.triage.aVerifier ? ' ⚠' : ''}` : '–'}
                  </td>
                  <td>{d.triage ? (d.triage.actionRequise ? 'Oui' : 'Non') : '–'}</td>
                  <td>{d.triage ? <Urgence note={d.triage.urgence} /> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibles.length === 0 && <p className="vide-table">Aucun document ne correspond au filtre.</p>}
        </div>

        <aside className="fiche" aria-label="Fiche du document">
          {!detail ? (
            <p className="indice">Cliquez sur un document pour voir son classement, le résumer ou lire son texte.</p>
          ) : (
            <>
              <h2>{detail.nom}</h2>
              <p className="meta">
                {detail.format.toUpperCase()} · {taille(detail.taille)} · {formaterEntier(detail.caracteres)} caractères · modifié le{' '}
                {new Date(detail.modifieLe).toLocaleDateString('fr-FR')}
                {detail.pagesOcr ? ` · ${detail.pagesOcr} page(s) lue(s) par OCR` : ''}
              </p>
              <div className="actions">
                <button type="button" onClick={() => void api.documents.ouvrir(detail.id).catch((e: unknown) => definirErreur(messageErreur(e)))}>
                  Ouvrir le fichier
                </button>
                <button type="button" disabled={operation !== null} onClick={() => void classer([detail.id])}>
                  {detail.triage ? 'Reclasser' : 'Classer'}
                </button>
                <button type="button" className="principal" disabled={operation !== null} onClick={() => void resumer(detail.id)}>
                  {operation === 'resume' ? 'Résumé en cours…' : detail.resume ? 'Refaire le résumé' : 'Résumer'}
                </button>
              </div>

              {detail.triage && (
                <section className="bloc">
                  <h3>Classement</h3>
                  <p className="indice">Ce que l’agent pense de ce document, et avec quelle certitude.</p>
                  {Object.entries(detail.triage.probabilites)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([id, p]) => (
                      <Jauge key={id} valeur={p} libelle={categories.get(id) ?? id} />
                    ))}
                  <Jauge valeur={detail.triage.probabiliteAction} libelle="Action à faire" />
                  <p>
                    Urgence : <Urgence note={detail.triage.urgence} />{' '}
                    {detail.triage.aVerifier && <Pastille ton="alerte">À vérifier</Pastille>}
                  </p>
                  <BilanMesures mesures={detail.triage.mesures} />
                </section>
              )}

              {detail.resume && (
                <section className="bloc">
                  <h3>Résumé</h3>
                  <div className="texte-resume">{detail.resume.texte}</div>
                  <BilanMesures mesures={detail.resume.mesures} />
                </section>
              )}

              <details className="bloc">
                <summary>Texte lu par l’agent</summary>
                <pre className="apercu">{detail.apercu}</pre>
              </details>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
