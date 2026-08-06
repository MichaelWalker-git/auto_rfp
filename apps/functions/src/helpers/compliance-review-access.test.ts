const mockGetOrganizationById = jest.fn();
jest.mock('@/helpers/org', () => ({
  getOrganizationById: (...a: unknown[]) => mockGetOrganizationById(...a),
}));

import { isComplianceReviewEnabled } from './compliance-review-access';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isComplianceReviewEnabled', () => {
  it('returns true when the org has enableComplianceReview set', async () => {
    mockGetOrganizationById.mockResolvedValue({ id: 'org-1', enableComplianceReview: true });
    await expect(isComplianceReviewEnabled('org-1')).resolves.toBe(true);
    expect(mockGetOrganizationById).toHaveBeenCalledWith('org-1');
  });

  it('returns false when the flag is absent', async () => {
    mockGetOrganizationById.mockResolvedValue({ id: 'org-1' });
    await expect(isComplianceReviewEnabled('org-1')).resolves.toBe(false);
  });

  it('returns false when the flag is explicitly false', async () => {
    mockGetOrganizationById.mockResolvedValue({ id: 'org-1', enableComplianceReview: false });
    await expect(isComplianceReviewEnabled('org-1')).resolves.toBe(false);
  });

  it('returns false when the org does not exist', async () => {
    mockGetOrganizationById.mockResolvedValue(null);
    await expect(isComplianceReviewEnabled('missing')).resolves.toBe(false);
  });
});
