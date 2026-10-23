import {createClient} from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const bootstrapAdminEmail = 'vanessalumawag404@gmail.com';

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: corsHeaders});
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return respond({error: 'Method not allowed.'}, 405);

  try {
    const tokenMatch = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) throw new HttpError(401, 'Sign in to continue.');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) throw new HttpError(500, 'Supabase function configuration is incomplete.');

    const authClient = createClient(supabaseUrl, anonKey, {auth: {persistSession: false, autoRefreshToken: false}});
    const {data: authData, error: authError} = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user?.email) throw new HttpError(401, 'Your session is invalid or expired.');

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON object.');
      body = parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON.');
    }

    const allowedEmails = new Set([
      bootstrapAdminEmail,
      ...(Deno.env.get('ADMIN_EMAILS') || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
    ]);
    const callerIsAdmin = allowedEmails.has(authData.user.email.toLowerCase()) || authData.user.app_metadata?.role === 'admin';
    const admin = createClient(supabaseUrl, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});

    async function getStoreOwnerId() {
      for (let page = 1; ; page++) {
        const {data, error} = await admin.auth.admin.listUsers({page, perPage: 100});
        if (error) throw new HttpError(502, 'Could not find the store product catalog owner.');
        const owner = data.users.find(account => account.email?.toLowerCase() === bootstrapAdminEmail);
        if (owner) return owner.id;
        if (data.users.length < 100) break;
      }
      throw new HttpError(503, 'The store administrator account is not configured yet.');
    }

    if (body.action === 'catalog') {
      const ownerId = await getStoreOwnerId();
      const {data, error} = await admin.from('products')
        .select('id,name,category,price,stock')
        .eq('user_id', ownerId)
        .gt('stock', 0)
        .order('name');
      if (error) throw new HttpError(502, 'Could not load the store product catalog.');
      return respond({products: data});
    }

    if (body.action === 'wishlist_catalog') {
      if (callerIsAdmin) throw new HttpError(403, 'Wishlists are available to customer accounts only.');
      const ownerId = await getStoreOwnerId();
      const {data, error} = await admin.from('products')
        .select('id,name,category,stock')
        .eq('user_id', ownerId)
        .order('name');
      if (error) throw new HttpError(502, 'Could not load products for your wishlist.');
      return respond({products: data});
    }

    if (body.action === 'add_wishlist') {
      if (callerIsAdmin) throw new HttpError(403, 'Wishlists are available to customer accounts only.');
      const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
      const quantity = body.quantity;
      if (!productId || productId.length > 100 || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        throw new HttpError(400, 'Choose a valid product and quantity between 1 and 100.');
      }
      const ownerId = await getStoreOwnerId();
      const {data: product, error: productError} = await admin.from('products')
        .select('id,name,category')
        .eq('user_id', ownerId)
        .eq('id', productId)
        .maybeSingle();
      if (productError) throw new HttpError(502, 'Could not validate this wishlist product.');
      if (!product) throw new HttpError(404, 'That product is no longer in the store catalog.');
      const metadata = authData.user.user_metadata || {};
      const customerName = typeof metadata.display_name === 'string' && metadata.display_name.trim()
        ? metadata.display_name.trim()
        : [metadata.first_name, metadata.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ') || authData.user.email;
      const {data: item, error} = await admin.from('customer_wishlist').insert({
        customer_id: authData.user.id,
        customer_email: authData.user.email,
        customer_name: customerName,
        product_id: product.id,
        product_name: product.name,
        category: product.category || 'Others',
        quantity,
        status: 'pending'
      }).select('id,product_id,product_name,category,quantity,status,created_at').single();
      if (error?.code === '23505') throw new HttpError(409, 'This product is already in your pending wishlist.');
      if (error) throw new HttpError(502, 'Could not add this product to your wishlist.');
      return respond({success: true, item});
    }

    if (body.action === 'my_wishlist') {
      if (callerIsAdmin) throw new HttpError(403, 'Customer wishlist history is not available to administrator accounts.');
      const {data, error} = await admin.from('customer_wishlist')
        .select('id,product_id,product_name,category,quantity,status,created_at,updated_at')
        .eq('customer_id', authData.user.id)
        .order('created_at', {ascending: false})
        .limit(200);
      if (error) throw new HttpError(502, 'Could not load your wishlist.');
      return respond({items: data});
    }

    if (body.action === 'list_wishlist') {
      if (!callerIsAdmin) throw new HttpError(403, 'Only administrators can review customer wishlists.');
      const {data, error} = await admin.from('customer_wishlist')
        .select('id,customer_email,customer_name,product_id,product_name,category,quantity,status,created_at')
        .order('created_at', {ascending: false})
        .limit(500);
      if (error) throw new HttpError(502, 'Could not load customer wishlist requests.');
      return respond({items: data});
    }

    if (body.action === 'review_wishlist') {
      if (!callerIsAdmin) throw new HttpError(403, 'Only administrators can review customer wishlists.');
      const itemId = typeof body.itemId === 'string' ? body.itemId : '';
      const status = body.status;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) {
        throw new HttpError(400, 'Invalid wishlist request id.');
      }
      const reviewStatus = status === 'granted' ? 'granted' : status === 'declined' ? 'declined' : null;
      if (!reviewStatus) throw new HttpError(400, 'Choose grant or decline.');
      const {data, error} = await admin.from('customer_wishlist')
        .update({status: reviewStatus, reviewed_by: authData.user.id, updated_at: new Date().toISOString()})
        .eq('id', itemId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw new HttpError(502, 'Could not update this wishlist request.');
      if (!data) throw new HttpError(409, 'This wishlist request has already been reviewed.');
      return respond({success: true});
    }

    if (body.action === 'save_push_subscription') {
      if (callerIsAdmin) throw new HttpError(403, 'Bill reminders are available to customer accounts only.');
      const subscription = body.subscription;
      if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
        throw new HttpError(400, 'A valid browser push subscription is required.');
      }
      const value = subscription as Record<string, unknown>;
      const endpoint = typeof value.endpoint === 'string' ? value.endpoint : '';
      const keys = value.keys && typeof value.keys === 'object' && !Array.isArray(value.keys)
        ? value.keys as Record<string, unknown>
        : {};
      const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
      const auth = typeof keys.auth === 'string' ? keys.auth : '';
      let endpointUrl: URL;
      try {
        endpointUrl = new URL(endpoint);
      } catch {
        throw new HttpError(400, 'The browser push endpoint is invalid.');
      }
      if (endpointUrl.protocol !== 'https:' || endpoint.length > 2048 || !p256dh || p256dh.length > 256
        || !auth || auth.length > 256) {
        throw new HttpError(400, 'The browser push subscription is incomplete or invalid.');
      }
      const {error} = await admin.from('customer_push_subscriptions').upsert({
        user_id: authData.user.id,
        endpoint,
        p256dh,
        auth,
        updated_at: new Date().toISOString()
      }, {onConflict: 'endpoint'});
      if (error) throw new HttpError(502, 'Could not save this device for bill reminders.');
      return respond({success: true});
    }

    if (body.action === 'place_order') {
      const paymentMethod = body.paymentMethod;
      const walletProvider = body.walletProvider;
      if (!['cash', 'utang', 'ewallet'].includes(String(paymentMethod))) {
        throw new HttpError(400, 'Choose Cash, Utang, or E-wallet before placing the order.');
      }
      if (paymentMethod === 'ewallet' && !['metrobank', 'gcash', 'maribank'].includes(String(walletProvider))) {
        throw new HttpError(400, 'Choose Metrobank, GCash, or MariBank for E-wallet payment.');
      }
      if (paymentMethod !== 'ewallet' && walletProvider !== undefined) {
        throw new HttpError(400, 'An E-wallet provider can only be selected for E-wallet payment.');
      }
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
        throw new HttpError(400, 'Choose between 1 and 50 products.');
      }
      const quantities = new Map<string, {quantity: number; unitPrice: number}>();
      for (const value of body.items) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Invalid order item.');
        const item = value as Record<string, unknown>;
        const productId = typeof item.productId === 'string' ? item.productId : '';
        const quantity = item.quantity;
        const unitPrice = item.unitPrice;
        if (!productId || productId.length > 100 || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000
          || typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new HttpError(400, 'Each order item needs a valid product and quantity.');
        }
        const existing = quantities.get(productId);
        if (existing && Math.round(existing.unitPrice * 100) !== Math.round(unitPrice * 100)) {
          throw new HttpError(400, 'A product has conflicting prices in the order.');
        }
        quantities.set(productId, {quantity: (existing?.quantity || 0) + quantity, unitPrice});
      }

      const ownerId = await getStoreOwnerId();
      const {data: products, error: productsError} = await admin.from('products')
        .select('id,name,category,price,stock')
        .eq('user_id', ownerId)
        .in('id', [...quantities.keys()]);
      if (productsError) throw new HttpError(502, 'Could not validate the order against the store catalog.');
      if (!products || products.length !== quantities.size) throw new HttpError(409, 'One or more products are no longer available.');

      const items = products.map(product => {
        const request = quantities.get(String(product.id));
        const quantity = request?.quantity || 0;
        const price = Number(product.price);
        const stock = Number(product.stock);
        if (!Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0) {
          throw new HttpError(502, 'A product has invalid price or stock data. Contact the store administrator.');
        }
        if (!request || Math.round(price * 100) !== Math.round(request.unitPrice * 100)) {
          throw new HttpError(409, 'A product price changed. Refresh the page and review your order total.');
        }
        if (stock < quantity) throw new HttpError(409, `${product.name} does not have enough stock for this order.`);
        return {productId: product.id, name: product.name, category: product.category || 'Others', price, quantity};
      });
      const total = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
      const metadata = authData.user.user_metadata || {};
      const customerName = typeof metadata.display_name === 'string' && metadata.display_name.trim()
        ? metadata.display_name.trim()
        : [metadata.first_name, metadata.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ') || authData.user.email;
      const {data: order, error: orderError} = await admin.from('customer_orders').insert({
        customer_id: authData.user.id,
        customer_email: authData.user.email,
        customer_name: customerName,
        items,
        total,
        payment_method: paymentMethod,
        ewallet_provider: paymentMethod === 'ewallet' ? walletProvider : null,
        status: 'pending'
      }).select('id,total,items,status,payment_method,ewallet_provider,created_at').single();
      if (orderError) throw new HttpError(502, 'Could not save the order request.');
      return respond({
        success: true,
        id: order.id,
        total: Number(order.total),
        items: order.items,
        status: order.status,
        paymentMethod: order.payment_method,
        walletProvider: order.ewallet_provider,
        createdAt: order.created_at
      });
    }

    if (body.action === 'my_orders') {
      const ownerId = await getStoreOwnerId();
      const {data: orders, error: ordersError} = await admin.from('customer_orders')
        .select('id,items,total,status,payment_method,ewallet_provider,sale_id,created_at')
        .eq('customer_id', authData.user.id)
        .order('created_at', {ascending: false})
        .limit(100);
      if (ordersError) throw new HttpError(502, 'Could not load your purchases.');
      const saleIds = (orders || []).map(order => order.sale_id).filter(Boolean);
      if (!saleIds.length) {
        return respond({orders: (orders || []).map(order => ({...order, paid: null}))});
      }
      const {data: sales, error: salesError} = await admin.from('sales')
        .select('id,paid')
        .eq('user_id', ownerId)
        .in('id', saleIds);
      if (salesError) throw new HttpError(502, 'Could not load your purchase payment status.');
      const saleById = new Map((sales || []).map(sale => [sale.id, sale]));
      return respond({
        orders: (orders || []).map(order => ({
          ...order,
          paid: order.sale_id && saleById.has(order.sale_id) ? saleById.get(order.sale_id)?.paid === true : null
        }))
      });
    }

    if (body.action === 'my_unpaid_utangs') {
      const ownerId = await getStoreOwnerId();
      const {data: orders, error: ordersError} = await admin.from('customer_orders')
        .select('id,total,sale_id,created_at')
        .eq('customer_id', authData.user.id)
        .eq('status', 'approved')
        .eq('payment_method', 'utang')
        .not('sale_id', 'is', null)
        .order('created_at', {ascending: true});
      if (ordersError) throw new HttpError(502, 'Could not load your unpaid Utang orders.');
      const saleIds = (orders || []).map(order => order.sale_id).filter(Boolean);
      if (!saleIds.length) return respond({debts: []});

      const {data: sales, error: salesError} = await admin.from('sales')
        .select('id,paid')
        .eq('user_id', ownerId)
        .in('id', saleIds);
      if (salesError) throw new HttpError(502, 'Could not check your Utang payment status.');
      const saleById = new Map((sales || []).map(sale => [sale.id, sale]));
      const debts = (orders || [])
        .filter(order => saleById.has(order.sale_id) && saleById.get(order.sale_id)?.paid === false)
        .map(order => ({id: order.id, total: Number(order.total), created_at: order.created_at}));
      return respond({debts});
    }

    if (body.action === 'list_orders') {
      if (!callerIsAdmin) throw new HttpError(403, 'Only administrators can review customer orders.');
      const {data, error} = await admin.from('customer_orders')
        .select('id,customer_email,customer_name,items,total,status,payment_method,ewallet_provider,sale_id,created_at')
        .order('created_at', {ascending: false})
        .limit(500);
      if (error) throw new HttpError(502, 'Could not load customer orders.');
      return respond({orders: data});
    }

    if (body.action === 'review_order') {
      if (!callerIsAdmin) throw new HttpError(403, 'Only administrators can review customer orders.');
      const orderId = typeof body.orderId === 'string' ? body.orderId : '';
      const status = body.status;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
        throw new HttpError(400, 'Invalid order id.');
      }
      if (status !== 'approved' && status !== 'rejected') throw new HttpError(400, 'Choose approve or decline.');
      if (status === 'approved') {
        if (!['cash', 'utang', 'ewallet'].includes(String(body.paymentMethod))) {
          throw new HttpError(400, 'This order has no valid payment choice.');
        }
        const {data, error} = await admin.rpc('finalize_customer_order', {
          p_order_id: orderId,
          p_payment_method: body.paymentMethod
        });
        if (error) {
          console.error('Customer order finalization failed:', error);
          const conflict = /stock|price|already|payment choice/i.test(error.message);
          throw new HttpError(conflict ? 409 : 502, error.message || 'Could not record the sale and update stock.');
        }
        return respond({success: true, ...data});
      }
      const {data, error} = await admin.from('customer_orders')
        .update({status, updated_at: new Date().toISOString()})
        .eq('id', orderId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw new HttpError(502, 'Could not update the order.');
      if (!data) throw new HttpError(409, 'This order has already been reviewed.');
      return respond({success: true});
    }

    throw new HttpError(400, 'Unknown order action.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected order request error.';
    if (status === 500) console.error('Customer order request failed:', error);
    return respond({error: message}, status);
  }
});
