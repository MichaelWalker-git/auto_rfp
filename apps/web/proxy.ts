import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/utils/cognito/middleware";

export async function proxy(request: NextRequest) {
  // Skip data: URIs that browsers may incorrectly send as HTTP requests
  // (caused by malformed src attributes with embedded base64 data)
  const pathname = request.nextUrl.pathname;
  if (pathname.includes('data:image') || pathname.includes('base64,')) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    return await updateSession(request);
  } catch (e) {
    console.error("Proxy error", e);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
