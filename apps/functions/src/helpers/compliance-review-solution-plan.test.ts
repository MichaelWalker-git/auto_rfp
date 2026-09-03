const mockLoadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

const mockLoadPlanFacts = jest.fn();
jest.mock('@/helpers/compliance-truth-sources', () => ({
  loadSolutionPlanFacts: (...a: unknown[]) => mockLoadPlanFacts(...a),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { computeSolutionPlanFindings } from './compliance-review-solution-plan';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { SolutionPlanFacts } from '@/helpers/compliance-truth-sources';

const modelReply = (obj: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }));

const planFacts = (over: Partial<SolutionPlanFacts> = {}): SolutionPlanFacts => ({
  planId: 'plan-1',
  version: 2,
  isStale: false,
  text: 'Solution Architecture: AWS-based. Team Composition: 5 engineers, 1 PM.',
  costItems: [
    { label: 'AWS Hosting', amount: 5000, billing: 'MONTHLY', category: 'THIRD_PARTY', optional: false },
  ],
  currency: 'USD',
  teamMembers: [],
  ...over,
});

const htmlInv = (): PackageInventory => ({
  documents: [
    {
      documentId: 'd1',
      title: 'Technical Volume',
      targetKind: 'RFP_DOCUMENT',
      headings: [],
      htmlContentKey: 'key-d1',
    },
  ],
  forms: [],
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('computeSolutionPlanFindings — no plan', () => {
  it('returns [] and never calls the model when no READY plan exists', async () => {
    mockLoadPlanFacts.mockResolvedValue(null);
    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('fails open to [] when the loader throws', async () => {
    mockLoadPlanFacts.mockRejectedValue(new Error('plan load failed'));
    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
  });
});

describe('C6a — cost-schedule consistency', () => {
  it('flags a package price that contradicts the plan cost schedule', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    // Doc mentions the service AND a differing price. C6b runs too, so answer both calls.
    mockLoadHtml.mockResolvedValue('<p>AWS Hosting is billed at $9,000 per month for the environment.</p>');
    mockInvokeModel.mockImplementation((_m: string, body: string) => {
      const parsed = JSON.parse(body);
      const prompt = JSON.stringify(parsed);
      if (prompt.includes('cost schedule')) {
        return Promise.resolve(
          modelReply({ mismatches: [{ index: 0, field: 'price', stated: '$9,000', plan: 'USD 5000' }] }),
        );
      }
      return Promise.resolve(modelReply({ contradictions: [] }));
    });

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    const cost = findings.filter((f) => f.title.includes('AWS Hosting'));
    expect(cost).toHaveLength(1);
    expect(cost[0].issueType).toBe('SOLUTION_PLAN_MISMATCH');
    expect(cost[0].severity).toBe('major');
    expect(cost[0].description).toContain('$9,000');
    expect(cost[0].description).toContain('5000');
    // orgId threads through to every solution-plan Bedrock call as the 3rd arg.
    expect(mockInvokeModel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'o');
    for (const call of mockInvokeModel.mock.calls) {
      expect(call[2]).toBe('o');
    }
  });

  it('renders a coherent billing-cadence mismatch (title + description reflect billing, plan price still shown)', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockLoadHtml.mockResolvedValue('<p>AWS Hosting is billed at $5,000 annually for the environment.</p>');
    mockInvokeModel.mockImplementation((_m: string, body: string) => {
      if (String(body).includes('cost schedule')) {
        return Promise.resolve(
          modelReply({ mismatches: [{ index: 0, field: 'billing', stated: 'ANNUAL', plan: 'MONTHLY' }] }),
        );
      }
      return Promise.resolve(modelReply({ contradictions: [] }));
    });

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    const billing = findings.filter((f) => f.title.includes('AWS Hosting'));
    expect(billing).toHaveLength(1);
    // Title reflects billing, not price.
    expect(billing[0].title).toContain('Billing cadence');
    // Description states the plan PRICE (regression: it used to print "MONTHLY (MONTHLY)" and omit the price).
    expect(billing[0].description).toContain('USD 5000');
    expect(billing[0].description).toContain('MONTHLY');
    // The stated cadence is surfaced, and the price is not miscast as a cadence.
    expect(billing[0].description).toContain('ANNUAL');
    expect(billing[0].description).not.toContain('MONTHLY (MONTHLY)');
  });

  it('falls back to "(unspecified)" — not the plan cadence — when a billing mismatch has an empty stated', async () => {
    // Malformed model response: field=billing but stated is empty. The fallback
    // must NOT echo the plan's own cadence (which would read "…prices at MONTHLY
    // … but states a billing cadence of MONTHLY" — self-contradictory).
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockLoadHtml.mockResolvedValue('<p>AWS Hosting is billed at $5,000 for the environment.</p>');
    mockInvokeModel.mockImplementation((_m: string, body: string) => {
      if (String(body).includes('cost schedule')) {
        return Promise.resolve(
          modelReply({ mismatches: [{ index: 0, field: 'billing', stated: '', plan: 'MONTHLY' }] }),
        );
      }
      return Promise.resolve(modelReply({ contradictions: [] }));
    });

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    const billing = findings.filter((f) => f.title.includes('AWS Hosting'));
    expect(billing).toHaveLength(1);
    expect(billing[0].description).toContain('states a billing cadence of "(unspecified)"');
    // Not self-contradictory: the "states a … of MONTHLY" phrasing must not appear.
    expect(billing[0].description).not.toContain('states a billing cadence of "MONTHLY"');
  });

  it('does not flag when the price matches (model reports no mismatch)', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockLoadHtml.mockResolvedValue('<p>AWS Hosting is billed at $5,000 per month.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings.filter((f) => f.issueType === 'SOLUTION_PLAN_MISMATCH' && f.title.includes('Price'))).toEqual([]);
  });

  it('anchors a cost mismatch in a form field to that field', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockInvokeModel.mockResolvedValue(
      modelReply({ mismatches: [{ index: 0, field: 'price', stated: '$8,000', plan: 'USD 5000' }] }),
    );
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Pricing Form',
          targetKind: 'XLSX_FORM',
          fields: [{ fieldId: 'f-price', label: 'AWS Hosting', value: '$8,000 monthly' }],
        },
      ],
    };
    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor).toEqual({ kind: 'field', fieldId: 'f-price' });
  });

  it('generates no cost candidate when no priced service mention is present', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockLoadHtml.mockResolvedValue('<p>Our team is highly experienced and committed to quality.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
    // The cost verify call is skipped (no candidate); only the prose call runs.
    const costCalls = mockInvokeModel.mock.calls.filter(([, body]) => String(body).includes('cost schedule'));
    expect(costCalls).toHaveLength(0);
  });

  it('never flags a null-amount plan item (no priced line to contradict)', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts({ costItems: [] })); // loader already drops null-amount lines
    mockLoadHtml.mockResolvedValue('<p>The optional add-on is priced at $2,000 per month.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings.filter((f) => f.title.includes('Price'))).toEqual([]);
    const costCalls = mockInvokeModel.mock.calls.filter(([, body]) => String(body).includes('cost schedule'));
    expect(costCalls).toHaveLength(0);
  });
});

