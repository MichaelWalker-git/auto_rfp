import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { OrganizationItem, UpdateOrganizationDTO } from '../schemas/organization';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function editOrganization(orgId: string, orgData: UpdateOrganizationDTO): Promise<OrganizationItem>;
