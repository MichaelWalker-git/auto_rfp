import { render, screen } from '@testing-library/react';
import { ProjectOutcomeBadge } from '../ProjectOutcomeBadge';

describe('ProjectOutcomeBadge', () => {
  describe('status rendering', () => {
    it('renders WON status with correct label', () => {
      render(<ProjectOutcomeBadge status="WON" />);
      expect(screen.getByText('Won')).toBeInTheDocument();
    });

    it('renders LOST status with correct label', () => {
      render(<ProjectOutcomeBadge status="LOST" />);
      expect(screen.getByText('Lost')).toBeInTheDocument();
    });

    it('renders PENDING status with correct label', () => {
      render(<ProjectOutcomeBadge status="PENDING" />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('renders NO_BID status with correct label', () => {
      render(<ProjectOutcomeBadge status="NO_BID" />);
      expect(screen.getByText('No Bid')).toBeInTheDocument();
    });

    it('renders WITHDRAWN status with correct label', () => {
      render(<ProjectOutcomeBadge status="WITHDRAWN" />);
      expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    });

    it('renders Pending when status is null', () => {
      render(<ProjectOutcomeBadge status={null} />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('renders Pending when status is undefined', () => {
      render(<ProjectOutcomeBadge status={undefined} />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
  });

  describe('size variations', () => {
    it('applies small size classes', () => {
      const { container } = render(<ProjectOutcomeBadge status="WON" size="sm" />);
      const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
      expect(badge).toHaveClass('text-xs');
    });

    it('applies medium size classes by default', () => {
      const { container } = render(<ProjectOutcomeBadge status="WON" />);
      const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
      expect(badge).toHaveClass('text-sm');
    });

    it('applies large size classes', () => {
      const { container } = render(<ProjectOutcomeBadge status="WON" size="lg" />);
      const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
      expect(badge).toHaveClass('text-base');
    });
  });

  describe('icon display', () => {
    it('shows icon by default', () => {
      const { container } = render(<ProjectOutcomeBadge status="WON" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('hides icon when showIcon is false', () => {
      const { container } = render(<ProjectOutcomeBadge status="WON" showIcon={false} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeInTheDocument();
    });
  });

  describe('custom styling', () => {
    it('applies custom className', () => {
      const { container } = render(
        <ProjectOutcomeBadge status="WON" className="custom-class" />
      );
      const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
      expect(badge).toHaveClass('custom-class');
    });

    it('applies green background for WON status', () => {
      const { container } = render(<ProjectOutcomeBadge status="WON" />);
      const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
      expect(badge).toHaveClass('bg-green-600');
    });
  });
});
