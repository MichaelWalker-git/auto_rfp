'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Pencil,
  Copy,
  CheckCircle,
  XCircle,
  Tag,
  Clock,
  User,
  BarChart2,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import type { ContentLibraryItem } from '@/lib/hooks/use-content-library';
import { formatDistanceToNow, format } from 'date-fns';

interface ContentDetailDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  item: ContentLibraryItem | null;
  onEdit: () => void;
  onApprove: () => void;
  onDeprecate: () => void;
}

const statusStyles: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  DEPRECATED: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function ContentDetailDialog({
  isOpen,
  onOpenChange,
  item,
  onEdit,
  onApprove,
  onDeprecate,
}: ContentDetailDialogProps) {
  const { toast } = useToast();

  const handleCopyAnswer = () => {
    if (item) {
      navigator.clipboard.writeText(item.answer);
      toast({
        title: 'Copied',
        description: 'Answer copied to clipboard',
      });
    }
  };

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <DialogTitle className="text-xl">{item.question}</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <Badge variant="secondary">{item.category}</Badge>
                <Badge className={statusStyles[item.approvalStatus]}>
                  {item.approvalStatus}
                </Badge>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Answer</h4>
            <div className="bg-muted/50 rounded-lg p-4 text-sm whitespace-pre-wrap">
              {item.answer}
            </div>
          </div>

          {item.description && (
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
          )}

          {item.tags.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Tags
              </h4>
              <div className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="space-y-1">
              <p className="text-muted-foreground flex items-center gap-1">
                <BarChart2 className="h-3 w-3" />
                Usage
              </p>
              <p className="font-medium">
                {item.usageCount} {item.usageCount === 1 ? 'time' : 'times'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Version
              </p>
              <p className="font-medium">v{item.currentVersion}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Created
              </p>
              <p className="font-medium">
                {format(new Date(item.createdAt), 'MMM d, yyyy')}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Updated
              </p>
              <p className="font-medium">
                {formatDistanceToNow(new Date(item.updatedAt), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </div>

          {item.versions.length > 1 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium mb-2">Version History</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {item.versions
                    .slice()
                    .reverse()
                    .map((version) => (
                      <div
                        key={version.version}
                        className="flex items-start justify-between text-sm p-2 bg-muted/30 rounded"
                      >
                        <div>
                          <span className="font-medium">v{version.version}</span>
                          {version.changeNotes && (
                            <span className="text-muted-foreground ml-2">
                              - {version.changeNotes}
                            </span>
                          )}
                        </div>
                        <span className="text-muted-foreground">
                          {format(new Date(version.createdAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={handleCopyAnswer}>
            <Copy className="h-4 w-4 mr-2" />
            Copy Answer
          </Button>
          {item.approvalStatus === 'DRAFT' && (
            <Button
              variant="outline"
              onClick={() => {
                onApprove();
                onOpenChange(false);
              }}
            >
              <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
              Approve
            </Button>
          )}
          {item.approvalStatus === 'APPROVED' && (
            <Button
              variant="outline"
              onClick={() => {
                onDeprecate();
                onOpenChange(false);
              }}
            >
              <XCircle className="h-4 w-4 mr-2 text-orange-600" />
              Deprecate
            </Button>
          )}
          <Button
            onClick={() => {
              onEdit();
              onOpenChange(false);
            }}
          >
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