describe('C6b — prose contradiction', () => {
  it('flags a section that contradicts the plan, anchored to the heading with a verbatim snippet', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockLoadHtml.mockResolvedValue(
      '<h2>Staffing</h2><p>Our team will consist of 20 engineers dedicated to this effort.</p>',
    );
    mockInvokeModel.mockImplementation((_m: string, body: string) => {
      if (String(body).includes('SOLUTION PLAN')) {
        return Promise.resolve(
          modelReply({
            contradictions: [
              { index: 0, verbatimSnippet: 'Our team will consist of 20 engineers', why: 'plan says 5 engineers' },
            ],
          }),
        );
      }
      return Promise.resolve(modelReply({ mismatches: [] }));
    });

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    const prose = findings.filter((f) => f.title.includes('contradicts the solution plan'));
    expect(prose).toHaveLength(1);
    expect(prose[0].issueType).toBe('SOLUTION_PLAN_MISMATCH');
    expect(prose[0].anchor).toEqual({ kind: 'heading', text: 'Staffing' });
    expect(prose[0].snippet).toContain('20 engineers');
  });

  it('degrades a heading-less contradiction to an anchor-less snippet finding', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockLoadHtml.mockResolvedValue('<p>We will use an on-premise datacenter, not cloud.</p>');
    mockInvokeModel.mockImplementation((_m: string, body: string) => {
      if (String(body).includes('SOLUTION PLAN')) {
        return Promise.resolve(
          modelReply({
            contradictions: [{ index: 0, verbatimSnippet: 'We will use an on-premise datacenter', why: 'plan is AWS' }],
          }),
        );
      }
      return Promise.resolve(modelReply({ mismatches: [] }));
    });

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    const prose = findings.filter((f) => f.title.includes('contradicts the solution plan'));
    expect(prose).toHaveLength(1);
    expect(prose[0].anchor).toBeUndefined();
    expect(prose[0].snippet).toContain('on-premise datacenter');
  });

  it('does not flag prose the model finds consistent', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts());
    mockLoadHtml.mockResolvedValue('<h2>Approach</h2><p>We use an AWS-based architecture as planned.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ contradictions: [], mismatches: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
  });

  it('fails open to [] when the prose model call throws (cost still runs independently)', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts({ costItems: [] }));
    mockLoadHtml.mockResolvedValue('<h2>Approach</h2><p>On-premise only.</p>');
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
  });
});

