import { fireEvent, render, screen } from '@testing-library/react';
import { SYSTEM_CREATED_BY, SYSTEM_CREATED_BY_NAME } from '@auto-rfp/core';
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import {
  NO_VERSIONS_LABEL,
  VERSION_DROPDOWN_RECENT_COUNT,
  VersionDropdown,
  VERSIONS_EMPTY_EXPLANATION,
} from '../VersionDropdown';
import { makeVersion } from '../../hooks/__tests__/test-utils';

// Radix menus need these DOM APIs that jsdom doesn't ship.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.hasPointerCapture = jest.fn();
  window.HTMLElement.prototype.releasePointerCapture = jest.fn();
});

const makeVersions = (count: number): SolutionPlanVersionListItem[] =>
  Array.from({ length: count }, (_, index) =>
    makeVersion({
      versionId: `ver-${count - index}`,
      versionNumber: count - index,
      origin: index === 1 ? 'manual-save' : 'generation',
      createdBy: index === 2 ? SYSTEM_CREATED_BY : 'user-1',
      createdByName: index === 2 ? SYSTEM_CREATED_BY_NAME : 'Jane Doe',
    }),
  );

const setup = (over: Partial<React.ComponentProps<typeof VersionDropdown>> = {}) => {
  const props = {
    versions: makeVersions(3),
    currentVersionId: 'ver-3',
    isLoading: false,
    hasError: false,
    onSelectVersion: jest.fn(),
    onSeeAll: jest.fn(),
    ...over,
  };
  render(<VersionDropdown {...props} />);
  return props;
};

// Radix opens the menu on keyboard activation (Enter) — the reliable path in jsdom.
const openMenu = () => {
  fireEvent.keyDown(screen.getByTestId('version-dropdown-trigger'), { key: 'Enter' });
};

describe('VersionDropdown', () => {
  it('shows a skeleton while the list loads — never "Loading..." text', () => {
    setup({ versions: [], isLoading: true });

    expect(screen.getByTestId('version-dropdown-skeleton')).toBeTruthy();
    expect(screen.queryByText(/loading/i)).toBeNull();
    expect(screen.queryByTestId('version-dropdown-trigger')).toBeNull();
  });

  it('names the current version on the trigger from currentVersionId', () => {
    setup();

    expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent(/current/i);
  });

  it('shows at most 5 recent versions plus "See all versions"', () => {
    const { onSeeAll } = setup({ versions: makeVersions(8), currentVersionId: 'ver-8' });

    openMenu();

    const items = screen.getAllByTestId(/^version-dropdown-item-/);
    expect(items).toHaveLength(VERSION_DROPDOWN_RECENT_COUNT);
    fireEvent.click(screen.getByTestId('version-dropdown-see-all'));
    expect(onSeeAll).toHaveBeenCalled();
  });

  it('opens the read-only view for a selected entry', () => {
    const { onSelectVersion } = setup();

    openMenu();
    fireEvent.click(screen.getByTestId('version-dropdown-item-ver-2'));

    expect(onSelectVersion).toHaveBeenCalledWith('ver-2');
  });

  it('marks the current entry with a Current badge', () => {
    setup();

    openMenu();

    const currentItem = screen.getByTestId('version-dropdown-item-ver-3');
    expect(currentItem).toHaveTextContent('Current');
    expect(screen.getByTestId('version-dropdown-item-ver-2')).not.toHaveTextContent('Current');
  });

  it('shows "No versions yet" with an explanation when the history is empty', () => {
    setup({ versions: [], currentVersionId: null });

    expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent(NO_VERSIONS_LABEL);

    openMenu();
    expect(screen.getByText(VERSIONS_EMPTY_EXPLANATION)).toBeTruthy();
  });

  it('degrades to the "See all versions" entry only when the list fetch failed', () => {
    setup({ versions: [], currentVersionId: null, hasError: true });

    openMenu();

    expect(screen.queryAllByTestId(/^version-dropdown-item-/)).toHaveLength(0);
    expect(screen.getByTestId('version-dropdown-see-all')).toBeTruthy();
  });
});
