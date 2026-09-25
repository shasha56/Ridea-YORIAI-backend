<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# AGENTS.md — Rideshare Backend Development Guide

This Next.js backend serves as the API server for a hackathon rideshare web application. Frontend and backend are separate repositories. This file documents permanent rules to prevent architectural mistakes and ensure consistency.

---

## Project Structure & Technologies

- **Framework**: Next.js 16.3.5 (App Router), TypeScript 5 with strict mode
- **APIs**: Use Route Handlers only (`src/app/api/**/route.ts`) for HTTP endpoints
- **Package Manager**: npm only (not pnpm, yarn, or bun)
- **Database**: Supabase PostgreSQL via `@supabase/supabase-js` (no ORM; do not add Prisma, Drizzle, TypeORM, or Sequelize without explicit justification)
- **Frontend UI**: This backend must NOT include React UI components. Only minimal Next.js bootstrap files are allowed.
- **Testing**: No test framework is configured yet; confirm availability before running tests
- **Validation**: TypeScript types alone are NOT runtime validation. Implement actual validation or use Zod if adding validation library.

---

## Database & Schema

**Source of Truth**: [docs/db-design.md](docs/db-design.md)

### Critical Invariants

1. **Supabase Auth Integration**
   - `auth.users` (managed by Supabase) holds authentication credentials
   - `public.users` holds application user data with `id = auth.users.id` (UUID)
   - Do NOT store passwords or email hashes in application tables
   - Do NOT confuse `auth.users` with `public.users`

2. **User Roles**
   - Only `passenger` (default) and `driver` roles exist
   - Drivers CAN also book reservations as passengers
   - Do NOT restrict passenger functionality based on driver role
   - No Admin role in this iteration

3. **Reservations & Shifts**
   - One Shift can have multiple active Reservations when pickup coordinates, drop-off coordinates, and `scheduled_pickup_at` match exactly
   - `available` means no active Reservation is assigned; `booked` means one or more active Reservations are assigned
   - A `booked` Shift remains eligible for another matching Reservation while passenger capacity remains
   - Do NOT create the old partial unique index that limited one active Reservation per Shift
   - Shift status transitions: `available -> booked -> completed`, `available -> canceled`, `booked -> canceled`, and `booked -> available` when no active Reservations remain
   - Reservation status transitions: `pending -> accepted -> in_progress -> completed`, `pending -> canceled` at the deadline, and `accepted -> pending` for re-matching after an allocation or Shift cancellation
   - Passenger count must be 1–3
   - `car_capacity` includes the Driver; passenger capacity is `car_capacity - 1`
   - Remaining capacity is not stored; calculate it from active (`accepted` or `in_progress`) Reservation passenger counts
   - `reservations.driver_id` does not exist; derive the Driver through `reservations.shift_id -> shifts.driver_id`

4. **Matching Logic**
   - Matching does NOT use driver current location
   - Prefer an existing `booked` Shift whose active Reservation has exactly matching pickup coordinates, drop-off coordinates, and `scheduled_pickup_at`, provided enough capacity remains
   - If no such `booked` Shift exists, search an unused Shift with `shift.status = 'available'` and `shift.start_time <= reservation.scheduled_pickup_at < shift.end_time`
   - Select 1 random Shift among candidates at the same priority
   - If no eligible Shift exists, leave the Reservation `pending` for future re-matching
   - Use a transaction and Shift row lock; recalculate capacity and matching conditions after locking

5. **Shift Time Overlap**
   - Shifts cannot overlap when either `driver_id` or `car_id` is the same
   - Overlap rule: `(existing.driver_id = new.driver_id OR existing.car_id = new.car_id) AND existing.start_time < new.end_time AND new.start_time < existing.end_time`
   - Application validates overlap; do NOT add Exclude Constraints or GiST indexes unless db-design.md is updated
   - Whether `canceled` Shifts are excluded from overlap checks is unresolved; decide before Initial Migration

6. **Cancellation & Re-matching**
   - Passengers may cancel an accepted allocation before the deadline; return the Reservation to `pending` and set `shift_id = NULL` for re-matching
   - Drivers cannot cancel Reservations directly, but may cancel their own Shift before the ride starts
   - On Shift cancellation, return its `accepted` Reservations to `pending` and set their `shift_id = NULL` in the same transaction
   - Do not cancel an `in_progress` Reservation or Shift
   - Previous allocation history is not stored

7. **Reservation Deadline & Automatic Transitions**
   - Deadline: 18:00 `Asia/Tokyo` on the day before desired pickup
   - Reject new Reservations and allocation cancellations after the deadline
   - Automatically change unmatched `pending` Reservations to `canceled` at the deadline
   - Automatically change `accepted` to `in_progress` at `scheduled_pickup_at`
   - Automatically complete the relevant Reservations and Shift after `shift.end_time`
   - On completion, calculate each `fare` and store `shifts.earnings = SUM(completed reservation fares)`

---

## Authentication & Authorization

### API Authentication Flow

```
React App
↓ (Access Token from Supabase Auth)
Next.js Route Handler
↓ (Verify Token)
Authenticated User ID from auth.users
↓ (Check Authorization)
Database Operation
```