describe('C6c — team-roster consistency', () => {
  const teamPlan = () =>
    planFacts({
      costItems: [], // isolate C6c: no cost candidates
      text: '', // isolate C6c: no prose call
      teamMembers: [{ name: 'Jane Doe', role: 'Project Manager' }],
    });

  it('flags a package that staffs a plan role with a different person', async () => {
    mockLoadPlanFacts.mockResolvedValue(teamPlan());
    mockLoadHtml.mockResolvedValue(
      '<p>The Project Manager for this effort will be Robert Jones, a seasoned lead.</p>',
    );
    mockInvokeModel.mockImplementation((_m: string, body: string) => {
      if (String(body).includes('team roster')) {
        return Promise.resolve(modelReply({ mismatches: [{ index: 0, stated: 'Robert Jones' }] }));
      }
      return Promise.resolve(modelReply({ mismatches: [], contradictions: [] }));
    });

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    const team = findings.filter((f) => f.title.includes('Project Manager'));
    expect(team).toHaveLength(1);
    expect(team[0].issueType).toBe('SOLUTION_PLAN_MISMATCH');
    expect(team[0].severity).toBe('major');
    expect(team[0].description).toContain('Jane Doe');
    expect(team[0].description).toContain('Robert Jones');
  });

  it('does not flag when the package names the plan-assigned person (no candidate generated)', async () => {
    mockLoadPlanFacts.mockResolvedValue(teamPlan());
    mockLoadHtml.mockResolvedValue('<p>The Project Manager for this effort will be Jane Doe.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
    // Only the plan's own assignee is named → no team candidate → no team verify call.
    const teamCalls = mockInvokeModel.mock.calls.filter(([, body]) => String(body).includes('team roster'));
    expect(teamCalls).toHaveLength(0);
  });

  it('does not flag when the model reports no mismatch (model is the precision gate)', async () => {
    mockLoadPlanFacts.mockResolvedValue(teamPlan());
    mockLoadHtml.mockResolvedValue(
      '<p>The Project Manager coordinates with Robert Jones, our client liaison.</p>',
    );
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings.filter((f) => f.title.includes('Staffing'))).toEqual([]);
  });

  it('anchors a team mismatch in a form field to that field', async () => {
    mockLoadPlanFacts.mockResolvedValue(teamPlan());
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [{ index: 0, stated: 'Robert Jones' }] }));
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Key Personnel Form',
          targetKind: 'XLSX_FORM',
          fields: [{ fieldId: 'f-pm', label: 'Project Manager', value: 'Robert Jones' }],
        },
      ],
    };
    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor).toEqual({ kind: 'field', fieldId: 'f-pm' });
  });

  it('never runs C6c when the plan has no filled team lines', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts({ costItems: [], text: '', teamMembers: [] }));
    mockLoadHtml.mockResolvedValue('<p>The Project Manager will be Robert Jones.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
    const teamCalls = mockInvokeModel.mock.calls.filter(([, body]) => String(body).includes('team roster'));
    expect(teamCalls).toHaveLength(0);
  });

  it('fails open to [] when the team model call throws', async () => {
    mockLoadPlanFacts.mockResolvedValue(teamPlan());
    mockLoadHtml.mockResolvedValue('<p>The Project Manager will be Robert Jones.</p>');
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
  });
});

