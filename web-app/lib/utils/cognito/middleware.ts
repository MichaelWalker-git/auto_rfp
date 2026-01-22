import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  // For now, simply continue the request without modifying the response.
  // You can extend this to manage authenticated sessions if needed.
  return NextResponse.next()
}