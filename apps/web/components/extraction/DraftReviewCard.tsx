'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, X, AlertTriangle, FileText, ChevronDown, ChevronUp, Edit, ExternalLink, Loader2, DollarSign, Package } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { BOMItemTypeSchema, type PastProjectDraft, type LaborRateDraft, type BOMItemDraft } from '@auto-rfp/core';
import { useConfirmDraft, useDiscardDraft } from '@/lib/hooks/use-extraction';
import { usePresignDownload } from '@/lib/hooks/use-presign';
import { useToast } from '@/components/ui/use-toast';

// Union type for all draft types
type AnyDraft = PastProjectDraft | LaborRateDraft | BOMItemDraft;

// BOM Categories
const BOM_CATEGORIES = BOMItemTypeSchema.options;
const categoryLabels: Record<string, string> = {
  HARDWARE: 'Hardware',
  SOFTWARE_LICENSE: 'Software License',
  MATERIALS: 'Materials',
  SUBCONTRACTOR: 'Subcontractor',
  TRAVEL: 'Travel',
  ODC: 'Other Direct Costs',
};

// Type guard helpers
const isPastProjectDraft = (draft: AnyDraft): draft is PastProjectDraft => {
  return 'projectId' in draft && 'title' in draft && 'client' in draft;
};

const isLaborRateDraft = (draft: AnyDraft): draft is LaborRateDraft => {
  return 'targetType' in draft && draft.targetType === 'LABOR_RATE';
};

const isBOMItemDraft = (draft: AnyDraft): draft is BOMItemDraft => {
  return 'targetType' in draft && draft.targetType === 'BOM_ITEM';
};

// Get draft ID based on type
const getDraftId = (draft: AnyDraft): string => {
  if (isPastProjectDraft(draft)) return draft.projectId;
  return draft.draftId;
};

// Get display title based on type
const getDraftTitle = (draft: AnyDraft): string => {
  if (isPastProjectDraft(draft)) return draft.title;
  if (isLaborRateDraft(draft)) return draft.position;
  if (isBOMItemDraft(draft)) return draft.name;
  return 'Unknown Draft';
};

// Get subtitle based on type
const getDraftSubtitle = (draft: AnyDraft): string | null => {
  if (isPastProjectDraft(draft)) return draft.client;
  if (isLaborRateDraft(draft)) return `$${draft.fullyLoadedRate.toFixed(2)}/hr fully loaded`;
  if (isBOMItemDraft(draft)) return draft.category;
  return null;
};

// Get icon based on type
const getDraftIcon = (draft: AnyDraft) => {
  if (isPastProjectDraft(draft)) return FileText;
  if (isLaborRateDraft(draft)) return DollarSign;
  if (isBOMItemDraft(draft)) return Package;
  return FileText;
};

// Get type label for toast messages
const getDraftTypeLabel = (draft: AnyDraft): string => {
  if (isPastProjectDraft(draft)) return 'Past performance';
  if (isLaborRateDraft(draft)) return 'Labor rate';
  if (isBOMItemDraft(draft)) return 'BOM item';
  return 'Draft';
};

// Get draft type for API
const getDraftType = (draft: AnyDraft): 'PAST_PERFORMANCE' | 'LABOR_RATE' | 'BOM_ITEM' => {
  if (isPastProjectDraft(draft)) return 'PAST_PERFORMANCE';
  if (isLaborRateDraft(draft)) return 'LABOR_RATE';
  return 'BOM_ITEM';
};

interface DraftReviewCardProps {
  draft: AnyDraft;
  orgId: string;
  /** Called after successful confirm/discard - use to refresh data */
  onSuccess?: () => void;
  /** Optional: hide edit button for types that don't support it */
  showEdit?: boolean;
  /** Disable all actions (e.g., during bulk processing) */
  disabled?: boolean;
}

