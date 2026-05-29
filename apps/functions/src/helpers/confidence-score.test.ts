import { calculateConfidenceScore, ConfidenceScoreInput } from './confidence-score';

function makeInput(overrides: Partial<ConfidenceScoreInput> = {}): ConfidenceScoreInput {
  return {
    llmConfidence: 0.85,
    found: true,
    questionText: 'What is the submission deadline?',
    answerText: 'The submission deadline is March 15, 2026 at 5:00 PM EST.',
    sources: [
      { id: '1', documentId: 'doc-1', fileName: 'rfp.pdf', chunkKey: 'chunk-1' },
      { id: '2', documentId: 'doc-2', fileName: 'amendment.pdf', chunkKey: 'chunk-2' },
    ],
    fromContentLibrary: false,
    similarityScores: [0.92, 0.87, 0.81, 0.75],
    sourceCreatedDates: undefined,
    ...overrides,
  };
}

describe('calculateConfidenceScore', () => {
  it('returns overall score between 0 and 100', () => {
    const result = calculateConfidenceScore(makeInput());
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('returns all 5 breakdown factors', () => {
    const result = calculateConfidenceScore(makeInput());
    expect(result.breakdown).toHaveProperty('contextRelevance');
    expect(result.breakdown).toHaveProperty('sourceRecency');
    expect(result.breakdown).toHaveProperty('answerCoverage');
    expect(result.breakdown).toHaveProperty('sourceAuthority');
    expect(result.breakdown).toHaveProperty('consistency');
  });

  it('each factor is between 0 and 100', () => {
    const result = calculateConfidenceScore(makeInput());
    for (const value of Object.values(result.breakdown)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('returns correct confidence band for high score', () => {
    const now = new Date().toISOString();
    const result = calculateConfidenceScore(makeInput({
      llmConfidence: 0.95,
      similarityScores: [0.98, 0.95, 0.93],
      fromContentLibrary: true,
      sourceCreatedDates: [now],
      answerText: 'The submission deadline is March 15, 2026 at 5:00 PM EST as stated in Section L of the solicitation document.',
    }));
    expect(result.band).toBe('high');
  });

  it('returns low band for poor inputs', () => {
    const result = calculateConfidenceScore(makeInput({
      llmConfidence: 0.2,
      found: false,
      answerText: 'Typically, you should verify this in the solicitation.',
      sources: [],
      similarityScores: [0.3, 0.25],
    }));
    expect(result.band).toBe('low');
  });

  it('content library answers get high source authority', () => {
    const result = calculateConfidenceScore(makeInput({
      fromContentLibrary: true,
    }));
    expect(result.breakdown.sourceAuthority).toBe(100);
  });

  it('no sources and not found gives low source authority', () => {
    const result = calculateConfidenceScore(makeInput({
      sources: [],
      found: false,
    }));
    expect(result.breakdown.sourceAuthority).toBe(30);
  });

  it('recent source dates give high recency score', () => {
    const now = new Date();
    const result = calculateConfidenceScore(makeInput({
      sourceCreatedDates: [now.toISOString()],
    }));
    expect(result.breakdown.sourceRecency).toBeGreaterThanOrEqual(80);
  });

  it('old source dates give low recency score', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000);
    const result = calculateConfidenceScore(makeInput({
      sourceCreatedDates: [twoYearsAgo.toISOString()],
    }));
    expect(result.breakdown.sourceRecency).toBeLessThanOrEqual(50);
  });

  it('no source dates defaults to moderate recency', () => {
    const result = calculateConfidenceScore(makeInput({
      sourceCreatedDates: undefined,
    }));
    expect(result.breakdown.sourceRecency).toBe(60);
  });

  it('hedging language reduces answer coverage', () => {
    const withHedging = calculateConfidenceScore(makeInput({
      answerText: 'Typically, best practice is to verify in the solicitation. Generally, you should check.',
    }));
    const withoutHedging = calculateConfidenceScore(makeInput({
      answerText: 'The deadline is March 15, 2026 at 5:00 PM EST as stated in Section L.',
    }));
    expect(withHedging.breakdown.answerCoverage).toBeLessThan(withoutHedging.breakdown.answerCoverage);
  });

  it('empty answer gives zero coverage', () => {
    const result = calculateConfidenceScore(makeInput({
      answerText: '',
    }));
    expect(result.breakdown.answerCoverage).toBe(0);
  });

  it('inconsistent found=true with low confidence reduces consistency', () => {
    const inconsistent = calculateConfidenceScore(makeInput({
      found: true,
      llmConfidence: 0.2,
    }));
    const consistent = calculateConfidenceScore(makeInput({
      found: true,
      llmConfidence: 0.9,
    }));
    expect(inconsistent.breakdown.consistency).toBeLessThan(consistent.breakdown.consistency);
  });

  it('weighted calculation is correct', () => {
    const result = calculateConfidenceScore(makeInput());
    const expected = Math.round(
      result.breakdown.contextRelevance * 0.40 +
      result.breakdown.sourceRecency * 0.25 +
      result.breakdown.answerCoverage * 0.20 +
      result.breakdown.sourceAuthority * 0.10 +
      result.breakdown.consistency * 0.05,
    );
    expect(result.overall).toBe(expected);
  });

  it('multi-part question with short answer gets lower coverage', () => {
    const multiPart = calculateConfidenceScore(makeInput({
      questionText: 'What is the deadline? What format should be used? What is the page limit?',
      answerText: 'March 15.',
    }));
    const singlePart = calculateConfidenceScore(makeInput({
      questionText: 'What is the deadline?',
      answerText: 'March 15.',
    }));
    expect(multiPart.breakdown.answerCoverage).toBeLessThanOrEqual(singlePart.breakdown.answerCoverage);
  });

  it('high similarity scores give high context relevance', () => {
    const result = calculateConfidenceScore(makeInput({
      similarityScores: [0.98, 0.95, 0.93],
      llmConfidence: 0.95,
    }));
    expect(result.breakdown.contextRelevance).toBeGreaterThanOrEqual(90);
  });

  it('no similarity scores and not found gives low context relevance', () => {
    const result = calculateConfidenceScore(makeInput({
      similarityScores: [],
      found: false,
    }));
    expect(result.breakdown.contextRelevance).toBe(20);
  });
});