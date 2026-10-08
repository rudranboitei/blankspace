import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** For Server Components, Server Actions and Route Handlers. One instance per request. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` cannot write cookies from a Server Component. Proxy refreshes
            // the session on every request, so this is safe to ignore.
          }
        },
      },
    },
  );
}