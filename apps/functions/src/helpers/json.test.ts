/**
 * Unit tests for json.ts helper
 *
 * Related Sentry Issues:
 * - AUTO-RFP-2A: SyntaxError in JSON parsing from truncated Bedrock responses
 */

import { safeParseJsonFromModel } from './json';

describe('safeParseJsonFromModel', () => {
  describe('valid JSON parsing', () => {
    it('should parse valid JSON object', () => {
      const input = '{"sections": [{"title": "Test", "questions": []}]}';
      const result = safeParseJsonFromModel(input);
      expect(result).toEqual({ sections: [{ title: 'Test', questions: [] }] });
    });

    it('should parse JSON with surrounding text', () => {
      const input = 'Here is the JSON: {"sections": []} Some trailing text';
      const result = safeParseJsonFromModel(input);
      expect(result).toEqual({ sections: [] });
    });

    it('should parse JSON with markdown code fences', () => {
      const input = '```json\n{"sections": []}\n```';
      const result = safeParseJsonFromModel(input);
      expect(result).toEqual({ sections: [] });
    });
  });

  describe('truncation repair (AUTO-RFP-2A)', () => {
    it('should repair truncated JSON with unclosed array', () => {
      // Simulates truncation right after an object - repair should close brackets
      const input = '{"sections": [{"title": "Test"}';
      const result = safeParseJsonFromModel(input);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('Test');
    });

    it('should repair truncated JSON with unclosed object', () => {
      const input = '{"sections": [{"title": "Test"}';
      const result = safeParseJsonFromModel(input);
      expect(result.sections).toHaveLength(1);
    });

    it('should repair truncated JSON with trailing comma', () => {
      const input = '{"sections": [{"title": "Test"},';
      const result = safeParseJsonFromModel(input);
      expect(result.sections).toHaveLength(1);
    });

    it('should repair deeply nested truncated JSON', () => {
      const input = '{"data": {"items": [{"name": "A"}, {"name": "B"}';
      const result = safeParseJsonFromModel(input);
      expect(result.data.items).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should throw for input without JSON object', () => {
      expect(() => safeParseJsonFromModel('No JSON here')).toThrow(
        'Model response contains no JSON object'
      );
    });

    it('should throw for empty input', () => {
      expect(() => safeParseJsonFromModel('')).toThrow(
        'Model response contains no JSON object'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle nested objects and arrays', () => {
      const input = JSON.stringify({
        sections: [
          {
            title: 'Section 1',
            questions: [
              { question: 'Q1', type: 'technical' },
              { question: 'Q2', type: 'pricing' },
            ],
          },
        ],
      });
      const result = safeParseJsonFromModel(input);
      expect(result.sections[0].questions).toHaveLength(2);
    });

    it('should handle special characters in strings', () => {
      const input = '{"text": "Line1\\nLine2\\tTabbed"}';
      const result = safeParseJsonFromModel(input);
      expect(result.text).toBe('Line1\nLine2\tTabbed');
    });

    it('should handle embedded newlines in strings', () => {
      const input = '{"text": "Line1\nLine2"}';
      const result = safeParseJsonFromModel(input);
      expect(result.text).toBe('Line1\nLine2');
    });
  });
});
