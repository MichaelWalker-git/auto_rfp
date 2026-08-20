import { render, screen, fireEvent } from '@testing-library/react';

// Keep the card minimal so the test targets FindingsList's scroll-anchoring, not
// the full card (which pulls in the package-edit barrel / SWR).
jest.mock('../FindingCard', () => ({
  FindingCard: ({
    finding,
    onResolve,
  }: {
    finding: { fingerprint: string; title: string };
    onResolve?: (fp: string) => void;
  }) => (
    <button onClick={() => onResolve?.(finding.fingerprint)}>resolve {finding.title}</button>
  ),
}));

import { FindingsList } from '../FindingsList';
import type { DecoratedFinding } from '../../hooks/useFindingDecisions';

const finding = (over: Partial<DecoratedFinding>): DecoratedFinding => ({
  findingId: over.fingerprint ?? 'f',
  fingerprint: over.fingerprint ?? 'f',
  targetKind: 'RFP_DOCUMENT',
  issueType: 'INCONSISTENCY',
  severity: 'major',
  title: over.title ?? 't',
  description: 'd',
  anchorValid: true,
  ...over,
});

const props = { orgId: 'o', projectId: 'p', oppId: 'opp' };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(window, 'scrollBy').mockImplementation(() => {});
});

describe('FindingsList — scroll anchoring on resolve', () => {
  it('compensates scroll so the next finding stays put when a card is resolved', () => {
    // Anchor element (f2) moves up by 300px after f1 leaves the active list.
    let f2Top = 500;
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const fp = this.getAttribute('data-fp');
        if (fp === 'f2') return { top: f2Top } as DOMRect;
        return { top: 0 } as DOMRect;
      });

    const active = [finding({ fingerprint: 'f1', title: 'one' }), finding({ fingerprint: 'f2', title: 'two' })];
    const onResolve = jest.fn();
    const { rerender } = render(
      <FindingsList activeFindings={active} {...props} onResolve={onResolve} />,
    );

    // Click resolve on f1 — this records the anchor (f2 at top=500).
    fireEvent.click(screen.getByText('resolve one'));
    expect(onResolve).toHaveBeenCalledWith('f1');

    // Simulate the parent moving f1 to the resolved group: f2 shifts up to 200.
    f2Top = 200;
    rerender(
      <FindingsList
        activeFindings={[finding({ fingerprint: 'f2', title: 'two' })]}
        resolvedFindings={[finding({ fingerprint: 'f1', title: 'one' })]}
        {...props}
        onResolve={onResolve}
      />,
    );

    // Delta = 200 - 500 = -300 → scroll up by 300 to keep f2 in place.
    expect(window.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: -300 }),
    );
  });

  it('does not scroll when there is no other active finding to anchor to', () => {
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ top: 0 }) as DOMRect);

    const onResolve = jest.fn();
    const { rerender } = render(
      <FindingsList
        activeFindings={[finding({ fingerprint: 'only', title: 'solo' })]}
        {...props}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByText('resolve solo'));
    rerender(
      <FindingsList
        activeFindings={[]}
        resolvedFindings={[finding({ fingerprint: 'only', title: 'solo' })]}
        {...props}
        onResolve={onResolve}
      />,
    );
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});
