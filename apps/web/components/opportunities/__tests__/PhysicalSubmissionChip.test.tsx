import { render, screen } from '@testing-library/react';
import { PhysicalSubmissionChip } from '../PhysicalSubmissionChip';

describe('PhysicalSubmissionChip', () => {
  it('renders the chip when submissionMethod is PHYSICAL', () => {
    render(<PhysicalSubmissionChip submissionMethod="PHYSICAL" />);
    expect(screen.getByTestId('physical-submission-chip')).toBeInTheDocument();
  });

  it('renders the chip when submissionMethod is BOTH', () => {
    render(<PhysicalSubmissionChip submissionMethod="BOTH" />);
    expect(screen.getByTestId('physical-submission-chip')).toBeInTheDocument();
  });

  it('renders nothing when submissionMethod is ELECTRONIC', () => {
    const { container } = render(<PhysicalSubmissionChip submissionMethod="ELECTRONIC" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when submissionMethod is null', () => {
    const { container } = render(<PhysicalSubmissionChip submissionMethod={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when submissionMethod is undefined', () => {
    const { container } = render(<PhysicalSubmissionChip submissionMethod={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
