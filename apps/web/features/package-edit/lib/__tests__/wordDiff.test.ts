import { computeWordDiff } from '../wordDiff';

describe('computeWordDiff', () => {
  it('marks changed words as removed/added and keeps the rest unchanged', () => {
    const parts = computeWordDiff('total cost is $2.0M', 'total cost is $2.4M');
    const removed = parts.filter((p) => p.type === 'removed').map((p) => p.value).join('');
    const added = parts.filter((p) => p.type === 'added').map((p) => p.value).join('');
    const unchanged = parts.filter((p) => p.type === 'unchanged').map((p) => p.value).join('');

    // diffWords tokenizes finely — assert the changed side contains the differing digits.
    expect(removed).toContain('0M');
    expect(added).toContain('4M');
    expect(unchanged).toContain('total cost is');
    // Reconstructing before/after from the parts is lossless.
    const before = parts.filter((p) => p.type !== 'added').map((p) => p.value).join('');
    const after = parts.filter((p) => p.type !== 'removed').map((p) => p.value).join('');
    expect(before).toBe('total cost is $2.0M');
    expect(after).toBe('total cost is $2.4M');
  });

  it('returns all-unchanged when strings are identical', () => {
    const parts = computeWordDiff('same text', 'same text');
    expect(parts.every((p) => p.type === 'unchanged')).toBe(true);
  });
});
