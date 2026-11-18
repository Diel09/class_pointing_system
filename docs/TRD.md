# Technical Requirements Document (TRD)
## Location-Verified Attendance, Gamified Pointing & Class Standing System

**Document Status:** Draft v1.0  
**Companion Document:** [PRD.md](./PRD.md)  
**Target Stack:** Next.js (App Router, TypeScript) + Tailwind CSS + PostgreSQL + Prisma ORM  

---

## 1. Architecture Overview

The system is architected as a **unified full-stack Next.js (App Router) Progressive Web App (PWA)** deployed on **Vercel** with a managed **PostgreSQL** database (Neon or Supabase) accessed via **Prisma ORM**.

### 1.1 High-Level System Diagram

```text
+-------------------------------------------------------------------+
|                   Client Browser / Installed PWA                  |
|  - Next.js App Router (React + TypeScript + Tailwind CSS)         |
|  - Service Worker (@serwist/next): App Shell + Web Push (VAPID)   |
|  - TanStack Query: Adaptive polling (2-3s on active QR/rosters)   |
|  - Browser APIs: getUserMedia (QR Scanner), Geolocation API       |
+---------------------------------+---------------------------------+
                                  | HTTPS (REST / Server Actions)
                                  v
+-------------------------------------------------------------------+
|                Vercel Serverless Functions (Next.js)              |
|  - Auth & RBAC Middleware (HTTP-only signed session + device cookie)|
|  - Zod Input Validation Layer                                     |
|  - Attendance Engine (HMAC Rotating QR + Haversine Geofencing)    |
|  - Atomic Ledger Engine (Serializable / Row-Locked Transactions)  |
|  - Deterministic Grade & Standing Engine                          |
|  - Web Push Dispatcher (web-push VAPID)                           |
+---------------------------------+---------------------------------+
                                  | Pooled Connection (PgBouncer/Neon)
                                  v
+-------------------------------------------------------------------+
|                   Managed PostgreSQL Database                     |
|  - Relational Tables + ACID Transactions + Unique Constraints     |
|  - Append-Only PointLedgerEntry + AuditLog                        |
+-------------------------------------------------------------------+
```

---

## 2. Technology Stack & Tooling

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | Next.js 15+ (App Router, TypeScript) | Unified full-stack React UI + secure backend Route Handlers/Server Actions. |
| **Styling & UI** | Tailwind CSS + shadcn/ui (Radix primitives) | Accessible, mobile-first responsive components for classroom & desktop gradebook views. |
| **State & Data Fetching** | TanStack Query (React Query) | Clean cache invalidation and adaptive short-interval polling on live attendance screens. |
| **Database** | Managed PostgreSQL (Neon or Supabase) | Strict ACID transactions, row-level locking, and relational integrity for financial-style point ledgers. |
| **ORM & Migrations** | Prisma ORM (`@prisma/client`) | Declarative schema, type-safe queries, transactional locks, and reproducible migrations. |
| **Validation** | Zod | Shared runtime schema validation across API routes and client forms. |
| **Authentication** | Credentials Auth (Argon2id + HTTP-only JWT/DB Session) | Self-contained institutional/email/ID login with zero third-party OAuth dependency. |
| **QR Generation & Scanning** | `qrcode` / `qrcode.react` + `html5-qrcode` (or `@zxing/browser`) | Reliable SVG QR rendering and cross-browser mobile camera scanning. |
| **PWA & Push** | `@serwist/next` + `web-push` (VAPID) | App installability, Service Worker asset caching, and native Web Push notifications. |
| **Testing** | Vitest (unit & API/DB integration) + Playwright (E2E) | Full coverage of ledger atomicity, grade math, geofence math, and core user flows. |
| **Hosting** | Vercel + Neon/Supabase | Automatic TLS/HTTPS (strictly required by browsers for Camera & GPS APIs). |

---

## 3. Authentication, Authorization & Security

### 3.1 Credentials Authentication
- **Login Identifiers:** Users log in using **Email** or **Institutional ID** (`student_number` / `employee_id`) + **Password**.
- **Password Hashing:** `argon2` (`argon2id` variant) with per-user cryptographic salt.
- **Session Management:**
  - Encrypted/signed **HTTP-only, `Secure`, `SameSite=Lax`** session cookies containing `session_id` / `user_id` + `role` + `session_version` (incremented on password change or admin revocation).
  - Password reset flow using single-use, hashed, time-limited tokens stored in PostgreSQL (delivered via transactional email provider such as Resend/SMTP, or admin-assisted reset in institutional deployments).

