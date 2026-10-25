import { describe, expect, it } from 'vitest';
import { pageItems } from '../src/components/Pager';

describe('pageItems', () => {
  it('fino a 7 pagine tutte', () => {
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('oltre 7: prima, ultima e le vicine, al più 7 voci', () => {
    expect(pageItems(1, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
    expect(pageItems(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageItems(10, 10)).toEqual([1, null, 6, 7, 8, 9, 10]);
  });
});
