import { isSnapshotStale } from './compliance-review-snapshot';

describe('isSnapshotStale', () => {
  it('is not stale when identical', () => {
    const snap = { 'doc:1': 'a', 'form:1': 'b' };
    expect(isSnapshotStale(snap, { ...snap })).toBe(false);
  });

  it('is stale when a version changed', () => {
    expect(isSnapshotStale({ 'doc:1': 'a' }, { 'doc:1': 'a2' })).toBe(true);
  });

  it('is stale when a document was added', () => {
    expect(isSnapshotStale({ 'doc:1': 'a' }, { 'doc:1': 'a', 'doc:2': 'x' })).toBe(true);
  });

  it('is stale when a document was removed', () => {
    expect(isSnapshotStale({ 'doc:1': 'a', 'doc:2': 'x' }, { 'doc:1': 'a' })).toBe(true);
  });

  it('handles empty snapshots', () => {
    expect(isSnapshotStale({}, {})).toBe(false);
  });
});