### 3.2 Role-Based Access Control (RBAC) & Teacher Gating
- **Roles:** `STUDENT`, `TEACHER`, `ADMIN`.
- **Teacher Account Gating:**
  - Public registration defaults strictly to `STUDENT`.
  - Registering as `TEACHER` requires a valid **Admin-issued Teacher Invite Code** (single-use or quota-limited) OR enters a `PENDING_VERIFICATION` state requiring `ADMIN` approval before the user can create subjects or attendance sessions.
- **Server-Side Enforcement:**
  - Every API route / Server Action verifies session validity, role, and **resource ownership/enrollment**:
    - Teachers can only mutate subjects they own (`subject.teacherId === user.id`).
    - Students can only read their own grades, ledger, and enrollments (`enrollment.studentId === user.id`).
    - Admins have read access to oversight/audit endpoints and account/term management.

### 3.3 Anti-Proxy Device Token
To enforce **"1 physical device per attendance session"**:
1. On first visit or login, if the browser lacks a valid `device_token` HTTP-only cookie (and matching `IndexedDB` mirror), the server issues a cryptographically random `device_id` signed via HMAC.
2. When a student submits an attendance QR scan, the server computes `deviceHash = SHA256(device_id + SERVER_PEPPER)`.
3. The database enforces a `UNIQUE (sessionId, deviceHash)` constraint on `AttendanceRecord` (when `checkInMethod === 'QR_SCAN'`).
4. If a second student account logs into the same browser/device and scans the same session, the server **blocks the check-in** and creates an `AuditLog` anomaly entry visible to the teacher (who may still manually override if legitimate, e.g., a student genuinely lent a device).

---

## 4. Database Schema & Ledger Architecture

### 4.1 Core Entity-Relationship Model (Prisma Conceptual Schema)

#### Users & Academic Terms
- **`User`**: `id (UUID)`, `email (unique)`, `institutionalId (unique, nullable)`, `passwordHash`, `fullName`, `role (STUDENT | TEACHER | ADMIN)`, `status (ACTIVE | PENDING | SUSPENDED)`, `sessionVersion`, `createdAt`
- **`TeacherInviteCode`**: `id`, `codeHash`, `maxUses`, `usedCount`, `expiresAt`, `createdByAdminId`
- **`AcademicTerm`**: `id`, `name` (e.g., `"1st Sem 2026-2027"`), `startDate`, `endDate`, `isActive`

#### Subjects & Enrollments (Per-Subject Wallet Isolation)
- **`Subject`**:
  - `id (UUID)`, `teacherId -> User`, `termId -> AcademicTerm`
  - `code`, `title`, `section`, `inviteCode (unique)`, `isArchived`
  - **Point & Economy Settings:** `allowNegativeBalance (bool, default false)`, `allowP2pTransfers (bool, default true)`, `p2pMaxPerTransfer (int?)`, `p2pMaxPerDay (int?)`, `p2pMaxPerTerm (int?)`, `allowOpenRedemptions (bool, default false)`
  - **Grading Settings:** `standingVisible (bool, default true)`, `lateAttendanceCreditPct (decimal, default 50)`, `termSplitConfig (JSONB)`
- **`SubjectEnrollment`**:
  - `id (UUID)`, `subjectId -> Subject`, `studentId -> User`
  - `availableBalance (int, default 0)`
  - `escrowedBalance (int, default 0)`
  - `manualStandingOverride (enum: NONE | INC | DRP)`
  - `enrolledAt`
  - `UNIQUE (subjectId, studentId)`

#### Attendance
- **`AttendanceSession`**:
  - `id (UUID)`, `subjectId -> Subject`, `teacherId -> User`
  - `status (OPEN | CLOSED)`
  - `teacherLat (decimal 9,6)`, `teacherLng (decimal 9,6)`, `teacherAccuracyM (float)`
  - `radiusMeters (int)`
  - `qrSecret (text, server-only — NEVER serialized to clients)`
  - `qrRotationSeconds (int, default 12)`
  - `startedAt`, `presentCutoffAt`, `lateCutoffAt`, `closedAt`
  - `presentPoints (int)`, `latePoints (int)`
