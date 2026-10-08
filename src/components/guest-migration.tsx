"use client";

import { useEffect } from "react";

import { migrateGuestSaves } from "@/lib/guest-migration";

/**
 * One run per page, shared by however many times the effect fires.
 *
 * Strict Mode mounts effects twice in development, and the migration is asynchronous, so a
 * bare call would start a second copy while the first was still writing. Holding the promise
 * means both callers await the same work instead of duplicating it.
 */
let inFlight: Promise<unknown> | null = null;

/**
 * Moves a guest's saved patterns into the database once an account exists.
 *
 * Mounted in the root layout so it runs whichever screen a signed-in visitor lands on, and
 * does nothing when there is no session or nothing to move.
 */
export function GuestMigration() {
  useEffect(() => {
    inFlight ??= migrateGuestSaves().finally(() => {
      inFlight = null;
    });
  }, []);

  return null;
}
