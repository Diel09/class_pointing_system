# Project Requirements Document (PRD)
## Location-Verified Attendance, Gamified Pointing & Class Standing System

**Document Status:** Draft v1.0 (Functional & Product Requirements)  
**Target Platform:** Mobile-First Progressive Web App (PWA)  
**Companion Documents:** `docs/TRD.md` *(Technical Requirements Document — to follow)*  

---

## 1. Executive Summary & Product Vision

The **Location-Verified Attendance, Gamified Pointing & Class Standing System** is a mobile-first Progressive Web App (PWA) designed to modernize classroom engagement, attendance integrity, and transparent grade tracking.

It combines:
1. **Fraud-resistant attendance** using dynamic QR codes and teacher-device geofencing.
2. **A per-subject gamified economy** where students earn points from attendance and teacher merits, lose points via demerits, share points peer-to-peer via GCash-style QR transfers, and spend points (with teacher approval) on score boosts or classroom perks.
3. **Streamlined gradebook & class standing tracking** where teachers create assessments, input scores without managing student file submissions, define custom subject computation formulas, and publish live class standings mapped to configurable grade equivalents (e.g., `1.00`, `1.25`, `1.50`, ..., `5.00`).

---

## 2. Core Design Principles & Scoping Decisions

| Principle | Specification |
|---|---|
| **Platform** | Mobile-first Progressive Web App (PWA) installable on smartphones and accessible via desktop browsers. |
| **Per-Subject Point Isolation** | Every subject/class maintains its own **isolated point wallet**, reward catalog, transfer settings, computation rules, and grading scale. Points earned in Subject A **cannot** be spent or transferred in Subject B. |
| **Teacher-Led Onboarding** | Teachers self-manage their subjects and student rosters (via class code, QR invite, or manual/CSV enrollment), supported by a lightweight Admin role for institutional oversight and academic term management. |
| **Zero Student Submissions** | Assessments/activities serve solely as teacher-scored records; students **cannot** upload files, submit links, or turn in work through the platform. |
| **Privacy-First Geolocation** | GPS coordinates are captured **only on-demand** (when a teacher runs an attendance session or when a student scans an attendance QR). No continuous background location tracking occurs. |

---

## 3. User Roles & Permissions

### 3.1 Student
- Register/log in and manage personal profile.
- Join subjects via class invite code or class invite QR code (or be pre-enrolled by a teacher).
- Check in to active attendance sessions by scanning the teacher's dynamic QR code with device GPS verification.
- View per-subject point balance (Available vs. Pending/Escrowed) and full immutable point transaction ledger.
- Receive points from or send points to classmates **within the same subject** via GCash-style QR codes.
- Browse the subject's reward catalog and submit point redemption requests (specifying the target exam/activity or custom usage).
- View read-only assignment/activity/exam details, raw scores, applied point bonuses, and teacher remarks.
- View live running class standing (percentage breakdown and grade equivalent such as `1.00`, `1.25`) when grade visibility is enabled by the teacher.

### 3.2 Teacher
- Create, edit, and archive subjects/classes per academic term.
- Manage enrollment (generate/reset class code & invite QR, approve join requests if gated, import/add/remove students).
- Start, manage, and close QR + GPS geofenced attendance sessions; manually override attendance statuses.
- Configure reusable Merit & Demerit presets and award/deduct points (individually or in bulk) with notes.
- Configure subject point economy settings (negative balance policy, P2P transfer toggles & anti-farming limits, reward catalog & score conversion rules).
- Review, approve, or reject student point redemption requests.
- Create assessments/activities/quizzes/exams and input or bulk-edit student scores.
- Configure subject grade computation weights, term weights, attendance weight contribution, grade equivalent range mappings (`1.00`–`5.00`), and student standing visibility toggles.

### 3.3 Admin (Lightweight Institutional Oversight)
- Verify and manage teacher accounts and institutional settings.
- Create/manage academic years and terms (e.g., 1st Sem, 2nd Sem, Summer).
- View high-level audit logs, enrollment counts, and resolve account disputes/device lock resets if needed.

---

## 4. Functional Requirements

### 4.1 Attendance Monitoring (QR Code + Teacher-Device GPS Radius)
**Goal:** Verify physical classroom presence accurately while rewarding timely attendance with subject points.