- **`AttendanceRecord`**:
  - `id (UUID)`, `sessionId -> AttendanceSession`, `enrollmentId -> SubjectEnrollment`
  - `status (PRESENT | LATE | ABSENT | EXCUSED)`
  - `checkInMethod (QR_SCAN | TEACHER_OVERRIDE)`
  - `studentLat (decimal 9,6?)`, `studentLng (decimal 9,6?)`, `studentAccuracyM (float?)`, `distanceMeters (float?)`
  - `deviceHash (text?)`, `pointsAwarded (int)`
  - `overriddenByTeacherId (UUID?)`, `overrideReason (text?)`, `recordedAt`
  - `UNIQUE (sessionId, enrollmentId)`
  - `PARTIAL UNIQUE (sessionId, deviceHash) WHERE checkInMethod = 'QR_SCAN' AND deviceHash IS NOT NULL`

#### Point Economy (Merits, Demerits, P2P, Redemptions)
- **`MeritPreset`**: `id`, `subjectId -> Subject`, `name`, `type (MERIT | DEMERIT)`, `pointsDelta (int)`, `description`, `isArchived`
- **`RewardItem`**:
  - `id`, `subjectId -> Subject`, `name`, `description`
  - `rewardType (SCORE_BOOST | FIXED_PERK)`
  - `pointCostPerUnit (int)` (e.g., `10` pts per `+1` assessment score, or flat cost for perk)
  - `scoreValuePerUnit (decimal, default 1)`
  - `eligibleCategoryIds (UUID[]?)`, `allowExtraCredit (bool, default false)`, `maxBoostPerAssessment (decimal?)`
  - `isActive`
- **`RedemptionRequest`**:
  - `id`, `subjectId`, `enrollmentId -> SubjectEnrollment`, `rewardItemId -> RewardItem?`
  - `isCustomRequest (bool)`, `targetAssessmentId -> Assessment?`
  - `pointsEscrowed (int)`, `requestedUnits (int)`, `studentNote (text?)`
  - `status (PENDING | APPROVED | REJECTED | CANCELLED)`
  - `reviewedByTeacherId -> User?`, `teacherNote (text?)`, `reviewedAt`
  - `createdAt`
- **`PointLedgerEntry`** *(Append-only immutable ledger)*:
  - `id (UUID)`, `enrollmentId -> SubjectEnrollment`, `subjectId`
  - `entryType (ATTENDANCE | ATTENDANCE_ADJUSTMENT | MERIT | DEMERIT | P2P_SEND | P2P_RECEIVE | REDEMPTION_ESCROW | REDEMPTION_REFUND | REDEMPTION_FINALIZE)`
  - `availableDelta (int)`, `escrowDelta (int)`
  - `availableAfter (int)`, `escrowAfter (int)`
  - `referenceType (text)`, `referenceId (UUID)`, `note (text?)`, `actorUserId -> User`, `createdAt`

#### Assessments & Grade Computation
- **`GradeCategory`**:
  - `id`, `subjectId -> Subject`, `termKey (text, default 'DEFAULT')`
  - `name`, `categoryType (ASSESSMENT | ATTENDANCE | POINTS_PARTICIPATION)`
  - `weightPct (decimal)`, `aggregationMethod (TOTAL_POINTS | EQUAL_AVERAGE)`
  - `targetPointsCap (int?)` *(used only if `POINTS_PARTICIPATION`)*
- **`Assessment`**:
  - `id`, `subjectId`, `categoryId -> GradeCategory`
  - `title`, `description`, `maxScore (decimal)`, `assessmentDate`
- **`AssessmentScore`**:
  - `id`, `assessmentId -> Assessment`, `enrollmentId -> SubjectEnrollment`
  - `status (PENDING | GRADED | MISSING | EXCUSED)`
  - `rawScore (decimal?)`, `bonusPoints (decimal, default 0)`, `remarks (text?)`, `updatedByTeacherId`, `updatedAt`
  - `UNIQUE (assessmentId, enrollmentId)`
