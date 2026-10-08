-- An exemption list for the coach quota.
--
-- The quota is the thing that bounds cost on an endpoint nobody has to sign in to, so an
-- exemption is a deliberate hole in it. It belongs in a table rather than in an environment
-- variable for two reasons: it can be changed from the Supabase dashboard without a deploy,
-- and "who currently has unlimited spend" is a question worth being able to answer.
--
-- There are no RLS policies, so this table is invisible to the browser and can only be written
-- through the service role, which no route handler does. Managing it is a deliberate act in
-- the SQL editor.

create table if not exists public.coach_exemptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Why this person has it. Not enforced, but an unexplained exemption is one nobody dares
  -- remove later.
  reason text,
  granted_at timestamptz not null default now()
);

comment on table public.coach_exemptions is
  'Accounts that spend coach quota without limit. Service role only; no RLS policies.';

alter table public.coach_exemptions enable row level security;

-- Adding a parameter means a new function, and the old one has to go first or the route would
-- keep calling a signature that still checks nothing.
drop function if exists public.consume_coach_quota(text, text, integer, timestamptz, text, integer, timestamptz);

create or replace function public.consume_coach_quota(
  p_subject text,
  p_user_id uuid,
  p_minute_bucket text,
  p_minute_limit integer,
  p_minute_expires_at timestamptz,
  p_day_bucket text,
  p_day_limit integer,
  p_day_expires_at timestamptz
)
returns table (
  allowed boolean,
  minute_used integer,
  minute_limit integer,
  day_used integer,
  day_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute integer;
  v_day integer;
begin
  -- An exempt caller is allowed, and no counters are written for them at all: there is nothing
  -- to enforce, so there is nothing to record. That also means an exempt account can never be
  -- left mid-window by a change to the list, because it never had a window.
  if p_user_id is not null
     and exists (select 1 from public.coach_exemptions where user_id = p_user_id) then
    return query select true, 0, p_minute_limit, 0, p_day_limit;
    return;
  end if;

  -- Sweep this subject's finished windows first, so a caller who signs in and out over days
  -- does not accumulate one row per window. The primary key leads with subject, so this only
  -- ever touches the two or three rows for this caller.
  delete from public.coach_rate_limits
   where subject = p_subject
     and expires_at <= now();

  insert into public.coach_rate_limits as limits (subject, bucket, count, expires_at)
  values (p_subject, p_minute_bucket, 1, p_minute_expires_at)
  on conflict (subject, bucket) do update
    set count = limits.count + 1
  where limits.count < p_minute_limit
  returning count into v_minute;

  insert into public.coach_rate_limits as limits (subject, bucket, count, expires_at)
  values (p_subject, p_day_bucket, 1, p_day_expires_at)
  on conflict (subject, bucket) do update
    set count = limits.count + 1
  where limits.count < p_day_limit
  returning count into v_day;

  -- Whichever window let the call through, give the unit back if the other one refused it.
  -- Without this a caller at the daily cap would also burn their whole minute allowance on
  -- requests that never reach the model.
  if v_minute is null or v_day is null then
    if v_minute is not null then
      update public.coach_rate_limits
         set count = count - 1
       where subject = p_subject and bucket = p_minute_bucket;
    end if;
    if v_day is not null then
      update public.coach_rate_limits
         set count = count - 1
       where subject = p_subject and bucket = p_day_bucket;
    end if;

    return query select
      false,
      coalesce(v_minute, p_minute_limit),
      p_minute_limit,
      coalesce(v_day, p_day_limit),
      p_day_limit;
    return;
  end if;

  return query select
    true,
    v_minute,
    p_minute_limit,
    v_day,
    p_day_limit;
end;
$$;

comment on function public.consume_coach_quota is
  'Atomically spends one unit of coach quota. Accounts in coach_exemptions are always allowed.';

revoke all on function public.consume_coach_quota(text, uuid, text, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_coach_quota(text, uuid, text, integer, timestamptz, text, integer, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
