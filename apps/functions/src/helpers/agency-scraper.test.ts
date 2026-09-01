import { scrapeAgencyContactInfo, findAgencyRecordsPage } from '@/helpers/agency-scraper';

// Mock fetch globally
// We'll mock fetch in each test to avoid cross-contamination

describe('agency-scraper', () => {
  beforeEach(() => {
    // Mock fetch for all tests
    global.fetch = jest.fn();
  });

  describe('findAgencyRecordsPage', () => {
    it('returns first matching URL', async () => {
      // Mock fetch to return OK for the first URL
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 404 }) // First URL fails
        .mockResolvedValueOnce({ ok: true, status: 200 }); // Second URL succeeds

      const result = await findAgencyRecordsPage('California Department of Fish and Wildlife');
      expect(result).toBe('https://www.california-department-of-fish-and-wildlife.ca.gov/foia');
    });

    it('returns null if no URL responds', async () => {
      // Mock fetch to return error for all URLs
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await findAgencyRecordsPage('Unknown Agency');
      expect(result).toBeNull();
    });

    it('handles hyphens in agency name', async () => {
      // Mock fetch to return OK for the URL with hyphens replaced
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await findAgencyRecordsPage('California Department of Fish and Wildlife');
      expect(result).toBe('https://www.california-department-of-fish-and-wildlife.ca.gov/records');
    });
  });

  describe('scrapeAgencyContactInfo', () => {
    it('extracts statutory citation', async () => {
      const html = `
        <html>
          <body>
            <p>Under the California Public Records Act (CPRA), you may request public records...</p>
            <p>Contact: records@agency.gov</p>
          </body>
        </html>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => html
      });

      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result.statutoryCitation).toBe('California Public Records Act');
    });

    it('extracts email address with records context', async () => {
      const html = `
        <html>
          <body>
            <p>Contact the Records Office at records@agency.gov for public records requests.</p>
            <p>General inquiries: info@agency.gov</p>
          </body>
        </html>
      `;
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => html
      });
      
      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result.coordinatorEmail).toBe('records@agency.gov');
    });

    it('prefers records-related email over generic email', async () => {
      const html = `
        <html>
          <body>
            <p>Contact us at info@agency.gov or records@agency.gov for assistance.</p>
          </body>
        </html>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => html
      });

      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result.coordinatorEmail).toBe('records@agency.gov');
    });

    it('extracts phone number', async () => {
      const html = `
        <html>
          <body>
            <p>Phone: (555) 123-4567</p>
            <p>Contact: records@agency.gov</p>
          </body>
        </html>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => html
      });

      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result.coordinatorPhone).toBe(' (555) 123-4567');
    });

    it('extracts name with records officer pattern', async () => {
      const html = `
        <html>
          <body>
            <p>Records Officer: Jane Smith</p>
            <p>Phone: (555) 123-4567</p>
          </body>
        </html>
      `;
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => html
      });
      
      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result.coordinatorName).toBe('Jane Smith');
    });

    it('extracts address', async () => {
      const html = `
        <html>
          <body>
            <p>Address: 123 Main Street, Sacramento, CA 95814</p>
            <p>Contact: records@agency.gov</p>
          </body>
        </html>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => html
      });

      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result.address).toBe('123 Main Street, Sacramento, CA 95814</p');
    });

    it('extracts portal URL', async () => {
      const html = `
        <html>
          <body>
            <p>Submit requests via our portal: <a href="https://californiadfw.govqa.us/">here</a></p>
            <p>Contact: records@agency.gov</p>
          </body>
        </html>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => html
      });

      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result.portalUrl).toMatch(/https:\/\/californiadfw\.govqa\.us/);
    });

    it('handles fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      
      const result = await scrapeAgencyContactInfo('California Department of Fish and Wildlife', 'https://example.com');
      expect(result).toEqual({});
    });
  });
});