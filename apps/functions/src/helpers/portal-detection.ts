import { URL } from 'url';
import { PortalType } from '@auto-rfp/core';

/**
 * Detected portal information
 */
export interface DetectedPortal {
  detected: boolean;
  type: PortalType;
  baseUrl: string;
  recordTypeField?: string; // The form field name for specifying agency/sub-entity
  recordTypeValue?: string; // The required value for the record type field
}

/**
 * Agency portal detection patterns
 */
const PORTAL_PATTERNS: Record<Exclude<PortalType, 'Unknown'>, { domains: string[]; urlPatterns: string[] }> = {
  GovQA: {
    domains: ['.govqa.us', '.govqa.com'],
    urlPatterns: [
      'https://*.govqa.us/WEBAPP/',
      'https://*.govqa.us/supporthome.aspx',
      'https://*.govqa.us/SupportHome.aspx',
      'https://*.govqa.com/WEBAPP/',
    ],
  },
  NextRequest: {
    domains: ['.nextrequest.com'],
    urlPatterns: [
      'https://*.nextrequest.com/',
      'https://*.nextrequest.com/request/',
    ],
  },
  JustFOIA: {
    domains: ['.justfoia.com'],
    urlPatterns: [
      'https://*.justfoia.com/',
      'https://*.justfoia.com/requests/',
    ],
  },
  GovOS: {
    domains: ['.govos.com'],
    urlPatterns: [
      'https://*.govos.com/',
      'https://*.govos.com/records/',
    ],
  },
};

/**
 * Agency specific portal patterns that match common naming conventions
 */
const AGENCY_PORTAL_PATTERNS: Record<string, { type: PortalType; url: string; recordTypeField?: string; recordTypeValue?: string }[]> = {
  // CDFW/FGC specific pattern
  'California Department of Fish and Wildlife': [
    {
      type: 'GovQA',
      url: 'https://californiadfw.govqa.us',
      recordTypeField: 'type_of_record_requested',
      recordTypeValue: 'California Department of Fish and Wildlife'
    }
  ],
  'Fish and Game Commission': [
    {
      type: 'GovQA',
      url: 'https://californiadfw.govqa.us',
      recordTypeField: 'type_of_record_requested',
      recordTypeValue: 'Fish and Game Commission'
    }
  ],
  // Add more agency-specific patterns as needed
};

/**
 * Search terms to use when doing web search for agency's public records portal
 */
const SEARCH_TERMS = [
  'public records request',
  'CPRA request',
  'records request',
  'foia request',
  'records center',
  'public records portal'
];

/**
 * Extract the agency name from the URL path or domain
 */
export function extractAgencyNameFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    
    // Remove common TLDs and prefixes
    let agencyName = hostname.replace('.govqa.us', '').replace('.govqa.com', '')
      .replace('.nextrequest.com', '')
      .replace('.justfoia.com', '')
      .replace('.govos.com', '')
      .replace('www.', '');
    
    // Capitalize first letter of each word
    agencyName = agencyName.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    
    return agencyName;
  } catch (e) {
    return '';
  }
}

/**
 * Detect if an agency has a known portal based on domain pattern
 */
export async function detectPortalByDomain(agencyName: string, domain: string): Promise<DetectedPortal> {
  // Check if the domain matches any known portal patterns
  for (const [type, patterns] of Object.entries(PORTAL_PATTERNS)) {
    const portalType = type as PortalType;
    
    // Check domain patterns
    for (const domainPattern of patterns.domains) {
      if (domain.endsWith(domainPattern)) {
        return {
          detected: true,
          type: portalType,
          baseUrl: `https://${domain}`
        };
      }
    }
    
    // Check URL patterns
    for (const urlPattern of patterns.urlPatterns) {
      if (domain.includes(urlPattern.replace('*', ''))) {
        return {
          detected: true,
          type: portalType,
          baseUrl: `https://${domain}`
        };
      }
    }
  }
  
  // Check for agency-specific portal patterns
  const agencyPatterns = AGENCY_PORTAL_PATTERNS[agencyName];
  if (agencyPatterns && agencyPatterns.length > 0) {
    const pattern = agencyPatterns[0]; // Use first matching pattern
    return {
      detected: true,
      type: pattern.type,
      baseUrl: pattern.url,
      recordTypeField: pattern.recordTypeField,
      recordTypeValue: pattern.recordTypeValue
    };
  }
  
  return {
    detected: false,
    type: 'Unknown',
    baseUrl: ''
  };
}

/**
 * Search for an agency's public records portal using web search
 * This is a fallback when no domain pattern is detected
 */
export async function searchForPortal(agencyName: string): Promise<DetectedPortal> {
  // In a real implementation, this would use a search engine API
  // For now, we'll create a simplified version that checks common patterns
  
  // Create potential URLs based on agency name
  const potentialDomains = [
    `${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.govqa.us`,
    `${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.govqa.com`,
    `${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.nextrequest.com`,
    `${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.justfoia.com`,
    `${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.govos.com`
  ];
  
  // Try each potential domain
  for (const domain of potentialDomains) {
    try {
      const response = await fetch(`https://${domain}`, { method: 'HEAD', redirect: 'follow' });
      
      if (response.ok) {
        // Check if this is a known portal type
        for (const [type, patterns] of Object.entries(PORTAL_PATTERNS)) {
          const portalType = type as PortalType;
          
          // Check if domain matches portal pattern
          for (const domainPattern of patterns.domains) {
            if (domain.endsWith(domainPattern)) {
              return {
                detected: true,
                type: portalType,
                baseUrl: `https://${domain}`
              };
            }
          }
        }
        
        // If we get here and have a working domain, it's a unknown portal
        return {
          detected: true,
          type: 'Unknown',
          baseUrl: `https://${domain}`
        };
      }
    } catch (e) {
      // Domain doesn't resolve or is not accessible, continue to next
      continue;
    }
  }
  
  // If no portal found through domain search, return not detected
  return {
    detected: false,
    type: 'Unknown',
    baseUrl: ''
  };
}

/**
 * Main portal detection function that orchestrates all detection methods
 * Returns detailed portal information including record type field if applicable
 */
export async function detectAgencyPortal(agencyName: string, domain?: string): Promise<DetectedPortal> {
  // First, try direct domain detection if domain is provided
  if (domain) {
    const result = await detectPortalByDomain(agencyName, domain);
    if (result.detected) {
      return result;
    }
  }
  
  // Second, try to detect by agency name patterns
  const agencyPatterns = AGENCY_PORTAL_PATTERNS[agencyName];
  if (agencyPatterns && agencyPatterns.length > 0) {
    const pattern = agencyPatterns[0]; // Use first matching pattern
    return {
      detected: true,
      type: pattern.type,
      baseUrl: pattern.url,
      recordTypeField: pattern.recordTypeField,
      recordTypeValue: pattern.recordTypeValue
    };
  }
  
  // Third, try to extract domain from agency name and search
  const extractedDomain = agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-') + '.govqa.us';
  const domainResult = await detectPortalByDomain(agencyName, extractedDomain);
  if (domainResult.detected) {
    return domainResult;
  }
  
  // Fourth, do web search for portal
  const searchResult = await searchForPortal(agencyName);
  if (searchResult.detected) {
    return searchResult;
  }
  
  // Finally, no portal detected
  return {
    detected: false,
    type: 'Unknown',
    baseUrl: ''
  };
}

/**
 * Extract agency name from agency info for portal detection
 */
export function getAgencyName(agencyInfo: string): string {
  // Extract from full agency info like 'Department of Fish and Wildlife'
  // This is a simple implementation that can be enhanced
  return agencyInfo.trim();
}