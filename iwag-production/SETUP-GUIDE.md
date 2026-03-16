# ✦ I Walk Amongst Gods — Production Setup Guide

## What's in this folder

```
iwag-production/
├── index.html        ← Main app (with real auth + database)
├── login.html        ← Sign in / Sign up page
├── config.js         ← YOUR KEYS GO HERE
├── manifest.json     ← PWA config
├── sw.js             ← Service worker (offline support)
├── netlify.toml      ← Netlify settings (auto-configured)
├── icons/            ← App icons (all sizes, ready to go)
└── sql/
    └── setup.sql     ← Run this once in Supabase
```

---

## STEP 1 — Create your Supabase project (10 min)

1. Go to **supabase.com** → Sign up free
2. Click **"New Project"**
3. Name it: **iwalkamongstgods**
4. Set a database password (save it somewhere safe)
5. Choose region closest to you → Click **Create Project**
6. Wait ~2 minutes for it to spin up

---

## STEP 2 — Run the database setup (2 min)

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **"New query"**
3. Open the file `sql/setup.sql` from this folder
4. Copy the entire contents and paste into the SQL editor
5. Click **Run** (green button)
6. You should see: `Database setup complete! ✦`

This creates all your tables:
- profiles (user accounts)
- journal_entries
- saved_affirmations
- meditation_sessions
- tracks, video_sessions, courses (your CMS)
- community_posts

---

## STEP 3 — Get your Supabase keys (2 min)

1. In Supabase, click **Settings** (gear icon) → **API**
2. Copy **Project URL** (looks like `https://abcxyz.supabase.co`)
3. Copy **anon public** key (long string starting with `eyJ...`)

---

## STEP 4 — Add keys to config.js (1 min)

Open `config.js` in any text editor and replace:

```
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

With your actual values. Save the file.

---

## STEP 5 — Deploy to Netlify (5 min)

1. Go to **netlify.com** → Sign up free
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag and drop the entire **iwag-production folder** into the box
4. Wait 20 seconds → your site is live!
5. Click **"Site configuration"** → **"Change site name"** → type `iwalkamongstgods`
6. Your app is live at `https://iwalkamongstgods.netlify.app`

---

## STEP 6 — Connect your domain (15 min)

1. In Netlify → **Domain management** → **Add a domain**
2. Type `iwalkamongstgods.com` → Verify
3. Netlify gives you 2 nameserver addresses
4. Log into your domain registrar (GoDaddy, Namecheap etc.)
5. Replace nameservers with Netlify's ones
6. Wait 15–60 min → your app is live at iwalkamongstgods.com

---

## STEP 7 — Enable Google login (optional, 10 min)

1. Go to **console.cloud.google.com**
2. Create a new project → Enable Google OAuth
3. Get Client ID and Secret
4. In Supabase → **Authentication** → **Providers** → **Google**
5. Paste your Client ID and Secret → Enable

---

## STEP 8 — Enable email confirmations (2 min)

1. In Supabase → **Authentication** → **Email Templates**
2. Customise your welcome email with your branding
3. Under **Settings** → set your site URL to `https://iwalkamongstgods.com`

---

## What your users experience

| Action | What Happens |
|--------|-------------|
| Visit site | Beautiful app loads instantly |
| Click "Join Free" | Sign up form → email confirmation |
| Sign in | Dashboard shows their stats |
| Generate affirmations | 3/day free, unlimited for paid |
| Complete meditation | Saves to their profile automatically |
| Write in journal | Saved to cloud, accessible anywhere |
| Click "Join Divine" | Stripe checkout → $9.99/mo |
| Click "Join Annual" | Stripe checkout → $79/yr |
| Install on phone | PWA installs like a native app |

---

## Adding your real content

### Add real music tracks
1. Go to **Supabase** → **Table Editor** → **tracks**
2. Upload your MP3 to Cloudinary → copy the URL
3. Paste the URL into the `audio_url` field for each track

### Add real videos
1. Upload video to Cloudinary or YouTube (unlisted)
2. Go to **Table Editor** → **video_sessions**
3. Paste the URL into `video_url`

### Add affirmations
1. Go to **Table Editor** → **affirmations**
2. Add new rows with your text and category

### This is your CMS — no code needed ever again!

---

## Monthly costs

| Service | Cost |
|---------|------|
| Netlify | FREE |
| Supabase | FREE (up to 50,000 users) |
| Stripe | 2.9% + 30¢ per transaction only |
| Cloudinary | FREE up to 25GB |
| **Total** | **$0/month to start** |

---

## Need help?

Bring any questions or errors back to Claude and we'll solve them together.

✦ Built with divine intention for I Walk Amongst Gods ✦
