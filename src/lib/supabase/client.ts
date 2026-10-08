"use client";

import { createBrowserClient } from "@supabase/ssr";

/** For Client Components. Safe to call in render, the client is cached per browser session. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}