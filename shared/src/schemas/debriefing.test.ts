import { describe, it, expect } from 'vitest';
import {
  DebriefingStatusSchema,
  DebriefingRequestMethodSchema,
  DebriefingLocationTypeSchema,
  DebriefingItemSchema,
  CreateDebriefingRequestSchema,
  UpdateDebriefingRequestSchema,
  GenerateDebriefingLetterRequestSchema,
  calculateDebriefingDeadline,
  type DebriefingStatus,
} from './debriefing';

describe('DebriefingStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const validStatuses: DebriefingStatus[] = [
      'NOT_REQUESTED',
      'REQUESTED',
      'SCHEDULED',
      'COMPLETED',
      'DECLINED',
    ];

    validStatuses.forEach((status) => {
      expect(DebriefingStatusSchema.safeParse(status).success).toBe(true);
    });
  });

  it('rejects invalid statuses', () => {
    expect(DebriefingStatusSchema.safeParse('PENDING').success).toBe(false);
    expect(DebriefingStatusSchema.safeParse('').success).toBe(false);
  });
});

describe('DebriefingRequestMethodSchema', () => {
  it('accepts valid methods', () => {
    expect(DebriefingRequestMethodSchema.safeParse('EMAIL').success).toBe(true);
    expect(DebriefingRequestMethodSchema.safeParse('PHONE').success).toBe(true);
    expect(DebriefingRequestMethodSchema.safeParse('PORTAL').success).toBe(true);
  });

  it('rejects invalid methods', () => {
    expect(DebriefingRequestMethodSchema.safeParse('FAX').success).toBe(false);
  });
});

describe('DebriefingLocationTypeSchema', () => {
  it('accepts valid location types', () => {
    expect(DebriefingLocationTypeSchema.safeParse('VIRTUAL').success).toBe(true);
    expect(DebriefingLocationTypeSchema.safeParse('IN_PERSON').success).toBe(true);
    expect(DebriefingLocationTypeSchema.safeParse('PHONE').success).toBe(true);
  });

  it('rejects invalid location types', () => {
    expect(DebriefingLocationTypeSchema.safeParse('HYBRID').success).toBe(false);
  });
});

