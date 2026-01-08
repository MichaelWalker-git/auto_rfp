import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { CreateOrganizationDTO, OrganizationItem } from '../schemas/organization';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function createOrganization(orgData: CreateOrganizationDTO): Promise<OrganizationItem>;
