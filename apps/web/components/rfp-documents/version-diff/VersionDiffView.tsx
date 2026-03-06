'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { X, Loader2, GitCompare } from 'lucide-react';
import { diffWords } from 'diff';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DiffNavigationBar } from './DiffNavigationBar';
import { CherryPickControls } from './CherryPickControls';
import {
  useVersionComparison,
  useCherryPickSelection,
  formatVersionDate,
} from '@/lib/hooks/use-document-versions';

interface VersionDiffViewProps {
  projectId: string;
  opportunityId: string;
  documentId: string;
  orgId: string;
  fromVersion: number;
  toVersion: number;
  onClose: () => void;
  onCherryPick: (mergedHtml: string, sourceVersion: number) => void;
  onRevertToOlder?: (version: import('@auto-rfp/core').RFPDocumentVersion) => void;
}

// ─── Word-level diff utilities ──────────────────────────────────────────────

interface DiffPart {
  type: 'unchanged' | 'added' | 'removed';
  value: string;
}

/**
 * Compute word-level diff between two strings using the 'diff' package
 * More efficient than custom LCS implementation for large texts
 */
const computeWordDiff = (oldText: string, newText: string): DiffPart[] => {
  const changes = diffWords(oldText, newText);
  return changes.map((change) => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
    value: change.value,
  }));
};

/**
 * Parse HTML into blocks (paragraphs, headings, etc.)
 * SSR-safe: returns empty array if document is not available
 */
interface HtmlBlock {
  tag: string;
  html: string;
  text: string;
}

const parseHtmlBlocks = (html: string): HtmlBlock[] => {
  // SSR guard: document.createElement only works in browser
  if (typeof window === 'undefined') {
    return [];
  }
  
  const div = document.createElement('div');
  div.innerHTML = html;
  
  const blocks: HtmlBlock[] = [];
  const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'DIV', 'TR', 'BLOCKQUOTE', 'PRE'];
  
  const extractBlocks = (element: Element) => {
    for (const child of Array.from(element.children)) {
      if (blockTags.includes(child.tagName)) {
        blocks.push({
          tag: child.tagName.toLowerCase(),
          html: child.outerHTML,
          text: child.textContent || '',
        });
      } else if (child.children.length > 0) {
        extractBlocks(child);
      }
    }
  };
  
  // If the HTML has block elements, extract them
  extractBlocks(div);
  
  // If no blocks found, treat the whole thing as one block
  if (blocks.length === 0 && html.trim()) {
    blocks.push({
      tag: 'div',
      html,
      text: div.textContent || '',
    });
  }
  
  return blocks;
};

/**
 * Align blocks from two documents for side-by-side comparison
 */
interface AlignedBlock {
  fromBlock: HtmlBlock | null;
  toBlock: HtmlBlock | null;
  diffStatus: 'unchanged' | 'modified' | 'added' | 'removed';
  diffParts?: DiffPart[];
}

const alignBlocks = (fromBlocks: HtmlBlock[], toBlocks: HtmlBlock[]): AlignedBlock[] => {
  const aligned: AlignedBlock[] = [];
  
  // Use LCS on block texts to align
  const fromTexts = fromBlocks.map(b => b.text.trim());
  const toTexts = toBlocks.map(b => b.text.trim());
  
  let fromIdx = 0;
  let toIdx = 0;
  
  while (fromIdx < fromBlocks.length || toIdx < toBlocks.length) {
    const fromBlock = fromBlocks[fromIdx];
    const toBlock = toBlocks[toIdx];
    
    if (fromIdx >= fromBlocks.length) {
      // Only new blocks left
      aligned.push({
        fromBlock: null,
        toBlock: toBlock,
        diffStatus: 'added',
      });
      toIdx++;
    } else if (toIdx >= toBlocks.length) {
      // Only old blocks left
      aligned.push({
        fromBlock: fromBlock,
        toBlock: null,
        diffStatus: 'removed',
      });
      fromIdx++;
    } else if (fromBlock.text.trim() === toBlock.text.trim()) {
      // Blocks match exactly
      aligned.push({
        fromBlock,
        toBlock,
        diffStatus: 'unchanged',
      });
      fromIdx++;
      toIdx++;
    } else {
      // Blocks differ - compute word diff
      const diffParts = computeWordDiff(fromBlock.text, toBlock.text);
      const hasChanges = diffParts.some(p => p.type !== 'unchanged');
      
      if (hasChanges) {
        aligned.push({
          fromBlock,
          toBlock,
          diffStatus: 'modified',
          diffParts,
        });
      } else {
        aligned.push({
          fromBlock,
          toBlock,
          diffStatus: 'unchanged',
        });
      }
      fromIdx++;
      toIdx++;
    }
  }
  
  return aligned;
};

// ─── Component ──────────────────────────────────────────────────────────────

