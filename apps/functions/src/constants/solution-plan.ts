/** Partition key for solution plan records (one plan per opportunity). */
export const SOLUTION_PLAN_PK = 'SOLUTION_PLAN';

/** Partition key for grilling interview transcript messages. */
export const GRILLING_MESSAGE_PK = 'GRILLING_MESSAGE';

/** Partition key for solution plan version history records (u1-version-capture). */
export const SOLUTION_PLAN_VERSION_PK = 'SOLUTION_PLAN_VERSION';

/** A plan keeps at most its 30 newest versions (BR4.1); prune removes oldest-first. */
export const SOLUTION_PLAN_VERSION_KEEP_COUNT = 30;
