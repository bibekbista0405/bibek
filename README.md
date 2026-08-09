# Bibek Bista — Portfolio

# EMAIL SETUP — START HERE

Your Hire Me form is fully wired up. The **only** thing left is pasting in
your Resend API key.

### Step 1 — Get a Resend account + API key

1. Go to https://resend.com and sign up (free tier is fine).
2. In the dashboard, go to **API Keys** → create a new key.
3. Copy it.

### Step 2 — Open the environment file

In this project folder, find `.env.example`.

### Step 3 — Make your own copy

Copy `.env.example` and rename the copy to `.env` (same folder).

```bash
cp .env.example .env
```

### Step 4 — Paste your key

Open `.env` and replace:

```
RESEND_API_KEY=PASTE_YOUR_RESEND_API_KEY_HERE
```

with your real key, e.g.:

```
RESEND_API_KEY=re_123abc456...
```

Save the file.

### Step 5 — Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, scroll to Hire Me, submit the form, and check
your inbox.

**You do not need to edit any other file.** `CONTACT_EMAIL_TO` and
`EMAIL_FROM` in `.env.example` are already set correctly for you.

---

## How local dev works (and why it's plain Node, not the Vercel CLI)

`npm run dev` runs `dev-server.js` — a small, dependency-free Node.js
server included in this project. It serves `index.html` and runs the
*exact same* `api/contact.js` handler that runs in production on Vercel,
so testing locally is a faithful preview of the real thing.

This project intentionally avoids using `vercel dev` for local
development. The Vercel CLI's zero-config detection repeatedly ran into
Windows-specific edge cases for this project's setup (a `dev` script
that shadows the CLI's own dev command, then a missing-output-directory
error once that was fixed) — so `dev-server.js` sidesteps the CLI
entirely for local testing. It has no effect on production: Vercel still
runs `api/contact.js` natively as a serverless function when you deploy.

## Important note about `EMAIL_FROM`

By default this project sends `from: onboarding@resend.dev`, which is
Resend's shared testing address — it works immediately with no setup, but
Resend restricts what testing-mode sending can do (e.g. it may limit
delivery to your own verified account address until you verify a domain).

For fully reliable delivery to **both** your Gmail addresses in
production, verify your own domain in Resend (**Domains** in their
dashboard — a few DNS records) and then update `EMAIL_FROM` to something
like:

```
EMAIL_FROM=Portfolio <hello@yourdomain.com>
```

This is optional to get started, but recommended before relying on this
for real recruiter emails.

## What this project is

A single Vercel project containing both your portfolio (static
HTML/CSS/JS — completely unchanged from your existing design, animations,
and creative Hire Me experience) and one small serverless function,
`api/contact.js`, that securely sends the form submission to Resend. They
deploy together, so the frontend calls its own `/api/contact` endpoint —
there's no separate backend URL to configure or connect.

```
Visitor
  ↓
Hire Me form (index.html)
  ↓
POST /api/contact          ← same project, same domain
  ↓
Validate + sanitize + rate-limit + honeypot check
  ↓
Resend API
  ↓
bibekbista0405@gmail.com  +  bibekbista009@gmail.com
```

Your API key (`RESEND_API_KEY`) only ever lives in `.env` (ignored by
git) or in Vercel's environment variable settings in production. It is
never in `index.html`, never in client-side JavaScript, and never sent
to the browser.

## Project structure

```
.
├── index.html          your portfolio — unchanged design/animations,
│                        Hire Me form posts to /api/contact
├── api/
│   └── contact.js       the handler: validates, sanitizes,
│                        rate-limits, and sends via Resend
├── dev-server.js         plain Node server for local testing only
├── package.json
├── vercel.json           pins this as a static + functions project
├── .env.example         copy this to .env and paste your key in
├── .gitignore            keeps .env out of GitHub
└── README.md             this file
```

## Local testing

```bash
npm install
npm run dev
```

Then either use the form in the browser at http://localhost:3000, or
test the endpoint directly:

```bash
curl -X POST http://localhost:3000/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","company":"Acme","role":"Frontend Intern","lookingFor":"An internship","message":"Just testing the contact form.","website":""}'
```

A successful response looks like `{"success":true}`, and both configured
inboxes should receive the email.

## Production deployment (Vercel)

```bash
npm run deploy
```

(or `vercel --prod` directly, or connect the GitHub repo to Vercel in
their dashboard for automatic deploys on push)

Then, in the Vercel dashboard → your project → **Settings → Environment
Variables**, add:

| Variable            | Value                                                        |
|---------------------|---------------------------------------------------------------|
| `RESEND_API_KEY`    | your real Resend API key                                      |
| `CONTACT_EMAIL_TO`  | `bibekbista0405@gmail.com,bibekbista009@gmail.com`             |
| `EMAIL_FROM`        | `onboarding@resend.dev`, or your verified domain address once set up |

Redeploy after adding/changing environment variables so they take effect.
Your `.env` file is never uploaded to GitHub or read in production —
Vercel's environment variables are the production equivalent of it.

`vercel.json` sets `"framework": null` and `"outputDirectory": "."` so
Vercel serves `index.html` directly from the project root (rather than
expecting a `public/` folder) and picks up `api/contact.js` automatically
as a serverless function — no build step needed for either.

## What happens on each test case

- **Valid submission** → email arrives in both inboxes.
- **Invalid email** → rejected with a 400, no email sent.
- **Empty message** → rejected.
- **Rapid duplicate submissions** (4+ from the same visitor within 10
  minutes) → the 4th gets a 429 "too many messages" response.
- **Very long message** (over 5000 characters) → rejected.
- **Mobile submission** → works the same as desktop, it's a normal
  `fetch()` request.
- **Reply-To** → open the email you received and hit Reply — it should
  address the visitor's submitted email, not your own.
- **API key exposure** → never happens; `RESEND_API_KEY` is read only
  inside `api/contact.js`, which runs on the server, not in the browser.

## Notes

- Rate limiting is best-effort and stored in memory inside the serverless
  function, so it resets on cold starts. It still catches rapid repeat
  submissions in the common case. For a hard guarantee across all
  instances, swap `submissionLog` in `api/contact.js` for a persistent
  store like Upstash Redis or Vercel KV.
- The honeypot field (`website`) is hidden from real visitors with CSS;
  if it's filled in, the submission is silently rejected — no "you're a
  bot" message is shown, so scripted spam doesn't learn the field exists.
