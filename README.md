# Twofold — Quotes & Invoices

A small app for two companies to each log in, create quotes/invoices, and download them as PDFs. Data is stored in Supabase (Postgres); the site is deployed on Vercel.

## What you need to do (step by step)

### 1. Create a Supabase project
1. Go to https://supabase.com → sign up / log in → **New project**.
2. Pick a name, a database password (save it somewhere), and a region close to you.
3. Wait ~2 minutes for it to finish provisioning.

### 2. Create the database tables
1. In your new project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase-schema.sql` from this project, copy all of it, paste it into the editor.
3. Click **Run**. You should see "Success. No rows returned."

### 3. Get your API keys
1. In Supabase, go to **Project Settings** (gear icon) → **API**.
2. Copy the **Project URL** and the **anon public** key. You'll need both next.

### 4. Put the code on GitHub
All the project files are flat (no subfolders) so this works from a phone browser without needing folder uploads:
1. Go to **github.com**, sign in (or create an account), tap **New repository**.
2. Name it (e.g. `twofold`), leave it empty (no README/gitignore), tap **Create repository**.
3. On the new repo's page, tap **Add file → Upload files**.
4. Select every file from this project folder (all of them, including `.gitignore` and `.env.example` — everything except `node_modules`, which doesn't exist yet anyway).
5. Scroll down, tap **Commit changes**.

### 5. Connect Vercel to that repo
- **If you already deployed this via Vercel Drop:** go to that existing project in your Vercel dashboard → **Settings → Git** → **Connect Git Repository** → pick the repo you just created. Vercel will redeploy from it, keeping your existing project and URL.
- **If this is your first deploy:** go to vercel.com → **Add New… → Project** → import the GitHub repo directly.

Either way, before (or right after) it deploys, go to **Settings → Environment Variables** and add:
- `VITE_SUPABASE_URL` = your Project URL
- `VITE_SUPABASE_ANON_KEY` = your anon public key

Then trigger a deploy (or **Deployments → ⋯ → Redeploy** if it already ran once without the keys).

### From now on
Any time you want to make a change: update the files in the GitHub repo (edit directly on github.com, or upload replacement files the same way as step 4), commit, and Vercel redeploys automatically to the same URL within a minute or two — no need to touch Vercel at all after this initial connection.

## Notes

- **Login is simple, not bulletproof.** See the security note at the top of `supabase-schema.sql` — the two-company separation is enforced by the app's UI, not by real authentication. Fine for keeping the two companies' day-to-day work apart; don't store highly sensitive data in it.
- **Adding a logo later:** once logged in, use "Edit logo" in the top bar.
- **Banking details:** set once per company under "Edit logo" (the same settings screen) — separate fields for Account Holder, Bank Name, Account Type, Branch Code, and Account Number, shown automatically on every quote and invoice.

