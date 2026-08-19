export const QUESTIONNAIRE_VERSION_PK = 'QUESTIONNAIRE_VERSION';

// S3 key prefix under the documents bucket where pre-write .xlsx snapshots live.
export const QUESTIONNAIRE_VERSION_KEY_PREFIX = 'questionnaire-versions';

// Bound stored snapshots per questionnaire. Each snapshot is a full .xlsx copy in
// S3, so pruning deletes BOTH the version row AND its S3 object.
export const QUESTIONNAIRE_VERSION_KEEP_COUNT = 30;
