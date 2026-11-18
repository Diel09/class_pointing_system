# Development Planning Document (PLAN)
## Location-Verified Attendance, Gamified Pointing & Class Standing System

**Document Status:** Draft v1.0  
**Companion Documents:** [PRD.md](./PRD.md) | [TRD.md](./TRD.md)  
**Delivery Approach:** Phased Vertical Releases (Solo / AI-Assisted Builder, Milestone-Based)  
**Testing Strategy:** Inline Exit Gates per Phase + Final Hardening & Launch Phase  

---

## 1. Execution & Sequencing Strategy

This plan breaks development into **7 sequential phases** (Phase 0 through Phase 6) organized as **vertical slices**. Every feature phase delivers working backend APIs, database migrations, UI screens, and automated verification tests before moving forward.

### Key Architectural Sequencing Rules
1. **Early Mobile HTTPS Verification:** Because mobile browsers strictly block Camera (`getUserMedia`) and GPS (`navigator.geolocation`) on non-HTTPS local IP addresses, **Phase 0** sets up Vercel Preview deployments + Managed PostgreSQL immediately so real smartphones can test QR + GPS over HTTPS starting in **Phase 2**.
2. **Per-Subject Isolation First:** `SubjectEnrollment` serves as the foundational anchor for wallets, attendance, merits, transfers, redemptions, and grades from **Phase 1** onward.
3. **Cross-Cutting Dependencies:**
   - **Phase 4 (Redemptions)** depends on **Phase 3 (Ledger)** for point escrows/refunds and links to **Phase 5 (Assessments)** once assessment records exist (or introduces a clean Score Boost hook wired in Phase 5).
   - **Phase 5 (Grading Engine)** integrates Attendance (**Phase 2**) and Score Boosts (**Phase 4**) into live class standing.

### Effort Sizing Legend
- **S (Small):** Foundational setup or focused single-domain slice.
- **M (Medium):** Multi-endpoint feature slice with hardware/auth/UI integration.
- **L (Large):** Complex transactional or computation slice with concurrency/math edge cases.

---

## 2. Phase Overview & Dependency Map

```text
Phase 0: Setup, CI/CD & Vercel/DB Foundation [S]
   │
   ▼
Phase 1: Auth, RBAC, Device Token & Subject Onboarding [M]
   │
   ▼
Phase 2: QR + GPS Attendance Monitoring (MVP Milestone 1) [M]
   │
   ▼
Phase 3: Merit & Demerit System + Point Ledger [S]
   │
   ▼
Phase 4: GCash-Style P2P QR Sharing & Redemptions (Milestone 2) [L]
   │
   ▼
Phase 5: Assessments, Computation & 1.00 Standing (Milestone 3) [L]
   │
   ▼
Phase 6: PWA Polish, Web Push, Admin UI & Launch Readiness [M]
```

---

## 3. Detailed Development Phases

### Phase 0: Project Setup, CI/CD & Cloud Preview Foundation
**Effort:** S | **Depends on:** None  
**Goal:** Establish the Next.js TypeScript codebase, database connectivity, testing harness, and automatic HTTPS Vercel preview pipeline.

#### Deliverables & Tasks
- [ ] Initialize Next.js (App Router, TypeScript, strict mode) with Tailwind CSS and shadcn/ui component primitives.
- [ ] Install and configure core dependencies: `prisma`, `@prisma/client`, `zod`, `@tanstack/react-query`, `vitest`, `@playwright/test`.
- [ ] Provision Managed PostgreSQL (Neon or Supabase) with separate development & preview databases (`DATABASE_URL` pooled + `DIRECT_URL` for migrations).
- [ ] Configure Vercel project linked to Git repository for automatic HTTPS Preview Deployments on every branch/commit.
- [ ] Define `.env.example` and environment validation (`env.ts` via Zod) covering `AUTH_SECRET`, `DEVICE_PEPPER`, `P2P_QR_SECRET`, and `VAPID_*` placeholders.
- [ ] Implement `/api/health` endpoint verifying Next.js + PostgreSQL round-trip connectivity.
- [ ] Create base responsive App Shell layout (mobile bottom navigation bar + desktop sidebar layout).
- [ ] Configure GitHub Actions (or CI script) running `lint`, `typecheck`, `vitest`, and `next build`.