- **`GradeScaleRule`**:
  - `id`, `subjectId -> Subject`
  - `minPct (decimal)`, `maxPct (decimal)`, `gradeEquivalent (text, e.g. '1.00')`, `label (text, e.g. 'Excellent')`, `isPassing (bool)`

#### Notifications, Push & Audit
- **`PushSubscription`**: `id`, `userId -> User`, `endpoint (unique)`, `p2p256dh`, `auth`, `userAgent`, `createdAt`
- **`Notification`**: `id`, `userId -> User`, `subjectId?`, `type`, `title`, `body`, `linkUrl`, `isRead`, `createdAt`
- **`AuditLog`**: `id`, `actorUserId`, `subjectId?`, `action`, `targetType`, `targetId`, `beforeState (JSONB?)`, `afterState (JSONB?)`, `ipAddress`, `createdAt`

---

## 5. Critical Algorithms & Transactional Flows

### 5.1 Dynamic Rotating QR Token (Stateless Server Signing)
- No Redis or external cache is required.
- When `AttendanceSession` starts, the server generates a 32-byte random `qrSecret` stored in PostgreSQL (never returned to any client).
- Teacher screen polls `GET /api/sessions/[id]/live` every `3s`. The server computes:
  - `bucket = Math.floor(Date.now() / (session.qrRotationSeconds * 1000))`
  - `sig = HMAC_SHA256(session.qrSecret, "${session.id}:${bucket}")` (truncated to 16 hex chars)
  - QR Payload: `att:${session.id}:${bucket}:${sig}`
- On student check-in (`POST /api/attendance/check-in`):
  - Server accepts `bucket === currentBucket` OR `bucket === currentBucket - 1` (1-tick grace window for network/camera latency).
  - Verifies HMAC using constant-time comparison (`crypto.timingSafeEqual`).

### 5.2 Geolocation & Haversine Geofence Validation
1. Client captures GPS via `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })`.
2. **Poor Accuracy Guard:** If `studentAccuracyM > 100`, the server rejects the automated scan with `ERR_LOW_GPS_ACCURACY`, prompting the student to move near a window/open area or request a manual teacher override.
3. **Distance Formula:** Server computes Haversine great-circle distance `D` (in meters) between `(teacherLat, teacherLng)` and `(studentLat, studentLng)`.
4. **Accuracy Buffer:** `effectiveRadius = session.radiusMeters + Math.min(studentAccuracyM, 25)` (capped at 25m to prevent GPS accuracy spoofing).
5. **Decision:** Pass if `D <= effectiveRadius`; otherwise reject with `ERR_OUT_OF_RANGE` including the measured distance `D` for transparency.

### 5.3 Atomic Point Transactions & Deadlock Prevention
All balance-mutating operations run inside a PostgreSQL transaction (`BEGIN ... COMMIT`) using row-level locks (`SELECT ... FROM "SubjectEnrollment" WHERE id = $1 FOR UPDATE`):

1. **P2P QR Transfer (`POST /api/subjects/[id]/transfers`):**
   - Verify P2P QR HMAC signature (`p2p:${subjectId}:${receiverEnrollmentId}:${optionalAmount}:${sig}`) to prevent tampered payloads.
   - Verify `senderEnrollmentId !== receiverEnrollmentId` and both belong to `subjectId`.
   - Enforce subject P2P toggles & daily/term/per-transfer caps by summing recent `P2P_SEND` / `P2P_RECEIVE` ledger entries.
   - **Deadlock Prevention:** Acquire `FOR UPDATE` row locks in deterministic ascending UUID order (`minId` first, then `maxId`).
   - Verify `sender.availableBalance >= amount`.
   - Decrement sender, increment receiver, insert paired `P2P_SEND` and `P2P_RECEIVE` `PointLedgerEntry` rows.
2. **Merits / Demerits:**
   - **Merit:** Increment `availableBalance` by `delta`.
   - **Demerit:** If `subject.allowNegativeBalance === true`, `newBalance = currentBalance - absDelta`. Otherwise, `newBalance = Math.max(0, currentBalance - absDelta)` and `actualDelta = newBalance - currentBalance` (storing the full requested infraction in `note` / `AuditLog`).
