'use client';

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { GripHorizontal } from 'lucide-react';

interface FloatingPanelProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
}

const MIN_W = 280;
const MIN_H = 320;
const MAX_W = 600;
const MAX_H = 800;

export function FloatingPanel({
  title,
  children,
  onClose,
  initialX,
  initialY,
  initialWidth = 360,
  initialHeight = 520,
}: FloatingPanelProps) {
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const [size, setSize] = useState({ w: initialWidth, h: initialHeight });

  const isDragging = useRef(false);
  const isResizing = useRef<string | null>(null); // 'se' | 'sw' | 's' | 'e'
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // Set initial position after mount
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      x: initialX ?? Math.max(0, vw - initialWidth - 32),
      y: initialY ?? Math.max(0, vh - initialHeight - 80),
    });
  }, [initialX, initialY, initialWidth, initialHeight]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setPos({
        x: Math.min(Math.max(0, ev.clientX - dragOffset.current.x), vw - size.w),
        y: Math.min(Math.max(0, ev.clientY - dragOffset.current.y), vh - 60),
      });
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pos, size.w]);

  // ── Resize ────────────────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    isResizing.current = direction;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = direction === 'se' ? 'se-resize' : direction === 'sw' ? 'sw-resize' : direction === 's' ? 's-resize' : 'e-resize';

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const dx = ev.clientX - resizeStart.current.x;
      const dy = ev.clientY - resizeStart.current.y;
      const dir = isResizing.current;

      let newW = resizeStart.current.w;
      let newH = resizeStart.current.h;
      let newX = resizeStart.current.px;

      if (dir === 'se' || dir === 'e') newW = Math.min(MAX_W, Math.max(MIN_W, resizeStart.current.w + dx));
      if (dir === 'sw') {
        newW = Math.min(MAX_W, Math.max(MIN_W, resizeStart.current.w - dx));
        newX = resizeStart.current.px + (resizeStart.current.w - newW);
      }
      if (dir === 'se' || dir === 'sw' || dir === 's') newH = Math.min(MAX_H, Math.max(MIN_H, resizeStart.current.h + dy));

      setSize({ w: newW, h: newH });
      if (dir === 'sw') setPos((p) => ({ ...p, x: newX }));
    };
    const onUp = () => {
      isResizing.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [size, pos]);

  if (pos.x === -1) return null;

  return (
    <div
      className="fixed z-50 flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200 cursor-grab active:cursor-grabbing shrink-0 select-none"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">{title}</span>
        </div>
        <button
          className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Content — fills remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>

      {/* ── Resize handles ── */}
      {/* Bottom edge */}
      <div
        className="absolute bottom-0 left-4 right-4 h-1.5 cursor-s-resize hover:bg-indigo-300/40 rounded-full transition-colors"
        onMouseDown={(e) => handleResizeStart(e, 's')}
      />
      {/* Right edge */}
      <div
        className="absolute top-8 right-0 bottom-4 w-1.5 cursor-e-resize hover:bg-indigo-300/40 rounded-full transition-colors"
        onMouseDown={(e) => handleResizeStart(e, 'e')}
      />
      {/* Bottom-right corner */}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onMouseDown={(e) => handleResizeStart(e, 'se')}
        title="Drag to resize"
      >
        <svg viewBox="0 0 10 10" className="h-3 w-3 absolute bottom-1 right-1 text-slate-300">
          <path d="M9 1L1 9M9 5L5 9M9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      {/* Bottom-left corner */}
      <div
        className="absolute bottom-0 left-0 h-4 w-4 cursor-sw-resize"
        onMouseDown={(e) => handleResizeStart(e, 'sw')}
      />
    </div>
  );
}