describe('DebriefingItemSchema', () => {
  const validDebriefing = {
    debriefId: '550e8400-e29b-41d4-a716-446655440000',
    projectId: 'proj-123',
    orgId: 'org-456',
    requestStatus: 'SCHEDULED',
    requestDeadline: '2025-01-20T17:00:00Z',
    requestSentDate: '2025-01-18T09:00:00Z',
    requestMethod: 'EMAIL',
    scheduledDate: '2025-01-25T14:00:00Z',
    locationType: 'VIRTUAL',
    location: 'Microsoft Teams',
    meetingLink: 'https://teams.microsoft.com/l/meetup-join/123',
    attendees: ['John Smith', 'Jane Doe'],
    notes: 'Prepare questions about technical scoring',
    strengthsIdentified: ['Strong past performance', 'Competitive pricing'],
    weaknessesIdentified: ['Limited experience with similar scale'],
    evaluationScores: {
      technical: 85,
      price: 90,
      pastPerformance: 80,
    },
    keyTakeaways: 'Need to improve technical approach for future bids',
    createdAt: '2025-01-17T10:00:00Z',
    updatedAt: '2025-01-18T15:00:00Z',
    createdBy: 'user-789',
  };

  it('validates a complete debriefing item', () => {
    const result = DebriefingItemSchema.safeParse(validDebriefing);
    expect(result.success).toBe(true);
  });

  it('requires debriefId as UUID', () => {
    const invalid = { ...validDebriefing, debriefId: 'not-a-uuid' };
    const result = DebriefingItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('requires projectId', () => {
    const { projectId, ...withoutProjectId } = validDebriefing;
    const result = DebriefingItemSchema.safeParse(withoutProjectId);
    expect(result.success).toBe(false);
  });

  it('requires orgId', () => {
    const { orgId, ...withoutOrgId } = validDebriefing;
    const result = DebriefingItemSchema.safeParse(withoutOrgId);
    expect(result.success).toBe(false);
  });

  it('validates meetingLink as URL', () => {
    const invalidLink = { ...validDebriefing, meetingLink: 'not-a-url' };
    const result = DebriefingItemSchema.safeParse(invalidLink);
    expect(result.success).toBe(false);
  });

  it('allows minimal debriefing', () => {
    const minimal = {
      debriefId: '550e8400-e29b-41d4-a716-446655440000',
      projectId: 'proj-123',
      orgId: 'org-456',
      requestStatus: 'NOT_REQUESTED',
      requestDeadline: '2025-01-20T17:00:00Z',
      createdAt: '2025-01-17T10:00:00Z',
      updatedAt: '2025-01-17T10:00:00Z',
      createdBy: 'user-789',
    };

    const result = DebriefingItemSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe('CreateDebriefingRequestSchema', () => {
  it('validates valid create request', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      requestDeadline: '2025-01-20T17:00:00Z',
    };

    const result = CreateDebriefingRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('allows missing requestDeadline', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
    };

    const result = CreateDebriefingRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('requires projectId', () => {
    const request = {
      orgId: 'org-456',
    };

    const result = CreateDebriefingRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('requires orgId', () => {
    const request = {
      projectId: 'proj-123',
    };

    const result = CreateDebriefingRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('rejects empty projectId', () => {
    const request = {
      projectId: '',
      orgId: 'org-456',
    };

    const result = CreateDebriefingRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });
});

describe('UpdateDebriefingRequestSchema', () => {
  it('validates partial update with status only', () => {
    const update = {
      requestStatus: 'REQUESTED',
    };

    const result = UpdateDebriefingRequestSchema.safeParse(update);
    expect(result.success).toBe(true);
  });

  it('validates partial update with scheduling info', () => {
    const update = {
      requestStatus: 'SCHEDULED',
      scheduledDate: '2025-01-25T14:00:00Z',
      locationType: 'VIRTUAL',
      meetingLink: 'https://zoom.us/j/123456',
    };

    const result = UpdateDebriefingRequestSchema.safeParse(update);
    expect(result.success).toBe(true);
  });

  it('validates update with notes and outcomes', () => {
    const update = {
      requestStatus: 'COMPLETED',
      notes: 'Very informative debriefing',
      strengthsIdentified: ['Technical approach', 'Team qualifications'],
      weaknessesIdentified: ['Pricing was slightly high'],
      evaluationScores: {
        technical: 88,
        price: 75,
      },
      keyTakeaways: 'Focus on more competitive pricing',
    };

    const result = UpdateDebriefingRequestSchema.safeParse(update);
    expect(result.success).toBe(true);
  });

  it('allows empty object (no updates)', () => {
    const result = UpdateDebriefingRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates meetingLink must be valid URL', () => {
    const update = {
      meetingLink: 'invalid-url',
    };

    const result = UpdateDebriefingRequestSchema.safeParse(update);
    expect(result.success).toBe(false);
  });
});

describe('GenerateDebriefingLetterRequestSchema', () => {
  it('validates valid request', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
    };

    const result = GenerateDebriefingLetterRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('requires both projectId and orgId', () => {
    expect(GenerateDebriefingLetterRequestSchema.safeParse({ projectId: 'proj-123' }).success).toBe(false);
    expect(GenerateDebriefingLetterRequestSchema.safeParse({ orgId: 'org-456' }).success).toBe(false);
  });
});

describe('calculateDebriefingDeadline', () => {
  it('calculates 3 business days from Monday', () => {
    // Monday January 27, 2025
    const notification = new Date('2025-01-27T10:00:00Z');
    const deadline = calculateDebriefingDeadline(notification);

    // Should be Thursday January 30, 2025
    expect(deadline.getDate()).toBe(30);
    expect(deadline.getMonth()).toBe(0); // January
  });

  it('skips weekends when calculating', () => {
    // Thursday January 30, 2025
    const notification = new Date('2025-01-30T10:00:00Z');
    const deadline = calculateDebriefingDeadline(notification);

    // Should be Wednesday February 5, 2025 (skips Sat/Sun)
    expect(deadline.getDate()).toBe(4);
    expect(deadline.getMonth()).toBe(1); // February
  });

  it('handles Friday notification', () => {
    // Friday January 31, 2025
    const notification = new Date('2025-01-31T10:00:00Z');
    const deadline = calculateDebriefingDeadline(notification);

    // Should be Wednesday February 5, 2025 (Mon, Tue, Wed)
    expect(deadline.getDate()).toBe(5);
    expect(deadline.getMonth()).toBe(1); // February
  });

  it('handles notification on weekend', () => {
    // Saturday February 1, 2025
    const notification = new Date('2025-02-01T10:00:00Z');
    const deadline = calculateDebriefingDeadline(notification);

    // Should be Wednesday February 5, 2025 (Mon, Tue, Wed)
    expect(deadline.getDate()).toBe(5);
    expect(deadline.getMonth()).toBe(1); // February
  });
});