3. **Redemption Escrow -> Approval / Rejection:**
   - **Submit:** Lock enrollment row, verify `availableBalance >= pointsCost`, move `availableBalance -= pointsCost` and `escrowedBalance += pointsCost`, create `RedemptionRequest(PENDING)`, append `REDEMPTION_ESCROW`.
   - **Approve:** Lock `RedemptionRequest` (verify `status === PENDING`) and `SubjectEnrollment`, decrement `escrowedBalance -= pointsCost`, update `RedemptionRequest(APPROVED)`, append `REDEMPTION_FINALIZE`. If `SCORE_BOOST`, lock `AssessmentScore` row and add calculated boost (`allowExtraCredit ? raw + bonus : Math.min(maxScore, raw + bonus)`).
   - **Reject / Cancel:** Lock request (`PENDING` check) and enrollment, move `escrowedBalance -= pointsCost` back to `availableBalance += pointsCost`, update status, append `REDEMPTION_REFUND`.

### 5.4 Deterministic Class Standing Engine (`lib/grading/computeStanding.ts`)
Pure TypeScript module shared by server endpoints and Vitest suites:
1. **Assessment Item Effective Score:**
   - `PENDING` or `EXCUSED`: excluded from numerator & denominator.
   - `MISSING`: `earned = 0`, `possible = assessment.maxScore`.
   - `GRADED`: `earned = allowExtraCredit ? (rawScore + bonusPoints) : Math.min(assessment.maxScore, rawScore + bonusPoints)`, `possible = assessment.maxScore`.
2. **Category Percentage (`categoryPct`):**
   - `ASSESSMENT` (`TOTAL_POINTS`): `(sum(earned) / sum(possible)) * 100`. If `sum(possible) === 0`, category is `INACTIVE`.
   - `ASSESSMENT` (`EQUAL_AVERAGE`): `avg((earned_i / possible_i) * 100)`. If 0 active items, category is `INACTIVE`.
   - `ATTENDANCE`: `Present = 100`, `Late = subject.lateAttendanceCreditPct`, `Absent = 0`, `Excused = excluded`. Average across recorded closed/active sessions. If 0 sessions, `INACTIVE`.
   - `POINTS_PARTICIPATION`: `Math.min(100, (totalEarnedMeritAndAttendancePts / targetPointsCap) * 100)`.
3. **Active Weight Normalization (In-Progress Standing):**
   - Sum weights of all **active** categories (`activeWeightSum`).
   - If `activeWeightSum === 0`, standing is `No Graded Items Yet`.
   - Otherwise, `termPct = sum(categoryPct * (category.weightPct / activeWeightSum))`.
4. **Multi-Term Rollup:**
   - If multi-term split is configured (e.g., Midterm 40% + Finals 60%), normalize across active terms in the same manner.
5. **Grade Equivalent Mapping:**
   - Match `overallPct` against `GradeScaleRule` (`minPct <= overallPct <= maxPct`, using highest precision or explicit boundary rules) to return `gradeEquivalent` (e.g., `"1.25"`) and `label`.
   - If `enrollment.manualStandingOverride !== 'NONE'`, return `"INC"` or `"DRP"`.

---

## 6. PWA & Browser Hardware Specifications

### 6.1 PWA Manifest & Service Worker (`@serwist/next`)
- **Installability:** `manifest.webmanifest` with `display: "standalone"`, app icons (`192x192`, `512x512`, maskable), and theme colors.
- **Caching Strategy:**
  - Static UI shell, fonts, and JS chunks cached (`StaleWhileRevalidate` / `CacheFirst`).
  - **Network-Only for Mutations & Live Data:** Attendance scans, QR token generation, P2P transfers, and point redemptions strictly require live server verification (`NetworkOnly`). If offline, the UI displays an explicit *"Internet connection required for QR & point transactions"* banner rather than queuing spoofable offline mutations.
- **Web Push Notifications:**
  - Service Worker handles `push` and `notificationclick` events to route users straight to the relevant subject/request URL.
  - Note for iOS Safari: Users must install the PWA to Home Screen (iOS 16.4+) to enable Web Push; the UI displays an unobtrusive prompt guiding iOS users if push permissions are unavailable, while the **In-App Notification Center** remains universally available.

