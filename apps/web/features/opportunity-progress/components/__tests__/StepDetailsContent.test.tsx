import { render, screen } from '@testing-library/react';
import { StepDetailsContent } from '../StepDetailsContent';
import type {
  ProgressStep,
  AnalysisDomain,
  RequiredFormsDomain,
  RfpDocumentsDomain,
} from '../../lib/types';

const step = (over: Partial<ProgressStep> & Pick<ProgressStep, 'stepId'>): ProgressStep => ({
  status: 'in-progress',
  detailText: 'detail',
  label: 'Step',
  navigation: { kind: 'anchor', sectionId: 'sec' },
  visible: true,
  ...over,
});

describe('StepDetailsContent', () => {
  it('renders the step label, description and detail', () => {
    render(<StepDetailsContent step={step({ stepId: 'solicitations', detailText: '2 of 3 processed' })} />);
    expect(screen.getByText('Solicitations')).toBeTruthy();
    expect(screen.getByText(/Upload the solicitation documents/)).toBeTruthy();
    expect(screen.getByText('2 of 3 processed')).toBeTruthy();
  });

  it('shows the reason callout when the step has one', () => {
    render(
      <StepDetailsContent
        step={step({ stepId: 'solicitations', reason: 'A document failed to process — remove or re-upload it' })}
      />,
    );
    expect(screen.getByText(/A document failed to process/)).toBeTruthy();
  });

  it('lists all eight analysis sections with per-section completion', () => {
    const brief = {
      sections: {
        summary: { status: 'COMPLETE' },
        scoring: { status: 'PENDING' },
      },
    } as unknown as AnalysisDomain['brief'];
    render(
      <StepDetailsContent
        step={step({ stepId: 'analysis', domainData: { brief } })}
      />,
    );
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Past performance')).toBeTruthy();
    expect(screen.getByText('Scoring')).toBeTruthy();
  });

  it('lists required forms with a fill hint', () => {
    const filledField = (id: string) => ({ fieldId: id, value: 'x' });
    const emptyField = (id: string) => ({ fieldId: id, value: null });
    const data = {
      forms: [
        {
          name: 'SF-33',
          status: 'PENDING',
          totalFieldCount: 4,
          manualFieldCount: 0,
          fields: [filledField('a'), filledField('b'), filledField('c'), filledField('d')],
          createdAt: 'a',
          updatedAt: 'a',
        },
        {
          name: 'SF-1449',
          status: 'PENDING',
          totalFieldCount: 4,
          manualFieldCount: 2,
          fields: [filledField('a'), filledField('b'), emptyField('c'), emptyField('d')],
          createdAt: 'a',
          updatedAt: 'a',
        },
      ],
    } as unknown as RequiredFormsDomain;
    render(<StepDetailsContent step={step({ stepId: 'required-forms', domainData: data })} />);
    expect(screen.getByText('SF-33')).toBeTruthy();
    expect(screen.getByText('Filled')).toBeTruthy();
    expect(screen.getByText('2 of 4 to fill')).toBeTruthy();
  });

  it('rfp-documents primary path lists the required-documents readiness', () => {
    const data = {
      documents: [{ name: 'T', title: 'Tech', documentType: 'TECHNICAL', status: 'READY', createdAt: 'a', updatedAt: 'a' }],
      requiredDocuments: [
        { documentType: 'TECHNICAL', name: 'Technical Proposal' },
        { documentType: 'PRICE', name: 'Price Proposal' },
      ],
    } as unknown as RfpDocumentsDomain;
    render(<StepDetailsContent step={step({ stepId: 'rfp-documents', domainData: data })} />);
    expect(screen.getByText('Technical Proposal')).toBeTruthy();
    expect(screen.getByText('Price Proposal')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Not ready')).toBeTruthy();
  });

  it('rfp-documents fallback shows an empty message when no documents exist', () => {
    const data = { documents: [] } as unknown as RfpDocumentsDomain;
    render(<StepDetailsContent step={step({ stepId: 'rfp-documents', domainData: data })} />);
    expect(screen.getByText(/No documents yet/)).toBeTruthy();
  });

  it('renders no item list for a step without domain data', () => {
    const { container } = render(<StepDetailsContent step={step({ stepId: 'submission' })} />);
    // header + status still render, but no <ul> checklist
    expect(container.querySelector('ul')).toBeNull();
    expect(screen.getByText('Submission')).toBeTruthy();
  });
});