1. **Session Creation & Teacher Location Capture:**
   - The teacher starts an attendance session for a specific subject.
   - The PWA captures the teacher's current device GPS coordinates (`latitude`, `longitude`, `accuracy`).
   - The teacher can manually **refresh their GPS anchor** (e.g., if moving rooms) before or during the session.
   - The teacher configures:
     - **Geofence Radius** (in meters, e.g., `15m` to `500m`, default e.g., `50m`).
     - **Present Window** (duration from session start, e.g., first 15 minutes) and **Present Points** (e.g., `+10 pts`).
     - **Late Cutoff Window** (duration after Present window, e.g., 15–45 minutes) and **Late Points** (e.g., `+5 pts`, or `0 pts`).
     - **Attendance Grade Credit %** for Present (e.g., `100%`) and Late (e.g., `50%` or `75%`).
2. **Dynamic Rotating QR Code:**
   - Once started, the teacher's screen displays a **dynamic QR code** that automatically rotates its cryptographic/session token every **10–15 seconds** (configurable) to prevent students from screenshotting and sending the QR to absent peers.
   - An optional short fallback session code may be displayed only if explicitly enabled by the teacher.
3. **Student Check-In & Validation Rules:**
   - Student opens the scanner in the subject and scans the teacher's QR code.
   - The PWA captures the student's current GPS coordinates and submits the scan.
   - The system validates all of the following before recording attendance:
     1. Student is actively enrolled in the subject.
     2. Session is `Open` and the scanned QR token is valid (current or immediate previous grace-window token to handle scan lag).
     3. Student has not already checked in for this session.
     4. **Anti-Proxy Device Check:** A single physical browser/device cannot check in multiple different student accounts for the same attendance session.
     5. **Geofence Check:** Distance between student GPS and teacher GPS anchor (computed via Haversine formula, optionally factoring configurable GPS accuracy tolerance) is `<= configured radius`.
4. **Automatic Point Award & Status Determination:**
   - If scanned within the Present window -> marked **Present**, awarded Present Points.
   - If scanned within the Late window -> marked **Late**, awarded Late Points.
   - Students who do not check in by session close default to **Absent** (`0 pts`).
5. **Teacher Live Roster & Manual Override:**
   - Teacher sees real-time check-ins with distance/status indicators.
   - Teacher can manually mark or override any student's status (`Present`, `Late`, `Excused`, `Absent`) to handle dead batteries, broken cameras, or indoor GPS drift.
   - Manual overrides automatically adjust (credit or reverse) the session's attendance points and log an audit entry noting the teacher override.

---

### 4.2 Merit & Demerit Pointing System
**Goal:** Enable teachers to reinforce positive behavior and penalize infractions within each subject.

1. **Merit & Demerit Presets:**
   - Teachers can create, edit, and archive reusable presets per subject:
     - **Merits** (positive delta), e.g., *Active Recitation (+5)*, *Early Submission/Prep (+3)*, *Helping Classmate (+5)*.
     - **Demerits** (negative delta), e.g., *Disruptive Behavior (-5)*, *No Uniform/ID (-3)*, *Phone Distraction (-5)*.
2. **Ad-Hoc & Bulk Adjustments:**
   - Teachers can select a preset or enter a custom point value (`+` or `-`) with a required or optional reason/note.
   - Teachers can apply a merit or demerit to **one student** or **multiple selected students at once** from the class roster.
3. **Balance Floor & Negative Debt Policy:**
   - **Default Behavior (Floor at `0`):** A demerit deducts points from the student's Available balance down to a minimum of `0`. Any excess demerit amount is still recorded in the point history/conduct log, even if the spendable balance stops at `0`.
   - **Optional Negative Balance Setting:** Teachers can toggle *"Allow Negative Point Balance"* per subject. When enabled, demerits can push a student below `0` (point debt); the student cannot spend or transfer points until they earn back a positive balance (`> 0`).
4. **Transparency & History:**
   - Every merit and demerit generates an immutable ledger record showing timestamp, preset/reason, point change, resulting balance, and issuing teacher.

---

### 4.3 Viewing & Spending Points (Teacher-Approved Redemption)
**Goal:** Allow students to spend earned points on score boosts or classroom perks under teacher control.

1. **Wallet Overview:**
   - Inside each subject, students view:
     - **Available Balance:** Points immediately spendable or transferable.
     - **Pending (Escrowed) Balance:** Points locked in pending redemption requests awaiting teacher decision.
     - **Lifetime Earned / Spent / Transferred** summary and chronological transaction ledger.
