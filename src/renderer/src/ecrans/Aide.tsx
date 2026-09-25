import { type ReactNode, useEffect, useState } from 'react';
import { useApplication } from '../contexte';

/** Commande à taper dans un terminal, avec un bouton pour la copier. */
function Commande({ texte }: { texte: string }) {
  const [copiee, definirCopiee] = useState(false);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
      definirCopiee(true);
      setTimeout(() => definirCopiee(false), 2000);
    } catch {
      // Presse-papiers indisponible : la commande reste sélectionnable à la main.
    }
  };
  return (
    <div className="commande">
      <code>{texte}</code>
      <button type="button" onClick={() => void copier()}>
        {copiee ? 'Copiée' : 'Copier'}
      </button>
    </div>
  );
}

/** Une question de l'aide, repliable ; `ouverte` au premier affichage si on l'a demandée. */
function Question({ id, titre, ouverte, children }: { id: string; titre: string; ouverte: boolean; children: ReactNode }) {
  return (
    <details id={`aide-${id}`} className="question" open={ouverte}>
      <summary>{titre}</summary>
      <div className="reponse">{children}</div>
    </details>
  );
}

export function EcranAide() {
  const { etat, sujetAide, allerA, ecran } = useApplication();
  const sujet = sujetAide ?? 'debut';

  // Arrivée depuis un lien « Comment faire ? » : la question voulue s'affiche en haut.
  useEffect(() => {
    if (ecran === 'aide' && sujetAide) document.getElementById(`aide-${sujetAide}`)?.scrollIntoView({ block: 'start' });
  }, [ecran, sujetAide]);

  const modeleLocal = etat?.reglages.ollama.modeleDecision ?? 'qwen3.5:4b';
  const seuil = Math.round((etat?.reglages.classement.seuilConfiance ?? 0.6) * 100);
  const ouverte = (id: string): boolean => id === sujet;
  const lien = (cible: 'documents' | 'recherche' | 'comparaison' | 'reglages', texte: string) => (
    <button type="button" className="lien" onClick={() => allerA(cible)}>
      {texte}
    </button>
  );

  return (
    <section className="ecran ecran-aide" key={sujet}>
      <h1>Aide</h1>
      <p className="consigne">Les réponses aux questions les plus courantes, pour bien démarrer. Cliquez sur une question pour l’ouvrir.</p>

      <Question id="debut" titre="Par où commencer ?" ouverte={ouverte('debut')}>
        <ol>
          <li>
            En haut de la fenêtre, choisissez le <strong>mode</strong> : <strong>Local</strong> si Ollama est installé sur ce PC,
            sinon <strong>Référence sans IA</strong> pour découvrir l’application sans rien installer.
          </li>
          <li>Dans l’écran {lien('documents', 'Documents')}, cliquez sur « Choisir un dossier… » et désignez le dossier de vos documents.</li>
          <li>Cliquez sur « Classer les documents » : chacun reçoit une catégorie, une action à faire (oui ou non) et une urgence.</li>
          <li>Cliquez sur un document pour le résumer, ou posez une question dans l’écran {lien('recherche', 'Recherche')}.</li>
        </ol>
      </Question>

      <Question id="modes" titre="Quel mode choisir ?" ouverte={ouverte('modes')}>
        <ul>
          <li>
            <strong>Local</strong> : tout reste sur ce PC. Gratuit. Il faut installer Ollama ; la vitesse dépend de la puissance du
            PC.
          </li>
          <li>
            <strong>Hybride</strong> : Jev et une IA en ligne travaillent sur des extraits de vos documents, sans dépendre de la
            puissance du PC. Payant à l’usage, et il faut une clé OpenRouter. Les données personnelles sont masquées avant l’envoi.
          </li>
          <li>
            <strong>Référence sans IA</strong> : de simples règles sur les mots. Instantané, sans rien installer, mais moins juste :
            il sert surtout de point de comparaison.
          </li>
        </ul>
        <p>
          Vous hésitez ? L’écran {lien('comparaison', 'Comparaison')} fait passer le même examen aux modes, mesure leur justesse et
          leur coût, puis recommande l’un d’eux.
        </p>
      </Question>

      <Question id="ollama" titre="Installer Ollama (mode Local)" ouverte={ouverte('ollama')}>
        <p>Ollama est un logiciel gratuit qui fait tourner l’IA sur votre ordinateur.</p>
        <ol>
          <li>
            Téléchargez Ollama sur{' '}
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
              ollama.com/download
            </a>
            , installez-le, puis lancez-le.
          </li>
          <li>Ouvrez un terminal (sous Windows : touche Windows, tapez « PowerShell », Entrée).</li>
          <li>
            Tapez cette commande, puis Entrée : elle télécharge le modèle (quelques Go, une seule fois).
            <Commande texte={`ollama pull ${modeleLocal}`} />
          </li>
          <li>Revenez ici : dans {lien('reglages', 'Réglages')}, « Vérifier à nouveau » doit afficher Ollama « prêt ».</li>
        </ol>
        <p>Si Ollama est installé mais « injoignable », il n’est pas lancé : ouvrez-le depuis le menu Démarrer.</p>
      </Question>

      <Question id="openrouter" titre="Obtenir une clé OpenRouter (mode Hybride)" ouverte={ouverte('openrouter')}>
        <ol>
          <li>
            Créez un compte sur{' '}
            <a href="https://openrouter.ai" target="_blank" rel="noreferrer">
              openrouter.ai
            </a>{' '}
            et ajoutez un peu de crédit (quelques dollars suffisent pour commencer).
          </li>
          <li>
            Créez une clé dans{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
              openrouter.ai/keys
            </a>{' '}
            et copiez-la.
          </li>
          <li>Collez-la dans {lien('reglages', 'Réglages')}, rubrique « Clé OpenRouter », puis cliquez sur « Enregistrer ».</li>
        </ol>
        <p>La clé est chiffrée par le système et ne sert qu’à parler à OpenRouter. La même clé donne accès à Jev.</p>
      </Question>

      <Question id="confidentialite" titre="Mes documents restent-ils privés ?" ouverte={ouverte('confidentialite')}>
        <ul>
          <li>
            <strong>Local</strong> et <strong>Référence sans IA</strong> : rien ne quitte ce PC.
          </li>
          <li>
            <strong>Hybride</strong> : des extraits partent sur Internet. Avant l’envoi, l’agent remplace les courriels, numéros de
            téléphone, IBAN, cartes bancaires et numéros de sécurité sociale, puis les remet à leur place à la réception. Les noms
            et les adresses postales ne sont pas masqués.
          </li>
        </ul>
        <p>L’en-tête indique toujours où partent les données. Le journal des envois se trouve dans {lien('reglages', 'Réglages')}.</p>
      </Question>

      <Question id="classement" titre="Que veulent dire « Confiance » et « À vérifier » ?" ouverte={ouverte('classement')}>
        <p>
          La <strong>confiance</strong> dit à quel point l’agent est sûr de la catégorie. Sous {seuil} %, le document est marqué{' '}
          <strong>« à vérifier »</strong> : jetez-y un œil. Cochez « À vérifier seulement » pour ne voir que ceux-là. Ce seuil se
          change dans les réglages avancés.
        </p>
        <p>
          <strong>Action à faire</strong> : le document demande-t-il de payer, répondre ou signer ? <strong>Urgence</strong> :
          aucune, bientôt, ou urgente (échéance proche, relance, pénalités).
        </p>
      </Question>

      <Question id="options" titre="Les options : recherche par le sens et PDF scannés" ouverte={ouverte('options')}>
        <p>Deux options facultatives, à cocher dans {lien('reglages', 'Réglages')}. Elles utilisent Ollama, sur ce PC.</p>
        <ul>
          <li>
            <strong>Recherche par le sens</strong> : trouve aussi les passages qui parlent de la même chose avec d’autres mots
            (« salaire » pour « rémunération »). Modèle à installer :
            <Commande texte="ollama pull embeddinggemma" />
          </li>
          <li>
            <strong>Lecture des PDF scannés</strong> : lit les pages qui ne sont que des images (scans, photos). Plus lent :
            plusieurs secondes par page. Modèle à installer :
            <Commande texte="ollama pull minicpm-v4.6:1b" />
          </li>
        </ul>
        <p>Après avoir coché une option, cliquez sur « Actualiser » dans l’écran Documents.</p>
      </Question>

      <Question id="comparaison" titre="À quoi sert la Comparaison ?" ouverte={ouverte('comparaison')}>
        <p>
          Elle fait passer le même examen aux modes, sur des documents d’exemple dont on connaît les bonnes réponses. Elle mesure
          la justesse, le temps, le coût et ce qui part sur Internet, puis recommande un mode. Comptez quelques minutes.
        </p>
      </Question>

      <Question id="problemes" titre="Un problème ?" ouverte={ouverte('problemes')}>
        <ul>
          <li>
            <strong>« Ollama est injoignable »</strong> : Ollama n’est pas lancé, ou pas installé (voir « Installer Ollama »).
          </li>
          <li>
            <strong>« Modèle absent »</strong> : copiez la commande « ollama pull … » indiquée et lancez-la dans un terminal.
          </li>
          <li>
            <strong>« Clé absente » ou « Clé refusée »</strong> : collez une clé OpenRouter valide dans Réglages.
          </li>
          <li>
            <strong>« Crédit OpenRouter insuffisant »</strong> : ajoutez du crédit sur openrouter.ai.
          </li>
          <li>
            <strong>Un fichier n’est pas lu</strong> : l’écran Documents en donne la raison. Un PDF scanné demande l’option de
            lecture des PDF scannés.
          </li>
        </ul>
      </Question>
    </section>
  );
}
