/**
 * Pipeline clustering helpers for the prepare-questions Lambda.
 *
 * Responsibilities:
 * - Embed questions and upsert to Pinecone
 * - Cluster questions by cosine similarity (threshold-based grouping)
 * - Match new questions to existing cluster masters via Pinecone
 */

import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RecordMetadata } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '@/helpers/db';
import { getEmbedding } from '@/helpers/embeddings';
import { initPineconeClient } from '@/helpers/pinecone';
import { cosineSimilarity } from '@/helpers/cosine-similarity';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { QUESTION_CLUSTER_PK, QUESTION_EMBEDDING_TYPE } from '@/constants/clustering';
import type {
  QuestionForAnswerGeneration,
  QuestionWithEmbedding,
  ClusterAndSortResult,
  MatchToExistingClustersResult,
} from '@/handlers/answer-pipeline/types';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const getPineconeIndexName = () => requireEnv('PINECONE_INDEX');

const EMBED_BATCH_SIZE = 10;

// ─── Embedding ───

/**
 * Embed all questions and store vectors in Pinecone.
 * Processes in batches to avoid rate limiting.
 */
export const embedQuestions = async (
  orgId: string,
  questions: QuestionForAnswerGeneration[],
): Promise<QuestionWithEmbedding[]> => {
  const client = await initPineconeClient();
  const index = client.Index(getPineconeIndexName());

  const embeddedQuestions: QuestionWithEmbedding[] = [];

  for (let i = 0; i < questions.length; i += EMBED_BATCH_SIZE) {
    const batch = questions.slice(i, i + EMBED_BATCH_SIZE);

    const embeddings = await Promise.all(
      batch.map(async (q) => {
        const embedding = await getEmbedding(q.questionText);
        return { ...q, embedding };
      }),
    );

    // Upsert to Pinecone - filter out undefined values from metadata
    const vectors = embeddings.map((q) => {
      const metadata: RecordMetadata = {
        type: QUESTION_EMBEDDING_TYPE,
        projectId: q.projectId,
        questionId: q.questionId,
        questionText: q.questionText.substring(0, 1000),
      };
      if (q.sectionId) metadata.sectionId = q.sectionId;
      if (q.sectionTitle) metadata.sectionTitle = q.sectionTitle;

      return {
        id: `q#${q.projectId}#${q.questionId}`,
        values: q.embedding!,
        metadata,
      };
    });

    await index.namespace(orgId).upsert(vectors);
    embeddedQuestions.push(...embeddings);
  }

  return embeddedQuestions;
};

// ─── Cluster Persistence ───

interface ClusterData {
  master: QuestionWithEmbedding;
  members: Array<{ q: QuestionWithEmbedding; sim: number }>;
}

/**
 * Build the question sort key used in DynamoDB.
 * Pattern: {projectId}#{opportunityId}#{questionId}
 */
const buildQuestionSK = (q: QuestionForAnswerGeneration): string =>
  `${q.projectId}#${q.opportunityId ?? ''}#${q.questionId}`;

/**
 * Save a cluster record to DynamoDB and update all member questions.
 */
