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
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{PROJECT_POC_NAME}}'}
                </Badge>
                <span className="text-xs text-gray-600">Primary point of contact name <span className="text-blue-600 font-medium">NEW</span></span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{PROJECT_POC_EMAIL}}'}
                </Badge>
                <span className="text-xs text-gray-600">Primary POC email <span className="text-blue-600 font-medium">NEW</span></span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{PROJECT_POC_PHONE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Primary POC phone <span className="text-blue-600 font-medium">NEW</span></span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{PROJECT_POC_TITLE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Primary POC title/role <span className="text-blue-600 font-medium">NEW</span></span>
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

          {/* Solicitation Organization */}
          <div>
            <div className="font-medium text-xs text-gray-600 mb-1.5">Solicitation Organization</div>
            <div className="space-y-1">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{SOLICITATION_ORG_NAME}}'}
                </Badge>
                <span className="text-xs text-gray-600">Government agency name <span className="text-blue-600 font-medium">NEW</span></span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{SOLICITATION_ORG_OFFICE}}'}
                </Badge>
                <span className="text-xs text-gray-600">Specific office or department <span className="text-blue-600 font-medium">NEW</span></span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{SOLICITATION_ORG_LOCATION}}'}
                </Badge>
                <span className="text-xs text-gray-600">Place of performance/location <span className="text-blue-600 font-medium">NEW</span></span>
              </div>
            </div>
          </div>

          {/* Agency Contacts (from Executive Brief) */}
          <div>
            <div className="font-medium text-xs text-gray-600 mb-1.5">Agency Contacts (from Executive Brief)</div>
            <div className="space-y-1">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{CONTRACTING_OFFICER}}'}
                </Badge>
                <span className="text-xs text-gray-600">Contracting officer name and email <span className="text-blue-600 font-medium">NEW</span></span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                  {'{{TECHNICAL_POC}}'}
                </Badge>
                <span className="text-xs text-gray-600">Technical point of contact name and email <span className="text-blue-600 font-medium">NEW</span></span>
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
