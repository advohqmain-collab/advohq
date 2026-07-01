# AdvoHQ — Backend

Production-grade backend for AdvoHQ: **Next.js 14** API routes deployed on **Vercel**, **Neon** serverless PostgreSQL, and **AWS S3** for file storage.

---

## Architecture

```
Browser (HTML files)
    │  fetch()
    ▼
Vercel Edge / Serverless Functions
    │  /api/auth/*        JWT auth (login, logout, refresh)
    │  /api/cases/*       Case CRUD + trash + annotations
    │  /api/events/*      Schedule events
    │  /api/files/*       Pre-signed S3 upload URLs
    ▼
Neon Postgres (serverless)        AWS S3 (file storage)
```

---

## Quick Start

### 1. Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| npm | 9+ |
| Vercel CLI | `npm i -g vercel` |
| AWS account | S3 bucket in `ap-south-1` (or your region) |
| Neon account | Free tier works: neon.tech |

---

### 2. Create the Neon Database

1. Go to **https://console.neon.tech** → New Project → name it `advohq`
2. Copy the **connection string** (it starts with `postgresql://`)
3. Open the **SQL Editor** in Neon console and run the entire contents of `sql/schema.sql`

---

### 3. Create the AWS S3 Bucket

```bash
# Using AWS CLI
aws s3api create-bucket \
  --bucket advohq-documents \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

# Block public access (files served via presigned URLs only)
aws s3api put-public-access-block \
  --bucket advohq-documents \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable server-side encryption
aws s3api put-bucket-encryption \
  --bucket advohq-documents \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

**Create IAM user** with this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::advohq-documents/*"
    }
  ]
}
```

---

### 4. Local Development

```bash
cd advohq-backend
npm install

# Copy env template and fill in your values
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL, JWT secrets, AWS keys

npm run dev
# → http://localhost:3000/api/...
```

---

### 5. Deploy to Vercel

```bash
# Login and link project
vercel login
vercel link       # creates .vercel/ folder

# Add secrets (one-time)
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add JWT_REFRESH_SECRET
vercel env add AWS_REGION
vercel env add AWS_ACCESS_KEY_ID
vercel env add AWS_SECRET_ACCESS_KEY
vercel env add S3_BUCKET_NAME
vercel env add ALLOWED_ORIGINS
vercel env add NEXT_PUBLIC_API_URL

# Deploy
vercel --prod
```

The API will be live at `https://your-project.vercel.app/api`.

---

### 6. Wire up the HTML frontend

Add these two tags to **every** AdvoHQ HTML page, just before `</body>`:

```html
<!-- Point to your deployed API -->
<script>window.ADVOHQ_API_URL = 'https://your-project.vercel.app/api';</script>
<script src="/api-client.js"></script>
```

Then in each page's `<script>`:

#### login2.html — replace the login button handler

```js
// BEFORE (localStorage, no real auth):
// onclick="window.location.href='advohq-home.html'"

// AFTER:
async function doLogin() {
  const username = document.querySelector('input[autocomplete="username"]').value;
  const password = document.querySelector('input[autocomplete="current-password"]').value;
  try {
    await AdvoAPI.auth.login(username, password);
    window.location.href = 'advohq-home.html';
  } catch (e) {
    alert(e.message);
  }
}
```

#### advohq-home.html — replace localStorage save/load

```js
// BEFORE:
// function save()    { localStorage.setItem('advohq_files', JSON.stringify({files,trash})); }
// function load()    { const d = JSON.parse(localStorage.getItem('advohq_files')||'{}'); ... }

// AFTER:
requireAuth(); // redirect to login if not authenticated

async function loadCases() {
  const { cases: active } = await AdvoAPI.cases.list();
  const { cases: trashed } = await AdvoAPI.cases.list({ trashed: true });
  files = active;
  trash = trashed;
  refresh();
}

async function saveCaseUpdate(id, changes) {
  await AdvoAPI.cases.update(id, changes);
}

// On page load:
loadCases();
```

#### advohq-schedule.html — replace hardcoded events

```js
requireAuth();

async function loadEvents() {
  const { events: evList } = await AdvoAPI.events.list();
  // map evList into your calendar render
}

async function saveScheduleEvent() {
  const data = { /* collect from form */ };
  await AdvoAPI.events.create(data);
  loadEvents();
}
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create account → access token + refresh cookie |
| `POST` | `/api/auth/login` | Login → access token + refresh cookie |
| `POST` | `/api/auth/logout` | Logout, revoke refresh token |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `GET`  | `/api/auth/me` | Current user profile |
| `GET`  | `/api/cases` | List cases (`?trashed`, `?search`, `?folder`) |
| `POST` | `/api/cases` | Create case |
| `GET`  | `/api/cases/:id` | Get single case |
| `PATCH`| `/api/cases/:id` | Update case fields |
| `DELETE`| `/api/cases/:id` | Trash (or hard-delete if trashed) |
| `GET`  | `/api/cases/:id/download` | Signed download URL |
| `GET`  | `/api/cases/:id/annotations` | List annotations |
| `POST` | `/api/cases/:id/annotations` | Add annotation |
| `GET`  | `/api/folders` | List folders (`?parent=<folderId>`, omit for root) |
| `POST` | `/api/folders` | Create folder |
| `GET`  | `/api/folders/:id` | Get single folder |
| `PATCH`| `/api/folders/:id` | Rename / move folder |
| `DELETE`| `/api/folders/:id` | Delete folder (subfolders cascade; cases inside move to root) |
| `GET`  | `/api/events` | List events (`?from`, `?to`, `?type`) |
| `POST` | `/api/events` | Create event |
| `PATCH`| `/api/events/:id` | Update event |
| `DELETE`| `/api/events/:id` | Delete event |
| `POST` | `/api/files/presigned` | Get S3 pre-signed upload URL |

All endpoints (except `/auth/login`) require `Authorization: Bearer <token>`.

---

## Security Notes

- Passwords are bcrypt-hashed (cost 12)
- Refresh tokens are stored as SHA-256 hashes (never plaintext)
- Refresh token rotation: every use issues a new token, invalidating the old one
- S3 files are private — accessible only via short-lived presigned URLs
- All S3 objects are AES-256 encrypted at rest
- CORS locked to `ALLOWED_ORIGINS`

---

## File Structure

```
advohq-backend/
├── app/api/
│   ├── auth/
│   │   ├── login/route.js
│   │   ├── logout/route.js
│   │   ├── refresh/route.js
│   │   ├── register/route.js
│   │   └── me/route.js
│   ├── cases/
│   │   ├── route.js                  (list + create)
│   │   └── [id]/
│   │       ├── route.js              (get + update + delete)
│   │       ├── download/route.js
│   │       └── annotations/route.js
│   ├── folders/
│   │   ├── route.js                  (list + create)
│   │   └── [id]/route.js             (get + rename/move + delete)
│   ├── events/
│   │   ├── route.js
│   │   └── [id]/route.js
│   └── files/
│       └── presigned/route.js
├── lib/
│   ├── db.js          (Neon Postgres)
│   ├── auth.js        (JWT + bcrypt)
│   ├── api.js         (response helpers, withAuth)
│   └── storage.js     (AWS S3)
├── public/
│   └── api-client.js  (drop into HTML pages)
├── sql/
│   └── schema.sql     (run once on Neon)
├── .env.example
├── next.config.js
├── package.json
└── vercel.json
```