const persistCluster = async (
  projectId: string,
  clusterId: string,
  cluster: ClusterData,
): Promise<void> => {
  // Calculate similarities for non-master members (include opportunityId/questionFileId for answer lookups)
  const nonMasterMembersWithSim = cluster.members.map((m) => ({
    questionId: m.q.questionId,
    questionText: m.q.questionText,
    similarity: cosineSimilarity(cluster.master.embedding!, m.q.embedding!),
    hasAnswer: false,
    opportunityId: m.q.opportunityId ?? '',
    questionFileId: m.q.questionFileId ?? '',
  }));

  const members = [
    {
      questionId: cluster.master.questionId,
      questionText: cluster.master.questionText,
      similarity: 1.0,
      hasAnswer: false,
      opportunityId: cluster.master.opportunityId ?? '',
      questionFileId: cluster.master.questionFileId ?? '',
    },
    ...nonMasterMembersWithSim,
  ];

  const avgSimilarity =
    nonMasterMembersWithSim.length > 0
      ? nonMasterMembersWithSim.reduce((sum, m) => sum + m.similarity, 0) / nonMasterMembersWithSim.length
      : 1.0;

  // Save cluster record
  const clusterItem: Record<string, unknown> = {
    [PK_NAME]: QUESTION_CLUSTER_PK,
    [SK_NAME]: `${projectId}#${clusterId}`,
    clusterId,
    projectId,
    masterQuestionId: cluster.master.questionId,
    masterQuestionText: cluster.master.questionText,
    members,
    avgSimilarity,
    questionCount: members.length,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (cluster.master.opportunityId) {
    clusterItem.opportunityId = cluster.master.opportunityId;
  }
  if (cluster.master.questionFileId) {
    clusterItem.questionFileId = cluster.master.questionFileId;
  }

  await docClient.send(
    new PutCommand({ TableName: DB_TABLE_NAME, Item: clusterItem }),
  );

  // Update master question in DynamoDB
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: QUESTION_PK, [SK_NAME]: buildQuestionSK(cluster.master) },
      UpdateExpression: 'SET clusterId = :cid, isClusterMaster = :icm, similarityToMaster = :sim, updatedAt = :now',
      ExpressionAttributeValues: { ':cid': clusterId, ':icm': true, ':sim': 1.0, ':now': nowIso() },
    }),
  );

  // Update in-memory master object
  cluster.master.clusterId = clusterId;
  cluster.master.isClusterMaster = true;
  cluster.master.similarityToMaster = 1.0;

  // Update each member question in DynamoDB
  for (const member of cluster.members) {
    const sim = cosineSimilarity(cluster.master.embedding!, member.q.embedding!);
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: QUESTION_PK, [SK_NAME]: buildQuestionSK(member.q) },
        UpdateExpression: 'SET clusterId = :cid, isClusterMaster = :icm, similarityToMaster = :sim, linkedToMasterQuestionId = :mid, updatedAt = :now',
        ExpressionAttributeValues: { ':cid': clusterId, ':icm': false, ':sim': sim, ':mid': cluster.master.questionId, ':now': nowIso() },
      }),
    );

    member.q.clusterId = clusterId;
    member.q.isClusterMaster = false;
    member.q.similarityToMaster = sim;
    member.q.masterQuestionId = cluster.master.questionId;
  }
};

// ─── Clustering Algorithm ───

/**
 * Build a similarity matrix and group questions into clusters using
 * a simple threshold-based approach. Persists clusters to DynamoDB.
 *
 * Returns the questions sorted by cluster role (masters → unclustered → members)
 * and the number of clusters created.
 */
export const clusterAndSort = async (
  projectId: string,
  questions: QuestionWithEmbedding[],
  clusterThreshold: number,
): Promise<ClusterAndSortResult> => {
  const n = questions.length;
  if (n < 2) {
    return { questions: questions.map(({ embedding: _e, ...rest }) => rest), clustersCreated: 0 };
  }

  // Build similarity matrix
  const simMatrix: number[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0) as number[]);

  for (let i = 0; i < n; i++) {
    const qi = questions[i];
    for (let j = i + 1; j < n; j++) {
      const qj = questions[j];
      if (qi?.embedding && qj?.embedding) {
        const sim = cosineSimilarity(qi.embedding, qj.embedding);
        simMatrix[i]![j] = sim;
        simMatrix[j]![i] = sim;
      }
    }
    simMatrix[i]![i] = 1.0;
  }

  // Find clusters using threshold-based grouping
  const visited = new Set<number>();
  const clusters = new Map<string, ClusterData>();

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    const neighbors: Array<{ idx: number; sim: number }> = [];
    for (let j = 0; j < n; j++) {
      const simVal = simMatrix[i]?.[j] ?? 0;
      if (simVal >= clusterThreshold) {
        neighbors.push({ idx: j, sim: simVal });
      }
    }

    // Only create cluster if there are at least 2 similar questions
    if (neighbors.length >= 2) {
      const clusterId = uuidv4();
      const clusterQuestions = neighbors
        .filter((nb) => !visited.has(nb.idx))
        .map((nb) => {
          visited.add(nb.idx);
          return { q: questions[nb.idx]!, sim: nb.sim };
        });

      if (clusterQuestions.length >= 2) {
        // Select master (longest question text)
        const master = clusterQuestions.reduce((m, c) =>
          c.q.questionText.length > m.q.questionText.length ? c : m,
        );

        clusters.set(clusterId, {
          master: master.q,
          members: clusterQuestions.filter((c) => c.q.questionId !== master.q.questionId),
        });
      }
    }
  }

  // Persist all clusters to DynamoDB
  for (const [clusterId, cluster] of clusters) {
    await persistCluster(projectId, clusterId, cluster);
  }

  // Build sorted list: masters → unclustered → non-masters
  const masterQuestions: QuestionForAnswerGeneration[] = [];
  const nonMasterQuestions: QuestionForAnswerGeneration[] = [];
  const unclusteredQuestions: QuestionForAnswerGeneration[] = [];

  for (const q of questions) {
    const { embedding: _e, ...rest } = q;
    if (q.isClusterMaster) {
      masterQuestions.push(rest);
    } else if (q.masterQuestionId) {
      nonMasterQuestions.push(rest);
    } else {
      unclusteredQuestions.push(rest);
    }
  }

  const sorted = [
    ...masterQuestions.sort((a, b) => b.questionText.length - a.questionText.length),
    ...unclusteredQuestions,
    ...nonMasterQuestions,
  ];

  console.log(
    `Clustering complete: ${clusters.size} clusters, ${masterQuestions.length} masters, ${nonMasterQuestions.length} non-masters, ${unclusteredQuestions.length} unclustered`,
  );

  return { questions: sorted, clustersCreated: clusters.size };
};

