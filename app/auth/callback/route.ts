import { type NextRequest } from 'next/server'
import { redirect } from 'next/navigation'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  
  if (!code) {
    return redirect('/login')
  }
  
  // For now, just redirect to home - this is a mock implementation
  // In a real implementation, you'd verify the code with AWS Cognito
  return redirect('/')
}
