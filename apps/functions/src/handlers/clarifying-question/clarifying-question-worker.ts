import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { ClarifyingQuestionGenerationMessage } from '@/helpers/clarifying-question-queue';
import {
  loadAllSolicitationTexts,
  queryCompanyKnowledgeBase,
  truncateText,
  invokeClaudeJson,
  getExecutiveBriefByProjectId,
} from '@/helpers/executive-opportunity-brief';
import { nowIso } from '@/helpers/date';
import { createClarifyingQuestionsBatch } from '@/helpers/clarifying-question';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { requireEnv } from '@/helpers/env';
import {
  getClarifyingQuestionsSystemPrompt,
  useClarifyingQuestionsUserPrompt,
} from '@/constants/prompt';

import type {
  ClarifyingQuestionCategory,
  ClarifyingQuestionPriority,
  AmbiguitySource,
} from '@auto-rfp/core';

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

// ─── Message Schema ───────────────────────────────────────────────────────────

const MessageSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  topK: z.number().int().min(1).max(20).default(10),
  force: z.boolean().default(false),
  userId: z.string().min(1),
  userName: z.string().min(1),
});

// ─── Response Schema ──────────────────────────────────────────────────────────

const GeneratedQuestionSchema = z.object({
  question: z.string().min(20),
  category: z.enum(['SCOPE', 'TECHNICAL', 'PRICING', 'SCHEDULE', 'COMPLIANCE', 'EVALUATION', 'OTHER']),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  rationale: z.string().min(20),
  ambiguitySource: z.object({
    snippet: z.string().optional(),
    sectionRef: z.string().optional(),
  }).optional(),
});

// The prompt outputs an array of questions
const GeneratedQuestionsArraySchema = z.array(GeneratedQuestionSchema);

type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

/**
 * SQS worker Lambda that processes clarifying question generation requests.
 *
 * This runs outside the API Gateway 29-second timeout, allowing plenty of time
 * for Claude to analyze the solicitation and generate questions.
 *
 * Uses the prompts from @/constants/prompt.ts which are designed to:
 * - Generate questions tied to specific solicitation text (with snippets)
 * - Avoid questions with obvious answers already in the solicitation
 * - Include section references for traceability
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const rawMessage = JSON.parse(record.body) as ClarifyingQuestionGenerationMessage;
      const { success, data: message, error } = MessageSchema.safeParse(rawMessage);

      if (!success) {
        console.error('Invalid SQS message schema:', error.issues);
        // Don't retry malformed messages
        continue;
      }

      console.log(`Processing clarifying question generation for opportunityId=${message.opportunityId}`);

      const { orgId, projectId, opportunityId, topK, userId, userName } = message;

      // Load solicitation text
      const rawSolicitationText = await loadAllSolicitationTexts(projectId, opportunityId);
      if (!rawSolicitationText || rawSolicitationText.trim().length < 100) {
        console.error(`No solicitation documents found for opportunityId=${opportunityId}`);
        // Don't retry - this is a data issue, not a transient failure
        continue;
      }

      const solicitationText = truncateText(rawSolicitationText, 40000);
      console.log(`Loaded ${solicitationText.length} chars of solicitation text`);

      // Load executive brief data for context
      let summary = 'None';
      let requirements = 'None';
      let evaluation = 'None';
      let deadlines = 'None';
      let risks = 'None';

      try {
        const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);
        if (brief?.sections) {
          const sections = brief.sections as Record<string, { data?: unknown }>;
          if (sections.summary?.data) {
            summary = JSON.stringify(sections.summary.data);
          }
          if (sections.requirements?.data) {
            const reqData = sections.requirements.data as Record<string, unknown>;
            requirements = JSON.stringify(reqData);
            if (reqData?.evaluationFactors) {
              evaluation = JSON.stringify(reqData.evaluationFactors);
            }
          }
          if (sections.deadlines?.data) {
            deadlines = JSON.stringify(sections.deadlines.data);
          }
          if (sections.risks?.data) {
            risks = JSON.stringify(sections.risks.data);
          }
        }
        console.log('Loaded executive brief context for question generation');
      } catch (briefErr) {
        console.warn('Could not load executive brief (continuing without):', (briefErr as Error)?.message);
      }

      // Query knowledge base for relevant context
      let kbText = 'None';
      try {
        const kbMatches = await queryCompanyKnowledgeBase(orgId, solicitationText.substring(0, 4000), 5);
        if (kbMatches?.length) {
          kbText = kbMatches
            .slice(0, 5)
            .map((m) => {
              const rec = m as unknown as Record<string, unknown>;
              const meta = rec.metadata as Record<string, unknown> | undefined;
              return (meta?.text as string) || '';
            })
            .filter(Boolean)
            .join('\n\n---\n\n');
          console.log(`Retrieved ${kbMatches.length} KB chunks for context`);
        }
      } catch (kbErr) {
        console.warn('KB query failed (continuing without KB context):', (kbErr as Error)?.message);
      }

      // Use the prompts from constants/prompt.ts
      const systemPrompt = await getClarifyingQuestionsSystemPrompt(orgId);
      const userPrompt = await useClarifyingQuestionsUserPrompt(
        orgId,
        solicitationText,
        summary,
        requirements,
        evaluation,
        deadlines,
        risks,
        kbText,
        topK,
      );

      console.log('Invoking Claude for clarifying question generation...');

      const response = await invokeClaudeJson({
        modelId: BEDROCK_MODEL_ID,
        system: systemPrompt,
        user: userPrompt,
        outputSchema: GeneratedQuestionsArraySchema,
        maxTokens: 6000,
        temperature: 0.3,
      });

      const questions = Array.isArray(response) ? response : [];
      console.log(`Generated ${questions.length} clarifying questions`);

      if (questions.length === 0) {
        console.warn('No questions generated - skipping save');
        continue;
      }

      // Batch save all questions to DynamoDB
      const now = nowIso();
      await createClarifyingQuestionsBatch({
        orgId,
        projectId,
        opportunityId,
        questions: questions.map((q: GeneratedQuestion) => ({
          question: q.question,
          category: q.category as ClarifyingQuestionCategory,
          priority: q.priority as ClarifyingQuestionPriority,
          rationale: q.rationale,
          ambiguitySource: q.ambiguitySource ? {
            snippet: q.ambiguitySource.snippet ?? null,
            sectionRef: q.ambiguitySource.sectionRef ?? null,
          } as AmbiguitySource : null,
          status: 'SUGGESTED' as const,
          responseReceived: false,
          createdAt: now,
          updatedAt: now,
        })),
      });

      console.log(`Successfully saved ${questions.length} clarifying questions for opportunityId=${opportunityId}`);

      // Write audit log (non-blocking)
      const hmacSecret = await getHmacSecret();
      writeAuditLog(
        {
          logId: uuidv4(),
          timestamp: nowIso(),
          userId,
          userName,
          organizationId: orgId,
          action: 'CLARIFYING_QUESTION_GENERATED',
          resource: 'clarifying-question',
          resourceId: opportunityId,
          changes: {
            after: {
              questionsGenerated: questions.length,
              projectId,
              opportunityId,
            },
          },
          ipAddress: '0.0.0.0', // Background worker
          userAgent: 'clarifying-question-worker',
          result: 'success',
        },
        hmacSecret,
      ).catch((err) => console.warn('Failed to write audit log:', (err as Error)?.message));

    } catch (err) {
      console.error('Error processing clarifying question generation:', err);
      // Mark this message for retry
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