### Rules

1. **Never Trust Client**
   - Do NOT accept user_id from request body/params as proof of identity
   - Always verify access token server-side and extract authenticated user_id
   - Do NOT trust role, user_id, ownership, or status from client claims

2. **Authorization Checks**
   - Verify passenger owns their reservation before allowing cancellation
   - Verify driver owns their shift before allowing updates
   - Check role for driver-only operations
   - Even with RLS, enforce application-level authorization; do NOT rely on RLS alone

3. **Secrets**
   - Do NOT expose Supabase Service Role Key, DB credentials, or API keys to client
   - Use environment variables for all secrets; do NOT hardcode
   - Service Role Key must be server-only (never sent to client)
   - Update `.env.example` (without secrets) if adding new environment variables

---

## API Architecture & Request Flow

```
Request Body / Query Params
↓
Validate Input (runtime, not just TypeScript types)
↓
Extract & Verify Authentication Token
↓
Check Authorization
↓
Call Service/Business Logic
↓
Supabase → PostgreSQL
↓
Return HTTP Response (200, 201, 400, 401, 403, 404, 409, 422, 500)
```

### Guidelines

1. **Route Handler Responsibility**: Accept HTTP request, authenticate, authorize, validate, call service, return response
2. **Service/Business Logic**: Reservation creation, shift registration, matching, cancellation, status transitions
3. **Avoid Over-Engineering**: No unnecessary Clean Architecture layers, DDD, CQRS, Event Sourcing, or complex DI for small features
4. **Simplicity First**: Prioritize readability and speed over premature abstraction

### HTTP Status Codes

- `200 OK` — Successful GET/PUT/PATCH
- `201 Created` — Successful POST with resource creation
- `204 No Content` — Successful DELETE or empty response
- `400 Bad Request` — Invalid input or missing required fields
- `401 Unauthorized` — Missing or invalid authentication token
- `403 Forbidden` — Authenticated but lacks permission
- `404 Not Found` — Resource does not exist
- `409 Conflict` — Business rule violation (e.g., shift overlap, passenger count exceeds capacity)
- `422 Unprocessable Entity` — Validation failed after schema checks
- `500 Internal Server Error` — Unexpected server error (do NOT return stack traces or secrets to client)

---

## Input Validation & Type Safety

1. **Validate All Client Input**
   - Request body, query parameters, URL parameters, UUIDs, dates, passenger count, addresses, roles, status values
   - Do NOT rely on TypeScript types as runtime validation

2. **Validation Approach**
   - If validation library already exists, use it
   - Otherwise, consider Zod as default choice (after checking existing dependencies)
   - Implement runtime schema validation for external input

3. **Type Design**
   - Do NOT assume database types match public API response types
   - Keep database entity types separate from API contract types
   - Use `unknown` + runtime validation + narrowing for external input

---

## Geocoding

- Frontend sends address strings; backend calls Geocoding API to convert to latitude/longitude
- DB stores: input address + latitude + longitude
- Geocoding provider is NOT yet determined; do NOT hardcode Google Maps or any specific provider
- Do NOT add provider-specific code until provider is decided
- Stores both address and coordinates for re-display and verification of results

---

## API Contract & Documentation

1. **API spec is the contract** between frontend and backend; changes affect both repos
2. **Maintain [docs/api.md](docs/api.md)** or existing API documentation
3. **Update API docs** when adding/changing endpoints
4. **Do NOT arbitrarily change** request/response structures without confirming frontend impact

---

## Repository Scanning & Sensitive Files

### Secrets & Environment Variables

- **Do NOT inspect** real environment files: `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test`, `.env.*.local`
- **Only inspect** `.env.example` for documentation of required variable names
- **Do NOT run** commands that expose secrets: `cat .env`, `grep ... .env`, `env`, `printenv`
- If an environment variable is needed but not documented in `.env.example`, update `.env.example` with a safe placeholder instead
- **Never include** real secret values in source code, logs, documentation, or responses
- Exception: follow the auto-generated Next.js agent rule at the top of this file and narrowly inspect `node_modules/next/dist/docs/` when required for Next.js implementation.

### Dependencies & Generated Files

- **Do NOT inspect or edit** `node_modules/` recursively
- **Use only** `package.json` and `package-lock.json` to understand dependencies
- **Avoid modifying** generated directories: `.next/`, `dist/`, `build/`, `coverage/`, `.git/`
- **Only inspect** dependency internals when: (1) debugging a specific issue, (2) documentation is insufficient, (3) inspection is narrowly scoped
- Runtime commands (`npm install`, `npm run lint`, `npm run build`) may use `node_modules/`; this is fine

### Repository Search Discipline

- **Search narrow scope first**: prefer `src/`, `docs/` over broad recursive searches
- **Avoid** `grep -R . `, `find . ...` without exclusions
- **Use** tools that skip ignored files: `git grep`
- **Never** inspect binary files, caches, or dependency trees unless directly necessary
- **Relevant source areas**: `src/`, `docs/`, `supabase/`, `tests/` (only if they exist)

