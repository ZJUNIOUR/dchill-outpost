# AGENTS.md

Instructions for AI coding agents (Claude Code, Cursor, etc.) working on the **DChill Outpost** repository. Read this file, `docs/CONTEXT.md`, and `docs/MEMORY.md` before making any change. If a request conflicts with the rules here, stop and surface the conflict rather than guessing.

---

## 1. Project in one paragraph

DChill Outpost is a Caribbean/international grocery store in Rocky Mount, NC. We are building a **pickup-only** supermarket app: a customer mobile app (browse inventory, see prices, scan barcodes, place pickup orders, get SMS/email updates) and an admin dashboard (products, inventory, pricing, orders, pickup rules, notifications, users, reports). Backend is Supabase (Postgres + Auth + RLS + Storage + Edge Functions). **Delivery is not in the MVP.**

## 2. Golden rules (never violate)

1. **The Owner role is sacred.** Owner is enum value `owner_admin`. No code path, migration, policy, function, seed, or agent action may let any non-owner create, assign, remove, demote, delete, deactivate, impersonate, edit the credentials of, or otherwise affect an `owner_admin`. This is enforced at the database layer (RLS + the `protect_owner_admin` trigger) and must stay that way.
2. **Technology Specialist is powerful but below Owner.** `technology_specialist` may manage everything operational and all users **below** owner. It must never gain owner power. See §6.
3. **Secrets are server-only.** The Supabase `service_role` key and any other backend secret must never be imported into the mobile app, the admin web client, client-side bundles, committed files, or exposed to a Technology Specialist. They live only in Edge Function / server runtime env.
4. **MVP is pickup-only.** Do not add delivery, delivery-lite, or driver logic unless a task is explicitly marked as a post-MVP future phase.
5. **Never weaken a security control to make a feature pass.** If RLS or a trigger blocks you, that is usually correct. Fix the feature, not the wall.

## 3. Coding standards

- **Languages:** TypeScript everywhere (mobile, admin web, Edge Functions). SQL for migrations.
- **Mobile:** React Native via Expo (target the **current stable Expo SDK**). Barcode scanning uses `expo-camera`'s `CameraView` (`onBarcodeScanned`) — `expo-barcode-scanner` is deprecated, do not reintroduce it.
- **Admin web:** React + Vite + TypeScript.
- **Style:** Prettier + ESLint (strict). No `any` without a written reason. Prefer pure functions and explicit return types on exported functions.
- **Money:** never floats for currency math in app logic; use integer cents or `numeric` in DB and a decimal library client-side. DB stores `numeric(10,2)`.
- **Time:** store UTC (`timestamptz`); render in `America/New_York`. Pickup slots carry explicit local date + time.
- **No secrets in code or logs.** Read config from env. Never `console.log` a token, key, password, or full PII.
- **Errors:** fail closed. On an authorization check error, deny.

## 4. Database safety rules

- **Migrations are forward-only and reviewed.** Never edit a shipped migration; add a new one. Name them `NNNN_description.sql`.
- **Never disable RLS** on `users`, `pickup_orders`, `pickup_order_items`, `notifications`, `audit_logs`, `system_settings`, or any table holding PII/financial data. If a query needs to bypass RLS, it runs in a `SECURITY DEFINER` function or server-side with the service role — not by turning RLS off.
- **Do not drop or alter** these objects without an explicit, owner-approved task: the `user_role` enum's `owner_admin`/`technology_specialist` values, `auth_user_role()`, `protect_owner_admin()`, the `trg_protect_owner_admin` trigger, or any `users_*` RLS policy.
- **Every role-bearing or credential-touching change must keep the test suite green** (`test_technology_specialist_rbac.sql`). If your change makes that suite fail, your change is wrong until proven otherwise.
- **Seed data must never create a second `owner_admin`** except through an explicit, human-owner-run bootstrap.
- Inventory writes go through the documented transactional path (reserve at checkout, decrement on accept, restore on cancel) — never ad-hoc `UPDATE inventory`.

## 5. Supabase / RLS rules

- Authorization has two layers and you must keep both: **RLS policies** (the hard wall in Postgres) and **UI gating** (courtesy hiding in the app). UI gating alone is never sufficient.
- Use the `auth_user_role()` `SECURITY DEFINER` helper inside `users`-table policies to avoid RLS recursion. Do not inline `SELECT role FROM users` in a `users` policy.
- New tables that hold store or customer data: enable RLS immediately and write policies in the same migration. A table without policies is a bug.
- Edge Functions that use the service role must **re-derive the caller's role from the database** (not from client input or JWT-supplied role claims) before doing privileged work, and must apply the Owner-protection rule. See `owner-checked-credential-change.ts` as the reference pattern.

## 6. How to handle roles (Owner & Technology Specialist)

- Canonical role lives in `users.role` (`user_role` enum). Fine-grained capabilities live in `role_permissions`. The enum is the security source of truth; the permission catalog drives feature gating.
- **Owner (`owner_admin`)**: only an existing owner may affect another owner. Treat any task that would let a lesser role touch an owner as a security incident in spec form — refuse and escalate.
- **Technology Specialist (`technology_specialist`)**: may manage products, inventory, pricing, barcodes, orders, customers, pickup rules, notifications (incl. resend), reports, basic settings, maintenance/testing/debug tools, scoped DB troubleshooting, and all users/roles **below** owner. May **not**: assign/remove/create/demote/delete/deactivate an owner; edit an owner's email/phone/password/credentials; transfer ownership; change ownership-level permissions; modify role-hierarchy/security rules; read service-role keys or backend secrets; act as database/system owner.
- When adding any user-management or role-assignment feature, the allowed target set is "roles strictly below owner." Encode that as a check, and add/extend a test asserting an owner target is rejected.

## 7. What agents must NEVER change without explicit owner sign-off

- The Owner-protection trigger, function, or policies.
- The meaning or removal of the `owner_admin` enum value.
- Anything that grants `technology_specialist` (or lower) a path to owner power.
- Service-role key handling (location, exposure surface).
- The pickup-only scope of the MVP (no delivery).
- Payment model assumptions in `docs/MEMORY.md` (change only via a labeled decision).

## 8. Testing expectations

- Run `test_technology_specialist_rbac.sql` against a disposable DB on every change that touches roles, users, policies, triggers, or credential flows. It must report **all PASS**.
- Add a test when you add a capability that crosses a role boundary. New owner-adjacent capability ⇒ new "owner target is rejected" assertion.
- Unit-test pure logic (pricing, slot eligibility, cart totals). Integration-test order flow and notification triggers.
- No PR that reduces coverage of the Owner-protection or Technology-Specialist-restriction paths.

## 9. Commit / PR checklist

Before opening a PR, confirm:

- [ ] No secret, key, token, password, or raw PII added to code, fixtures, or logs.
- [ ] RLS enabled + policies written for any new data table.
- [ ] `test_technology_specialist_rbac.sql` passes (attach output for role/credential changes).
- [ ] No delivery functionality introduced into the MVP scope.
- [ ] Owner-protection objects untouched (or change explicitly owner-approved and re-tested).
- [ ] Migrations are new, forward-only, and named correctly.
- [ ] Lint + typecheck clean; exported functions typed.
- [ ] Updated `docs/MEMORY.md` if a durable decision changed.
- [ ] Conventional commit message; description states the role/security impact ("no role-boundary impact" is a valid statement).

## 10. When unsure

If a request is ambiguous about roles, secrets, payment, or scope: do not improvise. State the ambiguity, cite the relevant rule here or in `docs/MEMORY.md`, and ask. A blocked task is recoverable; a leaked secret or a broken Owner boundary may not be.
