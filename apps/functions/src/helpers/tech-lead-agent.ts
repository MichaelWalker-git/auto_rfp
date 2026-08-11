/**
 * tech-lead-agent.ts
 *
 * The Tech Lead: the answering half of the two-agent grilling loop. A
 * self-contained, reusable class — construct it with a model id and call
 * `answer()` per round; it owns its persona prompt, the tool-use loop
 * (SOLUTION_PLAN_TOOLS via `invokeClaudeWithTools`), and the per-turn
 * tool-call summaries persisted on the transcript.
 *
 * Independent of the SQS worker: anything that can supply an opportunity
 * primer, a transcript, and an org/project/opportunity context can get
 * grounded answers from it.
 */

import { z } from 'zod';

import type { GrillingToolCallSummary } from '@auto-rfp/core';

import { invokeClaudeWithTools } from './bedrock-tool-loop';
import { truncateText } from './executive-opportunity-brief';
import {
  buildTechLeadSystemPrompt,
  buildTechLeadUserPrompt,
  type TranscriptEntry,
} from './solution-plan-prompts';
import { SOLUTION_PLAN_TOOLS, executeSolutionPlanTool } from './solution-plan-tools';

const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const TOOL_SUMMARY_CHAR_CAP = 200;

const TechLeadResponseSchema = z.object({
  answer: z.string().min(1),
});

/** One-line summary of a tool call for the transcript UI — not the full payload. */
const summarizeToolCall = (toolName: string, toolInput: Record<string, unknown>): string => {
  const interesting = toolInput.query ?? toolInput.keywords ?? toolInput.topic ?? toolInput.services;
  if (interesting === undefined) return '';
  const text = typeof interesting === 'string' ? interesting : JSON.stringify(interesting);
  return truncateText(text, TOOL_SUMMARY_CHAR_CAP);
};

export interface TechLeadAgentConfig {
  modelId: string;
  maxTokens?: number;
  maxToolRounds?: number;
}

/** Tenancy/entity scope the tool executors need. */
export interface TechLeadToolContext {
  orgId: string;
  projectId: string;
  opportunityId: string;
  solutionPlanId: string;
}

export interface TechLeadTurnInput {
  /** Compact opportunity context — the agent pulls detail via tools. */
  opportunityPrimer: string;
  transcript: TranscriptEntry[];
  currentQuestions: string;
  round: number;
  toolContext: TechLeadToolContext;
}

export interface TechLeadTurnResult {
  answer: string;
  /** Summaries of the tool calls made during this turn, in call order. */
  toolCalls: GrillingToolCallSummary[];
}

export class TechLeadAgent {
  private readonly modelId: string;
  private readonly maxTokens: number;
  private readonly maxToolRounds: number;

  constructor(config: TechLeadAgentConfig) {
    this.modelId = config.modelId;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  }

  /** One answering turn: concrete decisions, grounded via the tool loop. */
  async answer(input: TechLeadTurnInput): Promise<TechLeadTurnResult> {
    const { opportunityPrimer, transcript, currentQuestions, round, toolContext } = input;

    const toolCalls: GrillingToolCallSummary[] = [];
    const { answer } = await invokeClaudeWithTools({
      modelId: this.modelId,
      system: buildTechLeadSystemPrompt(),
      user: buildTechLeadUserPrompt({ opportunityPrimer, transcript, currentQuestions, round }),
      tools: SOLUTION_PLAN_TOOLS,
      toolExecutor: async (toolName, toolInput, toolUseId) => {
        toolCalls.push({ toolName, summary: summarizeToolCall(toolName, toolInput) });
        return executeSolutionPlanTool({ toolName, toolInput, toolUseId, ...toolContext });
      },
      outputSchema: TechLeadResponseSchema,
      maxTokens: this.maxTokens,
      maxToolRounds: this.maxToolRounds,
    });

    return { answer, toolCalls };
  }
}
