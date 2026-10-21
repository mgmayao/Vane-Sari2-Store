import {createClient} from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type OrderRow = {
  customer_id: string | null;
  sale_id: string | null;
  total: number | string;
};

type PushSubscriptionRow = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'}
  });
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function philippinesDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])) as {
    year: string;
    month: string;
    day: string;
  };
}

Deno.serve(async request => {
  if (request.method !== 'POST') return respond({error: 'Method not allowed.'}, 405);

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || !constantTimeEqual(request.headers.get('x-cron-secret') || '', cronSecret)) {
    return respond({error: 'Unauthorized.'}, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');
  if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error('Utang push reminders are missing required server configuration.');
    return respond({error: 'Push reminder configuration is incomplete.'}, 500);
  }

  const today = philippinesDate();
  const year = Number(today.year);
  const month = Number(today.month);
  const day = Number(today.day);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dueDay = Math.min(30, daysInMonth);
  if (day !== 15 && day !== dueDay) return respond({sent: 0, skipped: true});

  const dateKey = `${today.year}-${today.month}-${today.day}`;
  const admin = createClient(supabaseUrl, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  try {
    const orders: OrderRow[] = [];
    for (let from = 0; ; from += 1000) {
      const {data, error} = await admin.from('customer_orders')
        .select('customer_id,sale_id,total')
        .eq('status', 'approved')
        .eq('payment_method', 'utang')
        .not('customer_id', 'is', null)
        .not('sale_id', 'is', null)
        .range(from, from + 999);
      if (error) throw error;
      orders.push(...(data || []) as OrderRow[]);
      if (!data || data.length < 1000) break;
    }

    const orderBatches: OrderRow[][] = [];
    for (let index = 0; index < orders.length; index += 100) orderBatches.push(orders.slice(index, index + 100));
    const unpaidByCustomer = new Map<string, {total: number; saleIds: string[]}>();
    for (const batch of orderBatches) {
      const saleIds = batch.map(order => order.sale_id).filter((id): id is string => !!id);
      if (!saleIds.length) continue;
      const {data: unpaidSales, error} = await admin.from('sales')
        .select('id')
        .eq('paid', false)
        .in('id', saleIds);
      if (error) throw error;
      const unpaidIds = new Set((unpaidSales || []).map(sale => sale.id));
      for (const order of batch) {
        if (!order.customer_id || !order.sale_id || !unpaidIds.has(order.sale_id)) continue;
        const current = unpaidByCustomer.get(order.customer_id) || {total: 0, saleIds: []};
        current.total += Number(order.total) || 0;
        current.saleIds.push(order.sale_id);
        unpaidByCustomer.set(order.customer_id, current);
      }
    }
    if (!unpaidByCustomer.size) return respond({sent: 0, date: dateKey});

    const customerIds = [...unpaidByCustomer.keys()];
    const {data: existingReminders, error: reminderError} = await admin.from('utang_push_reminders')
      .select('user_id')
      .eq('due_date', dateKey)
      .in('user_id', customerIds);
    if (reminderError) throw reminderError;
    const alreadyReminded = new Set((existingReminders || []).map(row => row.user_id));
    const waitingIds = customerIds.filter(id => !alreadyReminded.has(id));
    if (!waitingIds.length) return respond({sent: 0, date: dateKey});

    const {data: subscriptions, error: subscriptionError} = await admin.from('customer_push_subscriptions')
      .select('user_id,endpoint,p256dh,auth')
      .in('user_id', waitingIds);
    if (subscriptionError) throw subscriptionError;
    const byCustomer = new Map<string, PushSubscriptionRow[]>();
    for (const subscription of (subscriptions || []) as PushSubscriptionRow[]) {
      const current = byCustomer.get(subscription.user_id) || [];
      current.push(subscription);
      byCustomer.set(subscription.user_id, current);
    }

    let sent = 0;
    for (const customerId of waitingIds) {
      const devices = byCustomer.get(customerId) || [];
      if (!devices.length) continue;
      let delivered = 0;
      for (const device of devices) {
        try {
          await webpush.sendNotification({
            endpoint: device.endpoint,
            keys: {p256dh: device.p256dh, auth: device.auth}
          }, JSON.stringify({
            title: 'Vane POS bill reminder',
            body: 'You have an unpaid bill due today. Open Vane POS to view your reminder.',
            tag: `utang-bill-reminder-${dateKey}`,
            date: dateKey
          }), {TTL: 86400});
          delivered++;
        } catch (error) {
          const status = typeof error === 'object' && error !== null && 'statusCode' in error
            ? Number((error as {statusCode: unknown}).statusCode)
            : 0;
          if (status === 404 || status === 410) {
            const {error: removeError} = await admin.from('customer_push_subscriptions').delete().eq('endpoint', device.endpoint);
            if (removeError) console.error('Could not remove an expired push subscription:', removeError);
          } else {
            console.error('Could not send an Utang reminder to a subscribed device:', error);
          }
        }
      }
      if (!delivered) continue;
      const {error} = await admin.from('utang_push_reminders').insert({user_id: customerId, due_date: dateKey});
      if (error) throw error;
      sent++;
    }
    return respond({sent, date: dateKey});
  } catch (error) {
    console.error('Utang push reminder job failed:', error);
    return respond({error: 'Could not send due-date reminders.'}, 500);
  }
});
