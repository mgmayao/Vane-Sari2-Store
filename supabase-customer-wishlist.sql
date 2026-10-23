create table if not exists public.customer_wishlist (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  customer_email text not null,
  customer_name text not null,
  product_id text not null,
  product_name text not null,
  category text not null default 'Others',
  quantity integer not null check (quantity between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'granted', 'declined')),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_wishlist_created_idx
  on public.customer_wishlist (created_at desc);

create index if not exists customer_wishlist_customer_created_idx
  on public.customer_wishlist (customer_id, created_at desc);

create unique index if not exists customer_wishlist_one_pending_product_idx
  on public.customer_wishlist (customer_id, product_id)
  where status = 'pending';

alter table public.customer_wishlist enable row level security;
revoke all on public.customer_wishlist from anon, authenticated;
grant all on public.customer_wishlist to service_role;
