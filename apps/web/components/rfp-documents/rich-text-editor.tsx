'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Heading1, Heading2, Heading3, Quote, Code, Minus,
  Undo, Redo, Loader2, Highlighter, Palette, SeparatorHorizontal,
  FileText,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ─── Page Size Configuration ──────────────────────────────────────────────────

export type PageSize = 'letter' | 'a4';

interface PageDimensions {
  /** Total page width in px (at 96 DPI) */
  width: number;
  /** Total page height in px (at 96 DPI) */
  height: number;
  /** Horizontal padding (left/right margin) in px */
  paddingX: number;
  /** Vertical padding (top/bottom margin) in px */
  paddingY: number;
  /** Display label */
  label: string;
}

const PAGE_SIZES: Record<PageSize, PageDimensions> = {
  letter: {
    width: 816,   // 8.5" × 96 DPI
    height: 1056,  // 11" × 96 DPI
    paddingX: 96,  // 1" margins
    paddingY: 72,  // 0.75" margins
    label: 'Letter (8.5" × 11")',
  },
  a4: {
    width: 794,    // 210mm ≈ 8.27" × 96 DPI
    height: 1123,  // 297mm ≈ 11.69" × 96 DPI
    paddingX: 96,
    paddingY: 72,
    label: 'A4 (210 × 297 mm)',
  },
};

// ─── PageBreak TipTap Extension ──────────────────────────────────────────────

const PageBreakView = ({ selected }: NodeViewProps) => (
  <NodeViewWrapper contentEditable={false}>
    <div
      className={cn(
        'page-break-node relative my-4 select-none',
        selected && 'ring-2 ring-indigo-400 ring-offset-2 rounded',
      )}
      style={{ breakAfter: 'page' }}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t-2 border-dashed border-gray-300" />
        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest px-2 py-0.5 bg-gray-50 rounded">
          Page Break
        </span>
        <div className="flex-1 border-t-2 border-dashed border-gray-300" />
      </div>
    </div>
  </NodeViewWrapper>
);

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [
      { tag: 'div[data-page-break]' },
      { tag: 'hr.page-break' },
    ];
  },

  renderHTML() {
    return ['div', { 'data-page-break': 'true', style: 'break-after: page; page-break-after: always;' }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageBreakView);
  },
});

// ─── ResizableImage TipTap extension ─────────────────────────────────────────

type ImageAlign = 'left' | 'center' | 'right';

/**
 * React NodeView for images — renders a resizable, selectable image with a
 * floating toolbar (align left/center/right + preset widths).
 */
