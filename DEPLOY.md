# Deploy ClearPort Lite for free (Vercel + Neon)

This puts the prototype online at no cost, without a credit card:

| Part | Where | How it runs |
|---|---|---|
| Web app | Vercel | Static files on Vercel's CDN |
| Backend | Vercel | The whole API as **one** serverless function (the same app as `npm run dev`). It wakes in about a second and costs nothing when idle. |
| Database | Neon | Postgres 16, free plan (0.5 GB). Uploaded files are stored here too. |

Staff sign in with **demouser / Demo@123**. Customer pages (`/track`, approval, driver and portal links) need no sign-in.

The online database starts **fresh**: the demo user, the agency (Batinah Gate, OMR), the workflow, ports, shipping lines, fee types, staff and trucks. There are no customers or jobs; create the first job in the app.

> Vercel's free (Hobby) plan is for non-commercial use, which suits a prototype. Before real customers rely on it, move to a paid plan or to AWS (the per-function Lambda bundles are already in `apps/api/dist` after `npm run build`).

Allow about 15 minutes.

## 1. Database (Neon)

1. Sign up at **neon.tech** (GitHub sign-in works; no card).
2. **Create project**:
   - Name: `clearport`
   - Postgres version: **16**
   - Region: **AWS Europe Central 1 (Frankfurt)**, the closest to Oman. The backend runs there too.
3. On the project dashboard, open **Connect**, tick **Connection pooling**, and copy the connection string. It looks like:
   `postgresql://neondb_owner:…@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. From this repo on your computer, create the tables and the base data (once):

   ```bash
   DATABASE_URL='<the pooled connection string>' npm run db:setup:remote
   ```

   You should see `applied 0001…` to `applied 0008…`, then `Seeded: demo user (sign in as demouser)…`.
   To use a different password than `Demo@123`, add `SEED_DEMO_PASSWORD='…'` before the command.

## 2. Code on GitHub

Push this repository to GitHub (a private repository is fine).

## 3. App (Vercel)

1. Sign up at **vercel.com** with GitHub (Hobby plan; no card).
2. **Add New… → Project**, then **Import** the repository.
3. Leave **Root Directory** as the repository root. `vercel.json` already sets the install and build commands, so leave Framework Preset as **Other** and the build settings untouched.
4. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the pooled Neon connection string from step 1 |
   | `DB_POOL_MAX` | `1` |
   | `FILE_STORE` | `db` |
   | `SESSION_SECRET` | a long random string: run `openssl rand -base64 32` |
   | `TRACK_SECRET` | another long random string (run it again) |
   | `NODE_ENV` | `production` |
   | `PUBLIC_APP_URL` | `https://<your-project>.vercel.app` (you can set this after the first deploy shows the address, then redeploy) |

5. Click **Deploy**. The build takes about 2 minutes.
6. In **Settings → General → Node.js Version**, check it says **22.x**.

## 4. Check it

- Open `https://<your-project>.vercel.app`. You land on **Sign in**; sign in as `demouser` / `Demo@123`.
- Home shows zero jobs. Create the first job (the customer can be created in step 1 of the wizard).
- Open `https://<your-project>.vercel.app/track` in a private window and enter that customer's mobile number.
- `https://<your-project>.vercel.app/api/health` returns `{"ok":true}`.
- In the app, **Settings → Company**: set your agency's name, WhatsApp, phone and email (shown on the tracking page).

## Updating

Every push to the main branch redeploys automatically. When a change adds a database migration (`db/migrations-lite/000N_….sql`), run it against Neon first:

```bash
DATABASE_URL='<pooled url>' npm run db:migrate
```

## Try the hosted build on your computer

```bash
npm run build:vercel   # writes .vercel/output: the web app (static/) and the API function (functions/api.func/)
```

Vercel runs the same command during a deploy. For day-to-day work keep using `npm run dev`.

## Limits to know

- **Neon free:** 0.5 GB. Uploads are stored in the database, so keep demo files small (the app caps each at 4 MB).
- **Neon sleeps** after 5 minutes idle; the first request after that takes about a second longer.
- **One shared login.** Anyone with the password sees everything. Real accounts and roles come later.
- **Rate limits** on sign-in and on the tracking lookup are per function instance. Add Vercel Firewall rules or move to API Gateway for stricter limits.
