import Link from "next/link";
import { connection } from "next/server";

import { HeaderNav } from "@/components/header-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/supabase/actions";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  // `cookies()` on its own is not enough suspension here: @supabase/ssr reads Date.now()
  // while it builds the client, to check token expiry, and Cache Components refuses an
  // unstable value during prerendering. Claiming the request first settles that.
  await connection();

  // Proxy already refreshed the session, so this only reads the cookie it left behind.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isSignedIn = Boolean(user);

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border py-4">
      <div className="flex items-baseline gap-3">
        <span className="font-sans text-[15px] leading-[22px] font-medium">Pattern Practice</span>
        {/* Guests get the same two screens; only where their saves live differs. */}
        <HeaderNav />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isSignedIn ? (
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The same one-line header without the session-dependent parts, so nothing shifts. */
export function SiteHeaderFallback() {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border py-4">
      <div className="flex items-baseline gap-3">
        <span className="font-sans text-[15px] leading-[22px] font-medium">Pattern Practice</span>
        <HeaderNav />
      </div>
      <ThemeToggle />
    </header>
  );
}