-- Rate limiting for the coach.
--
-- The counters live in Postgres rather than in the app's memory for two reasons. The route
-- runs on serverless, where memory is per invocation and a counter there would reset every
-- time; and the increment has to be atomic, because two requests arriving together would
-- both read the same count and both be let through if the app read and then wrote.

create table if not exists public.coach_rate_limits (
  -- "u:<uuid>" for an account, "ip:<hmac>" for a guest. The prefix keeps the two pools from
  -- colliding and keeps a user id from ever being mistaken for an address.
  subject text not null,
  -- A fixed window, named by where it starts: "m:2026-10-08T14:23:00Z" or "d:2026-10-08".
  -- A fixed window is chosen over a sliding one on purpose: it is one row, it needs no
  -- cleanup on a schedule, and it can be counted with the same upsert that enforces it.
  bucket text not null,
  count integer not null default 1,
  -- When this window stops mattering, so a subject's rows can be swept.
  expires_at timestamptz not null,
  primary key (subject, bucket),
  -- The minute window can never hold more than a couple of rows per subject.
  constraint coach_rate_limits_count_positive check (count > 0)
);

comment on table public.coach_rate_limits is
  'Fixed-window counters for coach calls. Service role only: no RLS policies exist.';

create index if not exists coach_rate_limits_expires_at_idx
  on public.coach_rate_limits (expires_at);

alter table public.coach_rate_limits enable row level security;

-- Deliberately no policies. A signed-out or signed-in request sees zero rows here, and the
-- function below is SECURITY DEFINER and owned by the table owner, so the service role can
-- still reach it.

-- Spends one unit of quota and reports what is left.
--
-- The increment carries its own guard: `where count < limit` means a row that is already at
-- its limit is left alone and the statement returns nothing, which is how an over-limit call
-- is told apart from an allowed one without a second read.
create or replace function public.consume_coach_quota(
  p_subject text,
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
  'Atomically spends one unit of coach quota. Returns false if either window is full.';

-- The function is the only way in, and only the service role may call it.
revoke all on function public.consume_coach_quota(text, text, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_coach_quota(text, text, integer, timestamptz, text, integer, timestamptz)
  to service_role;

-- PostgREST builds its schema cache at startup and does not notice a new function on its own.
notify pgrst, 'reload schema';
