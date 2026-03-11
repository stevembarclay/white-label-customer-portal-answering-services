// middleware.ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Create a mutable response for cookie updates (required by @supabase/ssr)
  let supabaseResponse = NextResponse.next({ request })

  // Explicit type forces TypeScript to the correct (non-deprecated) overload of
  // createServerClient, which in turn properly types the setAll parameter.
  const cookies: CookieMethodsServer = {
    getAll() {
      return request.cookies.getAll()
    },
    // Two separate loops are required — do NOT merge them.
    // Loop 1 mutates request.cookies. Then supabaseResponse is rebuilt once.
    // Loop 2 sets cookies on the new response object.
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value }) =>
        request.cookies.set(name, value)
      )
      supabaseResponse = NextResponse.next({ request })
      cookiesToSet.forEach(({ name, value, options }) =>
        // SAFETY: CookieOptions (Partial<SerializeOptions>) is structurally
        // compatible with Next.js ResponseCookieOptions at the fields we use.
        supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
      )
    },
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Authenticated user hitting a login page → send to portal
  if (user && pathname.startsWith('/login')) {
    const portalUrl = request.nextUrl.clone()
    portalUrl.pathname = '/answering-service'
    return NextResponse.redirect(portalUrl)
  }

  // Unauthenticated user on a protected route → redirect to login
  if (!user && !pathname.startsWith('/login')) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Exclude: static assets, API routes (they guard themselves), image files, and PWA manifests
    '/((?!_next/static|_next/image|api/|favicon.ico|manifest\\.webmanifest$|.*\\.png$|.*\\.svg$|.*\\.ico$).*)',
  ],
}
