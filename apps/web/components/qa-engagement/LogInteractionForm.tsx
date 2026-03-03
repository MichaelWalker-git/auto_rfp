'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQAEngagementContext } from './qa-engagement-context';
import { Plus, Loader2 } from 'lucide-react';
import type { EngagementType, EngagementDirection, EngagementSentiment } from '@auto-rfp/core';

interface FormData {
  interactionType: EngagementType;
  direction: EngagementDirection;
  contactName: string;
  contactEmail: string;
  summary: string;
  sentiment: EngagementSentiment | '';
  followUpRequired: boolean;
  followUpDate: string;
  followUpNotes: string;
}

const initialFormData: FormData = {
  interactionType: 'PHONE_CALL',
  direction: 'OUTBOUND',
  contactName: '',
  contactEmail: '',
  summary: '',
  sentiment: '',
  followUpRequired: false,
  followUpDate: '',
  followUpNotes: '',
};

export function LogInteractionForm() {
  const { createEngagementLog } = useQAEngagementContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.summary.trim()) {
      setError('Summary is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await createEngagementLog({
        interactionType: formData.interactionType,
        direction: formData.direction,
        interactionDate: new Date().toISOString(),
        contactName: formData.contactName || undefined,
        contactEmail: formData.contactEmail || undefined,
        summary: formData.summary,
        sentiment: formData.sentiment || undefined,
        followUpRequired: formData.followUpRequired,
        followUpDate: formData.followUpDate ? new Date(formData.followUpDate).toISOString() : undefined,
        followUpNotes: formData.followUpNotes || undefined,
      });
      setFormData(initialFormData);
      setIsExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log interaction');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (!isExpanded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Log Interaction</span>
            <Button size="sm" onClick={() => setIsExpanded(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Interaction
            </Button>
          </CardTitle>
          <CardDescription>
            Record phone calls, meetings, and other CO interactions
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-indigo-500" />
          Log New Interaction
        </CardTitle>
        <CardDescription>
          Record an interaction with the contracting officer
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-destructive text-sm p-3 bg-destructive/10 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Interaction Type */}
            <div className="space-y-2">
              <Label>Interaction Type</Label>
              <Select
                value={formData.interactionType}
                onValueChange={(v) => updateField('interactionType', v as EngagementType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PHONE_CALL">Phone Call</SelectItem>
                  <SelectItem value="MEETING">Meeting</SelectItem>
                  <SelectItem value="SITE_VISIT">Site Visit</SelectItem>
                  <SelectItem value="QUESTION_SUBMITTED">Question Submitted</SelectItem>
                  <SelectItem value="RESPONSE_RECEIVED">Response Received</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Direction */}
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select
                value={formData.direction}
                onValueChange={(v) => updateField('direction', v as EngagementDirection)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OUTBOUND">Outbound (We initiated)</SelectItem>
                  <SelectItem value="INBOUND">Inbound (CO initiated)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Contact Name */}
            <div className="space-y-2">
              <Label>Contact Name (optional)</Label>
              <Input
                value={formData.contactName}
                onChange={(e) => updateField('contactName', e.target.value)}
                placeholder="e.g., John Smith"
              />
            </div>

            {/* Contact Email */}
            <div className="space-y-2">
              <Label>Contact Email (optional)</Label>
              <Input
                type="email"
                value={formData.contactEmail}
                onChange={(e) => updateField('contactEmail', e.target.value)}
                placeholder="e.g., john.smith@agency.gov"
              />
            </div>
          </div>

          {/* Summary */}
          <div className="space-y-2">
            <Label>Summary *</Label>
            <Textarea
              value={formData.summary}
              onChange={(e) => updateField('summary', e.target.value)}
              placeholder="Briefly describe the interaction..."
              rows={3}
              required
            />
          </div>

          {/* Sentiment */}
          <div className="space-y-2">
            <Label>Sentiment (optional)</Label>
            <Select
              value={formData.sentiment}
              onValueChange={(v) => updateField('sentiment', v as EngagementSentiment | '')}
            >
              <SelectTrigger>
                <SelectValue placeholder="How did it go?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="POSITIVE">Positive</SelectItem>
                <SelectItem value="NEUTRAL">Neutral</SelectItem>
                <SelectItem value="NEGATIVE">Negative</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Follow-up Required */}
          <div className="flex items-center space-x-2">
            <Switch
              id="followup"
              checked={formData.followUpRequired}
              onCheckedChange={(checked) => updateField('followUpRequired', checked)}
            />
            <Label htmlFor="followup">Follow-up required</Label>
          </div>

          {/* Follow-up Details */}
          {formData.followUpRequired && (
            <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-amber-200">
              <div className="space-y-2">
                <Label>Follow-up Date</Label>
                <Input
                  type="date"
                  value={formData.followUpDate}
                  onChange={(e) => updateField('followUpDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Follow-up Notes</Label>
                <Input
                  value={formData.followUpNotes}
                  onChange={(e) => updateField('followUpNotes', e.target.value)}
                  placeholder="What to follow up on?"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFormData(initialFormData);
                setIsExpanded(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Log Interaction
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