// ─── Match New Questions to Existing Clusters ───

/**
 * Try to match each new (embedded) question to an existing cluster master
 * via Pinecone similarity search. Questions that match are added to the
 * existing cluster; those that don't are returned as orphans for new clustering.
 */
export const matchNewQuestionsToExistingClusters = async (
  projectId: string,
  orgId: string,
  embeddedNewQuestions: QuestionWithEmbedding[],
  existingMasters: QuestionForAnswerGeneration[],
  clusterThreshold: number,
): Promise<MatchToExistingClustersResult> => {
  const client = await initPineconeClient();
  const index = client.Index(getPineconeIndexName());

  const matched: QuestionForAnswerGeneration[] = [];
  const orphans: QuestionWithEmbedding[] = [];
  let matchedCount = 0;

  for (const newQ of embeddedNewQuestions) {
    if (!newQ.embedding) {
      orphans.push(newQ);
      continue;
    }

    // Query Pinecone for similar existing cluster masters
    const queryResult = await index.namespace(orgId).query({
      vector: newQ.embedding,
      topK: 1,
      filter: {
        type: { $eq: QUESTION_EMBEDDING_TYPE },
        projectId: { $eq: projectId },
      },
      includeMetadata: true,
    });

    const bestMatch = queryResult.matches?.[0];
    const matchedMaster =
      bestMatch?.score && bestMatch.score >= clusterThreshold
        ? existingMasters.find((m) => m.questionId === bestMatch.metadata?.questionId)
        : null;

    if (matchedMaster?.clusterId) {
      console.log(
        `New question ${newQ.questionId} matches existing cluster ${matchedMaster.clusterId} (${(bestMatch!.score! * 100).toFixed(1)}%)`,
      );

      // Update question with cluster info
      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: { [PK_NAME]: QUESTION_PK, [SK_NAME]: buildQuestionSK(newQ) },
          UpdateExpression: 'SET clusterId = :cid, isClusterMaster = :icm, similarityToMaster = :sim, linkedToMasterQuestionId = :mid, updatedAt = :now',
          ExpressionAttributeValues: {
            ':cid': matchedMaster.clusterId,
            ':icm': false,
            ':sim': bestMatch!.score!,
            ':mid': matchedMaster.questionId,
            ':now': nowIso(),
          },
        }),
      );

      // Add new member to existing cluster record
      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: { [PK_NAME]: QUESTION_CLUSTER_PK, [SK_NAME]: `${projectId}#${matchedMaster.clusterId}` },
          UpdateExpression: 'SET members = list_append(members, :newMember), questionCount = questionCount + :one, updatedAt = :now',
          ExpressionAttributeValues: {
            ':newMember': [{
              questionId: newQ.questionId,
              questionText: newQ.questionText,
              similarity: bestMatch!.score!,
              hasAnswer: false,
            }],
            ':one': 1,
            ':now': nowIso(),
          },
        }),
      );

      // Update in-memory object
      newQ.clusterId = matchedMaster.clusterId;
      newQ.isClusterMaster = false;
      newQ.masterQuestionId = matchedMaster.questionId;
      newQ.similarityToMaster = bestMatch!.score!;
      matchedCount++;

      const { embedding: _e, ...questionWithoutEmbedding } = newQ;
      matched.push(questionWithoutEmbedding);
    } else {
      orphans.push(newQ);
    }
  }

  return { matched, orphans, matchedCount };
};