2. **Subject Reward Catalog & Conversion Rules:**
   - Teachers configure redeemable options per subject:
     - **Score Boost Rewards:** Defined with a conversion rate (e.g., `10 pts = +1 raw score` on an Exam, Quiz, or Activity), minimum/increment rules, and eligible assessment categories.
     - **Score Cap Policy (Teacher Setting):** Per subject or reward, teacher defines whether redeemed bonus points **cap at the assessment's `max_score`** (e.g., max `50/50`) or **allow extra credit** above `max_score` (e.g., `52/50`).
     - **Fixed Classroom Perks:** Non-score rewards (e.g., *Deadline Extension Pass — 25 pts*, *Seat Selection — 15 pts*, *Drop Lowest Quiz — 50 pts*).
     - **Open / Custom Spend Request (Optional Toggle):** Allows students to propose a custom spend amount and describe how they wish to use it if the teacher keeps redemptions open.
3. **Student Redemption Submission (Target Selection):**
   - When submitting a redemption request, the student selects a reward from the catalog (or custom request if enabled) and **explicitly specifies where the points will be applied**:
     - For Score Boosts: selects the **specific assessment/exam/activity** from their graded/created items in that subject and specifies the point amount / boost units.
     - Includes an optional student note.
   - **Point Escrow:** Upon submission, the requested points are immediately moved from `Available` to `Pending/Escrowed` so the student cannot double-spend the same points across multiple requests.
   - Students may **cancel** a request while it remains `Pending`, immediately returning escrowed points to `Available`.
4. **Teacher Approval Queue & Execution:**
   - Teachers view a dedicated **Pending Redemptions** queue (filterable by subject) showing student name, current score on the target assessment, requested points, resulting projected score, and student note.
   - **Approve:**
     - Escrowed points are permanently deducted.
     - For Score Boosts, the system automatically credits the bonus points onto the specified assessment score (recording `raw_score` and `bonus_points` separately for transparency) and recalculates class standing.
     - Student receives an approval notification.
   - **Reject:**
     - Escrowed points are immediately **refunded** to the student's `Available` balance.
     - Teacher may enter a rejection reason; student receives a notification.

---

### 4.4 Peer-to-Peer QR Point Sharing ("GCash-Style")
**Goal:** Enable fast, intuitive, in-person point sharing between classmates within the same subject.

1. **Subject-Scoped QR Generation (Receiver):**
   - Inside a subject, a student taps **Receive Points** to display a personal QR code bound to `(student_id, subject_id)`.
   - Optionally, the receiver can enter a **Requested Amount** and note before generating the QR (so the sender sees the pre-filled amount upon scanning).
2. **Scan, Review & Confirm (Sender):**
   - A classmate in the **same subject** taps **Send Points**, scans the receiver's QR code, and views a confirmation sheet displaying:
     - Receiver's full name / student ID & subject name.
     - Point amount input (or pre-filled requested amount).
     - Optional transfer note/message.
   - Validation checks:
     - Sender and receiver must be enrolled in the **same subject** (cross-subject QR scans are rejected with a clear error).
     - Sender cannot send points to themselves.
     - Amount must be a positive integer `<= sender's Available balance` (escrowed points cannot be transferred).
     - Subject transfer guardrails (if enabled) are satisfied.
3. **Instant Settlement & Digital Receipt:**
   - Confirmed transfers execute atomically and instantaneously.
   - Both sender and receiver receive a transaction receipt (reference ID, timestamp, participants, amount, note) and immutable ledger entries (`Transfer Out` / `Transfer In`), plus a notification to the receiver.
4. **Teacher Anti-Farming Guardrails (Per-Subject Settings):**
   - Teachers can configure per subject:
     - **Enable / Disable P2P Transfers** (master toggle).
     - **Max Points Sent/Received per Transfer** (optional cap).
     - **Max Points Sent/Received per Day or Term** (prevents mass point pooling/farming onto one student before finals).

---

### 4.5 Assessments & Teacher-Only Score Entry
**Goal:** Provide a clean assessment tracker where teachers record scores without handling student file uploads or submissions.