const ResizableImageView = ({ node, updateAttributes, selected }: NodeViewProps) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const resizeStartRef = useRef<{ x: number; startWidth: number } | null>(null);

  const { src, alt, width, align } = node.attrs;

  // ── Drag-to-resize from SE corner ──
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = imgRef.current?.offsetWidth ?? (width ?? 400);
    resizeStartRef.current = { x: e.clientX, startWidth };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const delta = ev.clientX - resizeStartRef.current.x;
      const newWidth = Math.max(80, Math.min(720, resizeStartRef.current.startWidth + delta));
      updateAttributes({ width: Math.round(newWidth) });
    };
    const onMouseUp = () => {
      resizeStartRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [width, updateAttributes]);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
    margin: '0.5rem 0',
    position: 'relative',
  };

  const imgStyle: React.CSSProperties = {
    width: width ? `${width}px` : '100%',
    maxWidth: '100%',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'block',
    outline: selected ? '2px solid #6366f1' : 'none',
    outlineOffset: '2px',
    boxShadow: selected ? '0 0 0 4px rgba(99,102,241,0.15)' : 'none',
    transition: 'outline 0.1s, box-shadow 0.1s',
  };

  return (
    <NodeViewWrapper style={containerStyle} data-drag-handle>
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
        {/* Floating image toolbar — only visible when selected */}
        {selected && (
          <div
            contentEditable={false}
            style={{
              position: 'absolute',
              top: '-38px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              background: '#1f2937',
              borderRadius: '6px',
              padding: '4px 6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Alignment */}
            {(['left', 'center', 'right'] as ImageAlign[]).map((a) => (
              <button
                key={a}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); updateAttributes({ align: a }); }}
                title={`Align ${a}`}
                style={{
                  background: align === a ? '#6366f1' : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#f9fafb',
                  cursor: 'pointer',
                  padding: '2px 5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  lineHeight: 1.4,
                }}
              >
                {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
              </button>
            ))}
            <div style={{ width: '1px', height: '16px', background: '#374151', margin: '0 2px' }} />
            {/* Preset widths */}
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  // 624 = 816px page - 192px padding
                  updateAttributes({ width: Math.round(624 * pct / 100) });
                }}
                title={`${pct}% width`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#d1d5db',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  fontSize: '10px',
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {pct}%
              </button>
            ))}
          </div>
        )}

        {/* The image itself */}
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ''}
          style={imgStyle}
          draggable={false}
        />

        {/* SE resize handle — only visible when selected */}
        {selected && (
          <div
            contentEditable={false}
            onMouseDown={handleResizeMouseDown}
            style={{
              position: 'absolute',
              bottom: '-5px',
              right: '-5px',
              width: '12px',
              height: '12px',
              background: '#6366f1',
              borderRadius: '2px',
              cursor: 'se-resize',
              border: '2px solid white',
              zIndex: 10,
            }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
};

/**
 * Custom TipTap image extension with width, align, and data-s3-key attributes.
 * Renders via ResizableImageView React NodeView.
 */
const ResizableImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (el) => {
          const style = el.getAttribute('style') ?? '';
          const m = style.match(/width:\s*(\d+)px/);
          return m ? parseInt(m[1], 10) : null;
        },
      },
      align: {
        default: 'left',
        parseHTML: (el) => {
          const style = el.getAttribute('style') ?? '';
          if (style.includes('margin:0 auto') || style.includes('margin: 0 auto')) return 'center';
          if (style.includes('margin-left:auto') || style.includes('margin-left: auto')) return 'right';
          return 'left';
        },
      },
      's3key': {
        default: null,
        parseHTML: (el) => {
          const attr = el.getAttribute('data-s3-key');
          if (attr) return attr;
          const src = el.getAttribute('src') ?? '';
          if (src.startsWith('s3key:')) return src.slice(6);
          return null;
        },
        renderHTML: (attrs) => attrs['s3key'] ? { 'data-s3-key': attrs['s3key'] } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const { align, width, 's3key': s3key, ...rest } = HTMLAttributes;
    const styleParts: string[] = [];
    if (width) styleParts.push(`width:${width}px`);
    if (align === 'center') styleParts.push('display:block;margin:0 auto');
    else if (align === 'right') styleParts.push('display:block;margin-left:auto');
    else styleParts.push('display:block');
    const style = styleParts.join(';');
    return ['img', mergeAttributes(rest, { style, ...(s3key ? { 'data-s3-key': s3key } : {}) })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

// ─── S3 image helpers ─────────────────────────────────────────────────────────

/**
 * Replace presigned/display URLs with `s3key:KEY` placeholders before saving.
 * Also strips inline base64 data URIs to prevent them from being stored
 * (they bloat storage and can cause malformed URL issues on reload).
 */
export const stripPresignedUrlsFromHtml = (html: string): string => {
  if (!html) return html;

  // 1. Replace S3-backed images with s3key: placeholders
  let result = html.replace(/<img([^>]*?)data-s3-key="([^"]+)"([^>]*?)>/g, (_, before, key, after) => {
    const withoutSrc = (before + after).replace(/\s*src="[^"]*"/, '');
    return `<img${withoutSrc} data-s3-key="${key}" src="s3key:${key}">`;
  });

  // 2. Fix double-quoted src attributes that can cause data: URIs to be fetched as HTTP
  //    e.g. src=""data:image/png;base64,..." → src="data:image/png;base64,..."
  result = result.replace(/src=""+([^"]*)""+/g, 'src="$1"');

  return result;
};

// ─── Upload error dialog ──────────────────────────────────────────────────────

const UploadErrorDialog = ({ open, message, onClose }: { open: boolean; message: string; onClose: () => void }) => (
  <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Upload Failed</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground py-2">{message}</p>
      <DialogFooter><Button onClick={onClose}>OK</Button></DialogFooter>
    </DialogContent>
  </Dialog>
);

// ─── Link dialog ──────────────────────────────────────────────────────────────

const LinkDialog = ({
  open,
  initialUrl,
  onConfirm,
  onClose,
}: {
  open: boolean;
  initialUrl: string;
  onConfirm: (url: string) => void;
  onClose: () => void;
}) => {
  const [url, setUrl] = useState(initialUrl);
  useEffect(() => { if (open) setUrl(initialUrl); }, [open, initialUrl]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Insert Link</DialogTitle></DialogHeader>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          onKeyDown={(e) => { if (e.key === 'Enter') { onConfirm(url); } }}
          autoFocus
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onConfirm(url)}>Insert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Header / Footer ─────────────────────────────────────────────────────────

const ColontitleBar = ({ label, value, onChange, disabled, placeholder, maxWidth }: {
  label: string; value: string; onChange: (v: string) => void;
  disabled?: boolean; placeholder?: string; maxWidth: number;
}) => (
  <div className="mx-auto flex items-center gap-2 px-2" style={{ maxWidth: `${maxWidth}px` }}>
    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest w-14 shrink-0 text-right">{label}</span>
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      rows={1}
      className="flex-1 resize-none text-xs text-gray-500 border-0 border-b border-dashed border-gray-200 bg-transparent focus-visible:ring-0 focus-visible:border-gray-400 rounded-none py-1 px-0 placeholder:text-gray-300"
    />
  </div>
);

// ─── Toolbar button ───────────────────────────────────────────────────────────

const ToolbarButton = ({
  onClick,
  active = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    disabled={disabled}
    title={title}
    className={cn(
      'inline-flex items-center justify-center h-7 w-7 rounded text-sm transition-colors',
      'hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed',
      active ? 'bg-gray-200 text-indigo-600' : 'text-gray-600',
    )}
  >
    {children}
  </button>
);

const ToolbarSeparator = () => <div className="w-px h-5 bg-gray-200 mx-0.5 shrink-0" />;

// ─── Page Size Selector ───────────────────────────────────────────────────────

const PageSizeSelector = ({
  pageSize,
  onPageSizeChange,
  disabled,
}: {
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  disabled: boolean;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(!open); }}
        disabled={disabled}
        title="Page size"
        className={cn(
          'inline-flex items-center gap-1 h-7 px-2 rounded text-xs font-medium transition-colors',
          'hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed',
          'text-gray-600',
        )}
      >
        <FileText className="h-3.5 w-3.5" />
        <span>{pageSize === 'letter' ? 'Letter' : 'A4'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]">
            {(Object.entries(PAGE_SIZES) as [PageSize, PageDimensions][]).map(([key, dim]) => (
              <button
                key={key}
                type="button"
                onClick={() => { onPageSizeChange(key); setOpen(false); }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors',
                  pageSize === key ? 'text-indigo-600 font-medium bg-indigo-50' : 'text-gray-700',
                )}
              >
                {dim.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Page Sheets (Background Pages) ──────────────────────────────────────────

/**
 * Renders white page "sheets" behind the editor content to create the visual
 * appearance of separate document pages (like Google Docs / MS Word).
 *
 * Each sheet is a white rectangle with a subtle shadow. Between sheets, a thin
 * dashed line marks the page boundary. Content is NEVER hidden — the separator
 * is purely decorative and uses pointer-events: none.
 */
const PageSheets = ({
  editorElement,
  pageSize,
  updateTrigger,
}: {
  editorElement: HTMLElement | null;
  pageSize: PageSize;
  updateTrigger: number;
}) => {
  const [pageCount, setPageCount] = useState(1);
  const dims = PAGE_SIZES[pageSize];
  // Content area per page = total page height minus top and bottom margins
  const contentAreaHeight = dims.height - dims.paddingY * 2;

  useEffect(() => {
    if (!editorElement) return;

    const calculate = () => {
      const proseMirror = editorElement.querySelector('.ProseMirror') as HTMLElement | null;
      if (!proseMirror) return;
      const totalHeight = proseMirror.scrollHeight;
      // Subtract the initial top padding, then divide by content area per page
      const contentOnly = totalHeight - dims.paddingY;
      setPageCount(Math.max(1, Math.ceil(contentOnly / contentAreaHeight)));
    };

    calculate();

    const observer = new ResizeObserver(calculate);
    const proseMirror = editorElement.querySelector('.ProseMirror');
    if (proseMirror) observer.observe(proseMirror);

    return () => observer.disconnect();
  }, [editorElement, dims.height, dims.paddingY, contentAreaHeight, updateTrigger]);

  /**
   * Calculate the top position of each page sheet.
   * Page 0 starts at 0. Subsequent pages start where the previous page's
   * content area ends, accounting for top/bottom margins on each page.
   *
   * Layout per page:
   *   [paddingY top] [contentAreaHeight] [paddingY bottom]
   *
   * But since ProseMirror only has one top padding at the very start,
   * the page boundaries (where content transitions from one page to the next)
   * occur at: paddingY + (i * contentAreaHeight)
   *
   * Each page sheet is positioned to show the full page (with margins) around
   * the content area boundary.
   */
  const getPageTop = (i: number) => {
    if (i === 0) return 0;
    // Each subsequent page starts at the boundary minus the top margin
    return dims.paddingY + i * contentAreaHeight - dims.paddingY;
  };

  // The boundary line position: where content for page i ends
  const getBoundaryTop = (i: number) => {
    // After page (i+1): top padding + (i+1) content areas
    return dims.paddingY + (i + 1) * contentAreaHeight;
  };

  return (
    <>
      {Array.from({ length: pageCount }, (_, i) => (
        <div
          key={i}
          className="page-sheet absolute left-0 right-0 pointer-events-none"
          style={{
            top: `${getPageTop(i)}px`,
            height: `${dims.height}px`,
          }}
        >
          {/* Page number — bottom-right corner, inside the bottom margin area */}
          <div
            className="absolute select-none"
            style={{ bottom: `${Math.max(8, dims.paddingY / 2 - 6)}px`, right: `${dims.paddingX / 2}px` }}
          >
            <span className="text-[10px] font-medium text-gray-300 tabular-nums">
              {i + 1}
            </span>
          </div>
        </div>
      ))}

      {/* Page boundary indicators — thin dashed line at content area boundaries */}
      {Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => (
        <div
          key={`sep-${i}`}
          className="page-boundary pointer-events-none absolute z-[5]"
          style={{
            top: `${getBoundaryTop(i)}px`,
            left: 0,
            right: 0,
            height: 0,
          }}
        >
          {/* Thin dashed line at the content area boundary */}
          <div
            className="absolute left-0 right-0"
            style={{
              top: '-1px',
              height: '0px',
              borderTop: '1px dashed #94a3b8',
            }}
          />

          {/* Page label — positioned to the right, outside the content area */}
          <div
            className="absolute select-none"
            style={{
              top: '-9px',
              right: '-60px',
              height: '18px',
            }}
          >
            <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-[0.1em] whitespace-nowrap">
              Page {i + 2}
            </span>
          </div>
        </div>
      ))}
    </>
  );
};

// ─── Page Count Status ────────────────────────────────────────────────────────

const PageCount = ({ editorElement, pageSize, updateTrigger }: {
  editorElement: HTMLElement | null;
  pageSize: PageSize;
  updateTrigger: number;
}) => {
  const [pageCount, setPageCount] = useState(1);
  const dims = PAGE_SIZES[pageSize];
  const contentAreaHeight = dims.height - dims.paddingY * 2;

  useEffect(() => {
    if (!editorElement) return;

    const calculate = () => {
      const proseMirror = editorElement.querySelector('.ProseMirror') as HTMLElement | null;
      if (!proseMirror) return;
      const totalHeight = proseMirror.scrollHeight;
      const contentOnly = totalHeight - dims.paddingY;
      setPageCount(Math.max(1, Math.ceil(contentOnly / contentAreaHeight)));
    };

    calculate();

    const observer = new ResizeObserver(calculate);
    const proseMirror = editorElement.querySelector('.ProseMirror');
    if (proseMirror) observer.observe(proseMirror);

    return () => observer.disconnect();
  }, [editorElement, dims.paddingY, contentAreaHeight, updateTrigger]);

  return (
    <div className="text-[10px] text-slate-400 font-medium tabular-nums">
      {pageCount} {pageCount === 1 ? 'page' : 'pages'}
    </div>
  );
};

// ─── Toolbar ──────────────────────────────────────────────────────────────────

interface ToolbarProps {
  editor: Editor | null;
  disabled: boolean;
  onImageClick: () => void;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
}

const Toolbar = ({ editor, disabled, onImageClick, pageSize, onPageSizeChange }: ToolbarProps) => {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialUrl, setLinkInitialUrl] = useState('');

  if (!editor) return null;

  const openLinkDialog = () => {
    setLinkInitialUrl(editor.getAttributes('link').href ?? '');
    setLinkDialogOpen(true);
  };

  const handleLinkConfirm = (url: string) => {
    setLinkDialogOpen(false);
    if (!url) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const insertPageBreak = () => {
    editor.chain().focus().insertContent({ type: 'pageBreak' }).run();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 bg-white border-b border-slate-200 sticky top-0 z-10">
        {/* Page size selector */}
        <PageSizeSelector pageSize={pageSize} onPageSizeChange={onPageSizeChange} disabled={disabled} />

        <ToolbarSeparator />

        {/* Undo / Redo */}
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={disabled || !editor.can().undo()} title="Undo">
          <Undo className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={disabled || !editor.can().redo()} title="Redo">
          <Redo className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Headings */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          disabled={disabled}
          title="Heading 1"
        >
          <Heading1 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          disabled={disabled}
          title="Heading 2"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          disabled={disabled}
          title="Heading 3"
        >
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Inline marks */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          disabled={disabled}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          disabled={disabled}
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          disabled={disabled}
          title="Underline"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          disabled={disabled}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive('highlight')}
          disabled={disabled}
          title="Highlight"
        >
          <Highlighter className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Text color */}
        <label
          title="Text color"
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded cursor-pointer transition-colors',
            'hover:bg-gray-200',
            disabled ? 'opacity-40 pointer-events-none' : '',
          )}
        >
          <Palette className="h-3.5 w-3.5 text-gray-600" />
          <input
            type="color"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>

        <ToolbarSeparator />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          disabled={disabled}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          disabled={disabled}
          title="Ordered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          disabled={disabled}
          title="Align left"
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          disabled={disabled}
          title="Align center"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={editor.isActive({ textAlign: 'right' })}
          disabled={disabled}
          title="Align right"
        >
          <AlignRight className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          active={editor.isActive({ textAlign: 'justify' })}
          disabled={disabled}
          title="Justify"
        >
          <AlignJustify className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Block elements */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          disabled={disabled}
          title="Blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive('codeBlock')}
          disabled={disabled}
          title="Code block"
        >
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          disabled={disabled}
          title="Horizontal rule"
        >
          <Minus className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Link */}
        <ToolbarButton
          onClick={openLinkDialog}
          active={editor.isActive('link')}
          disabled={disabled}
          title="Insert link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Image */}
        <ToolbarButton
          onClick={onImageClick}
          disabled={disabled}
          title="Insert image"
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Table */}
        <ToolbarButton
          onClick={insertTable}
          active={editor.isActive('table')}
          disabled={disabled}
          title="Insert table"
        >
          <TableIcon className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Page Break */}
        <ToolbarButton
          onClick={insertPageBreak}
          disabled={disabled}
          title="Insert page break"
        >
          <SeparatorHorizontal className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>

      <LinkDialog
        open={linkDialogOpen}
        initialUrl={linkInitialUrl}
        onConfirm={handleLinkConfirm}
        onClose={() => setLinkDialogOpen(false)}
      />
    </>
  );
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  className?: string;
  minHeight?: string;
  header?: string;
  onHeaderChange?: (v: string) => void;
  footer?: string;
  onFooterChange?: (v: string) => void;
  onUploadImageToS3?: (file: File) => Promise<string>;
  onGetDownloadUrl?: (key: string) => Promise<string>;
  onUploadingChange?: (isUploading: boolean) => void;
  /** Called once the editor instance is ready */
  onEditorReady?: (editor: Editor) => void;
  /** Page size for the document — defaults to 'letter' */
  pageSize?: PageSize;
  /** Callback when user changes page size via toolbar */
  onPageSizeChange?: (size: PageSize) => void;
}