// ─── Sorting ───

/**
 * Sort questions by cluster role: masters first (longest first),
 * then unclustered, then cluster members.
 */
export const sortQuestionsByClusterRole = (
  questions: QuestionForAnswerGeneration[],
): { masters: QuestionForAnswerGeneration[]; unclustered: QuestionForAnswerGeneration[]; members: QuestionForAnswerGeneration[] } => {
  const masters: QuestionForAnswerGeneration[] = [];
  const members: QuestionForAnswerGeneration[] = [];
  const unclustered: QuestionForAnswerGeneration[] = [];

  for (const q of questions) {
    if (q.isClusterMaster) {
      masters.push(q);
    } else if (q.masterQuestionId) {
      members.push(q);
    } else {
      unclustered.push(q);
    }
  }

  masters.sort((a, b) => b.questionText.length - a.questionText.length);

  return { masters, unclustered, members };
};

// ─── Orchestration ───

export interface ClusteringPipelineResult {
  sortedQuestions: QuestionForAnswerGeneration[];
  clustersCreated: number;
  mastersCount: number;
  unclusteredCount: number;
  membersCount: number;
}

/**
 * Full clustering orchestration: embed new questions, match to existing
 * clusters, cluster remaining orphans, and return a sorted list.
 */
export const runClusteringPipeline = async (
  projectId: string,
  orgId: string,
  alreadyClusteredQuestions: QuestionForAnswerGeneration[],
  newQuestions: QuestionForAnswerGeneration[],
  clusterThreshold: number,
): Promise<ClusteringPipelineResult> => {
  let clustersCreated = 0;
  let newlyClusteredQuestions: QuestionForAnswerGeneration[] = [];

  if (newQuestions.length > 0) {
    console.log(`Embedding ${newQuestions.length} new questions...`);
    const embeddedNewQuestions = await embedQuestions(orgId, newQuestions);

    // Try to match new questions to existing cluster masters
    const existingMasters = alreadyClusteredQuestions.filter((q) => q.isClusterMaster);
    let orphans = embeddedNewQuestions;

    if (existingMasters.length > 0) {
      console.log(`Checking ${embeddedNewQuestions.length} new questions against ${existingMasters.length} existing cluster masters...`);
      const matchResult = await matchNewQuestionsToExistingClusters(
        projectId, orgId, embeddedNewQuestions, existingMasters, clusterThreshold,
      );
      newlyClusteredQuestions.push(...matchResult.matched);
      orphans = matchResult.orphans;
      console.log(`Added ${matchResult.matchedCount} questions to existing clusters, ${orphans.length} orphans remain`);
    }

    // Cluster remaining orphan questions among themselves
    if (orphans.length >= 2) {
      console.log(`Clustering ${orphans.length} orphan questions...`);
      const clusterResult = await clusterAndSort(projectId, orphans, clusterThreshold);
      newlyClusteredQuestions.push(...clusterResult.questions);
      clustersCreated = clusterResult.clustersCreated;
    } else if (orphans.length === 1) {
      const { embedding: _e, ...rest } = orphans[0]!;
      newlyClusteredQuestions.push(rest);
    }
  } else {
    console.log('No new questions to process');
  }

  // Build final sorted list (masters → unclustered → members)
  const { masters: existingMastersSorted, members: existingMembers } = sortQuestionsByClusterRole(alreadyClusteredQuestions);
  const { masters: newMasters, unclustered: newUnclustered, members: newMembers } = sortQuestionsByClusterRole(newlyClusteredQuestions);

  const masterQuestions = [...existingMastersSorted, ...newMasters];
  const unclusteredQuestions = [...newUnclustered];
  const memberQuestions = [...existingMembers, ...newMembers];

  masterQuestions.sort((a, b) => b.questionText.length - a.questionText.length);

  const sortedQuestions = [...masterQuestions, ...unclusteredQuestions, ...memberQuestions];
  console.log(`Returning ${sortedQuestions.length} questions: ${masterQuestions.length} masters, ${unclusteredQuestions.length} unclustered, ${memberQuestions.length} members, ${clustersCreated} new clusters created`);

  return {
    sortedQuestions,
    clustersCreated,
    mastersCount: masterQuestions.length,
    unclusteredCount: unclusteredQuestions.length,
    membersCount: memberQuestions.length,
  };
};
