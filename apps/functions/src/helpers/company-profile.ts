import { GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

import { DBItem, docClient, putItem } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { COMPANY_PROFILE_PK } from '../constants/company-profile';

import type {
  CompanyProfileItem,
  CreateCompanyProfileDTO,
  UpdateCompanyProfileDTO,
} from '@auto-rfp/core';

const DOCUMENTS_TABLE = requireEnv('DB_TABLE_NAME');

export type CompanyProfileDBItem = CompanyProfileItem & DBItem;

export const buildCompanyProfileSk = (orgId: string) => orgId;

export const getCompanyProfile = async (orgId: string): Promise<CompanyProfileDBItem | null> => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: COMPANY_PROFILE_PK,
        [SK_NAME]: buildCompanyProfileSk(orgId),
      },
    })
  );
  return (res.Item as CompanyProfileDBItem) ?? null;
};

export const upsertCompanyProfile = async (args: {
  orgId: string;
  dto: CreateCompanyProfileDTO | UpdateCompanyProfileDTO;
}): Promise<CompanyProfileDBItem> => {
  const { orgId, dto } = args;

  const item = await putItem<CompanyProfileDBItem>(
    COMPANY_PROFILE_PK,
    buildCompanyProfileSk(orgId),
    { ...dto, orgId } as unknown as CompanyProfileDBItem,
    true,
  );

  return item;
};

export const deleteCompanyProfile = async (orgId: string): Promise<void> => {
  await docClient.send(
    new DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: COMPANY_PROFILE_PK,
        [SK_NAME]: buildCompanyProfileSk(orgId),
      },
    })
  );
};
