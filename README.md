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
2. Authentication > URL Configuration: set **Site URL** to your Vercel link, and add these **Redirect URLs**: your Vercel link (ending in `/`) and `http://127.0.0.1:5500/` (Live Server).
3. Sign-ups: "Allow new users to sign up" must be ON for the Create account button to work. If you would rather add people yourself, keep it OFF.
4. Email: Supabase's built-in email sender is only for testing. It sends to your own team address only and about 2 emails per hour, so confirmation and reset emails will not reach other people. Fix it by either
   - turning OFF "Confirm email" (Authentication > Sign In / Providers > Email) so new accounts work instantly with no email, and/or
   - setting up a custom SMTP sender (Authentication > SMTP Settings) so reset and confirmation emails reach anyone.
5. Open `config.js` and paste your Project URL and publishable (anon) key. Never use the secret / service_role key.
6. In Supabase SQL Editor, run the SQL in `supabase-audit-events.sql` to enable synced void and stock history.
7. Test locally with Live Server, then deploy.

If `config.js` still has the placeholder values, the sign-in page shows "Setup needed" and nobody can enter.

## Adding your items
Products > Import from Excel / CSV. The file needs a header row with a product name column and a selling price column.
Optional columns: purchase price, stock, category. Use "Download CSV template" to see the layout.

## Good to know
- Login controls who can open the app. Store data is saved locally and synced to Supabase for that account. Open the app on each device while online; open devices check for remote changes about once a minute.
- Log out keeps the data on the device; signing in again brings it back.
- Download a backup from Reports > Store and data regularly. Backups include sales, void history, and stock movements. Clearing browser data deletes the local copy.
- Sale voids require a reason, stay in Reports as history, and return stock. Stock history records sales, voids, restocks, imports, and manual stock edits.
- Works offline after the first visit; local changes sync when the device reconnects.
