import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { requireEnv } from './env';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const TEMPLATE_PK = 'TEMPLATE';

/**
 * Template configuration for a company
 */
export interface TemplateConfig {
  organizationId: string;
  name: string;
  description?: string;
  branding: {
    companyName: string;
    primaryColor: { r: number; g: number; b: number };
    accentColor: { r: number; g: number; b: number };
    logoUrl?: string;
  };
  formatting: {
    fontFamily: 'Times New Roman' | 'Arial' | 'Calibri';
    fontSize: number;
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
  };
  sections: {
    includeTableOfContents: boolean;
    includeExecutiveSummary: boolean;
    includeCitations: boolean;
    pageBreakBetweenSections: boolean;
  };
  headerFooter: {
    includeHeader: boolean;
    includeFooter: boolean;
    headerHeight: number;
    footerHeight: number;
  };
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_TEMPLATE: TemplateConfig = {
  organizationId: 'DEFAULT',
  name: 'Default Template',
  description: 'Default Auto RFP template',
  branding: {
    companyName: 'Auto RFP',
    primaryColor: { r: 25, g: 118, b: 210 },
    accentColor: { r: 66, g: 133, b: 244 },
  },
  formatting: {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    marginTop: 1,
    marginRight: 1,
    marginBottom: 1,
    marginLeft: 1,
  },
  sections: {
    includeTableOfContents: true,
    includeExecutiveSummary: true,
    includeCitations: true,
    pageBreakBetweenSections: true,
  },
  headerFooter: {
    includeHeader: true,
    includeFooter: true,
    headerHeight: 0.5,
    footerHeight: 0.5,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Retrieve template configuration for an organization
 */
export async function getTemplateConfig(
  organizationId: string,
  templateName: string = 'default',
): Promise<TemplateConfig> {
  try {
    const cmd = new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': TEMPLATE_PK,
        ':sk': `${organizationId}#${templateName}`,
      },
      Limit: 1,
    });

    const res = await docClient.send(cmd);
    if (res.Items && res.Items.length > 0) {
      const item = res.Items[0] as any;
      return {
        organizationId: item.organizationId,
        name: item.name,
        description: item.description,
        branding: item.branding,
        formatting: item.formatting,
        sections: item.sections,
        headerFooter: item.headerFooter,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }

    return DEFAULT_TEMPLATE;
  } catch (err) {
    console.error('Error retrieving template config:', err);
    return DEFAULT_TEMPLATE;
  }
}

/**
 * List all templates for an organization
 */
export async function listTemplatesForOrganization(
  organizationId: string,
): Promise<TemplateConfig[]> {
  try {
    const cmd = new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': TEMPLATE_PK,
        ':sk': `${organizationId}#`,
      },
    });

    const res = await docClient.send(cmd);
    if (!res.Items || res.Items.length === 0) {
      return [DEFAULT_TEMPLATE];
    }

    return res.Items.map((item: any) => ({
      organizationId: item.organizationId,
      name: item.name,
      description: item.description,
      branding: item.branding,
      formatting: item.formatting,
      sections: item.sections,
      headerFooter: item.headerFooter,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  } catch (err) {
    console.error('Error listing templates:', err);
    return [DEFAULT_TEMPLATE];
  }
}

export function getDefaultTemplate(): TemplateConfig {
  return DEFAULT_TEMPLATE;
}