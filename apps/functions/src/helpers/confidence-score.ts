import {
  AnswerSource,
  ConfidenceBreakdown,
  ConfidenceBand,
  CONFIDENCE_WEIGHTS,
  getConfidenceBand,
} from '@auto-rfp/core';

// ─── Types ───

export interface ConfidenceScoreInput {
  /** Raw LLM confidence (0-1) */
  llmConfidence: number;
  /** Whether the LLM reported the answer was found in context */
  found: boolean;
  /** The question text */
  questionText: string;
  /** The generated answer text */
  answerText: string;
  /** Sources used to generate the answer */
  sources: AnswerSource[];
  /** Whether the answer came from the content library */
  fromContentLibrary: boolean;
  /** Pinecone similarity scores for the top hits (0-1) */
  similarityScores: number[];
  /** Created dates of source documents (ISO strings), if available */
  sourceCreatedDates?: (string | undefined)[];
}

export interface ConfidenceScoreResult {
  /** Overall confidence score 0-100 */
  overall: number;
  /** Per-factor breakdown 0-100 */
  breakdown: ConfidenceBreakdown;
  /** Confidence band: high | medium | low */
  band: ConfidenceBand;
}

// ─── Factor Calculations ───

/**
 * Factor 1: Context Relevance (40%)
 * Based on embedding similarity scores and LLM confidence.
 */
