import { z } from 'zod';

/**
 * Agency contact information extracted from public records page
 */
export interface AgencyContactInfo {
  coordinatorName?: string;
  coordinatorEmail?: string;
  coordinatorPhone?: string;
  address?: string;
  statutoryCitation?: string;
  portalUrl?: string;
}

/**
 * Extract agency contact information from PRA/CPRA guidance page
 * Uses pattern matching to extract key information from HTML content
 */
export async function scrapeAgencyContactInfo(agencyName: string, pageUrl: string): Promise<AgencyContactInfo> {
  try {
    const response = await fetch(pageUrl);
    if (!response.ok) {
      return {};
    }
    
    const html = await response.text();
    
    // Initialize result
    const result: AgencyContactInfo = {};
    
    // Extract statutory citation (common patterns)
    const citationPatterns = [
      /California Public Records Act|CPRA/i,
      /Public Records Act/i,
      /FOIA/i,
      /Freedom of Information Act/i,
    ];
    
    for (const pattern of citationPatterns) {
      const match = html.match(pattern);
      if (match) {
        result.statutoryCitation = match[0];
        break;
      }
    }
    
    // Extract email addresses
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailMatches = html.match(emailPattern);
    if (emailMatches && emailMatches.length > 0) {
      // Look for common email patterns in context
      for (const email of emailMatches) {
        // Check if email looks like a records coordinator email
        if (email.includes('records') || email.includes('foia') || email.includes('public') || 
            email.includes('request') || email.includes('cpa')) {
          result.coordinatorEmail = email;
          break;
        }
      }
      
      // If no specific pattern found, use first email
      if (!result.coordinatorEmail && emailMatches.length > 0) {
        result.coordinatorEmail = emailMatches[0];
      }
    }
    
    // Extract phone numbers
    const phonePattern = /\+?1?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/g;
    const phoneMatches = html.match(phonePattern);
    if (phoneMatches && phoneMatches.length > 0) {
      result.coordinatorPhone = phoneMatches[0];
    }
    
    // Extract name (look for common formats like "Name, Title")
    // This is a simplification - in practice we'd need more sophisticated NLP
    const namePatterns = [
      /records\s+officer\s*:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      /records\s+custodian\s*:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      /contact\s+person\s*:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      /(\b[A-Z][a-z]+\s+[A-Z][a-z]+\b)\s+(records officer|records custodian|foia officer)/i
    ];
    
    for (const pattern of namePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        result.coordinatorName = match[1];
        break;
      }
    }
    
    // Extract address
    const addressPatterns = [
      /address\s*:\s*([^\n]+\w)/i,
      /address:\s*([^\n]+\w)/i
    ];
    
    for (const pattern of addressPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        result.address = match[1].trim();
        break;
      }
    }
    
    // Look for portal URLs
    const portalPatterns = [
      /govqa\.us/, 
      /nextrequest\.com/, 
      /justfoia\.com/, 
      /govos\.com/
    ];
    
    for (const pattern of portalPatterns) {
      const match = html.match(new RegExp(`https?://[^\s]+${pattern.source}[^\s]*`));
      if (match) {
        result.portalUrl = match[0];
        break;
      }
    }
    
    return result;
  } catch (error) {
    console.error(`Error scraping agency info for ${agencyName} at ${pageUrl}:`, error);
    return {};
  }
}

/**
 * Find the most likely public records webpage for an agency
 */
export async function findAgencyRecordsPage(agencyName: string): Promise<string | null> {
  // Create potential URLs based on agency name
  const potentialUrls = [
    `https://www.${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.ca.gov/records`,
    `https://www.${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.ca.gov/foia`,
    `https://www.${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.ca.gov/public-records`,
    `https://${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.ca.gov/records`,
    `https://${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.ca.gov/foia`,
    `https://${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.ca.gov/public-records`
  ];
  
  // Try each potential URL
  for (const url of potentialUrls) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (response.ok) {
        return url;
      }
    } catch (e) {
      continue; // Try next URL
    }
  }
  
  // If no direct match, try with .gov domain
  const govUrls = [
    `https://www.${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.gov/records`,
    `https://www.${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.gov/foia`,
    `https://www.${agencyName.toLowerCase().replace(/[\s'\-()]+/g, '-')}.gov/public-records`
  ];
  
  for (const url of govUrls) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (response.ok) {
        return url;
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}