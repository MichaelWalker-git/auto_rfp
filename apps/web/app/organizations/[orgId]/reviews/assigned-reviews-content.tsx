'use client';

import React from 'react';
import { ClipboardCheck, FileText, Clock, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useAssignedReviews } from '@/lib/hooks/use-assigned-reviews';

interface AssignedReviewsContentProps {
  orgId: string;
}

export function AssignedReviewsContent({ orgId }: AssignedReviewsContentProps) {
  const { userSub } = useAuth();
  const { reviews, isLoading, error, refresh } = useAssignedReviews(orgId, userSub);

  if (!userSub) {
    return (
      <div className="container mx-auto p-12">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Please sign in to view your assigned reviews.</p>
        </div>
      </div>
    );
  }

  const pendingReviews = reviews?.filter(r => r.status === 'PENDING') || [];
  const completedReviews = reviews?.filter(r => r.status !== 'PENDING') || [];

  return (
    <div className="container mx-auto p-12">
      <ListingPageLayout
        title="My Review Assignments"
        description="Documents assigned to you for review"
        headerActions={
          <Button
            variant="outline"
            onClick={() => refresh()}
            disabled={isLoading}
          >
            Refresh
          </Button>
        }
      >
        <div className="space-y-8">
          {/* Loading skeleton */}
          {isLoading && (
            <div className="space-y-8">
              {/* Pending section skeleton */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-6 w-36" />
                  <Skeleton className="h-5 w-8 rounded-full" />
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Card key={`pending-skeleton-${i}`} className="border-amber-200 bg-amber-50/30">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2">
                              <Skeleton className="h-4 w-48" />
                              <Skeleton className="h-5 w-24 rounded-full" />
                            </div>
                            <Skeleton className="h-3 w-56" />
                            <Skeleton className="h-4 w-40" />
                          </div>
                          <Skeleton className="h-8 w-20 rounded-md shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Completed section skeleton */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-6 w-44" />
                  <Skeleton className="h-5 w-8 rounded-full" />
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Card key={`completed-skeleton-${i}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2">
                              <Skeleton className="h-4 w-44" />
                              <Skeleton className="h-5 w-20 rounded-full" />
                            </div>
                            <Skeleton className="h-3 w-64" />
                            <Skeleton className="h-4 w-36" />
                          </div>
                          <Skeleton className="h-8 w-16 rounded-md shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pending Reviews */}
          {!isLoading && pendingReviews.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5 text-amber-600" />
                <h2 className="text-lg font-semibold">Pending Reviews</h2>
                <Badge variant="outline" className="border-amber-300 text-amber-700">
                  {pendingReviews.length}
                </Badge>
              </div>
              
              <div className="space-y-3">
                {pendingReviews.map((review) => (
                  <Card key={review.approvalId} className="border-amber-200 bg-amber-50/30">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                          <FileText className="h-5 w-5 text-amber-600" />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-sm truncate">
                              {review.entityName || 'Untitled Document'}
                            </h3>
                            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                              Review Required
                            </Badge>
                          </div>
                          
                          <p className="text-xs text-muted-foreground mb-2">
                            Requested by {review.requestedByName || 'Unknown'} • {formatDistanceToNow(new Date(review.requestedAt), { addSuffix: true })}
                          </p>
                          
                          <p className="text-sm text-muted-foreground">
                            Project: {review.projectName || review.projectId}
                          </p>
                        </div>
                        
                        <Button size="sm" asChild>
                          <Link href={`/organizations/${orgId}/projects/${review.projectId}/opportunities/${review.opportunityId}/rfp-documents/${review.documentId}/edit`}>
                            <ClipboardCheck className="h-4 w-4 mr-2" />
                            Review
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Completed Reviews */}
          {!isLoading && completedReviews.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <ClipboardCheck className="h-5 w-5 text-emerald-600" />
                <h2 className="text-lg font-semibold">Completed Reviews</h2>
                <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                  {completedReviews.length}
                </Badge>
              </div>
              
              <div className="space-y-3">
                {completedReviews.map((review) => (
                  <Card key={review.approvalId}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                          review.status === 'APPROVED' 
                            ? 'bg-emerald-100' 
                            : 'bg-red-100'
                        }`}>
                          <FileText className={`h-5 w-5 ${
                            review.status === 'APPROVED' 
                              ? 'text-emerald-600' 
                              : 'text-red-600'
                          }`} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-sm truncate">
                              {review.entityName || 'Untitled Document'}
                            </h3>
                            <Badge 
                              variant={review.status === 'APPROVED' ? 'default' : 'destructive'}
                              className="text-xs"
                            >
                              {review.status}
                            </Badge>
                          </div>
                          
                          <p className="text-xs text-muted-foreground mb-2">
                            Requested by {review.requestedByName || 'Unknown'} • Reviewed {formatDistanceToNow(new Date(review.reviewedAt || review.requestedAt), { addSuffix: true })}
                          </p>
                          
                          <p className="text-sm text-muted-foreground">
                            Project: {review.projectName || review.projectId}
                          </p>
                          
                          {review.reviewNote && (
                            <p className="text-xs text-muted-foreground mt-2 italic">
                              "{review.reviewNote}"
                            </p>
                          )}
                        </div>
                        
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/organizations/${orgId}/projects/${review.projectId}/opportunities/${review.opportunityId}/rfp-documents/${review.documentId}/edit`}>
                            View
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Empty/Error state - show only when no content to display */}
          {!isLoading && ((reviews && reviews.length === 0) || error) && (
            <div className="text-center py-12">
              {error ? (
                <>
                  <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2 text-red-600">Failed to Load My Review Assignments</h3>
                  <p className="text-muted-foreground mb-4">{error.message}</p>
                  <Button onClick={() => refresh()}>Try Again</Button>
                </>
              ) : (
                <>
                  <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Review Assignments</h3>
                  <p className="text-muted-foreground">
                    You don't have any documents assigned for review at the moment.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </ListingPageLayout>
    </div>
  );
}