describe('C6d — person→role consistency', () => {
  // A plan person under the abbreviated-surname form the roster carries, to also
  // exercise the "Petro T." style name match that personNameRegex can't do.
  const rolePlan = () =>
    planFacts({
      costItems: [], // isolate C6: no cost candidates
      text: '', // isolate C6: no prose call
      teamMembers: [{ name: 'Jane Doe', role: 'Project Manager' }],
    });

  it('flags a package that lists a plan person under a different role', async () => {
    mockLoadPlanFacts.mockResolvedValue(rolePlan());
    mockLoadHtml.mockResolvedValue(
      '<p>Jane Doe will serve as the Solution Architect for this engagement.</p>',
    );
    mockInvokeModel.mockImplementation((_m: string, body: string) => {
      // C6d and C6c share the "team roster" system phrase; the C6d prompt is the
      // one that carries planRole=.
      if (String(body).includes('planRole=')) {
        return Promise.resolve(modelReply({ mismatches: [{ index: 0, stated: 'Solution Architect' }] }));
      }
      return Promise.resolve(modelReply({ mismatches: [], contradictions: [] }));
    });

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    const role = findings.filter((f) => f.title.includes('Role for Jane Doe'));
    expect(role).toHaveLength(1);
    expect(role[0].issueType).toBe('SOLUTION_PLAN_MISMATCH');
    expect(role[0].severity).toBe('major');
    expect(role[0].description).toContain('Project Manager');
    expect(role[0].description).toContain('Solution Architect');
  });

  it('generates no candidate when the person is named under their OWN plan role', async () => {
    mockLoadPlanFacts.mockResolvedValue(rolePlan());
    mockLoadHtml.mockResolvedValue('<p>Jane Doe is the Project Manager for this effort.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
    // The person appears with their plan role → no dispute → no C6d verify call.
    const roleCalls = mockInvokeModel.mock.calls.filter(([, body]) => String(body).includes('planRole='));
    expect(roleCalls).toHaveLength(0);
  });

  it('generates no candidate when the person is mentioned without any role signal', async () => {
    mockLoadPlanFacts.mockResolvedValue(rolePlan());
    mockLoadHtml.mockResolvedValue('<p>Jane Doe reviewed the draft and approved the schedule.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
    const roleCalls = mockInvokeModel.mock.calls.filter(([, body]) => String(body).includes('planRole='));
    expect(roleCalls).toHaveLength(0);
  });

  it('matches an abbreviated-surname plan name ("Petro T.") and anchors a form-field role mismatch', async () => {
    mockLoadPlanFacts.mockResolvedValue(
      planFacts({
        costItems: [],
        text: '',
        teamMembers: [{ name: 'Petro T.', role: 'DevOps / Cloud Infrastructure Engineer' }],
      }),
    );
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [{ index: 0, stated: 'UX Designer' }] }));
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Key Personnel Form',
          targetKind: 'XLSX_FORM',
          fields: [{ fieldId: 'f-role', label: 'Proposed Role', value: 'Petro T. — UX Designer' }],
        },
      ],
    };
    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('Role for Petro T.');
    expect(findings[0].anchor).toEqual({ kind: 'field', fieldId: 'f-role' });
  });

  it('does not flag when the model reports no mismatch (model is the precision gate)', async () => {
    mockLoadPlanFacts.mockResolvedValue(rolePlan());
    mockLoadHtml.mockResolvedValue(
      '<p>Jane Doe, our lead, coordinates with the delivery manager on scheduling.</p>',
    );
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings.filter((f) => f.title.includes('Role for'))).toEqual([]);
  });

  it('never runs C6d when the plan has no filled team lines', async () => {
    mockLoadPlanFacts.mockResolvedValue(planFacts({ costItems: [], text: '', teamMembers: [] }));
    mockLoadHtml.mockResolvedValue('<p>Jane Doe will serve as the Solution Architect.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [], contradictions: [] }));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
    const roleCalls = mockInvokeModel.mock.calls.filter(([, body]) => String(body).includes('planRole='));
    expect(roleCalls).toHaveLength(0);
  });

  it('fails open to [] when the role model call throws', async () => {
    mockLoadPlanFacts.mockResolvedValue(rolePlan());
    mockLoadHtml.mockResolvedValue('<p>Jane Doe will serve as the Solution Architect.</p>');
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));

    const findings = await computeSolutionPlanFindings({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', inventory: htmlInv(),
    });
    expect(findings).toEqual([]);
  });
});