function calculateContextRelevance(input: ConfidenceScoreInput): number {
  const { similarityScores, llmConfidence, found } = input;

  if (!found && similarityScores.length === 0) return 20;

  // Average similarity of top hits (Pinecone scores are 0-1)
  const avgSimilarity =
    similarityScores.length > 0
      ? similarityScores.reduce((sum, s) => sum + s, 0) / similarityScores.length
      : 0;

  // Top hit similarity matters more
  const topSimilarity = similarityScores[0] || 0;

  // Weighted blend: 50% top hit, 30% average, 20% LLM confidence
  const raw =
    topSimilarity * 0.50 +
    avgSimilarity * 0.30 +
    llmConfidence * 0.20;

  // Scale to 0-100
  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

/**
 * Factor 2: Source Recency (25%)
 * How current are the source documents.
 */
function calculateSourceRecency(input: ConfidenceScoreInput): number {
  const { sourceCreatedDates } = input;

  if (!sourceCreatedDates || sourceCreatedDates.length === 0) {
    // No date info available — assume moderate recency
    return 60;
  }

  const now = Date.now();
  const DAY_MS = 86_400_000;

  const scores = sourceCreatedDates
    .filter((d): d is string => !!d)
    .map((dateStr) => {
      const ageMs = now - new Date(dateStr).getTime();
      const ageDays = Math.max(0, ageMs / DAY_MS);

      if (ageDays < 30) return 100;
      if (ageDays < 180) return 80;
      if (ageDays < 365) return 60;
      return 30;
    });

  if (scores.length === 0) return 60;

  // Use the best (most recent) source score weighted more heavily
  const best = Math.max(...scores);
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;

  return Math.round(best * 0.6 + avg * 0.4);
}

/**
 * Factor 3: Answer Coverage (20%)
 * Does the answer fully address the question?
 * Uses heuristics: question complexity vs answer length, multi-part detection.
 */
function calculateAnswerCoverage(input: ConfidenceScoreInput): number {
  const { questionText, answerText, found } = input;

  if (!answerText || answerText.trim().length === 0) return 0;

  let score = 50; // baseline

  // Detect multi-part questions (contains "and", numbered items, semicolons, question marks)
  const questionParts = estimateQuestionParts(questionText);
  const answerLength = answerText.trim().length;

  // Length adequacy — longer answers for complex questions
  if (questionParts <= 1) {
    // Simple question
    if (answerLength >= 50) score += 20;
    else if (answerLength >= 20) score += 10;
  } else {
    // Multi-part question — need more comprehensive answer
    const expectedMinLength = questionParts * 80;
    if (answerLength >= expectedMinLength) score += 25;
    else if (answerLength >= expectedMinLength * 0.5) score += 15;
    else score -= 10;
  }

  // If the LLM said it found the answer in context, boost coverage
  if (found) score += 15;

  // Check if answer contains hedging language (indicates incomplete coverage)
  const hedgingPatterns = [
    /\bnot enough information\b/i,
    /\bunable to determine\b/i,
    /\bverify in the solicitation\b/i,
    /\bcannot confirm\b/i,
    /\bbest.?practice\b/i,
    /\btypically\b/i,
    /\bgenerally\b/i,
  ];

  const hedgingCount = hedgingPatterns.filter((p) => p.test(answerText)).length;
  score -= hedgingCount * 5;

  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Factor 4: Source Authority (10%)
 * Quality of source documents.
 */
function calculateSourceAuthority(input: ConfidenceScoreInput): number {
  const { fromContentLibrary, sources, found } = input;

  // Content library = approved, curated answers
  if (fromContentLibrary) return 100;

  if (!sources || sources.length === 0) {
    return found ? 50 : 30;
  }

  // Score based on source characteristics
  let score = 50;

  // More sources = more authority (up to a point)
  const sourceCount = sources.length;
  if (sourceCount >= 5) score += 20;
  else if (sourceCount >= 3) score += 15;
  else if (sourceCount >= 1) score += 10;

  // Sources with document IDs are from uploaded docs (higher authority)
  const withDocIds = sources.filter((s) => s.documentId).length;
  if (withDocIds > 0) score += 10;

  // Sources with relevance scores
  const relevantSources = sources.filter(
    (s) => s.relevance != null && s.relevance > 0.7,
  ).length;
  if (relevantSources > 0) score += 10;

  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Factor 5: Consistency Check (5%)
 * Basic consistency heuristics.
 */
function calculateConsistency(input: ConfidenceScoreInput): number {
  const { answerText, found, llmConfidence } = input;

  let score = 70; // baseline — assume reasonable consistency

  // If LLM says found but confidence is low, that's inconsistent
  if (found && llmConfidence < 0.4) score -= 20;

  // If LLM says not found but confidence is high, that's inconsistent
  if (!found && llmConfidence > 0.8) score -= 15;

  // Very short answers for complex-seeming questions
  if (answerText && answerText.length < 30) score -= 10;

  // If answer is reasonable length and found, boost
  if (found && answerText && answerText.length > 100) score += 15;

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ─── Main Calculator ───

/**
 * Calculate the enhanced multi-factor confidence score.
 */
export function calculateConfidenceScore(
  input: ConfidenceScoreInput,
): ConfidenceScoreResult {
  const breakdown: ConfidenceBreakdown = {
    contextRelevance: calculateContextRelevance(input),
    sourceRecency: calculateSourceRecency(input),
    answerCoverage: calculateAnswerCoverage(input),
    sourceAuthority: calculateSourceAuthority(input),
    consistency: calculateConsistency(input),
  };

  const overall = Math.round(
    breakdown.contextRelevance * CONFIDENCE_WEIGHTS.contextRelevance +
    breakdown.sourceRecency * CONFIDENCE_WEIGHTS.sourceRecency +
    breakdown.answerCoverage * CONFIDENCE_WEIGHTS.answerCoverage +
    breakdown.sourceAuthority * CONFIDENCE_WEIGHTS.sourceAuthority +
    breakdown.consistency * CONFIDENCE_WEIGHTS.consistency,
  );

  const band = getConfidenceBand(overall);

  return { overall, breakdown, band };
}

// ─── Helpers ───

function estimateQuestionParts(question: string): number {
  if (!question) return 1;

  // Count explicit sub-questions (question marks)
  const questionMarks = (question.match(/\?/g) || []).length;
  if (questionMarks > 1) return questionMarks;

  // Count numbered items (1. 2. 3. or a) b) c))
  const numberedItems = (question.match(/(?:^|\n)\s*(?:\d+[.)]\s|[a-z][.)]\s)/gi) || []).length;
  if (numberedItems > 1) return numberedItems;

  // Count "and" conjunctions that might indicate multiple parts
  const andCount = (question.match(/\band\b/gi) || []).length;
  if (andCount >= 2) return andCount + 1;

  // Count semicolons
  const semicolons = (question.match(/;/g) || []).length;
  if (semicolons >= 1) return semicolons + 1;

  return 1;
}