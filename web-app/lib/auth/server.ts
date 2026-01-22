// lib/auth/server.ts
import { cookies } from 'next/headers';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,     // e.g. "us-east-1_XXXXXXX"
  clientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID!, // App client id (no secret)
  tokenUse: 'id',
});

export type ServerUser = {
  sub: string;
  email?: string;
  [key: string]: any;
};

export async function getCurrentUser(): Promise<ServerUser | null> {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('idToken')?.value;
  if (!idToken) return null;

  try {
    const payload = await verifier.verify(idToken);
    return payload as ServerUser;
  } catch {
    return null;
  }
}
