import { Context } from 'aws-lambda';
import { QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { RecordMetadata } from '@pinecone-database/pinecone';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { getEmbedding } from '../helpers/embeddings';
import { getPineconeClient } from '../helpers/pinecone';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { QUESTION_CLUSTER_PK, CLUSTER_THRESHOLD, QUESTION_EMBEDDING_TYPE } from '../constants/clustering';
import { getProjectById } from '../helpers/project';
import { getOrganizationById } from '../organization/get-organization-by-id';
import { nowIso } from '../helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const PINECONE_INDEX = requireEnv('PINECONE_INDEX');

export interface PrepareQuestionsEvent {
  projectId: string;
  orgId?: string; // Passed from SF, but we also look it up from project
}

export interface QuestionForAnswerGeneration {
  questionId: string;
  projectId: string;
  orgId: string;
  questionText: string;
  sectionId?: string;
  sectionTitle?: string;
  // Clustering fields
  clusterId?: string;
  isClusterMaster?: boolean;
  masterQuestionId?: string;
  similarityToMaster?: number;
}

interface QuestionWithEmbedding extends QuestionForAnswerGeneration {
  embedding?: number[];
}

export interface PrepareQuestionsResult {
  questions: QuestionForAnswerGeneration[];
  totalCount: number;
  projectId: string;
  orgId: string;
  clustersCreated: number;
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Embed all questions and store in Pinecone
 */
async function embedQuestions(
  orgId: string,
  questions: QuestionForAnswerGeneration[]
): Promise<QuestionWithEmbedding[]> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);
  
  const embeddedQuestions: QuestionWithEmbedding[] = [];
  
  // Process in batches of 10 to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < questions.length; i += batchSize) {
    const batch = questions.slice(i, i + batchSize);
    
    const embeddings = await Promise.all(
      batch.map(async (q) => {
        const embedding = await getEmbedding(q.questionText);
        return { ...q, embedding };
      })
    );
    
    // Upsert to Pinecone - filter out undefined values from metadata
    const vectors = embeddings.map((q) => {
      const metadata: RecordMetadata = {
        type: QUESTION_EMBEDDING_TYPE,
        projectId: q.projectId,
        questionId: q.questionId,
        questionText: q.questionText.substring(0, 1000),
      };
      // Only add optional fields if they exist
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
}

async function clusterAndSort(
  projectId: string,
  questions: QuestionWithEmbedding[],
  clusterThreshold: number = CLUSTER_THRESHOLD // Use org setting or default
): Promise<{ questions: QuestionForAnswerGeneration[]; clustersCreated: number }> {
  const n = questions.length;
  if (n < 2) {
    return { questions: questions.map(q => ({ ...q, embedding: undefined })), clustersCreated: 0 };
  }
  
  // Build similarity matrix 
  const simMatrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0) as number[]);
  
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
    
  // Find clusters using simple threshold-based grouping
  const visited = new Set<number>();
  const clusters: Map<string, { master: QuestionWithEmbedding; members: Array<{ q: QuestionWithEmbedding; sim: number }> }> = new Map();
  
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    
    // Find all similar questions to this one
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
      const clusterQuestions = neighbors.filter(n => !visited.has(n.idx)).map(n => {
        visited.add(n.idx);
        return { q: questions[n.idx]!, sim: n.sim };
      });
      
      if (clusterQuestions.length >= 2) {
        // Select master (longest question)
        const master = clusterQuestions.reduce((m, c) => 
          c.q.questionText.length > m.q.questionText.length ? c : m
        );
        
        clusters.set(clusterId, {
          master: master.q,
          members: clusterQuestions.filter(c => c.q.questionId !== master.q.questionId),
        });
      }
    }
  }
  
  // Save clusters to DB and update questions
  for (const [clusterId, cluster] of clusters) {
    // Calculate similarities for non-master members
    const nonMasterMembersWithSim = cluster.members.map(m => ({
      questionId: m.q.questionId,
      questionText: m.q.questionText,
      similarity: cosineSimilarity(cluster.master.embedding!, m.q.embedding!),
      hasAnswer: false,
    }));
    
    const members = [
      { questionId: cluster.master.questionId, questionText: cluster.master.questionText, similarity: 1.0, hasAnswer: false },
      ...nonMasterMembersWithSim,
    ];
    
    // Calculate avgSimilarity excluding master (1.0) - only non-master similarities
    const avgSimilarity = nonMasterMembersWithSim.length > 0 
      ? nonMasterMembersWithSim.reduce((sum, m) => sum + m.similarity, 0) / nonMasterMembersWithSim.length
      : 1.0;
    
    // Save cluster
    await docClient.send(
      new PutCommand({
        TableName: DB_TABLE_NAME,
        Item: {
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
        },
      })
    );
    
    // Update master question
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: QUESTION_PK, [SK_NAME]: `${projectId}#${cluster.master.questionId}` },
        UpdateExpression: 'SET clusterId = :cid, isClusterMaster = :icm, similarityToMaster = :sim, updatedAt = :now',
        ExpressionAttributeValues: { ':cid': clusterId, ':icm': true, ':sim': 1.0, ':now': nowIso() },
      })
    );
    
    // Update the master object
    cluster.master.clusterId = clusterId;
    cluster.master.isClusterMaster = true;
    cluster.master.similarityToMaster = 1.0;
    
    // Update member questions with cluster info
    for (const member of cluster.members) {
      const sim = cosineSimilarity(cluster.master.embedding!, member.q.embedding!);
      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: { [PK_NAME]: QUESTION_PK, [SK_NAME]: `${projectId}#${member.q.questionId}` },
          UpdateExpression: 'SET clusterId = :cid, isClusterMaster = :icm, similarityToMaster = :sim, linkedToMasterQuestionId = :mid, updatedAt = :now',
          ExpressionAttributeValues: { ':cid': clusterId, ':icm': false, ':sim': sim, ':mid': cluster.master.questionId, ':now': nowIso() },
        })
      );
      
      // Update the question object
      member.q.clusterId = clusterId;
      member.q.isClusterMaster = false;
      member.q.similarityToMaster = sim;
      member.q.masterQuestionId = cluster.master.questionId;
    }
  }
  
  // Build sorted list: masters first, then unclustered, then non-masters
  const masterQuestions: QuestionForAnswerGeneration[] = [];
  const nonMasterQuestions: QuestionForAnswerGeneration[] = [];
  const unclusteredQuestions: QuestionForAnswerGeneration[] = [];
  
  for (const q of questions) {
    const { embedding, ...rest } = q;
    if (q.isClusterMaster) {
      masterQuestions.push(rest);
    } else if (q.masterQuestionId) {
      nonMasterQuestions.push(rest);
    } else {
      unclusteredQuestions.push(rest);
    }
  }
  
  // Sort: masters first (longest first), then unclustered, then non-masters
  const sorted = [
    ...masterQuestions.sort((a, b) => b.questionText.length - a.questionText.length),
    ...unclusteredQuestions,
    ...nonMasterQuestions,
  ];
  
  console.log(`Clustering complete: ${clusters.size} clusters, ${masterQuestions.length} masters, ${nonMasterQuestions.length} non-masters, ${unclusteredQuestions.length} unclustered`);
  
  return { questions: sorted, clustersCreated: clusters.size };
}

