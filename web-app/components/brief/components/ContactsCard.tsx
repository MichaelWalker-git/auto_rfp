'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

export function ContactsCard({ contacts }: { contacts: any }) {
  const list = contacts?.contacts ?? [];
  if (!list.length) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <CardTitle className="text-lg">Contact Directory</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3 md:grid-cols-2">
        {list.map((c: any, idx: number) => (
          <div key={idx} className="rounded-lg border p-4 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1">
                <div className="font-semibold text-sm">{c.name || 'N/A'}</div>
                <Badge variant="outline" className="text-xs mt-2" title="Contact role in the solicitation.">
                  {c.role || 'OTHER'}
                </Badge>
              </div>

              <div className="text-right text-xs text-muted-foreground space-y-1">
                {c.email && <div title="Email">{c.email}</div>}
                {c.phone && <div title="Phone">{c.phone}</div>}
              </div>
            </div>

            {c.notes && <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{c.notes}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}