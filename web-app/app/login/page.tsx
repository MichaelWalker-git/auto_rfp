'use client';

import { signInWithRedirect } from 'aws-amplify/auth';
import { Button } from '@/components/ui/button';
import { Mail } from 'lucide-react';

export default function LoginPage() {
  const handleCognitoLogin = async () => {
    await signInWithRedirect();
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="flex flex-1 flex-col justify-center py-12 px-4 sm:px-6 lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Sign in with Cognito hosted login.
            </p>
          </div>

          <div className="mt-8">
            <Button
              type="button"
              onClick={handleCognitoLogin}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium"
            >
              <Mail className="mr-2 h-4 w-4" />
              Continue with Cognito
            </Button>

            <p className="mt-4 text-center text-xs text-gray-500">
              You’ll be redirected to the Cognito hosted login page.
            </p>
          </div>
        </div>
      </div>

      <div className="relative hidden lg:flex flex-1 items-center justify-center px-6 bg-slate-800" />
    </div>
  );
}