export const baseHandler = async (
  event: PrepareQuestionsEvent,
  _ctx: Context,
): Promise<PrepareQuestionsResult> => {
  console.log('prepare-questions event:', JSON.stringify(event));

  const { projectId } = event;

  if (!projectId) {
    throw new Error('projectId is required');
  }

  // Get orgId from project (we validate even if passed in event)
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const orgId = project.orgId;
  if (!orgId) {
    throw new Error(`Project ${projectId} has no orgId`);
  }

  // Query ALL questions for the project - process entire project at once
  const allQuestions: QuestionForAnswerGeneration[] = [];
  let lastKey: Record<string, any> | undefined;

  const prefix = `${projectId}#`;

  // Track questions that already have clusters (skip re-clustering them)
  const alreadyClusteredQuestions: QuestionForAnswerGeneration[] = [];
  const newQuestions: QuestionForAnswerGeneration[] = [];

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_PK,
          ':prefix': prefix,
        },
        ExclusiveStartKey: lastKey,
        ConsistentRead: true,
      }),
    );

    if (res.Items) {
      for (const item of res.Items) {
        const questionId = item.questionId as string;
        const questionText = item.question as string;

        if (questionId && questionText) {
          const question: QuestionForAnswerGeneration = {
            questionId,
            projectId,
            orgId,
            questionText,
            sectionId: item.sectionId as string | undefined,
            sectionTitle: item.sectionTitle as string | undefined,
            // Preserve existing cluster assignments
            clusterId: item.clusterId as string | undefined,
            isClusterMaster: item.isClusterMaster as boolean | undefined,
            masterQuestionId: item.linkedToMasterQuestionId as string | undefined,
            similarityToMaster: item.similarityToMaster as number | undefined,
          };
          
          // Separate already-clustered from new questions
          if (item.clusterId) {
            alreadyClusteredQuestions.push(question);
          } else {
            newQuestions.push(question);
          }
          
          allQuestions.push(question);
        }
      }
    }

    lastKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);
  
  console.log(`Found ${allQuestions.length} total questions: ${alreadyClusteredQuestions.length} already clustered, ${newQuestions.length} new`);

  // Skip clustering for very small sets
  if (allQuestions.length < 2) {
    return {
      questions: allQuestions,
      totalCount: allQuestions.length,
      projectId,
      orgId,
      clustersCreated: 0,
    };
  }

  // Get org settings for clustering threshold
  let clusterThreshold = CLUSTER_THRESHOLD;
  try {
    const org = await getOrganizationById(orgId);
    if (org?.clusterThreshold != null && typeof org.clusterThreshold === 'number') {
      clusterThreshold = org.clusterThreshold;
    } else {
      console.log(`Org has no clusterThreshold set, using default: ${(CLUSTER_THRESHOLD * 100).toFixed(0)}%`);
    }
  } catch (err) {
    console.warn('Failed to load org settings, using default threshold:', err);
  }

  // Step 2: Embed ALL new questions first
  let clustersCreated = 0;
  let questionsAddedToExisting = 0;
  let newlyClusteredQuestions: QuestionForAnswerGeneration[] = [];
  
  if (newQuestions.length === 0) {
    console.log('No new questions to process');
  } else {
    console.log(`Embedding ${newQuestions.length} new questions...`);
    const embeddedNewQuestions = await embedQuestions(orgId, newQuestions);
    
    // Step 3: Try to match each new question to EXISTING cluster masters
    const existingMasters = alreadyClusteredQuestions.filter(q => q.isClusterMaster);
    const orphanQuestions: QuestionWithEmbedding[] = [];
    
    if (existingMasters.length > 0) {
      console.log(`Checking ${embeddedNewQuestions.length} new questions against ${existingMasters.length} existing cluster masters...`);
      
      // Load embeddings for existing cluster masters from Pinecone
      const client = getPineconeClient();
      const index = client.Index(PINECONE_INDEX);
      
      for (const newQ of embeddedNewQuestions) {
        if (!newQ.embedding) {
          orphanQuestions.push(newQ);
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
        
        // Check if the best match is an existing cluster master and meets threshold
        const bestMatch = queryResult.matches?.[0];
        const matchedMaster = bestMatch && bestMatch.score && bestMatch.score >= clusterThreshold
          ? existingMasters.find(m => m.questionId === bestMatch.metadata?.questionId)
          : null;
        
        if (matchedMaster && matchedMaster.clusterId) {
          // Add to existing cluster!
          console.log(`New question ${newQ.questionId} matches existing cluster ${matchedMaster.clusterId} (${(bestMatch!.score! * 100).toFixed(1)}%)`);
          
          // Update the question with cluster info
          await docClient.send(
            new UpdateCommand({
              TableName: DB_TABLE_NAME,
              Key: { [PK_NAME]: QUESTION_PK, [SK_NAME]: `${projectId}#${newQ.questionId}` },
              UpdateExpression: 'SET clusterId = :cid, isClusterMaster = :icm, similarityToMaster = :sim, linkedToMasterQuestionId = :mid, updatedAt = :now',
              ExpressionAttributeValues: { 
                ':cid': matchedMaster.clusterId, 
                ':icm': false, 
                ':sim': bestMatch!.score!, 
                ':mid': matchedMaster.questionId, 
                ':now': nowIso(),
              },
            })
          );
          
          // Update cluster record to add new member
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
            })
          );
          
          // Update the question object
          newQ.clusterId = matchedMaster.clusterId;
          newQ.isClusterMaster = false;
          newQ.masterQuestionId = matchedMaster.questionId;
          newQ.similarityToMaster = bestMatch!.score!;
          questionsAddedToExisting++;
          
          // Strip embedding before adding to results
          const { embedding: _e, ...questionWithoutEmbedding } = newQ;
          newlyClusteredQuestions.push(questionWithoutEmbedding);
        } else {
          // No existing cluster match - candidate for new clustering
          orphanQuestions.push(newQ);
        }
      }
      
      console.log(`Added ${questionsAddedToExisting} questions to existing clusters, ${orphanQuestions.length} orphans remain`);
    } else {
      // No existing clusters - all new questions are orphans
      orphanQuestions.push(...embeddedNewQuestions);
    }
    
    // Step 4: Cluster remaining orphan questions among themselves
    if (orphanQuestions.length >= 2) {
      console.log(`Clustering ${orphanQuestions.length} orphan questions...`);
      const clusterResult = await clusterAndSort(projectId, orphanQuestions, clusterThreshold);
      newlyClusteredQuestions.push(...clusterResult.questions);
      clustersCreated = clusterResult.clustersCreated;
    } else if (orphanQuestions.length === 1) {
      // Single orphan - no clustering
      const { embedding, ...rest } = orphanQuestions[0]!;
      newlyClusteredQuestions.push(rest);
    }
  }
  
  // Step 4: Build final sorted list
  // Sort order: cluster masters → unclustered → cluster members
  const masterQuestions: QuestionForAnswerGeneration[] = [];
  const memberQuestions: QuestionForAnswerGeneration[] = [];
  const unclusteredQuestions: QuestionForAnswerGeneration[] = [];
  
  // Process already-clustered questions (preserve their existing cluster info)
  for (const q of alreadyClusteredQuestions) {
    if (q.isClusterMaster) {
      masterQuestions.push(q);
    } else {
      memberQuestions.push(q);
    }
  }
  
  // Process newly-clustered/unclustered questions
  for (const q of newlyClusteredQuestions) {
    if (q.isClusterMaster) {
      masterQuestions.push(q);
    } else if (q.masterQuestionId) {
      memberQuestions.push(q);
    } else {
      unclusteredQuestions.push(q);
    }
  }
  
  // Final sorted list: masters first, then unclustered, then members (skip members in answer gen)
  const sortedQuestions = [
    ...masterQuestions.sort((a, b) => b.questionText.length - a.questionText.length),
    ...unclusteredQuestions,
    ...memberQuestions,
  ];
  
  console.log(`Returning ${sortedQuestions.length} questions: ${masterQuestions.length} masters, ${unclusteredQuestions.length} unclustered, ${memberQuestions.length} members, ${clustersCreated} new clusters created`);

  return {
    questions: sortedQuestions,
    totalCount: sortedQuestions.length,
    projectId,
    orgId,
    clustersCreated,
  };
};

export const handler = withSentryLambda(baseHandler);