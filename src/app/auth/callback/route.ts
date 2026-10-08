import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** Where Supabase sends the browser after an email confirmation or a sign-in link. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  // Only same-site paths, so `?next=` can never bounce someone to another host.
  const rawNext = searchParams.get("next");
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (code) {
    // A PKCE redirect, from OAuth or from a sign-in link.
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(`${origin}/login?error=link`);
    }
  } else if (tokenHash && type) {
    // The `?token_hash=&type=` link on a confirmation email.
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (error) {
      return NextResponse.redirect(`${origin}/login?error=link`);
    }
  } else {
    return NextResponse.redirect(`${origin}/login`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}