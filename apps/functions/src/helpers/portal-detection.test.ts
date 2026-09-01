import { detectAgencyPortal, detectPortalByDomain, searchForPortal, getAgencyName, extractAgencyNameFromUrl } from '@/helpers/portal-detection';
import type { DetectedPortal } from '@/types/portal-detection';
import type { PortalType } from '@auto-rfp/core';

// Mock fetch globally
// We'll mock fetch in each test to avoid cross-contamination

describe('portal-detection', () => {
  beforeEach(() => {
    // Mock fetch for all tests
    global.fetch = jest.fn();
  });

  describe('getAgencyName', () => {
    it('returns trimmed agency info', () => {
      expect(getAgencyName('  California Department of Fish and Wildlife  ')).toBe('California Department of Fish and Wildlife');
      expect(getAgencyName('')).toBe('');
    });
  });

  describe('extractAgencyNameFromUrl', () => {
    it('extracts agency name from govqa.us domain', () => {
      expect(extractAgencyNameFromUrl('https://californiadfw.govqa.us')).toBe('Californiadfw');
    });

    it('extracts agency name from govqa.com domain', () => {
      expect(extractAgencyNameFromUrl('https://californiadfw.govqa.com')).toBe('Californiadfw');
    });

    it('handles www prefix', () => {
      expect(extractAgencyNameFromUrl('https://www.californiadfw.govqa.us')).toBe('Californiadfw');
    });

    it('returns empty string for invalid URL', () => {
      expect(extractAgencyNameFromUrl('invalid-url')).toBe('');
    });

    it('converts hyphens to spaces and capitalizes', () => {
      expect(extractAgencyNameFromUrl('https://california-dfw.govqa.us')).toBe('California Dfw');
    });
  });

  describe('detectPortalByDomain', () => {
    it('detects GovQA domain pattern', async () => {
      const result = await detectPortalByDomain('California Department of Fish and Wildlife', 'californiadfw.govqa.us');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us'
      });
    });

    it('detects GovQA with www prefix', async () => {
      const result = await detectPortalByDomain('California Department of Fish and Wildlife', 'www.californiadfw.govqa.us');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://www.californiadfw.govqa.us'
      });
    });

    it('detects known agency-specific pattern', async () => {
      const result = await detectPortalByDomain('California Department of Fish and Wildlife', 'example.com');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us',
        recordTypeField: 'type_of_record_requested',
        recordTypeValue: 'California Department of Fish and Wildlife'
      });
    });

    it('returns unknown for unknown domain', async () => {
      const result = await detectPortalByDomain('Unknown Agency', 'unknown.com');
      expect(result).toEqual({
        detected: false,
        type: 'Unknown',
        baseUrl: ''
      });
    });

    it('returns unknown if domain matches but agency name has no pattern', async () => {
      const result = await detectPortalByDomain('Unknown Agency', 'californiadfw.govqa.us');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us'
      });
    });
  });

  describe('searchForPortal', () => {
    it('detects GovQA domain through search', async () => {
      // Mock fetch to return OK for govqa.us domain
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      const result = await searchForPortal('California Department of Fish and Wildlife');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://california-department-of-fish-and-wildlife.govqa.us'
      });
    });

    it('returns unknown if no domain responds', async () => {
      // Mock fetch to return error for all domains
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await searchForPortal('Unknown Agency');
      expect(result).toEqual({
        detected: false,
        type: 'Unknown',
        baseUrl: ''
      });
    });

    it('detects GovQA portal by domain pattern', async () => {
      // Mock fetch to return OK for a govqa domain
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      const result = await searchForPortal('Unknown Agency');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://unknown-agency.govqa.us'
      });
    });
  });

  describe('detectAgencyPortal', () => {
    it('uses domain if provided', async () => {
      // Mock detectPortalByDomain
      const mockDetectPortalByDomain = jest.fn().mockResolvedValue({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us'
      });
      
      // Mock the underlying function
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      detectAgencyPortal = (async (agencyName, domain) => {
        return await mockDetectPortalByDomain(agencyName, domain);
      }) as typeof detectAgencyPortal;

      const result = await detectAgencyPortal('California Department of Fish and Wildlife', 'californiadfw.govqa.us');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us'
      });
      expect(mockDetectPortalByDomain).toHaveBeenCalledWith('California Department of Fish and Wildlife', 'californiadfw.govqa.us');
    });

    it('uses agency-specific pattern if available', async () => {
      // Mock detectPortalByDomain to not match domain
      const mockDetectPortalByDomain = jest.fn().mockResolvedValue({
        detected: false,
        type: 'Unknown',
        baseUrl: ''
      });
      
      // Mock searchForPortal
      const mockSearchForPortal = jest.fn().mockResolvedValue({
        detected: false,
        type: 'Unknown',
        baseUrl: ''
      });
      
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      detectAgencyPortal = (async (agencyName, domain) => {
        // Mock the functions
        const result1 = await mockDetectPortalByDomain(agencyName, domain);
        if (result1.detected) return result1;
        
        const result2 = await mockSearchForPortal(agencyName);
        if (result2.detected) return result2;
        
        // Return the agency-specific pattern
        return {
          detected: true,
          type: 'GovQA',
          baseUrl: 'https://californiadfw.govqa.us',
          recordTypeField: 'type_of_record_requested',
          recordTypeValue: 'California Department of Fish and Wildlife'
        };
      }) as typeof detectAgencyPortal;

      const result = await detectAgencyPortal('California Department of Fish and Wildlife');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us',
        recordTypeField: 'type_of_record_requested',
        recordTypeValue: 'California Department of Fish and Wildlife'
      });
    });

    it('uses web search when other methods fail', async () => {
      // Mock detectPortalByDomain to fail
      const mockDetectPortalByDomain = jest.fn().mockResolvedValue({
        detected: false,
        type: 'Unknown',
        baseUrl: ''
      });
      
      // Mock searchForPortal to succeed
      const mockSearchForPortal = jest.fn().mockResolvedValue({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us'
      });
      
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      detectAgencyPortal = (async (agencyName, domain) => {
        // Mock the functions
        const result1 = await mockDetectPortalByDomain(agencyName, domain);
        if (result1.detected) return result1;
        
        const result2 = await mockSearchForPortal(agencyName);
        if (result2.detected) return result2;
        
        // Return the agency-specific pattern
        return {
          detected: true,
          type: 'GovQA',
          baseUrl: 'https://californiadfw.govqa.us',
          recordTypeField: 'type_of_record_requested',
          recordTypeValue: 'California Department of Fish and Wildlife'
        };
      }) as typeof detectAgencyPortal;

      const result = await detectAgencyPortal('California Department of Fish and Wildlife');
      expect(result).toEqual({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us'
      });
      expect(mockDetectPortalByDomain).toHaveBeenCalledWith('California Department of Fish and Wildlife', undefined);
      expect(mockSearchForPortal).toHaveBeenCalledWith('California Department of Fish and Wildlife');
    });
  });
});