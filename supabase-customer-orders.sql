create table if not exists public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete set null,
  customer_email text not null,
  customer_name text not null,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total numeric(12, 2) not null check (total >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_orders
  add column if not exists payment_method text,
  add column if not exists sale_id text;

alter table public.customer_orders
  drop constraint if exists customer_orders_payment_method_check;

alter table public.customer_orders
  add constraint customer_orders_payment_method_check
  check (payment_method is null or payment_method in ('cash', 'utang'));

create index if not exists customer_orders_status_created_idx
  on public.customer_orders (status, created_at desc);

alter table public.customer_orders enable row level security;
revoke all on public.customer_orders from anon, authenticated;
grant all on public.customer_orders to service_role;

create or replace function public.set_new_user_default_customer_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app_metadata jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  if v_app_metadata ->> 'role' not in ('admin', 'customer') or v_app_metadata ->> 'role' is null then
    new.raw_app_meta_data := v_app_metadata || jsonb_build_object('role', 'customer');
  end if;
  return new;
end;
$$;

drop trigger if exists set_new_user_default_customer_role on auth.users;
create trigger set_new_user_default_customer_role
  before insert on auth.users
  for each row execute function public.set_new_user_default_customer_role();

revoke all on function public.set_new_user_default_customer_role() from public, anon, authenticated;

create or replace function public.finalize_customer_order(p_order_id uuid, p_payment_method text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.customer_orders%rowtype;
  v_owner_id uuid;
  v_item jsonb;
  v_product_id text;
  v_product_name text;
  v_product_price numeric;
  v_product_cost numeric;
  v_quantity integer;
  v_items jsonb := '[]'::jsonb;
  v_total numeric(12, 2) := 0;
  v_profit numeric(12, 2) := 0;
  v_sale_id text;
  v_now timestamptz := now();
begin
  if p_payment_method not in ('cash', 'utang') then
    raise exception 'Choose Cash or Utang before confirming the order.';
  end if;

  select * into v_order
  from public.customer_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  v_sale_id := 'customer-order-' || v_order.id::text;
  if v_order.status = 'approved' then
    if v_order.payment_method = p_payment_method and v_order.sale_id = v_sale_id then
      return jsonb_build_object('saleId', v_sale_id, 'paymentMethod', p_payment_method, 'alreadyFinalized', true);
    end if;
    raise exception 'Order has already been finalized.';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Order has already been reviewed.';
  end if;

  select id into v_owner_id
  from auth.users
  where lower(email) = 'vanessalumawag404@gmail.com'
  limit 1;
  if v_owner_id is null then
    raise exception 'The store administrator account is not configured.';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(v_order.items)
    order by value ->> 'productId'
  loop
    v_product_id := v_item ->> 'productId';
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_product_id is null or v_quantity is null or v_quantity < 1 then
      raise exception 'Order contains an invalid product or quantity.';
    end if;

    update public.products
    set stock = stock - v_quantity, updated_at = v_now
    where user_id = v_owner_id
      and id = v_product_id
      and stock >= v_quantity
      and round(price, 2) = round((v_item ->> 'price')::numeric, 2)
    returning name, price, cost into v_product_name, v_product_price, v_product_cost;

    if not found then
      raise exception 'Product % is unavailable, out of stock, or its price has changed.', coalesce(v_item ->> 'name', v_product_id);
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'pid', v_product_id,
      'name', v_product_name,
      'qty', v_quantity,
      'price', v_product_price,
      'cost', v_product_cost
    ));
    v_total := v_total + v_product_price * v_quantity;
    v_profit := v_profit + (v_product_price - v_product_cost) * v_quantity;

    insert into public.audit_events (id, user_id, type, entity_id, ts, payload)
    values (
      'customer-order-stock-' || gen_random_uuid()::text,
      v_owner_id,
      'stock_movement',
      v_product_id,
      v_now,
      jsonb_build_object(
        'productName', v_product_name,
        'delta', -v_quantity,
        'reason', 'Customer order',
        'saleId', v_sale_id
      )
    );
  end loop;

  insert into public.sales (
    id, user_id, ts, items, total, profit, customer, paid, paid_at, cash_received, change_given
  ) values (
    v_sale_id,
    v_owner_id,
    v_now,
    v_items,
    v_total,
    v_profit,
    v_order.customer_name,
    p_payment_method = 'cash',
    case when p_payment_method = 'cash' then v_now else null end,
    case when p_payment_method = 'cash' then v_total else 0 end,
    0
  );

  update public.customer_orders
  set status = 'approved',
      payment_method = p_payment_method,
      sale_id = v_sale_id,
      updated_at = v_now
  where id = p_order_id;

  return jsonb_build_object('saleId', v_sale_id, 'paymentMethod', p_payment_method, 'alreadyFinalized', false);
end;
$$;

revoke all on function public.finalize_customer_order(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_customer_order(uuid, text) to service_role;
