import { useEffect, useMemo, useState } from 'react';
import type { DetailDocument, Progression } from '../../../partage/contrat';
import { formaterEntier, formaterPourcentage } from '../../../partage/format';
import { api, messageErreur } from '../api';
import { BarreProgression, BilanMesures, Jauge, Message, Pastille, Urgence } from '../composants';
import { useApplication } from '../contexte';

type Operation = 'indexation' | 'triage' | 'resume' | null;

const taille = (octets: number): string =>
  octets < 1024 ? `${octets} o` : octets < 1_048_576 ? `${formaterEntier(octets / 1024)} Ko` : `${(octets / 1_048_576).toFixed(1).replace('.', ',')} Mo`;

/** Avancement de l'indexation : fichiers, pages lues par OCR, puis plongements (options). */
function AvancementIndexation({ progression, annuler }: { progression: Progression | null; annuler: () => void }) {
  if (progression?.type !== 'indexation') return null;
  const libelle =
    progression.etape === 'plongements'
      ? 'Recherche sémantique : calcul des vecteurs des passages'
      : progression.ocr
        ? `Lecture OCR de ${progression.fichier} : page ${progression.ocr.page} sur ${progression.ocr.pages}`
        : `Indexation : ${progression.fichier}`;
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
  const { etat, corpus, definirCorpus, rafraichirCorpus, progression } = useApplication();
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

  // Les triages et résumés dépendent du mode : on recharge quand il change.
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

  const indexer = (chemin: string) =>
    executer('indexation', async () => {
      const nouveau = await api.dossier.indexer(chemin);
      definirSelection(null);
      definirCorpus(nouveau);
    });
  const annulerIndexation = () => void api.dossier.annuler();

  const choisirDossier = async () => {
    const chemin = await api.dossier.choisir();
    if (chemin) await indexer(chemin);
  };

  const trier = (ids?: string[]) =>
    executer('triage', async () => {
      try {
        await api.documents.trier(ids);
      } finally {
        // Les triages réussis avant une éventuelle erreur restent affichés.
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
  const visibles = documents.filter(
    (d) => (!filtre || d.triage?.categorie === filtre) && (!seulementAVerifier || d.triage?.aVerifier)
  );

  if (!corpus) {
    return (
      <section className="ecran">
        <h1>Documents</h1>
        <div className="vide">
          <p>Choisissez un dossier : l’agent en extrait le texte (TXT, Markdown, PDF, Word) sur ce PC, sans rien envoyer.</p>
          <div className="actions">
            <button type="button" className="principal" disabled={operation !== null} onClick={() => void choisirDossier()}>
              Choisir un dossier…
            </button>
            {etat?.dernierDossier && (
              <button type="button" disabled={operation !== null} onClick={() => void indexer(etat.dernierDossier as string)}>
                Rouvrir {etat.dernierDossier}
              </button>
            )}
          </div>
          {operation === 'indexation' && <AvancementIndexation progression={progression} annuler={annulerIndexation} />}
          {erreur && <Message type="erreur">{erreur}</Message>}
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
        <button type="button" disabled={operation !== null} onClick={() => void indexer(corpus.dossier)}>
          Réindexer
        </button>
        <button type="button" className="principal" disabled={operation !== null || restants === 0} onClick={() => void trier()}>
          {restants === 0
            ? 'Tous les documents sont triés'
            : restants === documents.length
              ? `Trier les ${restants} documents`
              : `Trier les ${restants} restants`}
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
        <label className="case">
          <input type="checkbox" checked={seulementAVerifier} onChange={(e) => definirSeulementAVerifier(e.target.checked)} />À
          vérifier seulement
        </label>
      </div>

      {operation === 'indexation' && <AvancementIndexation progression={progression} annuler={annulerIndexation} />}
      {operation === 'triage' && progression?.type === 'triage' && (
        <BarreProgression fait={progression.fait} total={progression.total} libelle="Triage des documents" />
      )}
      {erreur && <Message type="erreur">{erreur}</Message>}
      {corpus.avis.map((avis) => (
        <Message key={avis} type="alerte">
          {avis}
        </Message>
      ))}
      {corpus.semantique && (
        <p className="indice">
          Recherche sémantique prête : {formaterEntier(corpus.semantique.passages)} passages, modèle {corpus.semantique.modele}.
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
                <th>Confiance</th>
                <th>Action</th>
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
                      <span title={`${d.pagesOcr} page(s) lue(s) par OCR`}>
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
                  <td className={d.triage?.aVerifier ? 'a-verifier' : undefined} title={d.triage?.aVerifier ? 'À vérifier : confiance sous le seuil' : undefined}>
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
            <p className="indice">Sélectionnez un document pour voir son triage, son résumé et son texte.</p>
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
                <button type="button" disabled={operation !== null} onClick={() => void trier([detail.id])}>
                  {detail.triage ? 'Retrier' : 'Trier'}
                </button>
                <button type="button" className="principal" disabled={operation !== null} onClick={() => void resumer(detail.id)}>
                  {operation === 'resume' ? 'Résumé en cours…' : detail.resume ? 'Refaire le résumé' : 'Résumer'}
                </button>
              </div>

              {detail.triage && (
                <section className="bloc">
                  <h3>Triage</h3>
                  {Object.entries(detail.triage.probabilites)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([id, p]) => (
                      <Jauge key={id} valeur={p} libelle={categories.get(id) ?? id} />
                    ))}
                  <Jauge valeur={detail.triage.probabiliteAction} libelle="Action requise" />
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
                <summary>Aperçu du texte extrait</summary>
                <pre className="apercu">{detail.apercu}</pre>
              </details>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