#### Exit Gate
- `npm run lint`, `npm run typecheck`, `npm run build`, and `vitest` pass cleanly.
- Vercel Preview URL loads over `https://` and `/api/health` returns `{ status: "ok", db: "connected" }`.

---

### Phase 1: Identity, RBAC, Device Token & Subject Management
**Effort:** M | **Depends on:** Phase 0  
**Goal:** Enable secure registration/login for Students, Teachers, and Admins, anti-proxy device registration, and teacher-led subject/roster management.

#### Deliverables & Tasks
- [ ] **Database Schema (Migration 1):** `User`, `TeacherInviteCode`, `AcademicTerm`, `Subject`, `SubjectEnrollment`, `AuditLog`.
- [ ] **Credentials Auth:** Implement `argon2id` password hashing, HTTP-only `Secure` signed session cookies (`sessionVersion` support), and endpoints for `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, and password reset tokens.
- [ ] **Teacher Gating & RBAC Middleware:**
  - Public signup defaults to `STUDENT`.
  - Teacher signup requires a valid `TeacherInviteCode` or creates a `PENDING` teacher account awaiting `ADMIN` approval.
  - Route guards enforcing `STUDENT`, `TEACHER` (subject ownership), and `ADMIN` access.
- [ ] **Persistent Device Token:** Implement `POST /api/device/register` issuing a signed HTTP-only `device_token` cookie mirrored in `IndexedDB` for Phase 2 anti-proxy checks.
- [ ] **Subject & Enrollment Management:**
  - Teacher Subject CRUD (code, title, section, academic term, archive toggle, unique class invite code + join QR).
  - Student Join Class flow (enter class code or scan class invite QR) + Teacher manual/CSV student roster enrollment & removal.
  - Automatic initialization of isolated `SubjectEnrollment` wallet (`availableBalance = 0`, `escrowedBalance = 0`) per subject.
- [ ] **Seed Script (`prisma/seed.ts`):** Seed 1 Admin, 2 Teachers, 10 Students, 1 Active Term, and 2 Subjects for rapid local/preview testing.

#### Exit Gate
- **Vitest Integration Tests:** Verify `STUDENT` cannot create subjects or hit teacher endpoints; verify `TEACHER` cannot mutate another teacher's subject; verify invalid teacher invite codes are rejected.
- **Manual Check:** Teacher creates a subject and generates an invite QR; student registers, scans/enters code, and sees their isolated subject dashboard (`0 pts`).

---

### Phase 2: Attendance Monitoring (Dynamic QR + Teacher-Device GPS)
**Effort:** M | **Depends on:** Phase 1  
**Milestone:** **Classroom MVP (Release 1)** — Usable in a live classroom for location-verified QR attendance.

#### Deliverables & Tasks
- [ ] **Database Schema (Migration 2):** `AttendanceSession`, `AttendanceRecord` (including partial unique constraint on `(sessionId, deviceHash)` for QR scans), and `PointLedgerEntry` (initial `ATTENDANCE` / `ATTENDANCE_ADJUSTMENT` types).
- [ ] **Teacher Attendance Session Flow:**
  - Start session UI capturing teacher browser GPS (`enableHighAccuracy: true`), allowing manual GPS anchor refresh, geofence radius (`15m–500m`), Present/Late time windows, and Present/Late point rewards.
  - Server-side `qrSecret` generation (never sent to clients) and `GET /api/sessions/[id]/live` returning HMAC time-bucketed QR payload (`10–15s` rotation) + live check-in roster (polled every `2–3s` while open).
  - Dynamic SVG QR display (`qrcode.react`) + Close Session action (marks remaining unchecked students `ABSENT`).
- [ ] **Student QR + GPS Check-In Flow:**
  - Mobile camera QR scanner (`html5-qrcode`) with pre-permission prompt and explicit error UI for denied permissions, low GPS accuracy (`>100m`), or offline status.
  - `POST /api/attendance/check-in`: Validates enrollment, session `OPEN`, HMAC token (`currentBucket` or `currentBucket - 1`), duplicate student check, `deviceHash` session uniqueness (logging `AuditLog` anomaly if violated), and Haversine geofence (`distance <= radius + min(accuracy, 25)`).
  - Atomic transaction recording `AttendanceRecord` (`PRESENT` or `LATE`), updating `availableBalance`, and appending `PointLedgerEntry`.
- [ ] **Teacher Manual Override:**
  - `PATCH /api/sessions/[id]/override` allowing teacher to change any student's status (`PRESENT`, `LATE`, `EXCUSED`, `ABSENT`) with reason, automatically crediting or reversing attendance points in the ledger.

#### Exit Gate
- **Vitest Unit Tests:** Haversine distance calculations, 25m accuracy cap, `>100m` rejection, and HMAC bucket + 1-tick grace window validation.
- **Vitest DB Integration Tests:** Confirm second account scanning from the same `deviceHash` in one session is blocked and logged; confirm manual override accurately adjusts `availableBalance` and `PointLedgerEntry`.
- **Real-Device HTTPS Test:** Test teacher phone + student phone over Vercel Preview URL in a real room (inside radius passes, outside radius rejects, screenshot of expired QR rejects).

---

### Phase 3: Merit & Demerit Pointing System + Immutable Ledger
**Effort:** S | **Depends on:** Phase 2  
**Goal:** Give teachers fast in-class tools to award merits and demerits, and give students transparent point history.

#### Deliverables & Tasks
- [ ] **Database Schema (Migration 3):** `MeritPreset` table + subject setting `allowNegativeBalance` enforcement.
- [ ] **Teacher Merit/Demerit Management:**
  - Subject Preset CRUD (`MERIT` / `DEMERIT`, point delta, label, description, archive).
  - Quick Award UI: Select preset or enter custom `+`/`-` value + note, select **one or multiple students** from the subject roster, and submit (`POST /api/subjects/[id]/merits`).
  - **Balance Floor Logic:** Atomic transaction clamps `availableBalance` at `0` by default when demerits exceed balance (recording full infraction in `note` and `AuditLog`), or allows negative balance if `subject.allowNegativeBalance === true`.
- [ ] **Student & Teacher Ledger Views:**
  - Student Subject Wallet header (`Available` vs `Pending/Escrowed` points) + paginated chronological `PointLedgerEntry` feed with filter by type (`Attendance`, `Merits`, `Demerits`, etc.).
  - Teacher Conduct/Point Log per student and per subject.

#### Exit Gate
- **Vitest Integration Tests:** Verify `0`-floor clamping vs negative-debt mode when `allowNegativeBalance` toggles; verify bulk awarding across 5 students creates 5 balanced ledger entries atomically.

---

### Phase 4: GCash-Style P2P QR Sharing & Teacher-Approved Redemptions
**Effort:** L | **Depends on:** Phase 3  
**Milestone:** **Full Gamified Economy (Release 2)** — Complete point earning, peer sharing, and teacher-approved spending loop.

#### Deliverables & Tasks
- [ ] **Database Schema (Migration 4):** `RewardItem`, `RedemptionRequest` (referencing optional `targetAssessmentId` nullable FK ready for Phase 5), plus subject P2P guardrail columns.
- [ ] **Part A — GCash-Style Peer-to-Peer QR Sharing:**
  - Teacher Subject Settings UI to toggle P2P transfers On/Off and set optional caps (`p2pMaxPerTransfer`, `p2pMaxPerDay`, `p2pMaxPerTerm`).
  - Student **Receive Points** screen generating signed subject-scoped QR (`GET /api/subjects/[id]/p2p-qr`) with optional requested amount & note.
  - Student **Send Points** scanner -> confirmation sheet showing verified classmate name, subject, amount, and note -> `POST /api/subjects/[id]/transfers`.
  - Server atomic transaction acquiring `FOR UPDATE` locks in ascending `enrollmentId` order, validating same-subject enrollment, positive balance, transfer caps, and creating paired `P2P_SEND` / `P2P_RECEIVE` ledger rows + instant digital receipt screen.
- [ ] **Part B — Reward Catalog & Point Redemptions (with Escrow):**
  - Teacher `RewardItem` CRUD (`SCORE_BOOST` conversion rate, eligible category rules, extra-credit toggle, max boost; `FIXED_PERK`; subject `allowOpenRedemptions` toggle).
  - Student **Spend Points** catalog & request form allowing student to select a reward (or custom request if enabled) and **specify target exam/activity or usage note**.
  - Submission moves points from `availableBalance` to `escrowedBalance` (`REDEMPTION_ESCROW`). Student can cancel while `PENDING` (`REDEMPTION_REFUND`).
  - Teacher **Pending Redemptions Queue** with **Approve** (`REDEMPTION_FINALIZE`) and **Reject** (`REDEMPTION_REFUND` + reason). *(Score Boost automatic score application hook prepared cleanly for Phase 5 assessment records.)*

#### Exit Gate
- **Vitest Concurrency & Integration Tests:**
  - Simultaneous opposing P2P transfers (`A -> B` and `B -> A`) complete with zero deadlocks.
  - Concurrent redemption requests exceeding `availableBalance` allow only valid request(s) and reject the rest with zero negative balance leaks.
  - Cross-subject QR scan and exceeding daily/term P2P limits are rejected cleanly.
  - Rejection and student cancellation accurately restore `availableBalance` from `escrowedBalance`.

---

### Phase 5: Assessments (No-Submission), Computation Engine & Class Standing
**Effort:** L | **Depends on:** Phase 4  
**Milestone:** **Complete Core System (Release 3)** — Full academic gradebook, custom computation, and `1.00`/`1.25` class standing.

#### Deliverables & Tasks
- [ ] **Database Schema (Migration 5):** `GradeCategory`, `Assessment`, `AssessmentScore`, `GradeScaleRule` (plus FK wiring from `RedemptionRequest.targetAssessmentId -> Assessment`).
- [ ] **Subject Computation & Grade Scale Setup (Teacher):**
  - Computation Builder UI: Add/edit weighted `GradeCategory` items (`ASSESSMENT`, `ATTENDANCE`, optional `POINTS_PARTICIPATION`), enforce 100% weight validation, choose `TOTAL_POINTS` vs `EQUAL_AVERAGE`, configure Late attendance credit %, and optional Multi-Term split (e.g., Midterm 40% / Finals 60%).
  - Grade Scale Table Editor: Pre-filled Philippine collegiate scale (`1.00` to `5.00`), customizable min/max percentage ranges and labels, validated for zero gaps or overlaps.
  - Subject Visibility Toggle (`standingVisible`) + per-student manual status override (`NONE` / `INC` / `DRP`).
- [ ] **Assessments & Teacher-Only Score Entry:**
  - Teacher Assessment CRUD (title, category, term, max score, date, description).
  - Fast Class Score Grid UI (plus CSV score import) supporting `PENDING`, `GRADED`, `MISSING` (`0`), and `EXCUSED` statuses + teacher remarks.
  - **Student Assessment View (Strictly Read-Only):** Displays details, max score, status, raw score, applied point boost, and remarks — **zero upload/submission controls**.
- [ ] **Deterministic Standing Engine (`lib/grading/computeStanding.ts`):**
  - Implement weighted calculation, active-category re-normalization for running standing, attendance rate computation, and grade equivalent lookup.
  - Wire Phase 4 **Redemption Approval** (`SCORE_BOOST`) so approving a student's boost request automatically increments `AssessmentScore.bonusPoints` (respecting `allowExtraCredit` vs `maxScore` cap) and updates standing.
- [ ] **Student Class Standing Dashboard:**
  - Displays current grade equivalent (e.g., `1.25`), status badge, running percentage, category breakdown, boosted score indicators, and "Grades Hidden by Teacher" state when `standingVisible === false`.

#### Exit Gate
- **Vitest Unit Tests (`computeStanding.ts`):** Verify `Pending` exclusion, `Missing (0)` penalty, `Excused` denominator exclusion, active-weight re-normalization, `maxScore` cap vs extra credit, multi-term rollup, and exact boundary mappings (`96.99%` vs `97.00%`).
- **Vitest Integration Tests:** Verify approving a Score Boost redemption targeting an assessment updates `bonusPoints`, `PointLedgerEntry`, and computed standing in one atomic workflow; verify students have zero endpoints or UI to submit files/answers to assessments.

---

### Phase 6: PWA Polish, Web Push Notifications, Admin UI & Production Launch
**Effort:** M | **Depends on:** Phase 5  
**Goal:** Finalize installable PWA experience, background push alerts, admin oversight tools, full E2E verification, and production readiness.

#### Deliverables & Tasks
- [ ] **PWA & Offline Guardrails:**
  - Integrate `@serwist/next` Service Worker + `manifest.webmanifest` + app icons (`192x192`, `512x512`, maskable).
  - Add install-to-home-screen banner (including iOS Safari Web Push installation instructions).
  - Implement explicit `NetworkOnly` handling & clear offline state banners on QR attendance, P2P scan, and redemption screens.
- [ ] **Notifications & Web Push (`web-push` VAPID):**
  - **Database Schema (Migration 6):** `PushSubscription`, `Notification`.
  - Implement In-App Notification Center (bell icon, unread badge, mark-as-read) + VAPID push subscription flow (`POST /api/push/subscribe`).
  - Wire notification triggers for: attendance check-in/override, merit/demerit received, P2P transfer received, redemption submitted/approved/rejected, and new/updated assessment scores.
- [ ] **Admin Oversight Dashboard:**
  - Manage `TeacherInviteCode` generation, pending Teacher account approvals, `AcademicTerm` management, and searchable `AuditLog` viewer.
- [ ] **Full Playwright E2E Test Suite:**
  - Mobile (`390x844`) & Desktop (`1280x800`) critical paths:
    1. Teacher onboarding -> Subject creation -> Student join.
    2. Attendance session -> Mocked geolocation check-in -> Manual override.
    3. Merit/demerit + GCash-style P2P QR transfer.
    4. Assessment score entry -> Student redemption targeting exam -> Teacher approval -> Student views updated `1.00`/`1.25` standing.
- [ ] **Production Launch Checklist:**
  - Run Lighthouse PWA & Accessibility audit.
  - Configure production secrets on Vercel, enable automated daily PostgreSQL backups, set up error monitoring (e.g., Sentry), and execute final smoke test on production URL with physical Android & iOS devices.

#### Exit Gate
- 100% of Vitest unit/integration tests and Playwright E2E specs pass in CI.
- Lighthouse PWA & Accessibility checks pass with zero critical blockers.
- Production smoke test verified end-to-end on physical mobile devices.

---

## 4. Risk Register & Mitigations

| Risk | Impact | Mitigation Built Into Plan |
|---|---|---|
| **Mobile browsers block Camera/GPS on non-HTTPS local IPs** | Blocks testing of Phase 2 on phones | Cloud Vercel Preview HTTPS configured in **Phase 0** before any hardware code is written. |
| **Indoor GPS drift causes false absences** | Poor classroom UX | Capped `25m` accuracy buffer + instant teacher manual override built in **Phase 2**. |
| **Race conditions / double-spending on P2P or Redemptions** | Corrupted point economy | Row-level `FOR UPDATE` locks (sorted UUID order) + `escrowedBalance` + concurrency Vitest suite in **Phase 4**. |
| **Grade formula confusion / unexpected `5.00` early in term** | Student panic / teacher support load | Active-weight re-normalization + explicit `Pending` vs `Missing (0)` + exhaustive unit test matrix in **Phase 5**. |
| **iOS Safari Web Push limitations (requires Home Screen install)** | Missed alerts on iOS | Universal In-App Notification Center + non-intrusive iOS install prompt in **Phase 6**. |
