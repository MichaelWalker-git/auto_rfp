export const AUDIT_LOG_PK = 'AUDIT_LOG';

/** 90 days hot storage in DynamoDB before archival to S3 Glacier */
export const AUDIT_LOG_TTL_DAYS = 90;

/** 7 years cold storage in S3 Glacier (FedRAMP / ISO 27001 requirement) */
export const AUDIT_LOG_COLD_RETENTION_YEARS = 7;

/** HMAC secret env var name — stored in SSM Parameter Store */
export const AUDIT_HMAC_SECRET_PARAM = '/auto-rfp/audit-hmac-secret';
