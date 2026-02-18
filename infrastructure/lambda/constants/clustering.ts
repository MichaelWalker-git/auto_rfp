// Clustering PK for DynamoDB
export const QUESTION_CLUSTER_PK = 'QUESTION_CLUSTER';

// Thresholds - these match the shared schema
export const CLUSTER_THRESHOLD = 0.80; // Questions >= 80% similarity are auto-clustered
export const SIMILAR_THRESHOLD = 0.50; // Questions >= 50% similarity are shown as "similar"

// Pinecone type for question embeddings
export const QUESTION_EMBEDDING_TYPE = 'question';

// Limits
export const MAX_QUESTIONS_TO_CLUSTER = 500;
export const MAX_SIMILAR_QUESTIONS = 20;