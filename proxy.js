import { NextResponse } from 'next/server';
import { auth0 } from './lib/auth0';

export async function proxy(request) {
  const authResponse = await auth0.middleware(request);

  if (request.nextUrl.pathname.startsWith('/auth')) {
    return authResponse;
  }

  const protectedRoute =
    request.nextUrl.pathname.startsWith('/training-manager') ||
    request.nextUrl.pathname === '/dashboard.html';

  if (!protectedRoute) {
    return authResponse;
  }

  const session = await auth0.getSession(request);

  if (!session) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('returnTo', '/training-manager');
    return NextResponse.redirect(loginUrl);
  }

  return authResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'
  ]
};
