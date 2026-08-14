export const REQUIRED_FORM_VERSION_PK = 'REQUIRED_FORM_VERSION';

// Bound stored snapshots per form (large compressed field arrays). Pruning keeps
// the newest N versions; older snapshots are deleted after each new snapshot.
export const FORM_VERSION_KEEP_COUNT = 30;
