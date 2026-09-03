import { evaluateRelated } from '../related';

describe('evaluateRelated', () => {
  it('counts the related items and labels them "N related"', () => {
    const result = evaluateRelated([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(result.count).toBe(3);
    expect(result.label).toBe('3 related');
  });

  it('reports zero for an empty list', () => {
    const result = evaluateRelated([]);
    expect(result.count).toBe(0);
    expect(result.label).toBe('0 related');
  });

  it('treats a missing/non-array input as zero', () => {
    expect(evaluateRelated(undefined).count).toBe(0);
    expect(evaluateRelated(null).count).toBe(0);
  });
});
