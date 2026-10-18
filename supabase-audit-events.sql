create table if not exists public.audit_events (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  entity_id text not null,
  ts timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create index if not exists audit_events_user_ts_idx
  on public.audit_events (user_id, ts desc);

alter table public.audit_events enable row level security;

grant select, insert on public.audit_events to authenticated;

do $$
begin
  create policy "Users can read their audit events"
    on public.audit_events for select to authenticated
    using ((select auth.uid()) = user_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can insert their audit events"
    on public.audit_events for insert to authenticated
    with check ((select auth.uid()) = user_id);
exception when duplicate_object then null;
end $$;