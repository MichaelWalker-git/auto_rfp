import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/utils/cognito/middleware";

export async function proxy(request: NextRequest) {
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
