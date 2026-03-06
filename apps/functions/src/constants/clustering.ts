import { CLUSTERING_THRESHOLDS } from '@auto-rfp/core';

// Clustering PK for DynamoDB
export const QUESTION_CLUSTER_PK = 'QUESTION_CLUSTER';

// Re-export thresholds from the single source of truth in @auto-rfp/core
export const CLUSTER_THRESHOLD = CLUSTERING_THRESHOLDS.CLUSTER_THRESHOLD;
export const SIMILAR_THRESHOLD = CLUSTERING_THRESHOLDS.SIMILAR_THRESHOLD;
export const MAX_SIMILAR_QUESTIONS = CLUSTERING_THRESHOLDS.MAX_SIMILAR_QUESTIONS;
export const MAX_QUESTIONS_TO_CLUSTER = CLUSTERING_THRESHOLDS.MAX_QUESTIONS_TO_CLUSTER;

// Pinecone type for question embeddings
export const QUESTION_EMBEDDING_TYPE = 'question';
