// Bulles d'information : tout élément qui porte `data-infobulle` dit à quoi il
// sert, au survol de la souris (après un court délai) comme au clavier (tout de
// suite). Une seule bulle pour toute l'application, posée au-dessus de tout :
// les zones qui défilent ne la rognent pas. Les lecteurs d'écran la lisent
// comme description de l'élément.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Délai au survol : assez court pour répondre tout de suite, assez long pour ne pas clignoter. */
const DELAI_SURVOL_MS = 250;
const MARGE = 8;
const ID = 'infobulle';

interface Bulle {
  texte: string;
  cible: DOMRect;
}

export function Infobulles() {
  const [bulle, definirBulle] = useState<Bulle | null>(null);
  const [position, definirPosition] = useState<{ gauche: number; haut: number } | null>(null);
  const boite = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cible: HTMLElement | null = null;
    // Élément cliqué : sa bulle ne revient qu'après que la souris l'a quitté.
    let ignore: HTMLElement | null = null;
    let minuterie: number | undefined;

    const cacher = (): void => {
      window.clearTimeout(minuterie);
      cible?.removeAttribute('aria-describedby');
      cible = null;
      definirBulle(null);
    };
    const montrer = (element: HTMLElement): void => {
      const texte = element.dataset.infobulle?.trim();
      if (!texte || !element.isConnected) return;
      element.setAttribute('aria-describedby', ID);
      definirBulle({ texte, cible: element.getBoundingClientRect() });
    };
    const entrer = (evenement: Event): void => {
      const element = evenement.target instanceof Element ? evenement.target.closest<HTMLElement>('[data-infobulle]') : null;
      if (element !== ignore) ignore = null;
      if (element === cible || element === ignore) return;
      cacher();
      if (!element) return;
      cible = element;
      minuterie = window.setTimeout(() => montrer(element), evenement.type === 'focusin' ? 0 : DELAI_SURVOL_MS);
    };
    const quitterFenetre = (evenement: MouseEvent): void => {
      if (!evenement.relatedTarget) cacher();
    };
    const cliquer = (): void => {
      ignore = cible;
      cacher();
    };
    const touche = (evenement: KeyboardEvent): void => {
      if (evenement.key === 'Escape') cacher();
    };

    document.addEventListener('mouseover', entrer);
    document.addEventListener('focusin', entrer);
    document.addEventListener('focusout', cacher);
    document.addEventListener('mouseout', quitterFenetre);
    document.addEventListener('mousedown', cliquer);
    document.addEventListener('keydown', touche);
    // Défilement ou redimensionnement : la bulle ne serait plus à sa place.
    document.addEventListener('scroll', cacher, true);
    window.addEventListener('resize', cacher);
    return () => {
      cacher();
      document.removeEventListener('mouseover', entrer);
      document.removeEventListener('focusin', entrer);
      document.removeEventListener('focusout', cacher);
      document.removeEventListener('mouseout', quitterFenetre);
      document.removeEventListener('mousedown', cliquer);
      document.removeEventListener('keydown', touche);
      document.removeEventListener('scroll', cacher, true);
      window.removeEventListener('resize', cacher);
    };
  }, []);

  // Au-dessus de l'élément si la place le permet, sinon dessous ; jamais hors de la fenêtre.
  useLayoutEffect(() => {
    if (!bulle || !boite.current) {
      definirPosition(null);
      return;
    }
    const { width: largeur, height: hauteur } = boite.current.getBoundingClientRect();
    const { cible } = bulle;
    const auDessus = cible.top - hauteur - MARGE;
    const haut = auDessus >= MARGE ? auDessus : Math.min(cible.bottom + MARGE, window.innerHeight - hauteur - MARGE);
    const centre = cible.left + cible.width / 2 - largeur / 2;
    const gauche = Math.max(MARGE, Math.min(centre, window.innerWidth - largeur - MARGE));
    definirPosition({ gauche, haut });
  }, [bulle]);

  if (!bulle) return null;
  return (
    <div
      ref={boite}
      id={ID}
      role="tooltip"
      className="infobulle"
      style={position ? { left: position.gauche, top: position.haut } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {bulle.texte}
    </div>
  );
}