---

## Development Workflow

### Before Implementation

1. Read related existing code
2. Consult [docs/db-design.md](docs/db-design.md)
3. Check API specification
4. Review `package.json` for available dependencies
5. Search codebase for similar implementations

### During Implementation

- Proceed in single vertical slices (Request → Validation → Auth → Authz → Logic → DB → Response)
- Do NOT refactor unrelated code in the same commit
- Do NOT add features not requested by users
- Do NOT add future-proofing features to a hackathon project

### After Implementation

1. Verify available npm scripts exist before running them:
   - `npm run lint` (ESLint)
   - `npm run build` (Next.js build)
   - `npm run dev` (dev server)
   - Tests (if available)

2. Run lint and build checks
3. Do NOT claim tests passed if you did not actually run them
4. Do NOT ignore TypeScript errors

---

## Git Workflow

### During Development

* Work on one logical task at a time.
* Keep changes scoped to the current task.
* Do not include unrelated refactoring, formatting, or cleanup in the same task.

### Before Committing

1. Run the relevant tests, lint, type checks, and build commands available in `package.json`.
2. Review `git status` and `git diff`.
3. Verify that only files related to the current task are included.
4. Verify that no secrets, environment files, generated artifacts, or unrelated files are staged.
5. Before creating any commit, always ask the user which branch name should be used for the commit.
6. Do not create, switch, rename, or otherwise choose a branch for the commit until the user explicitly provides or confirms the branch name.

### Branch Selection

* The branch name must never be assumed.
* Always ask the user for the branch name before every commit, even if the current branch already appears appropriate.
* If the requested branch does not exist, ask whether it should be created before creating it.
* Do not automatically create a branch unless the user explicitly confirms the branch name and creation.
* Do not switch branches if doing so could affect unrelated uncommitted changes. Preserve those changes and report the situation instead.

### Commit Guidelines

Each commit must:

* Represent one logical task
* Contain only changes required for that task
* Use a concise commit message describing the completed change
* Avoid bundling unrelated changes
* Be created only after the user has explicitly confirmed the branch name for that commit

### Do NOT Commit

* Sensitive files: `.env`, `.env.local`, `.env.*`
* Generated or dependency directories: `node_modules/`, `.next/`, `dist/`, `coverage/` (unless explicitly tracked)
* Unrelated or uncommitted user changes

### Forbidden Operations

Do not:

* Push to remote unless explicitly instructed
* Force push
* Rewrite published history
* Run destructive commands: `git reset --hard`, `git clean -fd`
* Use `git commit --amend`, interactive rebase, or history-rewriting operations unless explicitly requested
* Delete or overwrite unrelated uncommitted user changes
* Automatically choose, create, rename, or switch to a branch without explicit user confirmation

If unrelated uncommitted changes exist, preserve them and do not include them in the task commit.

### Failure Handling

If relevant tests or checks fail, do not create the completion commit unless the failure is known to be unrelated to the task. In that case, clearly report the existing failure.

### Task Completion Report

At the end of the task, report:

* Branch name used
* Commit hash
* Commit message
* Checks executed
* Any checks that could not be executed or did not pass


---

## Out of Scope (This Hackathon)

Do NOT implement without explicit user request:

- Payment processing (fare calculation and storage still follow docs/db-design.md)
- Admin role/dashboard
- Rating/review system
- Chat functionality
- Push notifications
- Driver reservation cancellation
- Driver reservation approval workflow
- Nearest-driver matching (current matching uses shift time only)

---

## Definition of Done

A task is complete when:

1. ✓ Requested behavior implemented and working
2. ✓ Input validated server-side
3. ✓ Authentication handled (if required by feature)
4. ✓ Authorization enforced (if required by feature)
5. ✓ Database invariants from db-design.md preserved
6. ✓ API contract preserved or documented
7. ✓ TypeScript compiles without errors
8. ✓ Lint passes
9. ✓ Build succeeds
10. ✓ No secrets exposed in code
11. ✓ No unrelated changes mixed in

---

## Task Completion Report Template

After each implementation task, briefly report:

```
1. What changed: [Feature description and endpoint paths if API]
2. Key design decisions: [Why this approach over alternatives]
3. Files modified: [List of changed files]
4. Checks executed: [lint, build, specific manual tests]
5. Remaining assumptions/risks: [Open questions, future refinements]
```

---

## Summary of Key Constraints

| Constraint | Rule |
|-----------|------|
| Database | Supabase PostgreSQL, @supabase/supabase-js, no ORM |
| Package Manager | npm only |
| APIs | Route Handlers (`src/app/api/**/route.ts`) |
| Auth | Supabase Auth email+password; verify token server-side |
| Matching | Prefer matching booked shifts; otherwise available shifts; random within same priority; transactional |
| Shifts | Multiple matching reservations allowed; no overlap for same driver or car |
| Roles | passenger (default), driver only; drivers can book as passengers |
| Validation | Runtime + TypeScript, not types alone |
| Secrets | Environment variables only; never expose to client |
| UI | No React components (backend API only) |
| Scope | Hackathon—do NOT add unrequested features |
