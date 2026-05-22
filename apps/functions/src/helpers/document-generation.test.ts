/**
 * Unit tests for document-generation helpers
 * Covers: validateGeneratedContent, calculateRetryDelay
 */

import {
  validateGeneratedContent,
  calculateRetryDelay,
  RETRY_BASE_DELAY_SECONDS,
  RETRY_MAX_DELAY_SECONDS,
} from './document-generation';
import { MAX_GENERATION_RETRIES } from '@auto-rfp/core';

describe('validateGeneratedContent', () => {
  describe('invalid content cases', () => {
    it('returns invalid for null content', () => {
      const result = validateGeneratedContent(null);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('returns invalid for undefined content', () => {
      const result = validateGeneratedContent(undefined);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('returns invalid for empty string', () => {
      const result = validateGeneratedContent('');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('returns invalid for whitespace-only content', () => {
      const result = validateGeneratedContent('   \n\t  ');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('returns invalid for HTML tags only (no text content)', () => {
      const result = validateGeneratedContent('<div><span></span><p></p></div>');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('only HTML tags');
    });

    it('returns invalid for placeholder-only content with {{MACRO}} style', () => {
      const result = validateGeneratedContent('<div>{{COMPANY_NAME}} {{PROJECT_TITLE}}</div>');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('placeholders');
    });

    it('returns invalid for placeholder-only content with [CONTENT:] style', () => {
      const result = validateGeneratedContent('<div>[CONTENT: Write your summary here]</div>');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('placeholders');
    });

    it('returns invalid for placeholder-only content with [Your X] style', () => {
      const result = validateGeneratedContent('<div>[Your Company Name] [Your Address]</div>');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('placeholders');
    });

    it('returns invalid for content too short (< 100 chars)', () => {
      const shortContent = '<p>This is a very short document.</p>'; // ~35 chars
      const result = validateGeneratedContent(shortContent);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('too short');
    });

    it('returns invalid for content that is short after removing placeholders', () => {
      const content = '<p>Hello {{COMPANY_NAME}}</p><p>[CONTENT: Main content goes here]</p>';
      const result = validateGeneratedContent(content);
      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/placeholders|too short/);
    });
  });

  describe('valid content cases', () => {
    it('returns valid for content with sufficient text (100+ chars)', () => {
      const validContent = `
        <h1>Executive Summary</h1>
        <p>This is a detailed executive summary that provides an overview of our proposal. 
        We are committed to delivering exceptional value to your organization through our 
        comprehensive approach to solving your most pressing challenges.</p>
      `;
      const result = validateGeneratedContent(validContent);
      expect(result.isValid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns valid for content with some placeholders but also real text', () => {
      const content = `
        <h1>Technical Proposal for {{PROJECT_TITLE}}</h1>
        <p>Our company, {{COMPANY_NAME}}, proposes a comprehensive solution that leverages 
        our extensive experience in federal contracting. We have successfully completed over 
        50 similar projects in the past five years, delivering consistent results on time 
        and within budget.</p>
      `;
      const result = validateGeneratedContent(content);
      expect(result.isValid).toBe(true);
    });

    it('returns valid for long document content', () => {
      const longContent = '<article>' + 'Lorem ipsum dolor sit amet. '.repeat(50) + '</article>';
      const result = validateGeneratedContent(longContent);
      expect(result.isValid).toBe(true);
    });
  });
});

describe('calculateRetryDelay', () => {
  it('returns base delay for first retry (retryCount = 1)', () => {
    const delay = calculateRetryDelay(1);
    expect(delay).toBe(RETRY_BASE_DELAY_SECONDS); // 30s
  });

  it('returns doubled delay for second retry (retryCount = 2)', () => {
    const delay = calculateRetryDelay(2);
    expect(delay).toBe(RETRY_BASE_DELAY_SECONDS * 2); // 60s
  });

  it('returns capped delay for third retry (retryCount = 3)', () => {
    const delay = calculateRetryDelay(3);
    expect(delay).toBe(RETRY_MAX_DELAY_SECONDS); // 120s (capped)
  });

  it('caps delay at max for high retry counts', () => {
    const delay = calculateRetryDelay(10);
    expect(delay).toBe(RETRY_MAX_DELAY_SECONDS); // Should be capped at 120s
  });

  it('handles retryCount = 0 (edge case)', () => {
    const delay = calculateRetryDelay(0);
    // 30 * 2^(-1) = 15, but this shouldn't happen in practice
    // The formula gives 15, which is less than the cap
    expect(delay).toBeLessThanOrEqual(RETRY_MAX_DELAY_SECONDS);
  });
});

