'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import '@/lib/amplify';
import '@aws-amplify/ui-react/styles.css'


export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (<Authenticator>{children }</Authenticator>)
}
