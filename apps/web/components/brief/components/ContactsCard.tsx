'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';
import { EmptyState } from './EmptyState';

export function ContactsCard({ contacts }: { contacts: any }) {
  const list = contacts?.contacts ?? [];

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <CardTitle>Key Contacts</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact Directory ({list.length})</p>
        
        {list.length === 0 ? (
          <EmptyState 
            icon={Users}
            title="No contacts found"
            description="Contact information will appear here when available"
          />
        ) : (
          <div className="space-y-3">
            {list.map((c: any, idx: number) => (
              <div key={idx} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{c.name || 'N/A'}</p>
                      {c.title && <p className="text-xs text-muted-foreground">{c.title}</p>}
                    </div>
                    <Badge variant="outline" className="text-xs flex-shrink-0" title="Contact role in the solicitation.">
                      {c.role || 'OTHER'}
                    </Badge>
                  </div>

                  <div className="space-y-2 pt-2 border-t">
                    {c.email && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-muted-foreground flex-shrink-0 w-12">Email:</span>
                        <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline truncate">
                          {c.email}
                        </a>
                      </div>
                    )}
                    {c.phone && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-muted-foreground flex-shrink-0 w-12">Phone:</span>
                        <a href={`tel:${c.phone}`} className="text-blue-600 hover:underline">
                          {c.phone}
                        </a>
                      </div>
                    )}
                    {c.organization && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-muted-foreground flex-shrink-0 w-12">Org:</span>
                        <span className="text-muted-foreground">{c.organization}</span>
                      </div>
                    )}
                  </div>

                  {c.notes && (
                    <div className="text-xs text-muted-foreground leading-relaxed border-t pt-2">
                      <p>{c.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
