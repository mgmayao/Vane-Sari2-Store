# Vane Hams Store POS

A phone/tablet-friendly point of sale for a sari-sari store. No server, no build step: it is plain static files.

## Deploy on Vercel

**Option A: GitHub (recommended)**
1. Create a new GitHub repository and upload every file in this folder.
2. In Vercel: Add New > Project > import that repository.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty. Click Deploy.

**Option B: Vercel CLI**
```
npm i -g vercel
cd vane-hams-pos
vercel --prod
```

Open the Vercel link on your phone, then use "Add to Home Screen" so it opens like an app.

## Login setup (do this before deploying)
The app opens on a sign-in page with Create account and Forgot password. It needs a free Supabase project:
1. Create the project (supabase.com). Then go to Authentication and create your own user (Users > Add user, tick Auto Confirm).
2. Authentication > URL Configuration: set **Site URL** to `https://vane-sari2-store.vercel.app/`, and add it to **Redirect URLs**. You may also allow `http://127.0.0.1:5500/` for Live Server, but public signup confirmation and password reset links always redirect to the live Vercel app.
3. Sign-ups: "Allow new users to sign up" must be ON for the Create account button to work. If you would rather add people yourself, keep it OFF.
4. Email: Supabase's built-in email sender has a very low rate limit and is only for testing. Repeated account-creation attempts can hit the confirmation-email limit. For public customer signups, configure a custom SMTP provider under Authentication > SMTP Settings. Alternatively, turn OFF "Confirm email" under Authentication > Sign In / Providers > Email if you want accounts activated immediately without email verification.
5. Open `config.js` and paste your Project URL and publishable (anon) key. Never use the secret / service_role key.
6. In Supabase SQL Editor, run the SQL in `supabase-audit-events.sql` to enable synced void and stock history.
7. To enable user management and customer orders, run `supabase-customer-orders.sql` in the Supabase SQL Editor, then link the Supabase CLI to this project and deploy both Edge Functions:
   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set ADMIN_EMAILS=vanessalumawag404@gmail.com
   supabase functions deploy manage-users
   supabase functions deploy customer-orders
   ```
   `vanessalumawag404@gmail.com` is the built-in bootstrap administrator; set `ADMIN_EMAILS` to that address and any other administrator email addresses. The bootstrap admin must already exist in Supabase Authentication and sign in with that email. Public signups collect first and last name and receive the Customer role automatically; only admins can create or promote Admin accounts. Customer accounts browse available items from this administrator's synced product catalog and choose Cash, Utang, or E-wallet when placing an order. E-wallet checkout offers Metrobank, GCash, or MariBank; it shows the supplied bank QR or GCash account image and asks the customer to submit the payment request after paying. Admins must verify an E-wallet transfer before confirming; confirmation marks it paid and reduces stock. The customer receives an in-app thank-you prompt; Utang orders explain the 15th and 30th payment dates. After an admin confirms an Utang order, the customer sees an in-app reminder on the 15th and 30th (month-end in months without a 30th) while it remains unpaid. Reminders are checked when the customer opens the app and while it is open; if the app is closed on a reminder date, it shows the pending reminder next time the customer opens it. Requests appear in Admin Dashboard > Orders with the selected payment type. Confirming a request atomically records the sale, updates stock and stock history, and marks cash/E-wallet orders paid or utang orders unpaid. Both functions use Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY`; never add that key to `config.js` or browser code. Keep JWT verification enabled when deploying the functions.
8. To enable browser push notifications for Utang due dates, run `supabase-utang-push.sql` in the SQL Editor after the customer-orders setup. Set the server-only secrets for the `utang-push-reminders` function: `CRON_SECRET` (a unique random value), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` contact address). Generate a VAPID key pair with `npx web-push generate-vapid-keys`; keep the private key only in Supabase secrets. Add the matching public key to `PUSH_PUBLIC_KEY` in `index.html`, then deploy the push job without gateway JWT verification (the job validates its own `CRON_SECRET`):
   ```
   supabase secrets set CRON_SECRET=your-random-secret VAPID_PUBLIC_KEY=your-public-key VAPID_PRIVATE_KEY=your-private-key VAPID_SUBJECT=mailto:you@example.com
   supabase functions deploy utang-push-reminders --no-verify-jwt
   ```
   The SQL schedules hourly checks. Notifications are sent on the 15th and 30th (or the last day of a shorter month) to subscribed customer devices with confirmed unpaid Utang. Customers must sign in on the deployed HTTPS site and press **Enable bill reminders**, then allow notifications in their browser. Browser/OS notification settings must also permit them.
9. Test locally with Live Server, then deploy.

If `config.js` still has the placeholder values, the sign-in page shows "Setup needed" and nobody can enter.

## Adding your items
Products > Import from Excel / CSV. The file needs a header row with a product name column and a selling price column.
Optional columns: purchase price, stock, category. Use "Download CSV template" to see the layout.

## Good to know
- Login controls who can open the app. Store data is saved locally and synced to Supabase for that account. Open the app on each device while online; open devices check for remote changes about once a minute.
- Open **Admin Dashboard** from the POS header to access the store Dashboard overview, Products, Utang, Reports, customer Orders, and (for configured admins) Users in one sidebar. Customers see the shared product catalog in Sell, can review the cart total, and submit a Cash, Utang, or E-wallet order request. The separate **My purchases** tab beside Sell shows each submitted order's date, products, total, payment type, and review/payment status, plus a combined total for orders awaiting review; it can be refreshed from that screen. E-wallet options are Metrobank, GCash, and MariBank; the QR/account image is shown before the customer submits. Admins verify E-wallet transfers before confirming them as paid and reducing stock. The customer gets an in-app thank-you prompt after submitting; confirmed unpaid Utang orders are included in in-app reminders on the 15th and 30th, and can receive browser push reminders even when the app is closed after enabling notifications on that device. Cash and verified E-wallet sales are marked paid; Utang remains unpaid. The Users module can add accounts with first name, last name, email, password, and Customer/Admin role, and can edit, reset passwords, or delete accounts. Use **Back to POS** in that sidebar to return to selling; the POS header keeps an **Admin Dashboard** shortcut so you can return at any time. The bootstrap admin cannot be demoted or deleted in the dashboard. Password resets set a password directly, so share temporary passwords securely.
- Log out keeps the data on the device; signing in again brings it back.
- Download a backup from Reports > Store and data regularly. Backups include sales, void history, and stock movements. Clearing browser data deletes the local copy.
- Sale voids require a reason, stay in Reports as history, and return stock. Stock history records sales, voids, restocks, imports, and manual stock edits.
- Works offline after the first visit; local changes sync when the device reconnects.
