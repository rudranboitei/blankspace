"use client";

/**
 * Whether there is a session, and whose it is.
 *
 * Several things need this and none of them can ask afresh on every action: logging an
 * attempt, saving a pattern, and choosing between the database and local storage. The answer
 * cannot change without a reload or an explicit sign in, so it is read once per tab.
 */
let userId: string | null = null;

export function currentUserId() {
  return userId;
}

export async function refreshSession() {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  userId = user?.id ?? null;
  return userId;
}

/** Called from sign-in and sign-out so the cached id cannot outlive the session. */
export function setSession(id: string | null) {
  userId = id;
}