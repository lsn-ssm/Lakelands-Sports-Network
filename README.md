# LSN+ Deployment Guide

This folder has everything needed to get the Lakelands Sports Network site live with real
LSN+ subscriptions: the site itself (`index.html`), two small serverless functions that talk
to Stripe (`api/`), and the SQL to finish setting up Supabase.

Follow these steps in order.

## 1. Finish Supabase setup

You already created your Supabase project and a `profiles` table. Now run the trigger so a
profile row is created automatically every time someone signs up:

1. In Supabase, go to **SQL Editor** → New query.
2. Paste in the contents of `supabase-setup.sql` (in this folder) and run it.

## 2. Fill in the two placeholder values in `index.html`

Open `index.html` in a text editor and search for `SUPABASE_URL`. You'll find this near the
top of the `<script>` block:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace both with your real values from Supabase → Project Settings → API:
- `SUPABASE_URL` — the Project URL (e.g. `https://xxxxxxxx.supabase.co`)
- `SUPABASE_ANON_KEY` — the `anon` `public` key

These two are safe to have in the site's front-end code — they're meant to be public.
**Do not** put your Supabase `service_role` key or any Stripe secret key in this file — those
go in Vercel's environment variables instead (step 4), never in code that ships to the browser.

## 3. Create a GitHub repo and upload these files

1. Go to [github.com](https://github.com) and sign in (or create an account).
2. Click **New repository**. Name it something like `lsn-website`. Keep it private if you'd
   rather not have it public. Don't initialize it with a README — you're uploading your own files.
3. On the new repo's page, click **uploading an existing file**.
4. Drag in everything from this folder: `index.html`, the `api` folder, `package.json`, and
   `supabase-setup.sql` (that last one's just for your reference, but no harm including it).
5. Commit directly to the `main` branch.

## 4. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up with **Continue with GitHub** — this
   connects the two automatically.
2. Click **Add New... → Project**, and import the `lsn-website` repo you just created.
3. Before clicking Deploy, expand **Environment Variables** and add these (all as plain text,
   no quotes):

   | Name | Value | Where to find it |
   |---|---|---|
   | `STRIPE_SECRET_KEY` | `sk_test_...` | Stripe → Developers → API keys |
   | `STRIPE_PRICE_ID` | `price_...` | Stripe → Product Catalog → LSN+ → click the price |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_...` | You'll get this in step 5 below — add it after, then redeploy |
   | `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` | Supabase → Project Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase → Project Settings → API → `service_role` `secret` key |

   Leave `STRIPE_WEBHOOK_SECRET` blank for now if you don't have it yet — you'll add it in step 5.

4. Click **Deploy**. In a minute or two you'll get a live URL like `lsn-website.vercel.app`.

## 5. Point Stripe's webhook at your new site

1. In Stripe, go to **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://<your-vercel-url>/api/stripe-webhook`
3. Select these events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save it. Stripe will show you a **Signing secret** (starts with `whsec_`) — copy it.
5. Back in Vercel, go to your project → Settings → Environment Variables, and set
   `STRIPE_WEBHOOK_SECRET` to that value.
6. Redeploy (Vercel → Deployments → click the three dots on the latest deployment → Redeploy)
   so the function picks up the new variable.

## 6. Test it end-to-end (stay in Stripe Test mode for this)

1. Open your live site, go to the LSN+ page, sign up with a real email you can check.
2. Confirm your email if Supabase asks for it, then log back in.
3. Click **Join LSN+**. You should land on a real Stripe Checkout page.
4. Use a Stripe test card: `4242 4242 4242 4242`, any future expiry date, any CVC, any ZIP.
5. After paying, you should land back on the site. Refresh the LSN+ page — it should now show
   "✓ You're an LSN+ member."
6. In Supabase → Table Editor → `profiles`, confirm your row shows `subscription_status: trialing`
   (or `active`) and a `stripe_customer_id`.

If that all works, you're live in test mode. When you're ready to charge real cards: flip
Stripe out of Test mode, grab the **live** versions of `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`,
update those two in Vercel's environment variables, and repeat step 5 for a live-mode webhook
endpoint (test and live webhooks are separate).

## What's gated right now

Right now the only thing tied to LSN+ membership is the "Join LSN+" flow itself — the stat
leaderboards were moved to a free public Stats tab earlier, so there's no exclusive content
behind the paywall yet. `isPlusMember()` in the code is ready to gate anything you want to add
later (just wrap it in `if (isPlusMember()) { ... }`).
