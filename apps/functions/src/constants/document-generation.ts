import { requireEnv } from '@/helpers/env';

export const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
export const MAX_TOKENS = Number(requireEnv('BEDROCK_MAX_TOKENS', '40000'));
export const TEMPERATURE = Number(requireEnv('BEDROCK_TEMPERATURE', '0.1'));
export const MAX_SOLICITATION_CHARS = Number(requireEnv('PROPOSAL_MAX_SOLICITATION_CHARS', '80000'));
