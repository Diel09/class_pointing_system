# ClassPulse Production Launch Checklist & Runbook

Use this checklist to complete the external infrastructure, secrets, monitoring, and physical-device verification steps before rolling out to classrooms.

---

## 1. Generate Web Push VAPID Keys
Run the helper script locally to generate a fresh VAPID keypair:
```bash
npm run push:vapid
```
Copy the printed `publicKey` and `privateKey`.

---

## 2. Configure Production Environment Secrets on Vercel
In your **Vercel Project -> Settings -> Environment Variables** (Production & Preview), configure:

| Variable | Value / Notes |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL pooled URL (`?pgbouncer=true` on port `6543` for Supabase, or `-pooler` host for Neon) |
| `DIRECT_URL` | Direct session PostgreSQL URL (port `5432`) for `prisma db push` / migrations |
| `AUTH_SECRET` | `openssl rand -hex 32` (minimum 32 chars, unique per environment) |
| `DEVICE_PEPPER` | `openssl rand -hex 32` (minimum 32 chars, unique per environment) |
| `P2P_QR_SECRET` | `openssl rand -hex 32` (minimum 32 chars, unique per environment) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public key from `npm run push:vapid` |
| `VAPID_PRIVATE_KEY` | Private key from `npm run push:vapid` (keep server-only) |
| `VAPID_SUBJECT` | Contact URI, e.g. `mailto:support@yourdomain.edu` |

After adding variables, trigger a fresh Production deployment (`vercel --prod` or push to `main`).

---

## 3. Database Sync & Initial Admin Bootstrap
1. Run schema sync against your production `DIRECT_URL`:
   ```bash
   npx prisma db push
   ```
2. Verify `/api/health` returns `200 OK` with `{"status":"ok","db":"connected"}`.
3. Create your production `ADMIN` account (or run a production-safe bootstrap script without dev dummy students), then sign in at `/admin` to:
   - Create the active `AcademicTerm` (e.g., `1st Sem 2026-2027`).
   - Generate `TeacherInviteCode` values for faculty onboarding.

---

## 4. Automated Daily PostgreSQL Backups
- **Supabase:** Go to **Project Settings -> Database -> Backups** and verify Daily Backups (or Point-in-Time Recovery on Pro) are enabled.
- **Neon:** Confirm branch retention / automated snapshot schedule is active in the Neon Console.
- Run one manual test restore to a staging branch/database to confirm point-in-time recovery works.

---

## 5. Error Monitoring (Sentry)
1. Create a Next.js project in Sentry (`sentry.io`).
2. Add the Sentry Vercel integration (or set `SENTRY_DSN` and run `npx @sentry/wizard@latest -i nextjs`).
3. Verify test exception capture in Sentry Issues and set alert rules for `500` responses on `/api/attendance/check-in`, `/api/subjects/*/transfers`, and `/api/redemptions/*/review`.

---

## 6. Physical Android & iOS HTTPS Smoke Test
Mobile browsers require `https://` for Camera (`getUserMedia`), GPS (`navigator.geolocation`), Service Workers, and Web Push.

1. **PWA Installation & Push:**
   - **Android (Chrome):** Open production URL -> tap **Install App** banner (or Chrome menu -> *Install app*) -> open Notification Bell -> tap **Enable Push** -> allow notifications.
   - **iOS (Safari 16.4+):** Open production URL -> tap **Share** -> **Add to Home Screen** -> launch from Home Screen icon -> open Notification Bell -> tap **Enable Push** -> allow notifications.
2. **Classroom Attendance Test:**
   - Teacher starts an attendance session (`50m` radius) on phone/laptop.
   - Student inside the room scans the rotating QR -> confirms `PRESENT` + points credited + notification received.
   - Student >`100m` away (or using a screenshot >24s old) is rejected with `ERR_OUT_OF_RANGE` / `ERR_QR_EXPIRED_OR_INVALID`.
   - Second student logging into the same browser/device is blocked with `ERR_PROXY_DEVICE_CONFLICT` and logged in Admin Audit Logs.
3. **Economy & Class Standing Test:**
   - Student A scans Student B's P2P QR -> sends points -> Student B receives instant notification.
   - Student submits Score Boost redemption targeting an assessment -> Teacher approves -> Student's assessment bonus points and `1.00`/`1.25` standing update immediately.
