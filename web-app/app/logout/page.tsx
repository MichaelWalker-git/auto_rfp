'use client';

import { signOut } from 'aws-amplify/auth';

export default function LogoutPage() {
  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-12">
      <h1 className="text-2xl font-bold">Log out</h1>
      <p className="text-center">Are you sure you want to log out?</p>
      <form action={async (e) => {
        await signOut({
          global: true,
          oauth: {
            redirectUrl: 'http://localhost:3000/login'
          }
        });
      }}>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
        >
          Log out
        </button>
      </form>
    </div>
  );
} 