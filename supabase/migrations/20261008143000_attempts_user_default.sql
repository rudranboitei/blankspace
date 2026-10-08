-- Fixes a column default that the first migration left off.
--
-- `attempts.user_id` was created without `default auth.uid()`, so the documented
-- "insert without naming the user" path wrote NULL and the row was refused by the
-- `attempts_insert_own` policy with 42501. The practice screen logs every check that way,
-- so nothing was ever recorded.
--
-- The column stays nullable: a guest has no `auth.uid()`, and the default simply yields
-- NULL for them. Guests are refused by RLS regardless, since the policy is scoped to
-- `authenticated`.

alter table public.attempts
  alter column user_id set default auth.uid();

comment on column public.attempts.user_id is
  'Defaults to the caller. Nullable, but a guest has no auth.uid() and is refused by RLS.';