// ─── RichTextEditor ───────────────────────────────────────────────────────────

export const RichTextEditor = ({
  value,
  onChange,
  disabled = false,
  className,
  minHeight,
  header = '',
  onHeaderChange,
  footer = '',
  onFooterChange,
  onUploadImageToS3,
  onGetDownloadUrl,
  onUploadingChange,
  onEditorReady,
  pageSize: pageSizeProp,
  onPageSizeChange: onPageSizeChangeProp,
}: RichTextEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadErrorOpen, setUploadErrorOpen] = useState(false);
  const [uploadErrorMsg, setUploadErrorMsg] = useState('');
  const [updateTrigger, setUpdateTrigger] = useState(0);

  // Internal page size state (controlled or uncontrolled)
  const [internalPageSize, setInternalPageSize] = useState<PageSize>(pageSizeProp ?? 'letter');
  const pageSize = pageSizeProp ?? internalPageSize;
  const dims = PAGE_SIZES[pageSize];

  const handlePageSizeChange = useCallback((size: PageSize) => {
    setInternalPageSize(size);
    onPageSizeChangeProp?.(size);
  }, [onPageSizeChangeProp]);

  // Compute min height: at least one full page content area
  const effectiveMinHeight = minHeight ?? `${dims.height}px`;

  const initializedRef = useRef(false);

  // Ref for the image upload handler — allows editorProps callbacks
  // (defined at useEditor init time) to access the latest handler.
  const imageUploadRef = useRef<((file: File) => Promise<void>) | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color.configure({ types: [TextStyle.name] }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
          class: 'text-indigo-600 underline hover:text-indigo-800',
        },
      }),
      ResizableImage,
      PageBreak,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    editorProps: {
      // Intercept pasted images and upload them to S3 instead of inserting base64
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file && imageUploadRef.current) {
              event.preventDefault();
              imageUploadRef.current(file);
              return true;
            }
          }
        }
        return false;
      },
      // Intercept dropped images and upload them to S3
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;

        const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'));
        if (imageFile && imageUploadRef.current) {
          event.preventDefault();
          imageUploadRef.current(imageFile);
          return true;
        }
        return false;
      },
    },
    content: value || '',
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      onChange(stripPresignedUrlsFromHtml(html));
      // Trigger page break recalculation
      setUpdateTrigger((prev) => prev + 1);
    },
    onCreate: ({ editor: e }) => {
      onEditorReady?.(e);
    },
  });

  // Sync external `value` into the editor
  useEffect(() => {
    if (!editor || initializedRef.current) return;
    if (value) {
      initializedRef.current = true;
      if (editor.getHTML() !== value) {
        editor.commands.setContent(value, { emitUpdate: false });
        setUpdateTrigger((prev) => prev + 1);
      }
    }
  }, [editor, value]);

  useEffect(() => {
    if (!value) {
      initializedRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // ── Image upload ──
  // Keep the ref in sync so paste/drop handlers can access the latest function
  const handleImageUpload = useCallback(async (file: File) => {
    if (!onUploadImageToS3 || !editor) return;
    setIsUploadingImage(true);
    onUploadingChange?.(true);
    try {
      const keyOrDataUrl = await onUploadImageToS3(file);
      const isDataUrl = keyOrDataUrl.startsWith('data:');

      let displaySrc = isDataUrl ? keyOrDataUrl : `s3key:${keyOrDataUrl}`;
      if (!isDataUrl && onGetDownloadUrl) {
        try { displaySrc = await onGetDownloadUrl(keyOrDataUrl); }
        catch { console.warn('Failed to get presigned URL'); }
      }

      editor.chain().focus().insertContent({
        type: 'image',
        attrs: {
          src: displaySrc,
          alt: file.name,
          ...(isDataUrl ? {} : { 's3key': keyOrDataUrl }),
        },
      }).run();
    } catch (err) {
      setUploadErrorMsg(err instanceof Error ? err.message : 'Image upload failed.');
      setUploadErrorOpen(true);
    } finally {
      setIsUploadingImage(false);
      onUploadingChange?.(false);
    }
  }, [onUploadImageToS3, onGetDownloadUrl, onUploadingChange, editor]);

  // Keep the ref in sync so editorProps paste/drop handlers always use the latest upload function
  useEffect(() => {
    imageUploadRef.current = handleImageUpload;
  }, [handleImageUpload]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleImageUpload(file);
    e.target.value = '';
  }, [handleImageUpload]);

  return (
    <>
      <div className={cn('flex flex-col overflow-hidden bg-slate-200', className)}>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

        {isUploadingImage && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-700 text-xs shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            Uploading image to S3…
          </div>
        )}

        {onHeaderChange && (
          <div className="py-2 border-b border-dashed border-slate-300 bg-white shrink-0">
            <ColontitleBar label="Header" value={header} onChange={onHeaderChange} disabled={disabled} placeholder="Document header / running title…" maxWidth={dims.width} />
          </div>
        )}

        {/* Sticky toolbar + scrollable editor area */}
        <div className="flex-1 overflow-y-auto">
          <div className="tiptap-document-editor">
            <Toolbar
              editor={editor}
              disabled={disabled}
              onImageClick={() => fileInputRef.current?.click()}
              pageSize={pageSize}
              onPageSizeChange={handlePageSizeChange}
            />

            <div className="editor-pages-container py-8 px-4" style={{ background: '#e2e8f0' }}>
              <div
                ref={editorContainerRef}
                className="editor-page-wrapper mx-auto relative"
                style={{
                  maxWidth: `${dims.width}px`,
                  width: `${dims.width}px`,
                  minHeight: effectiveMinHeight,
                }}
              >
                {/* Page sheet backgrounds */}
                <PageSheets
                  editorElement={editorContainerRef.current}
                  pageSize={pageSize}
                  updateTrigger={updateTrigger}
                />

                {/* Editor content */}
                <div className="relative z-[1]">
                  <EditorContent editor={editor} />
                </div>
              </div>
            </div>

            {/* Page count status bar */}
            <div className="flex items-center justify-center py-3 bg-slate-200">
              <PageCount
                editorElement={editorContainerRef.current}
                pageSize={pageSize}
                updateTrigger={updateTrigger}
              />
            </div>
          </div>
        </div>

        {onFooterChange && (
          <div className="py-2 border-t border-dashed border-slate-300 bg-white shrink-0">
            <ColontitleBar label="Footer" value={footer} onChange={onFooterChange} disabled={disabled} placeholder="Document footer / page number…" maxWidth={dims.width} />
          </div>
        )}
      </div>

      <UploadErrorDialog open={uploadErrorOpen} message={uploadErrorMsg} onClose={() => setUploadErrorOpen(false)} />

      <style>{`
        /* ── Page sheet styling ── */
        .editor-page-wrapper .page-sheet {
          background: white;
          box-shadow:
            0 1px 3px rgba(0, 0, 0, 0.08),
            0 4px 12px rgba(0, 0, 0, 0.04);
          border-radius: 2px;
        }

        /* First page gets top border radius */
        .editor-page-wrapper .page-sheet:first-of-type {
          border-top-left-radius: 4px;
          border-top-right-radius: 4px;
        }

        /* ── ProseMirror editor styling ── */
        .tiptap-document-editor .ProseMirror {
          padding: ${dims.paddingY}px ${dims.paddingX}px;
          min-height: ${effectiveMinHeight};
          line-height: 1.75;
          color: #374151;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
          font-size: 14px;
          outline: none;
          background: transparent;
        }
        .tiptap-document-editor .ProseMirror h1 {
          font-size: 1.875rem; font-weight: 700; margin: 1.5rem 0 0.5rem;
          color: #111827;
        }
        .tiptap-document-editor .ProseMirror h2 {
          font-size: 1.5rem; font-weight: 600; margin: 1.25rem 0 0.5rem;
          color: #1f2937;
        }
        .tiptap-document-editor .ProseMirror h3 {
          font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.4rem; color: #1f2937;
        }
        .tiptap-document-editor .ProseMirror h4 {
          font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.3rem; color: #374151;
        }
        .tiptap-document-editor .ProseMirror p { margin: 0 0 0.75rem; }
        .tiptap-document-editor .ProseMirror p:last-child { margin-bottom: 0; }
        .tiptap-document-editor .ProseMirror img {
          max-width: 100%; border-radius: 4px; margin: 0.5rem 0; cursor: pointer;
          display: block;
        }
        .tiptap-document-editor .ProseMirror blockquote {
          border-left: 4px solid #d1d5db; padding-left: 1rem;
          margin: 1rem 0; font-style: italic; color: #6b7280;
        }
        .tiptap-document-editor .ProseMirror pre {
          background: #f3f4f6; border-radius: 4px; padding: 0.75rem 1rem;
          font-family: monospace; font-size: 0.875rem; overflow-x: auto;
        }
        .tiptap-document-editor .ProseMirror code {
          background: #f3f4f6; border-radius: 3px; padding: 0.1em 0.3em;
          font-family: monospace; font-size: 0.875em;
        }
        .tiptap-document-editor .ProseMirror pre code {
          background: none; padding: 0;
        }
        .tiptap-document-editor .ProseMirror ul,
        .tiptap-document-editor .ProseMirror ol {
          padding-left: 1.5rem; margin: 0.5rem 0 0.75rem;
        }
        .tiptap-document-editor .ProseMirror ul { list-style-type: disc; }
        .tiptap-document-editor .ProseMirror ol { list-style-type: decimal; }
        .tiptap-document-editor .ProseMirror li { margin: 0.2rem 0; }
        .tiptap-document-editor .ProseMirror hr {
          border: none; border-top: 2px solid #e5e7eb; margin: 1.5rem 0;
        }
        .tiptap-document-editor .ProseMirror table {
          border-collapse: collapse; width: 100%; margin: 1rem 0;
          table-layout: fixed;
        }
        .tiptap-document-editor .ProseMirror th,
        .tiptap-document-editor .ProseMirror td {
          border: 1px solid #d1d5db; padding: 0.5rem 0.75rem;
          vertical-align: top; position: relative;
        }
        .tiptap-document-editor .ProseMirror th {
          background: #f9fafb; font-weight: 600; text-align: left;
        }
        .tiptap-document-editor .ProseMirror .selectedCell:after {
          z-index: 2; position: absolute; content: "";
          left: 0; right: 0; top: 0; bottom: 0;
          background: rgba(99, 102, 241, 0.1); pointer-events: none;
        }
        .tiptap-document-editor .ProseMirror .column-resize-handle {
          position: absolute; right: -2px; top: 0; bottom: -2px;
          width: 4px; background-color: #6366f1; pointer-events: none;
        }
        .tiptap-document-editor .ProseMirror mark {
          background-color: #fef08a; border-radius: 2px; padding: 0 1px;
        }
        .tiptap-document-editor .ProseMirror .is-editor-empty:first-child::before {
          color: #9ca3af; content: attr(data-placeholder);
          float: left; height: 0; pointer-events: none;
        }
        /* Page break node styling */
        .tiptap-document-editor .ProseMirror .page-break-node {
          user-select: none;
          cursor: default;
        }
        @media print {
          .tiptap-document-editor .sticky { position: static; }
          .tiptap-document-editor .ProseMirror {
            padding: 0;
            min-height: auto;
            background: white;
          }
          .tiptap-document-editor .ProseMirror .page-break-node {
            display: none;
          }
          .tiptap-document-editor .ProseMirror div[data-page-break] {
            break-after: page;
            page-break-after: always;
          }
          .page-boundary,
          .page-sheet,
          .editor-pages-container {
            background: white !important;
            box-shadow: none !important;
          }
          .page-boundary {
            display: none;
          }
        }
      `}</style>
    </>
  );
};
