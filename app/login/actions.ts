'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { signInWithMagicLink as cognitoSignIn, signOut as cognitoSignOut } from '@/lib/utils/cognito/client'

export async function signInWithMagicLink(formData: FormData) {
  // Get email from form data
  const email = formData.get('email') as string
  
  // Validate email
  if (!email || !email.includes('@')) {
    // In a real app, you'd want to return an error message
    redirect('/error')
  }

  const { error } = await cognitoSignIn(email)

  if (error) {
    redirect('/error')
  }

  // Redirect to a confirmation page
  redirect('/login/confirmation')
}

// Keep this for backward compatibility if needed, but it won't be used in the new flow
export async function login(formData: FormData) {
  redirect('/login/confirmation')
}

// Keep this for backward compatibility if needed, but it won't be used in the new flow
export async function signup(formData: FormData) {
  redirect('/login/confirmation')
}

export async function logout() {
  await cognitoSignOut()
  
  revalidatePath('/', 'layout')
  redirect('/login')
}
