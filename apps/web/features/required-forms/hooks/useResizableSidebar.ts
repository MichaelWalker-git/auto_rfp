'use client';

import { useCallback, useState } from 'react';

interface UseResizableSidebarOptions {
  /** Initial width in px. */
  initial?: number;
  /** Minimum width in px (sidebar can't shrink below this). */
  min?: number;
  /** Maximum width in px (sidebar can't grow beyond this). */
  max?: number;
}

interface UseResizableSidebar {
  /** Current sidebar width in px — apply via style={{ width }}. */
  width: number;
  /** mousedown handler for the drag divider placed to the LEFT of the sidebar. */
  onResizeStart: (e: React.MouseEvent) => void;
}

/**
 * Drag-to-resize for a RIGHT-hand sidebar in the required-forms editors.
 * The divider sits to the LEFT of the sidebar, so dragging left widens it.
 * Width is session-only (resets on reload). Shared by the PDF/XLSX/DOCX editors
 * so they resize identically.
 */
export const useResizableSidebar = ({
  initial = 340,
  min = 280,
  max = 720,
}: UseResizableSidebarOptions = {}): UseResizableSidebar => {
  const [width, setWidth] = useState(initial);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) => {
        // Sidebar is on the RIGHT: dragging left (negative dx) widens it.
        const next = Math.min(max, Math.max(min, startWidth - (ev.clientX - startX)));
        setWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
      };
      document.body.style.userSelect = 'none'; // no text selection while dragging
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [width, min, max],
  );

  return { width, onResizeStart };
};
