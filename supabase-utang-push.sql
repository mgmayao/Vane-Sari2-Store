create table if not exists public.customer_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  updated_at timestamptz not null default now()
);

create index if not exists customer_push_subscriptions_user_idx
  on public.customer_push_subscriptions (user_id);

alter table public.customer_push_subscriptions enable row level security;
revoke all on public.customer_push_subscriptions from anon, authenticated;
grant all on public.customer_push_subscriptions to service_role;

create table if not exists public.utang_push_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  due_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, due_date)
);

alter table public.utang_push_reminders enable row level security;
revoke all on public.utang_push_reminders from anon, authenticated;
grant all on public.utang_push_reminders to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'vane-pos-utang-push-reminders';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'vane-pos-utang-push-reminders',
  '0 * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'vane_pos_supabase_url'
      ) || '/functions/v1/utang-push-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'vane_pos_utang_cron_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
