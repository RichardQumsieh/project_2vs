import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createContentSecurityPolicy, frontendDocumentSecurityHeaders } from "./lib/security-policy";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const contentSecurityPolicy = createContentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === "development",
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  for (const [name, value] of Object.entries(frontendDocumentSecurityHeaders(request.nextUrl.protocol))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
