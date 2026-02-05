/**
 * Tests for DeepSeek text extraction helper functions
 *
 * Tests the integration layer with the existing DeepSeek ECS service
 * running in idp-human-validation infrastructure.
 */

import {
  shouldUseDeepSeek,
  getDeepSeekTrafficPercentage,
  shouldRouteToDeepSeek,
  inferMimeType,
  isDeepSeekSupported,
  DeepSeekExtractionError,
  DEFAULT_OCR_PROMPT,
} from '../helpers/deepseek';

describe('DeepSeek Helper Functions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('shouldUseDeepSeek', () => {
    it('should return false when USE_DEEPSEEK is not set', () => {
      delete process.env.USE_DEEPSEEK;
      expect(shouldUseDeepSeek()).toBe(false);
    });

    it('should return false when USE_DEEPSEEK is false', () => {
      process.env.USE_DEEPSEEK = 'false';
      expect(shouldUseDeepSeek()).toBe(false);
    });

    it('should return true when USE_DEEPSEEK is true', () => {
      process.env.USE_DEEPSEEK = 'true';
      expect(shouldUseDeepSeek()).toBe(true);
    });
  });

  describe('getDeepSeekTrafficPercentage', () => {
    it('should return 0 when DEEPSEEK_TRAFFIC_PERCENT is not set', () => {
      delete process.env.DEEPSEEK_TRAFFIC_PERCENT;
      expect(getDeepSeekTrafficPercentage()).toBe(0);
    });

    it('should return the configured percentage', () => {
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '50';
      expect(getDeepSeekTrafficPercentage()).toBe(50);
    });

    it('should clamp values above 100 to 100', () => {
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '150';
      expect(getDeepSeekTrafficPercentage()).toBe(100);
    });

    it('should clamp negative values to 0', () => {
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '-10';
      expect(getDeepSeekTrafficPercentage()).toBe(0);
    });

    it('should handle invalid values', () => {
      process.env.DEEPSEEK_TRAFFIC_PERCENT = 'invalid';
      expect(getDeepSeekTrafficPercentage()).toBe(0);
    });
  });

  describe('shouldRouteToDeepSeek', () => {
    it('should return false when USE_DEEPSEEK is false', () => {
      process.env.USE_DEEPSEEK = 'false';
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '100';
      expect(shouldRouteToDeepSeek('doc-123')).toBe(false);
    });

    it('should return false when traffic percentage is 0', () => {
      process.env.USE_DEEPSEEK = 'true';
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '0';
      expect(shouldRouteToDeepSeek('doc-123')).toBe(false);
    });

    it('should return true when traffic percentage is 100', () => {
      process.env.USE_DEEPSEEK = 'true';
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '100';
      expect(shouldRouteToDeepSeek('doc-123')).toBe(true);
    });

    it('should be deterministic for the same document ID', () => {
      process.env.USE_DEEPSEEK = 'true';
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '50';

      const docId = 'test-document-abc123';
      const result1 = shouldRouteToDeepSeek(docId);
      const result2 = shouldRouteToDeepSeek(docId);

      expect(result1).toBe(result2);
    });

    it('should distribute traffic roughly according to percentage', () => {
      process.env.USE_DEEPSEEK = 'true';
      process.env.DEEPSEEK_TRAFFIC_PERCENT = '50';

      // Generate 1000 unique document IDs and check distribution
      let deepSeekCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (shouldRouteToDeepSeek(`doc-${i}-${Date.now()}`)) {
          deepSeekCount++;
        }
      }

      // Should be roughly 50% (allow 10% margin)
      expect(deepSeekCount).toBeGreaterThan(400);
      expect(deepSeekCount).toBeLessThan(600);
    });
  });

  describe('inferMimeType', () => {
    it('should infer PDF type', () => {
      expect(inferMimeType('document.pdf')).toBe('application/pdf');
      expect(inferMimeType('path/to/document.PDF')).toBe('application/pdf');
    });

    it('should infer PNG type', () => {
      expect(inferMimeType('image.png')).toBe('image/png');
    });

    it('should infer JPEG type', () => {
      expect(inferMimeType('photo.jpg')).toBe('image/jpeg');
      expect(inferMimeType('photo.jpeg')).toBe('image/jpeg');
    });

    it('should infer TIFF type', () => {
      expect(inferMimeType('scan.tiff')).toBe('image/tiff');
      expect(inferMimeType('scan.tif')).toBe('image/tiff');
    });

    it('should infer GIF type', () => {
      expect(inferMimeType('image.gif')).toBe('image/gif');
    });

    it('should infer WEBP type', () => {
      expect(inferMimeType('image.webp')).toBe('image/webp');
    });

    it('should infer DOCX type', () => {
      expect(inferMimeType('document.docx')).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    });

    it('should return octet-stream for unknown types', () => {
      expect(inferMimeType('file.xyz')).toBe('application/octet-stream');
      expect(inferMimeType('noextension')).toBe('application/octet-stream');
    });
  });

  describe('isDeepSeekSupported', () => {
    it('should return true for supported types', () => {
      expect(isDeepSeekSupported('doc.pdf')).toBe(true);
      expect(isDeepSeekSupported('img.png')).toBe(true);
      expect(isDeepSeekSupported('photo.jpg')).toBe(true);
      expect(isDeepSeekSupported('photo.jpeg')).toBe(true);
      expect(isDeepSeekSupported('scan.tiff')).toBe(true);
      expect(isDeepSeekSupported('scan.tif')).toBe(true);
      expect(isDeepSeekSupported('anim.gif')).toBe(true);
      expect(isDeepSeekSupported('modern.webp')).toBe(true);
    });

    it('should return false for unsupported types', () => {
      expect(isDeepSeekSupported('doc.docx')).toBe(false);
      expect(isDeepSeekSupported('sheet.xlsx')).toBe(false);
      expect(isDeepSeekSupported('text.txt')).toBe(false);
    });

    it('should handle uppercase extensions', () => {
      expect(isDeepSeekSupported('doc.PDF')).toBe(true);
      expect(isDeepSeekSupported('img.PNG')).toBe(true);
    });
  });

  describe('DeepSeekExtractionError', () => {
    it('should store error details', () => {
      const error = new DeepSeekExtractionError(
        'Extraction failed',
        500,
        'Internal server error'
      );

      expect(error.message).toBe('Extraction failed');
      expect(error.statusCode).toBe(500);
      expect(error.responseBody).toBe('Internal server error');
      expect(error.name).toBe('DeepSeekExtractionError');
    });

    it('should identify retryable errors by status code', () => {
      const error500 = new DeepSeekExtractionError('Server error', 500);
      const error502 = new DeepSeekExtractionError('Bad gateway', 502);
      const error400 = new DeepSeekExtractionError('Bad request', 400);

      expect(error500.isRetryable()).toBe(true);
      expect(error502.isRetryable()).toBe(true);
      expect(error400.isRetryable()).toBe(false);
    });

    it('should identify retryable errors by connection message', () => {
      const connRefused = new DeepSeekExtractionError('ECONNREFUSED', 0);
      const timeout = new DeepSeekExtractionError('ETIMEDOUT', 0);
      const reset = new DeepSeekExtractionError('ECONNRESET', 0);

      expect(connRefused.isRetryable()).toBe(true);
      expect(timeout.isRetryable()).toBe(true);
      expect(reset.isRetryable()).toBe(true);
    });

    it('should identify client errors', () => {
      const error400 = new DeepSeekExtractionError('Bad request', 400);
      const error404 = new DeepSeekExtractionError('Not found', 404);
      const error500 = new DeepSeekExtractionError('Server error', 500);

      expect(error400.isClientError()).toBe(true);
      expect(error404.isClientError()).toBe(true);
      expect(error500.isClientError()).toBe(false);
    });
  });

  describe('DEFAULT_OCR_PROMPT', () => {
    it('should be defined and non-empty', () => {
      expect(DEFAULT_OCR_PROMPT).toBeDefined();
      expect(DEFAULT_OCR_PROMPT.length).toBeGreaterThan(0);
    });

    it('should mention text extraction', () => {
      expect(DEFAULT_OCR_PROMPT.toLowerCase()).toContain('text');
    });

    it('should include the required <image> placeholder', () => {
      expect(DEFAULT_OCR_PROMPT).toContain('<image>');
    });
  });
});
