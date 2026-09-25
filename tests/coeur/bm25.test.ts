import { describe, expect, it } from 'vitest';
import { IndexBm25 } from '../../src/coeur/index/bm25';

function indexDemo(): IndexBm25<string> {
  const index = new IndexBm25<string>();
  index.ajouter('facture', 'Facture n° 2026-041 : impression de 500 flyers, montant dû 1 250 euros.');
  index.ajouter('contrat', 'Contrat de maintenance du site internet pour une durée de douze mois.');
  index.ajouter('courrier', 'Courrier des impôts : avis de taxe foncière à régler avant le 15 octobre.');
  index.ajouter('note', 'Notes de réunion : planning du site internet et maquettes à valider.');
  return index;
}

describe('index BM25', () => {
  it('trouve le document qui contient les termes de la requête', () => {
    expect(indexDemo().chercher('montant de la facture', 2)[0]?.element).toBe('facture');
  });

  it('tolère pluriels et accents', () => {
    expect(indexDemo().chercher('impots taxes foncieres')[0]?.element).toBe('courrier');
  });

  it('classe plus haut le terme rare que le terme fréquent', () => {
    const resultats = indexDemo().chercher('site maintenance');
    expect(resultats[0]?.element).toBe('contrat');
    expect(resultats.map((r) => r.element)).toContain('note');
  });

  it('ignore les requêtes sans terme connu et respecte la limite', () => {
    const index = indexDemo();
    expect(index.chercher('xylophone')).toEqual([]);
    expect(index.chercher('site facture courrier notes', 2)).toHaveLength(2);
  });

  it('fonctionne sur un index vide', () => {
    expect(new IndexBm25<string>().chercher('facture')).toEqual([]);
  });
});
