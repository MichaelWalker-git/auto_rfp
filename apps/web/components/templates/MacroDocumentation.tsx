'use client';

import { InfoIcon, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const MacroDocumentation = () => {
  return (
    <Collapsible className="mb-3 border rounded-lg bg-blue-50/50">
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 text-sm font-medium hover:bg-blue-100/50 transition-colors rounded-t-lg">
        <InfoIcon className="h-4 w-4 text-blue-600" />
        <span className="text-blue-900">How to use template variables</span>
        <ChevronDown className="ml-auto h-4 w-4 text-blue-600 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-3 text-sm">
        <p className="text-gray-700">
          Variables are automatically replaced with real data when generating documents:
        </p>

        <div className="space-y-3">
          {/* Always Available */}
          <div>
            <div className="font-medium text-xs text-gray-600 mb-1.5">Always Available</div>
            <div className="space-y-1">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{TODAY}}'}
                </Badge>
                <span className="text-xs text-gray-600">Current date (YYYY-MM-DD format)</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-emerald-50 border-emerald-200 text-emerald-700">
                  {'{{CONTENT}}'}
                </Badge>
                <span className="text-xs text-gray-600">
                  <strong className="text-gray-900">Special:</strong> AI will generate content here based on the solicitation and your knowledge base
                </span>
              </div>
            </div>
          </div>

          {/* From Organization */}
          <div>
            <div className="font-medium text-xs text-gray-600 mb-1.5">From Organization Settings</div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {'{{COMPANY_NAME}}'}
              </Badge>
              <span className="text-xs text-gray-600">Your organization name (e.g., "Acme Corporation")</span>
            </div>
          </div>

          {/* From Project */}
          <div>
            <div className="font-medium text-xs text-gray-600 mb-1.5">From Project Details</div>
            <div className="space-y-1">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{PROJECT_TITLE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Project name</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{PROPOSAL_TITLE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Same as project title</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{PROJECT_DESCRIPTION}}'}
                </Badge>
                <span className="text-xs text-gray-600">Project description/overview</span>
              </div>
            </div>
          </div>

          {/* From Opportunity */}
          <div>
            <div className="font-medium text-xs text-gray-600 mb-1.5">From Linked Opportunity</div>
            <div className="space-y-1">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{OPPORTUNITY_TITLE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Official opportunity title</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{SOLICITATION_NUMBER}}'}
                </Badge>
                <span className="text-xs text-gray-600">Official solicitation number</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{OPPORTUNITY_ID}}'}
                </Badge>
                <span className="text-xs text-gray-600">Unique opportunity ID</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{RESPONSE_DEADLINE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Proposal submission deadline</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{AGENCY_NAME}}'}
                </Badge>
                <span className="text-xs text-gray-600">Government agency name</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{NAICS_CODE}}'}
                </Badge>
                <span className="text-xs text-gray-600">NAICS classification code</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {'{{SET_ASIDE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Set-aside category</span>
              </div>
            </div>
          </div>
        </div>

        <Alert className="mt-3 bg-amber-50 border-amber-200">
          <AlertDescription className="text-xs text-amber-900">
            <strong>Note:</strong> If a variable has no value, it will show as a placeholder like{' '}
            <code className="text-xs bg-amber-100 px-1 rounded">[Company Name]</code> in the generated document.
          </AlertDescription>
        </Alert>
      </CollapsibleContent>
    </Collapsible>
  );
};
