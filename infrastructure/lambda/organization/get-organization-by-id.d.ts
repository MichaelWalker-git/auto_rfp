import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { OrganizationItem } from '../schemas/organization';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function getOrganizationById(orgId: string): Promise<OrganizationItem | undefined>;
