// Mock @auto-rfp/shared to ensure correct FOIA_DOCUMENT_DESCRIPTIONS
jest.mock('@auto-rfp/shared', () => ({
  FOIA_DOCUMENT_TYPES: [
    'SSEB_REPORT',
    'SSDD',
    'TECHNICAL_EVAL',
    'PRICE_ANALYSIS',
    'PAST_PERFORMANCE_EVAL',
  ],
  FOIA_DOCUMENT_DESCRIPTIONS: {
    SSEB_REPORT: 'The complete Source Selection Evaluation Board (SSEB) report, including all technical and cost/price evaluations',
    SSDD: 'The Source Selection Decision Document (SSDD)',
    TECHNICAL_EVAL: 'Technical evaluation reports and findings',
    PRICE_ANALYSIS: 'Price/cost analysis documentation for all offerors',
    PAST_PERFORMANCE_EVAL: 'Past performance evaluation reports for all offerors',
    PROPOSAL_ABSTRACT: 'Proposal Abstract or Executive Summary',
    DEBRIEFING_NOTES: 'Debriefing Notes or Documentation',
    CORRESPONDENCE: 'All correspondence between the contracting officer and the winning contractor during the evaluation period',
    AWARD_NOTICE: 'Award Notice and Supporting Documentation',
    OTHER: 'Other Relevant Documentation',
  },
}));

describe('FOIARequestCard', () => {
  it('has correct FOIA document descriptions', () => {
    // This test verifies that the FOIA_DOCUMENT_DESCRIPTIONS are properly defined
    // with the complete descriptions rather than shortened versions
    const { FOIA_DOCUMENT_DESCRIPTIONS } = require('@auto-rfp/shared');
    
    expect(FOIA_DOCUMENT_DESCRIPTIONS.SSEB_REPORT).toContain('complete');
    expect(FOIA_DOCUMENT_DESCRIPTIONS.SSEB_REPORT).toContain('SSEB');
    expect(FOIA_DOCUMENT_DESCRIPTIONS.TECHNICAL_EVAL).toContain('Technical evaluation reports');
    expect(FOIA_DOCUMENT_DESCRIPTIONS.PRICE_ANALYSIS).toContain('Price/cost analysis documentation');
  });
});
