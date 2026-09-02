import {
  STATUS_DISPLAY,
  stepAccessibleLabel,
  currentStepIndex,
  completeCount,
} from '../status-display';
import type { ProgressStep, StepStatus } from '../types';

const step = (status: StepStatus, over: Partial<ProgressStep> = {}): ProgressStep => ({
  stepId: 'analysis',
  status,
  detailText: '3 of 8 sections',
  label: 'Analysis',
  navigation: { kind: 'anchor', sectionId: 'sec' },
  visible: true,
  ...over,
});

describe('STATUS_DISPLAY', () => {
  it('conveys every status in words, never colour alone (FR6)', () => {
    for (const status of Object.keys(STATUS_DISPLAY) as StepStatus[]) {
      expect(STATUS_DISPLAY[status].label.length).toBeGreaterThan(0);
      expect(STATUS_DISPLAY[status].icon).toBeDefined();
    }
  });
});

describe('stepAccessibleLabel', () => {
  it('builds "label, status, detail" without a reason', () => {
    expect(stepAccessibleLabel(step('in-progress'))).toBe(
      'Analysis, in progress, 3 of 8 sections',
    );
  });

  it('appends the reason sentence when present', () => {
    expect(
      stepAccessibleLabel(step('needs-attention', { reason: 'Outdated — new solicitation uploaded' })),
    ).toBe('Analysis, needs attention, 3 of 8 sections. Outdated — new solicitation uploaded');
  });
});

describe('currentStepIndex', () => {
  it('returns the first non-complete step', () => {
    const steps = [step('complete'), step('complete'), step('in-progress'), step('not-started')];
    expect(currentStepIndex(steps)).toBe(2);
  });

  it('returns the last step when every step is complete', () => {
    const steps = [step('complete'), step('complete'), step('complete')];
    expect(currentStepIndex(steps)).toBe(2);
  });

  it('returns 0 for an empty list (never negative)', () => {
    expect(currentStepIndex([])).toBe(0);
  });
});

describe('completeCount', () => {
  it('counts only complete steps', () => {
    const steps = [step('complete'), step('needs-attention'), step('complete'), step('not-started')];
    expect(completeCount(steps)).toBe(2);
  });

  it('is zero when nothing is complete', () => {
    expect(completeCount([step('in-progress'), step('not-started')])).toBe(0);
  });
});
