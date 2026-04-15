'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Copy, Pencil, Send, Trash2, FileText, Clock, ArrowDownToLine, ArchiveRestore } from 'lucide-react';
import type { TemplateItem } from '@/lib/hooks/use-templates';
import { usePermission } from '@/components/permission-wrapper';

const CATEGORY_LABELS: Record<string, string> = {
  TECHNICAL_PROPOSAL: 'Technical',
  MANAGEMENT_PROPOSAL: 'Management',
  PAST_PERFORMANCE: 'Past Performance',
  PRICE_VOLUME: 'Price',
  EXECUTIVE_SUMMARY: 'Executive Summary',
  CERTIFICATIONS: 'Certifications',
  CUSTOM: 'Custom',
};

/** Title-case a slug: "ORAL_PRESENTATION_PLAN" → "Oral Presentation Plan" */
const slugToLabel = (slug: string): string =>
  CATEGORY_LABELS[slug] ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase());

const statusVariant = (status: string) => {
  if (status === 'PUBLISHED') return 'default';
  if (status === 'ARCHIVED') return 'destructive';
  return 'secondary';
};

interface TemplateCardProps {
  template: TemplateItem;
  onEdit: (template: TemplateItem) => void;
  onPublish: (templateId: string) => void;
  onUnpublish: (templateId: string) => void;
  onClone: (template: TemplateItem) => void;
  onDelete: (template: TemplateItem) => void;
  onUnarchive: (template: TemplateItem) => void;
  onPermanentlyDelete: (template: TemplateItem) => void;
  orgId: string;
}

export function TemplateCard({
  template,
  onEdit,
  onPublish,
  onUnpublish,
  onClone,
  onDelete,
  onUnarchive,
  onPermanentlyDelete,
}: TemplateCardProps) {
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  const isArchived = template.isArchived;
  const canUpdate = usePermission('template:update');
  const canPublish = usePermission('template:publish');
  const canCreate = usePermission('template:create');
  const canDelete = usePermission('template:delete');
  const hasAnyAction = canUpdate || canPublish || canCreate || canDelete;

  return (
    <Card className="group overflow-hidden hover:shadow-md transition-shadow">
      <CardHeader className="pb-3 overflow-hidden">
        <div className="flex items-start justify-between gap-2 min-w-0 w-full">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate" title={template.name}>{template.name}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2 text-xs">
              {template.description || 'No description'}
            </CardDescription>
          </div>
          {hasAnyAction && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 ml-auto">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isArchived ? (
                  <>
                    {canUpdate && (
                      <DropdownMenuItem onClick={() => onUnarchive(template)}>
                        <ArchiveRestore className="h-4 w-4 mr-2" />
                        Restore
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onPermanentlyDelete(template)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Forever
                        </DropdownMenuItem>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {canUpdate && (
                      <DropdownMenuItem onClick={() => onEdit(template)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {canPublish && template.status === 'DRAFT' && (
                      <DropdownMenuItem onClick={() => onPublish(template.id)}>
                        <Send className="h-4 w-4 mr-2" />
                        Publish
                      </DropdownMenuItem>
                    )}
                    {canPublish && template.status === 'PUBLISHED' && (
                      <DropdownMenuItem onClick={() => onUnpublish(template.id)}>
                        <ArrowDownToLine className="h-4 w-4 mr-2" />
                        Unpublish
                      </DropdownMenuItem>
                    )}
                    {canCreate && (
                      <DropdownMenuItem onClick={() => onClone(template)}>
                        <Copy className="h-4 w-4 mr-2" />
                        Clone
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDelete(template)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      </>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge variant={statusVariant(template.status)} className="text-xs">
            {template.status}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {slugToLabel(template.category)}
          </Badge>
          {template.agencyName && (
            <Badge variant="outline" className="text-xs">
              {template.agencyName}
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {template.category === 'CUSTOM' ? 'Custom template' : 'Document template'}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            v{template.currentVersion} · {timeAgo(template.updatedAt)}
          </span>
        </div>
        {template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {template.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {template.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{template.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