### 6.2 Camera & Geolocation UX Fallback
- Clear pre-permission explanation modal before requesting Camera and GPS permissions.
- Explicit error states for `PermissionDeniedError`, `PositionUnavailableError`, `TimeoutError`, and low GPS accuracy (`> 100m`), directing students to retry or ask their teacher for manual override.

---

## 7. API Surface Overview

| Domain | Key Endpoints |
|---|---|
| **Auth & Device** | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/device/register` |
| **Subjects & Roster** | `GET/POST /api/subjects`, `POST /api/subjects/join`, `GET/POST /api/subjects/[id]/roster`, `PATCH /api/subjects/[id]/settings` |
| **Attendance** | `POST /api/subjects/[id]/sessions`, `GET /api/sessions/[id]/live` *(returns rotating QR token + live roster)*, `PATCH /api/sessions/[id]/location`, `POST /api/sessions/[id]/close`, `POST /api/attendance/check-in`, `PATCH /api/sessions/[id]/override` |
| **Merits & Ledger** | `GET/POST /api/subjects/[id]/presets`, `POST /api/subjects/[id]/merits` *(single/bulk)*, `GET /api/subjects/[id]/wallet`, `GET /api/subjects/[id]/ledger` |
| **P2P Sharing** | `GET /api/subjects/[id]/p2p-qr`, `POST /api/subjects/[id]/transfers` |
| **Redemptions** | `GET/POST /api/subjects/[id]/rewards`, `POST /api/subjects/[id]/redemptions`, `DELETE /api/redemptions/[id]` *(cancel)*, `POST /api/redemptions/[id]/review` *(approve/reject)* |
| **Assessments & Standing** | `GET/POST /api/subjects/[id]/assessments`, `PUT /api/assessments/[id]/scores` *(teacher bulk/single)*, `GET/PUT /api/subjects/[id]/computation`, `GET/PUT /api/subjects/[id]/grade-scale`, `GET /api/subjects/[id]/standing` |
| **Notifications & Push** | `GET /api/notifications`, `PATCH /api/notifications/read`, `POST /api/push/subscribe` |
| **Admin** | `GET/PATCH /api/admin/teachers`, `POST /api/admin/invites`, `GET/POST /api/admin/terms`, `GET /api/admin/audit-logs` |

---

## 8. Testing, Performance & Deployment Requirements

### 8.1 Automated Test Strategy
- **Vitest Unit Tests:**
  - `computeStanding.ts` edge cases: empty categories, `Pending` vs `Missing (0)` vs `Excused`, extra credit caps, multi-term rollups, boundary percentages (e.g., `96.99%` vs `97.00%`).
  - Haversine distance & capped accuracy buffer validation.
  - HMAC QR token generation, current/previous bucket acceptance, expired token rejection.
- **Vitest Integration Tests (Test PostgreSQL DB):**
  - Concurrent P2P transfers & simultaneous redemption requests verifying zero race conditions, zero negative balances (when disabled), and zero deadlocks.
  - Anti-proxy `deviceHash` uniqueness constraint enforcement per session.
  - RBAC enforcement (student attempting teacher-only score edit, cross-subject P2P attempt).
- **Playwright E2E Tests:**
  - Teacher creates subject, configures computation & grade scale -> creates assessment -> inputs scores -> student views standing (`1.00`, `1.25`, etc.) with zero upload UI present.
  - Student submits redemption targeting an exam -> teacher approves -> exam score updates automatically.

### 8.2 Performance & Scalability Targets
- Database indexes on `(subjectId, studentId)`, `(sessionId, enrollmentId)`, `(enrollmentId, createdAt DESC)`, and `(userId, isRead)`.
- Serverless connection pooling enabled (`PgBouncer` / Neon pooled URL) to handle burst classroom check-ins (e.g., 50+ students scanning within 10 seconds).
- Grade standing calculations executed efficiently per subject view or cached per `(enrollmentId)` and invalidated whenever scores, attendance, or computation rules change.

### 8.3 Environment Variables & Secrets
- `DATABASE_URL` (pooled), `DIRECT_URL` (migrations)
- `AUTH_SECRET` (session encryption/signing)
- `DEVICE_PEPPER` (device hash pepper)
- `P2P_QR_SECRET` (HMAC signing key for P2P QR payloads)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (Web Push)
