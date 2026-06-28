# SKILLS.md

Skills and competency areas required to build and maintain DChill Outpost. Useful for staffing, for routing tasks to the right specialist, and for an AI agent to self-assess whether a task is in scope.

---

| Area | What it covers | Why it matters here | Key tools |
|---|---|---|---|
| **Mobile app development** | React Native / Expo, navigation, device camera, offline-tolerant UX, app-store builds | The customer app is the primary product surface | Expo (current stable SDK), EAS Build, React Navigation |
| **Admin dashboard development** | React + Vite SPA, data tables, forms, realtime updates, role-gated UI | Staff run the whole store from here | React, Vite, TypeScript, TanStack Query |
| **Database / Supabase** | Postgres schema design, migrations, indexes, transactions, `pg_cron`, Storage, RLS | App data layer: users, roles, orders, carts, notifications, and the **Clover-synced catalog mirror** — **not** the POS inventory authority | Supabase, Postgres 15+, SQL |
| **Clover inventory sync & write-through** | OAuth/token refresh, catalog/stock sync, webhooks, idempotent upserts, Clover-first admin writes, conflict/drift handling | Clover is primary for products, categories, prices, barcodes, and stock; Supabase mirrors for app/RLS | Clover Inventory API, Edge Functions (`clover-sync-catalog`, `clover-sync-inventory`, `clover-sync-webhook`, `clover-create-or-update-item`, `clover-update-stock`, `clover-token-refresh`) |
| **Authentication** | Email/phone login, password reset, JWT sessions, OTP, secure session handling | Gatekeeper for every role and customer | Supabase Auth, Twilio Verify (OTP) |
| **Role-based access control (RBAC)** | Role/permission modeling, RLS policy design, privilege-escalation prevention, Owner protection | The Owner/Technology-Specialist boundary is a core requirement | Postgres RLS, `SECURITY DEFINER` functions, triggers |
| **Barcode scanning** | Camera-based UPC/EAN scanning, fast lookup, multi-barcode handling, manual fallback | Customer lookup + admin stock/price tools (reads mirror) | `expo-camera` `CameraView` |
| **Inventory management** | Stock reservation/decrement/restore, low-stock alerts, audit logging, status rules, Clover write-through | Prevents overselling; mirror must match Clover POS truth | Clover stock APIs, Edge Functions, `inventory_logs`, Postgres transactions |
| **Payments** | Clover Ecommerce / Hosted Checkout, server-side session creation, webhook confirmation + idempotency, OAuth/token handling, PCI scope minimization | In-app pickup payment | Clover (Hosted Checkout), Supabase Edge Functions |
| **SMS / email notifications** | Transactional messaging, templating, delivery logging, retries, A2P 10DLC compliance | Customers are kept informed at each order step | Twilio, Resend/SendGrid |
| **Backend / Edge Functions** | Server-side TypeScript, secure use of service role, owner-checked operations, webhooks, Clover API integration | Privileged work that must never touch the client | Supabase Edge Functions (Deno) |
| **Testing** | Unit, integration, RLS/security tests, edge-case and launch-readiness checks | Proves the Owner boundary and order/inventory correctness | psql test harness, Vitest/Jest, Playwright (optional) |
| **Security** | Secret management, least privilege, RLS, input validation, audit logging, threat modeling | Owner protection + secret hygiene are non-negotiable | RLS, env-based secrets, Sentry |
| **Deployment** | Managed hosting, mobile store submission, env/secret config, backups, monitoring | Get it live and keep it up | Supabase, Vercel/Netlify (admin), EAS, Sentry |
| **Documentation** | Clear specs, decision records, onboarding docs, runbooks | Lets new devs/agents continue without re-explanation | Markdown, this doc set |

## Minimum team shape (realistic)

- 1 full-stack developer comfortable with **Expo + Supabase + Postgres RLS + Clover APIs** can build the MVP.
- A **security-minded reviewer** should sign off on anything touching roles, RLS, the Owner boundary, or secrets.
- Store **Owner** must be available for the bootstrap (first owner account) and for any decision affecting ownership, payment model, or scope.