export const VersionDiffView = ({
  projectId,
  opportunityId,
  documentId,
  orgId,
  fromVersion,
  toVersion,
  onClose,
  onCherryPick,
  onRevertToOlder,
}: VersionDiffViewProps) => {
  const { data, isLoading, error } = useVersionComparison(
    projectId,
    opportunityId,
    documentId,
    fromVersion,
    toVersion,
    orgId,
  );

  const [cherryPickMode, setCherryPickMode] = useState(false);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);

  // Parse and align blocks from both documents
  const alignedBlocks = useMemo(() => {
    if (!data?.fromHtml || !data?.toHtml) return [];
    const fromBlocks = parseHtmlBlocks(data.fromHtml);
    const toBlocks = parseHtmlBlocks(data.toHtml);
    return alignBlocks(fromBlocks, toBlocks);
  }, [data?.fromHtml, data?.toHtml]);

  // Get only the changed blocks for navigation
  const changedIndices = useMemo(() => {
    return alignedBlocks
      .map((block, idx) => ({ block, idx }))
      .filter(({ block }) => block.diffStatus !== 'unchanged')
      .map(({ idx }) => idx);
  }, [alignedBlocks]);

  const totalChanges = changedIndices.length;
  const hasNext = currentChangeIndex < totalChanges - 1;
  const hasPrev = currentChangeIndex > 0;

  // Cherry-pick selection
  const cherryPick = useCherryPickSelection();

  // Navigate to a specific change
  const navigateToChange = useCallback((changeIdx: number) => {
    if (changeIdx < 0 || changeIdx >= totalChanges) return;
    setCurrentChangeIndex(changeIdx);
    const blockIdx = changedIndices[changeIdx];
    const element = document.getElementById(`block-${blockIdx}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [changedIndices, totalChanges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'ArrowUp') {
        e.preventDefault();
        if (hasPrev) navigateToChange(currentChangeIndex - 1);
      } else if (e.ctrlKey && e.key === 'ArrowDown') {
        e.preventDefault();
        if (hasNext) navigateToChange(currentChangeIndex + 1);
      } else if (e.key === 'Escape') {
        if (cherryPickMode) {
          setCherryPickMode(false);
          cherryPick.clearSelection();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentChangeIndex, hasNext, hasPrev, navigateToChange, cherryPickMode, cherryPick, onClose]);

  // Sync scroll between left and right panels
  const handleScroll = useCallback((side: 'left' | 'right') => {
    if (!leftScrollRef.current || !rightScrollRef.current) return;
    const source = side === 'left' ? leftScrollRef.current : rightScrollRef.current;
    const target = side === 'left' ? rightScrollRef.current : leftScrollRef.current;
    target.scrollTop = source.scrollTop;
  }, []);

  // Render a block with inline diff highlighting
  const renderBlockContent = (block: AlignedBlock, side: 'from' | 'to') => {
    const isFrom = side === 'from';
    const htmlBlock = isFrom ? block.fromBlock : block.toBlock;
    
    if (!htmlBlock) {
      return <div className="h-full min-h-[2rem]" />;
    }

    // If unchanged or no diff parts, render as-is
    if (block.diffStatus === 'unchanged' || !block.diffParts) {
      return (
        <div 
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: htmlBlock.html }}
        />
      );
    }

    // For modified blocks, highlight the differences at word level
    if (block.diffStatus === 'modified' && block.diffParts) {
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {block.diffParts.map((part, idx) => {
            if (part.type === 'unchanged') {
              return <span key={idx}>{part.value}</span>;
            }
            if (part.type === 'removed' && isFrom) {
              return (
                <span 
                  key={idx} 
                  className="bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-200 px-0.5 rounded"
                >
                  {part.value}
                </span>
              );
            }
            if (part.type === 'added' && !isFrom) {
              return (
                <span 
                  key={idx} 
                  className="bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-200 px-0.5 rounded"
                >
                  {part.value}
                </span>
              );
            }
            // Hide removed on right side, added on left side
            return null;
          })}
        </div>
      );
    }

    // Added block (only on right)
    if (block.diffStatus === 'added' && !isFrom) {
      return (
        <div 
          className="prose prose-sm dark:prose-invert max-w-none bg-green-100/50 dark:bg-green-900/20 rounded p-2"
          dangerouslySetInnerHTML={{ __html: htmlBlock.html }}
        />
      );
    }

    // Removed block (only on left)
    if (block.diffStatus === 'removed' && isFrom) {
      return (
        <div 
          className="prose prose-sm dark:prose-invert max-w-none bg-red-100/50 dark:bg-red-900/20 rounded p-2 line-through opacity-75"
          dangerouslySetInnerHTML={{ __html: htmlBlock.html }}
        />
      );
    }

    return <div className="h-full min-h-[2rem]" />;
  };

  // Build merged HTML based on selections
  // Note: We use cherryPick.selections and cherryPick.selectedCount to ensure reactivity
  const mergedHtml = useMemo(() => {
    if (!data?.fromHtml || !data?.toHtml || alignedBlocks.length === 0) return data?.toHtml || '';
    
    // Build merged result: for each block, pick either fromBlock or toBlock based on selection
    // Default to toBlock (newer) unless user explicitly selected fromBlock (older)
    const mergedBlocks = alignedBlocks.map((block, idx) => {
      const selection = cherryPick.selections.get(idx);
      
      // User explicitly chose "from" (older) version
      if (selection === 'from') {
        if (block.fromBlock) {
          return block.fromBlock.html;
        }
        // If "from" was selected but it was an "added" block (no fromBlock), return empty
        return '';
      }
      
      // User explicitly chose "to" (newer) or no explicit choice (default to newer)
      if (block.toBlock) {
        return block.toBlock.html;
      }
      
      // If "to" is selected but it was a "removed" block (no toBlock), return empty
      return '';
    });
    
    // Join blocks with newlines - no extra wrapper div to preserve formatting
    // Each block already has its own HTML tag (p, h1, h2, etc.)
    return mergedBlocks.filter(Boolean).join('\n');
  }, [data, alignedBlocks, cherryPick.selections, cherryPick.selectedCount]);

  // Handle cherry-pick apply
  const handleCherryPickApply = useCallback(() => {
    if (!mergedHtml) return;
    onCherryPick(mergedHtml, fromVersion);
  }, [mergedHtml, onCherryPick, fromVersion]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-background border rounded-lg shadow-lg p-8 flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading version comparison...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-background border rounded-lg shadow-lg p-8 text-center">
          <p className="text-destructive mb-4">Failed to load comparison</p>
          <p className="text-muted-foreground text-sm mb-4">{error?.message}</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-background shrink-0">
        <div className="flex items-center gap-4">
          <GitCompare className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">Compare Versions</h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">v{fromVersion}</Badge>
            <span>→</span>
            <Badge variant="outline">v{toVersion}</Badge>
          </div>
          {totalChanges > 0 && (
            <Badge variant="secondary" className="ml-2">
              {totalChanges} change{totalChanges !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          <DiffNavigationBar
            currentIndex={currentChangeIndex}
            totalHunks={totalChanges}
            hasNext={hasNext}
            hasPrev={hasPrev}
            onNext={() => navigateToChange(currentChangeIndex + 1)}
            onPrev={() => navigateToChange(currentChangeIndex - 1)}
          />
          
          <CherryPickControls
            isEnabled={cherryPickMode}
            selectedCount={cherryPick.selectedCount}
            totalHunks={totalChanges}
            onToggleMode={() => {
              setCherryPickMode(!cherryPickMode);
              if (cherryPickMode) cherryPick.clearSelection();
            }}
            onSelectAll={() => cherryPick.selectAll(changedIndices)}
            onClearSelection={cherryPick.clearSelection}
            onApply={handleCherryPickApply}
            onRevertToOlder={onRevertToOlder && data?.fromVersion ? () => onRevertToOlder(data.fromVersion) : undefined}
          />
          
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Version Headers */}
      <div className="grid grid-cols-2 border-b bg-muted/30 shrink-0">
        <div className="p-3 border-r flex items-center gap-3">
          <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            v{data.fromVersion.versionNumber} (Older)
          </Badge>
          <div className="text-sm text-muted-foreground">
            {formatVersionDate(data.fromVersion.createdAt)}
            {data.fromVersion.createdByName && ` by ${data.fromVersion.createdByName}`}
          </div>
        </div>
        <div className="p-3 flex items-center gap-3">
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            v{data.toVersion.versionNumber} (Newer)
          </Badge>
          <div className="text-sm text-muted-foreground">
            {formatVersionDate(data.toVersion.createdAt)}
            {data.toVersion.createdByName && ` by ${data.toVersion.createdByName}`}
          </div>
        </div>
      </div>

      {/* Cherry-pick mode banner */}
      {cherryPickMode && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200 shrink-0 flex items-center justify-between">
          <div>
            <strong>Merge Mode:</strong> For each change, select which version to keep. 
            <span className="ml-2 text-red-700 dark:text-red-300">■ Left = Older</span>
            <span className="ml-2 text-green-700 dark:text-green-300">■ Right = Newer</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-red-700 dark:text-red-300">{cherryPick.fromCount} older</span>
            <span className="text-muted-foreground">|</span>
            <span className="text-green-700 dark:text-green-300">{cherryPick.toCount} newer</span>
          </div>
        </div>
      )}

      {/* Side-by-side Document View */}
      <div className="flex-1 grid grid-cols-2 min-h-0 overflow-hidden">
        {/* Left (From/Older) */}
        <div 
          ref={leftScrollRef}
          className="overflow-auto border-r p-6"
          onScroll={() => handleScroll('left')}
        >
          <div className="max-w-2xl mx-auto space-y-2">
            {alignedBlocks.map((block, idx) => {
              const isChanged = block.diffStatus !== 'unchanged';
              const isCurrentChange = changedIndices[currentChangeIndex] === idx;
              const isFromSelected = cherryPick.isFromSelected(idx);
              const isToSelected = cherryPick.isToSelected(idx);
              
              return (
                <div 
                  key={idx}
                  id={`block-${idx}`}
                  className={`
                    rounded transition-all relative
                    ${isChanged ? 'ring-1 ring-red-200 dark:ring-red-800' : ''}
                    ${isCurrentChange && !cherryPickMode ? 'ring-2 ring-primary bg-primary/5' : ''}
                    ${block.diffStatus === 'removed' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}
                    ${block.diffStatus === 'added' ? 'opacity-30' : ''}
                    ${cherryPickMode && isChanged ? 'cursor-pointer' : ''}
                    ${isFromSelected ? 'ring-2 ring-red-500 bg-red-100/70 dark:bg-red-900/40' : ''}
                    ${isToSelected ? 'opacity-40' : ''}
                  `}
                  onClick={cherryPickMode && isChanged ? () => cherryPick.selectFrom(idx) : undefined}
                >
                  {/* Cherry-pick checkbox for LEFT (older) version */}
                  {cherryPickMode && isChanged && (
                    <div 
                      className={`absolute -left-2 top-0 flex items-center gap-1 border rounded-full px-1.5 py-0.5 shadow-sm
                        ${isFromSelected ? 'bg-red-100 border-red-400 dark:bg-red-900 dark:border-red-600' : 'bg-background'}
                      `}
                    >
                      <Checkbox 
                        checked={isFromSelected}
                        onCheckedChange={() => cherryPick.selectFrom(idx)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4"
                      />
                      <span className={`text-xs ${isFromSelected ? 'text-red-700 dark:text-red-300 font-medium' : 'text-muted-foreground'}`}>
                        #{changedIndices.indexOf(idx) + 1}
                      </span>
                    </div>
                  )}
                  {renderBlockContent(block, 'from')}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right (To/Newer) */}
        <div 
          ref={rightScrollRef}
          className="overflow-auto p-6"
          onScroll={() => handleScroll('right')}
        >
          <div className="max-w-2xl mx-auto space-y-2">
            {alignedBlocks.map((block, idx) => {
              const isChanged = block.diffStatus !== 'unchanged';
              const isCurrentChange = changedIndices[currentChangeIndex] === idx;
              const isFromSelected = cherryPick.isFromSelected(idx);
              const isToSelected = cherryPick.isToSelected(idx);
              
              return (
                <div 
                  key={idx}
                  className={`
                    rounded transition-all relative
                    ${isChanged ? 'ring-1 ring-green-200 dark:ring-green-800' : ''}
                    ${isCurrentChange && !cherryPickMode ? 'ring-2 ring-primary bg-primary/5' : ''}
                    ${block.diffStatus === 'added' ? 'bg-green-50/50 dark:bg-green-950/20' : ''}
                    ${block.diffStatus === 'removed' ? 'opacity-30' : ''}
                    ${cherryPickMode && isChanged ? 'cursor-pointer' : ''}
                    ${isToSelected ? 'ring-2 ring-green-500 bg-green-100/70 dark:bg-green-900/40' : ''}
                    ${isFromSelected ? 'opacity-40' : ''}
                  `}
                  onClick={cherryPickMode && isChanged ? () => cherryPick.selectTo(idx) : undefined}
                >
                  {/* Cherry-pick checkbox for RIGHT (newer) version */}
                  {cherryPickMode && isChanged && (
                    <div 
                      className={`absolute -right-2 top-0 flex items-center gap-1 border rounded-full px-1.5 py-0.5 shadow-sm
                        ${isToSelected ? 'bg-green-100 border-green-400 dark:bg-green-900 dark:border-green-600' : 'bg-background'}
                      `}
                    >
                      <span className={`text-xs ${isToSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-muted-foreground'}`}>
                        #{changedIndices.indexOf(idx) + 1}
                      </span>
                      <Checkbox 
                        checked={isToSelected}
                        onCheckedChange={() => cherryPick.selectTo(idx)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4"
                      />
                    </div>
                  )}
                  {renderBlockContent(block, 'to')}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t bg-muted/30 text-center text-sm text-muted-foreground shrink-0">
        <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl+↑</kbd> Previous change •{' '}
        <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl+↓</kbd> Next change •{' '}
        <kbd className="px-2 py-1 bg-muted rounded text-xs">Esc</kbd> Close
      </div>
    </div>
  );
};