1. **Assessment Creation (Teacher):**
   - Teachers create assessments under a subject, specifying:
     - **Title** (e.g., *Quiz 1: Loops*, *Midterm Exam*, *Lab Activity 3*).
     - **Grade Category** (linked to the subject's computation categories, e.g., Quizzes, Activities/Assignments, Exams).
     - **Term / Period** (if the subject uses term splits such as Midterm & Finals).
     - **Max Score** (e.g., `20`, `50`, `100`).
     - **Date / Reference Description** (optional instructions or topics covered for student reference).
2. **Strict No-Submission Rule (Student):**
   - Students can view the assessment list, instructions/description, `max_score`, their recorded score, any applied point boost, and teacher feedback/remarks.
   - There is **no file upload, text submission box, link attachment, or "Turn In" action** anywhere in the student assessment interface.
3. **Score Input & Grading Statuses (Teacher):**
   - Teachers enter scores via individual student view or a fast spreadsheet-like **Class Score Grid** (and optional CSV score import).
   - Each student's record for an assessment has an explicit status:
     - **`Pending` (Default when created):** Not yet graded; **excluded** from the student's current running standing so ungraded future items do not artificially tank their grade.
     - **`Graded`:** Numeric score entered (`0` to `max_score`, or higher if extra credit from point boost applies).
     - **`Missing (0)`:** Explicitly counts as `0 / max_score` in the student's standing.
     - **`Excused`:** Excluded from both numerator and denominator for that specific student.
   - When a score is displayed alongside a redeemed point boost, both values are visible (e.g., `42/50 + 3 pts boost = 45/50`).

---

### 4.6 Subject Grade Computation Configuration
**Goal:** Give teachers complete flexibility to define how each subject's standing is calculated.

1. **Weighted Grade Categories:**
   - For each subject, the teacher defines grade categories and their percentage weights (validated to total **100%**), for example:
     - *Assignments / Activities:* `20%`
     - *Quizzes:* `20%`
     - *Major Exams:* `50%`
     - *Attendance:* `10%`
2. **Optional Term Weighting:**
   - Teachers can choose either:
     - **Single Continuous Term** (100% across categories), OR
     - **Multi-Term Split** (e.g., *Midterm Period 40%* + *Final Period 60%*), where each term computes its category breakdown and rolls up into the overall subject standing.
3. **Category Score Calculation Rules:**
   - Within an assessment category, teachers can choose the aggregation method:
     - **Total Points Sum (Default):** $\frac{\sum \text{earned\_scores}}{\sum \text{max\_scores}} \times 100\%$ across all `Graded` and `Missing (0)` items.
     - **Equal Weight Average:** Average of individual item percentages within the category.
   - **Attendance Category:** Computed automatically from recorded attendance sessions:
     - `Present` = `100%` (or teacher-configured value)
     - `Late` = teacher-configured % (e.g., `50%` or `75%`)
     - `Absent` = `0%`
     - `Excused` = excluded from session denominator.
   - **Optional Points / Participation Category:** By default, wallet points impact grades indirectly when spent on Score Boosts (preventing double-counting). However, if a teacher explicitly adds a *Participation / Points* category, they may configure a target point cap (e.g., `100 earned pts = 100%`) to factor earned merits/points directly.
4. **Running / In-Progress Standing Normalization:**
   - If a category currently has **no graded items or recorded attendance yet** (all items are `Pending`), that empty category is temporarily excluded and remaining active category weights are **proportionally re-normalized to 100%** so students see an accurate running standing at any point in the semester.

---

### 4.7 Class Standing & Custom Grade Equivalents (`1.00`, `1.25`, etc.)
**Goal:** Let students track their live academic standing and grade equivalent based on the teacher's exact grading scale.

1. **Custom Grade Scale Mapping (Teacher):**
   - Each subject includes a teacher-configurable **Grade Scale Table** mapping percentage ranges (`min_%` to `max_%`) to:
     - **Grade Equivalent / Point** (e.g., `1.00`, `1.25`, `1.50`, `1.75`, `2.00`, `2.25`, `2.50`, `2.75`, `3.00`, `5.00`, or letter grades `A`, `B+`, etc.).
     - **Status Label** (e.g., *Excellent*, *Passed*, *Conditional*, *Failed*).
   - Teachers start with a pre-filled standard template (e.g., Philippine 1.00–5.00 scale) that they can customize freely, with validation ensuring non-overlapping, gap-free ranges from `0%` to `100%+`.
   - Teachers can also assign manual override academic statuses when applicable (e.g., `INC` - Incomplete, `DRP` - Dropped).
2. **Student Class Standing View:**
   - Displays clearly at the top of the subject dashboard:
     - **Current Grade Equivalent** (e.g., `1.25`) & **Status Badge** (e.g., *Passing — Very Good*).
     - **Running Percentage** (e.g., `94.6%`).
     - **Category-by-Category Breakdown** showing each category's weight, current score, and contribution.
     - **Score Transparency:** Shows which scores were boosted via redeemed points.
3. **Grade Visibility Controls:**
   - Teachers can toggle **Standing Visibility** per subject:
     - **Live / Visible (Default):** Students see real-time running standing as scores and attendance are recorded.
     - **Hidden (Encoding Mode):** Temporarily hides the calculated grade equivalent/percentage from students while the teacher finalizes or deliberates grades, then reveals when toggled back on.

---

## 5. Notifications & Engagement

Users receive real-time in-app notifications (and optional Web Push notifications in the PWA) for key events:
- **Student Notifications:**
  - Attendance check-in confirmed (status + points earned) or manually overridden by teacher.
  - Merit or demerit awarded (amount + reason).
  - P2P QR transfer received (sender name + amount + note).
  - Redemption request approved or rejected (with teacher note and score update/refund confirmation).
  - New assessment posted or score recorded/updated.
- **Teacher Notifications:**
  - New student redemption request submitted (with quick link to review queue).
  - Student joined class via invite code/QR (if approval or alerts enabled).

---

## 6. Non-Functional Requirements (Product Level)

| Area | Requirement |
|---|---|
| **Usability & Mobile Ergonomics** | Primary student flows (QR attendance scan, GCash-style QR receive/send, checking standing) must be completable in **≤ 3 taps** on a mobile screen. |
| **Security & Integrity** | All point balances must derive from or reconcile strictly with an atomic, immutable ledger. No client-side manipulation of GPS distance, QR expiry, balances, or scores. |
| **Privacy** | Students can only view their **own** grades, class standing, and point ledger. Classmates can only see a peer's name/ID during an active QR transfer confirmation. |
| **Auditability** | Every score edit, attendance override, merit/demerit, P2P transfer, and redemption decision must log the actor, timestamp, and before/after state. |
| **Reliability in Classrooms** | Dynamic QR validation must allow a brief grace window (e.g., 1 previous rotation tick) to tolerate slow mobile cameras/networks; teachers must always have manual override for attendance. |
| **PWA Installability** | App must support home-screen installation, responsive layout (mobile portrait for classroom use + desktop/tablet layout for teacher gradebook entry), and graceful offline feedback (clearly warning when internet/GPS is required for QR check-in or transfers). |

---

## 7. Key Edge Cases & Resolutions

1. **Student has no phone / dead battery / indoor GPS drift during attendance:** Teacher uses the live session roster to manually mark the student `Present` or `Late`; attendance points are credited and flagged as manual override.
2. **Student screenshots dynamic QR and sends to friend outside campus:** Rejected both by the short-lived rotating QR token and by the Haversine geofence check against the teacher's device coordinates.
3. **Student logs into a friend's account on their own phone to scan twice:** Blocked by the per-session device check-in uniqueness rule.
4. **Student submits 3 redemption requests using the same 20 points:** Prevented by immediate point escrow upon submission; `Available` balance drops immediately when a request enters `Pending`.
5. **Teacher rejects a redemption request:** Escrowed points are automatically refunded to the student's `Available` balance.
6. **Student receives a demerit when balance is `0`:** Balance stays at `0` by default (unless teacher enabled negative point debt for that subject), while the demerit event remains permanently logged in history.
7. **Student scans a classmate's QR from a different subject:** Rejected immediately with a clear message (*"Transfers are only allowed between classmates in the same subject"*).
8. **Early semester before exams are graded:** Running standing re-normalizes weights across categories that have graded/recorded data, preventing misleading `5.00` standings during week 1–2.

---

## 8. Out of Scope (v1.0)

- Student file uploads, online quiz-taking, or text-based assignment submissions (explicitly excluded per Requirement 6).
- Cross-subject global point wallets or converting points into real currency.
- Continuous background GPS tracking outside active attendance check-ins.
- Automated institutional LMS/SIS integrations (e.g., Canvas/Moodle sync) — may be considered in future versions.

---

## 9. Next Steps

1. Review and sign off on this **Project Requirements Document (`docs/PRD.md`)**.
2. Conduct technical requirements discovery and produce the **Technical Requirements Document (`docs/TRD.md`)** covering:
   - PWA frontend framework & camera/geolocation APIs
   - Backend architecture, database schema, & atomic ledger design
   - Authentication, QR token cryptography, & anti-proxy device fingerprinting
   - Hosting, push notifications, & deployment strategy
