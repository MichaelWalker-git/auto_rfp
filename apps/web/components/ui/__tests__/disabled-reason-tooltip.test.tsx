import { render, screen } from '@testing-library/react';
import { DisabledReasonTooltip } from '../disabled-reason-tooltip';
import { Button } from '../button';

describe('DisabledReasonTooltip', () => {
  it('renders children directly when no reason is given', () => {
    const { container } = render(
      <DisabledReasonTooltip>
        <Button>Do it</Button>
      </DisabledReasonTooltip>,
    );

    expect(screen.getByRole('button', { name: 'Do it' })).toBeTruthy();
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it('renders children directly when reason is null', () => {
    const { container } = render(
      <DisabledReasonTooltip reason={null}>
        <Button>Do it</Button>
      </DisabledReasonTooltip>,
    );

    expect(screen.getByRole('button', { name: 'Do it' })).toBeTruthy();
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it('wraps the child in a tooltip trigger when a reason is given', () => {
    const { container } = render(
      <DisabledReasonTooltip reason="Upload solicitation documents first">
        <Button disabled>Do it</Button>
      </DisabledReasonTooltip>,
    );

    const trigger = container.querySelector('[data-slot="tooltip-trigger"]');
    expect(trigger).toBeTruthy();
    // The disabled button lives inside the trigger span so hover events still fire.
    expect(trigger?.querySelector('button')).toBeTruthy();
  });
});