export const DraftReviewCard = ({ draft, orgId, onSuccess, showEdit = true, disabled = false }: DraftReviewCardProps) => {
  const router = useRouter();
  const { toast } = useToast();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isViewingSource, setIsViewingSource] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { confirmDraft } = useConfirmDraft();
  const { discardDraft } = useDiscardDraft();
  const { trigger: presignDownload } = usePresignDownload();

  const draftId = getDraftId(draft);
  const title = getDraftTitle(draft);
  const subtitle = getDraftSubtitle(draft);
  const Icon = getDraftIcon(draft);
  const typeLabel = getDraftTypeLabel(draft);
  const draftType = getDraftType(draft);

  const handleViewSource = async () => {
    const sourceKey = draft.extractionSource?.sourceDocumentKey;
    if (!sourceKey || isViewingSource) return;
    
    setIsViewingSource(true);
    try {
      const presign = await presignDownload({ key: sourceKey });
      window.open(presign.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({
        title: 'Could not open document',
        description: err instanceof Error ? err.message : 'Failed to get document URL.',
        variant: 'destructive',
      });
    } finally {
      setIsViewingSource(false);
    }
  };

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await confirmDraft({ orgId, draftId, draftType });
      toast({ title: 'Draft Confirmed', description: `${typeLabel} added to your library.` });
      onSuccess?.();
    } catch (error) {
      console.error('Failed to confirm draft:', error);
      toast({ title: 'Error', description: 'Failed to confirm draft.', variant: 'destructive' });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleEditSubmit = async (updates: Record<string, unknown>) => {
    setIsConfirming(true);
    try {
      await confirmDraft({ orgId, draftId, draftType, updates });
      toast({ title: 'Item Added', description: `${typeLabel} has been added with your edits.` });
      setIsEditDialogOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error('Failed to confirm draft with updates:', error);
      toast({ title: 'Error', description: 'Failed to confirm draft.', variant: 'destructive' });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleEdit = () => {
    // Navigate to appropriate edit page for past performance
    if (isPastProjectDraft(draft)) {
      router.push(`/organizations/${orgId}/past-performance/new?draftId=${draftId}`);
    } else {
      // Open edit dialog for labor rates and BOM items
      setIsEditDialogOpen(true);
    }
  };

  const handleDiscard = async () => {
    setIsDiscarding(true);
    try {
      await discardDraft({ orgId, draftId, draftType });
      toast({ title: 'Draft Discarded', description: 'Draft has been removed.' });
      onSuccess?.();
    } catch (error) {
      console.error('Failed to discard draft:', error);
      toast({ title: 'Error', description: 'Failed to discard draft.', variant: 'destructive' });
    } finally {
      setIsDiscarding(false);
    }
  };

  const confidenceColor = (score: number | undefined) => {
    if (!score) return 'text-muted-foreground';
    if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
    if (score >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  // Check for duplicate warning (different structure for different types)
  const hasDuplicateWarning = isPastProjectDraft(draft) 
    ? draft.duplicateWarning?.isDuplicate 
    : isLaborRateDraft(draft) 
      ? draft.duplicateWarning?.isDuplicate 
      : false;

  return (
    <>
      <Card className="border-l-4 border-l-primary gap-0">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">{title}</CardTitle>
                {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasDuplicateWarning && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Possible Duplicate
                </Badge>
              )}
              {draft.fieldConfidence?.overall && (
                <Badge variant="outline" className={confidenceColor(draft.fieldConfidence.overall)}>
                  {draft.fieldConfidence.overall}% confidence
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Type-specific content */}
          {isPastProjectDraft(draft) && <PastProjectContent draft={draft} isExpanded={isExpanded} />}
          {isLaborRateDraft(draft) && <LaborRateContent draft={draft} />}
          {isBOMItemDraft(draft) && <BOMItemContent draft={draft} />}

          {/* Expandable details for past performance */}
          {isPastProjectDraft(draft) && (
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
                  {isExpanded ? 'Show Less' : 'Show More Details'}
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                <PastProjectExpandedContent draft={draft} />
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Source Info */}
          {draft.extractionSource && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              <FileText className="h-3 w-3 flex-shrink-0" />
              <span>Extracted from:</span>
              {draft.extractionSource.sourceDocumentKey ? (
                <button
                  onClick={handleViewSource}
                  disabled={isViewingSource}
                  className="text-primary hover:underline font-medium inline-flex items-center gap-1 disabled:opacity-50"
                  title="Click to view source document"
                >
                  {isViewingSource && <Loader2 className="h-3 w-3 animate-spin" />}
                  {draft.extractionSource.sourceDocumentName || 'View source document'}
                  <ExternalLink className="h-3 w-3" />
                </button>
              ) : (
                <span>{draft.extractionSource.sourceDocumentName || 'Unknown source'}</span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={disabled || isDiscarding || isConfirming}
              className="text-destructive hover:text-destructive"
            >
              <X className="h-4 w-4 mr-1" />
              {isDiscarding ? 'Discarding...' : 'Discard'}
            </Button>
            {showEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleEdit}
                disabled={disabled || isConfirming || isDiscarding}
              >
                <Edit className="h-4 w-4 mr-1" />
                Edit & Review
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={disabled || isConfirming || isDiscarding}
            >
              <Check className="h-4 w-4 mr-1" />
              {isConfirming ? 'Confirming...' : 'Confirm & Add'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog for Labor Rates */}
      {isLaborRateDraft(draft) && (
        <LaborRateEditDialog
          draft={draft}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onSubmit={handleEditSubmit}
          isSubmitting={isConfirming}
        />
      )}

      {/* Edit Dialog for BOM Items */}
      {isBOMItemDraft(draft) && (
        <BOMItemEditDialog
          draft={draft}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onSubmit={handleEditSubmit}
          isSubmitting={isConfirming}
        />
      )}
    </>
  );
};

// ================================
// Edit Dialogs
// ================================

interface LaborRateEditDialogProps {
  draft: LaborRateDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (updates: Record<string, unknown>) => Promise<void>;
  isSubmitting: boolean;
}

const LaborRateEditDialog = ({ draft, open, onOpenChange, onSubmit, isSubmitting }: LaborRateEditDialogProps) => {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      position: fd.get('position') as string,
      baseRate: parseFloat(fd.get('baseRate') as string),
      overhead: parseFloat(fd.get('overhead') as string),
      ga: parseFloat(fd.get('ga') as string),
      profit: parseFloat(fd.get('profit') as string),
      rateJustification: fd.get('rateJustification') as string,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Labor Rate</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Position Title</label>
            <Input name="position" defaultValue={draft.position} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Base Rate ($/hr)</label>
              <Input name="baseRate" type="number" step="0.01" defaultValue={draft.baseRate} />
            </div>
            <div>
              <label className="text-sm font-medium">Overhead (%)</label>
              <Input name="overhead" type="number" step="0.1" defaultValue={draft.overhead} />
            </div>
            <div>
              <label className="text-sm font-medium">G&A (%)</label>
              <Input name="ga" type="number" step="0.1" defaultValue={draft.ga} />
            </div>
            <div>
              <label className="text-sm font-medium">Profit (%)</label>
              <Input name="profit" type="number" step="0.1" defaultValue={draft.profit} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Rate Justification</label>
            <Input name="rateJustification" defaultValue={draft.rateSource || ''} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save & Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

interface BOMItemEditDialogProps {
  draft: BOMItemDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (updates: Record<string, unknown>) => Promise<void>;
  isSubmitting: boolean;
}

const BOMItemEditDialog = ({ draft, open, onOpenChange, onSubmit, isSubmitting }: BOMItemEditDialogProps) => {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      name: fd.get('name') as string,
      category: fd.get('category') as string,
      unitCost: parseFloat(fd.get('unitCost') as string),
      unit: fd.get('unit') as string,
      vendor: fd.get('vendor') as string,
      partNumber: fd.get('partNumber') as string,
      description: fd.get('description') as string,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit BOM Item</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Item Name</label>
            <Input name="name" defaultValue={draft.name} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Category</label>
              <select 
                name="category" 
                defaultValue={draft.category} 
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              >
                {BOM_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{categoryLabels[cat]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Unit Cost ($)</label>
              <Input name="unitCost" type="number" step="0.01" defaultValue={draft.unitCost} />
            </div>
            <div>
              <label className="text-sm font-medium">Unit</label>
              <Input name="unit" defaultValue={draft.unit} placeholder="each, license, month..." />
            </div>
            <div>
              <label className="text-sm font-medium">Vendor</label>
              <Input name="vendor" defaultValue={draft.vendor || ''} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Part Number</label>
            <Input name="partNumber" defaultValue={draft.partNumber || ''} />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Input name="description" defaultValue={draft.description || ''} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save & Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ================================
// Type-specific content components
// ================================

const PastProjectContent = ({ draft }: { draft: PastProjectDraft; isExpanded?: boolean }) => (
  <>
    {/* Description */}
    <p className="text-sm text-muted-foreground line-clamp-3">{draft.description}</p>

    {/* Key Fields */}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
      {draft.contractNumber && (
        <div>
          <span className="text-muted-foreground">Contract #:</span>{' '}
          <span className="font-medium">{draft.contractNumber}</span>
        </div>
      )}
      {draft.value !== null && draft.value !== undefined && draft.value !== 0 && (
        <div>
          <span className="text-muted-foreground">Value:</span>{' '}
          <span className="font-medium">${draft.value.toLocaleString()}</span>
        </div>
      )}
      {draft.domain && (
        <div>
          <span className="text-muted-foreground">Domain:</span>{' '}
          <span className="font-medium">{draft.domain}</span>
        </div>
      )}
      {draft.startDate && (
        <div>
          <span className="text-muted-foreground">Period:</span>{' '}
          <span className="font-medium">
            {draft.startDate} - {draft.endDate || 'Present'}
          </span>
        </div>
      )}
      {draft.teamSize !== null && draft.teamSize !== undefined && draft.teamSize !== 0 && (
        <div>
          <span className="text-muted-foreground">Team Size:</span>{' '}
          <span className="font-medium">{draft.teamSize}</span>
        </div>
      )}
      {draft.durationMonths !== null && draft.durationMonths !== undefined && draft.durationMonths !== 0 && (
        <div>
          <span className="text-muted-foreground">Duration:</span>{' '}
          <span className="font-medium">{draft.durationMonths} months</span>
        </div>
      )}
    </div>
  </>
);

const PastProjectExpandedContent = ({ draft }: { draft: PastProjectDraft }) => (
  <>
    {/* Technical Approach */}
    {draft.technicalApproach && (
      <div>
        <h5 className="text-sm font-medium mb-1">Technical Approach</h5>
        <p className="text-sm text-muted-foreground">{draft.technicalApproach}</p>
      </div>
    )}

    {/* Achievements */}
    {draft.achievements && draft.achievements.length > 0 && (
      <div>
        <h5 className="text-sm font-medium mb-1">Achievements</h5>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          {draft.achievements.map((achievement, i) => (
            <li key={i}>{achievement}</li>
          ))}
        </ul>
      </div>
    )}

    {/* Technologies */}
    {draft.technologies && draft.technologies.length > 0 && (
      <div>
        <h5 className="text-sm font-medium mb-2">Technologies</h5>
        <div className="flex flex-wrap gap-1">
          {draft.technologies.map((tech, i) => (
            <Badge key={i} variant="outline" className="text-xs">{tech}</Badge>
          ))}
        </div>
      </div>
    )}

    {/* Contract Details */}
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm bg-muted/50 p-3 rounded-lg">
      {draft.contractType && (
        <div>
          <span className="text-muted-foreground block text-xs">Contract Type</span>
          <span className="font-medium">{draft.contractType}</span>
        </div>
      )}
      {draft.setAside && (
        <div>
          <span className="text-muted-foreground block text-xs">Set-Aside</span>
          <span className="font-medium">{draft.setAside}</span>
        </div>
      )}
      {draft.naicsCodes && draft.naicsCodes.length > 0 && (
        <div>
          <span className="text-muted-foreground block text-xs">NAICS</span>
          <span className="font-medium">{draft.naicsCodes.join(', ')}</span>
        </div>
      )}
      {draft.performanceRating && draft.performanceRating > 0 && (
        <div>
          <span className="text-muted-foreground block text-xs">CPARS Rating</span>
          <span className="font-medium">{draft.performanceRating}/5</span>
        </div>
      )}
    </div>

    {/* Client POC */}
    {draft.clientPOC && (draft.clientPOC.name || draft.clientPOC.email) && (
      <div className="bg-muted/50 p-3 rounded-lg">
        <h5 className="text-sm font-medium mb-2">Client Point of Contact</h5>
        <div className="text-sm space-y-1">
          {draft.clientPOC.name && (
            <p><span className="text-muted-foreground">Name:</span> {draft.clientPOC.name}</p>
          )}
          {draft.clientPOC.title && (
            <p><span className="text-muted-foreground">Title:</span> {draft.clientPOC.title}</p>
          )}
          {draft.clientPOC.email && (
            <p><span className="text-muted-foreground">Email:</span> {draft.clientPOC.email}</p>
          )}
          {draft.clientPOC.phone && (
            <p><span className="text-muted-foreground">Phone:</span> {draft.clientPOC.phone}</p>
          )}
        </div>
      </div>
    )}
  </>
);

const LaborRateContent = ({ draft }: { draft: LaborRateDraft }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
    <div>
      <span className="text-muted-foreground">Base Rate:</span>{' '}
      <span className="font-medium">${draft.baseRate.toFixed(2)}/hr</span>
    </div>
    {draft.overhead > 0 && (
      <div>
        <span className="text-muted-foreground">Overhead:</span>{' '}
        <span className="font-medium">{draft.overhead}%</span>
      </div>
    )}
    {draft.ga > 0 && (
      <div>
        <span className="text-muted-foreground">G&A:</span>{' '}
        <span className="font-medium">{draft.ga}%</span>
      </div>
    )}
    {draft.profit > 0 && (
      <div>
        <span className="text-muted-foreground">Profit:</span>{' '}
        <span className="font-medium">{draft.profit}%</span>
      </div>
    )}
    <div>
      <span className="text-muted-foreground">Fully Loaded:</span>{' '}
      <span className="font-medium text-primary">${draft.fullyLoadedRate.toFixed(2)}/hr</span>
    </div>
    {draft.effectiveDate && (
      <div>
        <span className="text-muted-foreground">Effective:</span>{' '}
        <span className="font-medium">{draft.effectiveDate}</span>
      </div>
    )}
    {draft.expirationDate && (
      <div>
        <span className="text-muted-foreground">Expires:</span>{' '}
        <span className="font-medium">{draft.expirationDate}</span>
      </div>
    )}
    {draft.rateSource && (
      <div>
        <span className="text-muted-foreground">Source:</span>{' '}
        <span className="font-medium">{draft.rateSource}</span>
      </div>
    )}
  </div>
);

const BOMItemContent = ({ draft }: { draft: BOMItemDraft }) => (
  <>
    {draft.description && (
      <p className="text-sm text-muted-foreground line-clamp-2">{draft.description}</p>
    )}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
      <div>
        <span className="text-muted-foreground">Unit Cost:</span>{' '}
        <span className="font-medium text-primary">${draft.unitCost.toFixed(2)}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Unit:</span>{' '}
        <span className="font-medium">{draft.unit}</span>
      </div>
      {draft.vendor && (
        <div>
          <span className="text-muted-foreground">Vendor:</span>{' '}
          <span className="font-medium">{draft.vendor}</span>
        </div>
      )}
      {draft.partNumber && (
        <div>
          <span className="text-muted-foreground">Part #:</span>{' '}
          <span className="font-medium">{draft.partNumber}</span>
        </div>
      )}
      {draft.quantity && (
        <div>
          <span className="text-muted-foreground">Quantity:</span>{' '}
          <span className="font-medium">{draft.quantity}</span>
        </div>
      )}
    </div>
  </>
);

// ================================
// Skeleton components
// ================================

export const DraftReviewCardSkeleton = () => (
  <Card>
    <CardHeader className="pb-2">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-4 gap-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="flex justify-end gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>
    </CardContent>
  </Card>
);

// Export type for external use
export type { AnyDraft };
