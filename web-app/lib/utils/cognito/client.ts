

export async function getCurrentUser() {
  // For now, return null to let the build pass
  return null
}

export const userPool = {
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
}
