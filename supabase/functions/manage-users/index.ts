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

function getUserId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Invalid user id.');
  }
  return value;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return respond({error: 'Method not allowed.'}, 405);

  try {
    const authHeader = request.headers.get('Authorization') || '';
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) throw new HttpError(401, 'Sign in to manage users.');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) throw new HttpError(500, 'Supabase function configuration is incomplete.');

    const authClient = createClient(supabaseUrl, anonKey, {auth: {persistSession: false, autoRefreshToken: false}});
    const {data: authData, error: authError} = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user || !authData.user.email) throw new HttpError(401, 'Your session is invalid or expired.');

    const allowedEmails = new Set([
      bootstrapAdminEmail,
      ...(Deno.env.get('ADMIN_EMAILS') || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
    ]);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON object.');
      body = parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON.');
    }

    const action = body.action;
    const callerIsAdmin = allowedEmails.has(authData.user.email.toLowerCase()) || authData.user.app_metadata?.role === 'admin';
    if (action === 'check') return respond({isAdmin: callerIsAdmin});
    if (!callerIsAdmin) throw new HttpError(403, 'Only configured administrators can manage users.');

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) throw new HttpError(500, 'Supabase function service configuration is incomplete.');
    const admin = createClient(supabaseUrl, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});

    if (action === 'list') {
      const users = [];
      for (let page = 1; ; page++) {
        const {data, error} = await admin.auth.admin.listUsers({page, perPage: 100});
        if (error) throw new HttpError(502, 'Could not retrieve the user list.');
        users.push(...data.users);
        if (data.users.length < 100) break;
      }
      return respond({users: users.map(account => ({
        id: account.id,
        email: account.email || '',
        created_at: account.created_at,
        last_sign_in_at: account.last_sign_in_at || null,
        email_confirmed_at: account.email_confirmed_at || null,
        is_admin: (!!account.email && allowedEmails.has(account.email.toLowerCase())) || account.app_metadata?.role === 'admin',
        role: (!!account.email && allowedEmails.has(account.email.toLowerCase())) || account.app_metadata?.role === 'admin' ? 'admin' : 'customer',
        first_name: typeof account.user_metadata?.first_name === 'string' ? account.user_metadata.first_name : '',
        last_name: typeof account.user_metadata?.last_name === 'string' ? account.user_metadata.last_name : '',
        display_name: typeof account.user_metadata?.display_name === 'string' ? account.user_metadata.display_name :
          [account.user_metadata?.first_name, account.user_metadata?.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ')
      }))});
    }

    if (action === 'create') {
      const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
      const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const role = body.role;
      if (!firstName || firstName.length > 60 || !lastName || lastName.length > 60) {
        throw new HttpError(400, 'First and last name are required and must be 60 characters or fewer.');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
      if (role !== 'customer' && role !== 'admin') throw new HttpError(400, 'Role must be customer or admin.');
      const {data, error} = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {first_name: firstName, last_name: lastName, display_name: `${firstName} ${lastName}`},
        app_metadata: {role}
      });
      if (error) throw new HttpError(400, error.message);
      return respond({success: true, userId: data.user.id});
    }

    const userId = getUserId(body.userId);
    const {data: targetData, error: targetError} = await admin.auth.admin.getUserById(userId);
    if (targetError || !targetData.user) throw new HttpError(404, 'User account not found.');
    const target = targetData.user;
    const targetIsBootstrapAdmin = !!target.email && allowedEmails.has(target.email.toLowerCase());
    const targetIsAdmin = targetIsBootstrapAdmin || target.app_metadata?.role === 'admin';

    if (action === 'update') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
      const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
      const role = body.role;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      if (!firstName || firstName.length > 60 || !lastName || lastName.length > 60) {
        throw new HttpError(400, 'First and last name are required and must be 60 characters or fewer.');
      }
      if (role !== 'customer' && role !== 'admin') throw new HttpError(400, 'Role must be customer or admin.');
      if (targetIsBootstrapAdmin && (!allowedEmails.has(email) || role !== 'admin')) {
        throw new HttpError(400, 'The bootstrap administrator email and Admin role cannot be changed here.');
      }
      if (userId === authData.user.id && role !== 'admin') throw new HttpError(400, 'You cannot remove your own administrator role.');
      const {error} = await admin.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
        user_metadata: {...(target.user_metadata || {}), first_name: firstName, last_name: lastName, display_name: `${firstName} ${lastName}`},
        app_metadata: {...(target.app_metadata || {}), role}
      });
      if (error) throw new HttpError(400, error.message);
      return respond({success: true});
    }

    if (action === 'reset_password') {
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
      const {error} = await admin.auth.admin.updateUserById(userId, {password});
      if (error) throw new HttpError(400, error.message);
      return respond({success: true});
    }

    if (action === 'delete') {
      if (userId === authData.user.id) throw new HttpError(400, 'You cannot delete the account you are currently using.');
      if (targetIsBootstrapAdmin) throw new HttpError(400, 'The bootstrap administrator cannot be deleted here.');
      const {error} = await admin.auth.admin.deleteUser(userId);
      if (error) throw new HttpError(400, error.message);
      return respond({success: true});
    }

    throw new HttpError(400, 'Unknown user management action.');
  } catch (error) {
    if (error instanceof HttpError) return respond({error: error.message}, error.status);
    console.error('manage-users failed:', error);
    return respond({error: 'An unexpected error occurred while managing users.'}, 500);
  }
});
