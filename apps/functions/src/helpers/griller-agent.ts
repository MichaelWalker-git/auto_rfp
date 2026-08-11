/**
 * griller-agent.ts
 *
 * The Griller: the interrogating half of the two-agent grilling loop. A
 * self-contained, reusable class — construct it with a model id and call
 * `ask()` per round; it owns its persona prompt, the raw Bedrock invocation
 * (plain text, no tools), and the interview-termination rule (ADR-13).
 *
 * Independent of the SQS worker: anything that can supply solicitation text
 * and a transcript can run an interview with it.
 */

import { invokeModel } from './bedrock-http-client';
import { extractBedrockText } from './document-generation';
import {
  INTERVIEW_COMPLETE_TOKEN,
  buildGrillerSystemPrompt,
  buildGrillerUserPrompt,
  type TranscriptEntry,
} from './solution-plan-prompts';

/** The interview may never end before round 2 (ADR-13). */
export const MIN_GRILLING_ROUNDS = 2;

const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_TEMPERATURE = 0.4;

/**
 * Whether a Griller message ends the interview. The literal token is honored
 * only (a) from round 2 onward and (b) when it is essentially the entire
 * message or its final line — a round-1 emission or a mid-text leak
 * ("…when done I will say INTERVIEW_COMPLETE") never terminates (ADR-13).
 */
export const shouldHonorTerminationToken = (content: string, round: number): boolean => {
  if (round < MIN_GRILLING_ROUNDS) return false;

  const trimmed = content.trim();
  if (!trimmed.includes(INTERVIEW_COMPLETE_TOKEN)) return false;
  if (trimmed === INTERVIEW_COMPLETE_TOKEN) return true;

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? '';

  // Tolerate markdown emphasis/heading noise and trailing punctuation around
  // the token, but nothing wordy — "I will say INTERVIEW_COMPLETE" must fail.
  const stripped = lastLine.replace(/[*`#\s]/g, '').replace(/[.!]+$/, '');
  return stripped === INTERVIEW_COMPLETE_TOKEN;
};

export interface GrillerAgentConfig {
  modelId: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GrillerTurnInput {
  /** Solicitation text, already capped by the caller. */
  solicitationText: string;
  /** Formatted exec-brief analysis; empty string when no brief exists (ADR-14). */
  execBriefText: string;
  transcript: TranscriptEntry[];
  round: number;
  maxRounds: number;
}

export class GrillerAgent {
  private readonly modelId: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: GrillerAgentConfig) {
    this.modelId = config.modelId;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  }

  /** One interview turn: 1-3 pointed questions, or the termination token. */
  async ask(input: GrillerTurnInput): Promise<string> {
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      system: buildGrillerSystemPrompt(),
      messages: [
        { role: 'user', content: [{ type: 'text', text: buildGrillerUserPrompt(input) }] },
      ],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    });

    const responseBody = await invokeModel(this.modelId, body);
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody));
    const text = extractBedrockText(parsed);
    if (!text) throw new Error('Griller returned no text content');
    return text;
  }

  /** Whether this turn's output ends the interview (ADR-13). */
  isInterviewComplete(content: string, round: number): boolean {
    return shouldHonorTerminationToken(content, round);
  }
}
