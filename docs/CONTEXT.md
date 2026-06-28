# CONTEXT.md

Full project context for DChill Outpost. This is the "why and what" companion to `AGENTS.md` ("how to work") and `MEMORY.md` ("decisions to remember").

---

## Business overview

DChill Outpost is a Caribbean and international grocery store in Rocky Mount, North Carolina. It sells meats, produce, drinks, seasonings, snacks, frozen items, household goods, and Caribbean specialty products. The owner wants to modernize store operations and make shopping more convenient by letting customers browse the catalog, check prices and stock, and reserve a pickup order from their phone — while giving staff a single dashboard to run products, inventory, pricing, orders, and customer communication.

The business starts as **one store**, with the system designed so a second location could be added later without a rebuild.

## Target users

- **Customers** — local shoppers who want to see what's in stock, check prices, and place a pickup order ahead of time. Many are looking specifically for Caribbean/international items that are hard to find elsewhere.
- **Store staff** — cashiers and floor staff who prepare orders and keep stock accurate.
- **Inventory & order specialists** — staff focused on stock counts, pricing, and order fulfillment.
- **Managers / Admins** — run day-to-day operations and oversee staff.
- **Technology Specialist** — maintains the app, troubleshoots, configures the system, supports staff, and administers users below the Owner.
- **Owner** — the highest authority; owns the business and the system.

## App goals

1. Let customers browse the live catalog with prices and stock status.
2. Let customers scan a barcode to find a product instantly.
3. Let customers place and track a **pickup** order, and pay in-app.
4. Notify customers by SMS and email at each meaningful step.
5. Give staff one dashboard to manage products, inventory, pricing, orders, pickup rules, notifications, users, and reports.
6. Keep the system fast to operate, secure by default, and realistic to build and maintain.

## MVP scope

The first release focuses on the core that makes the store useful from day one:

- Customer accounts (sign up, log in, reset password, profile, saved addresses for account use only).
- Product browsing: categories, search (name/brand/category/**barcode**/keyword), product detail, stock status, filters, favorites, featured items.
- Barcode scanning (customer lookup + admin tools).
- Cart and **pickup** checkout with in-app payment (**Clover Hosted Checkout**) and pickup time-slot selection.
- Order tracking from placed → ready → completed.
- Admin dashboard: today view, product/inventory/price/barcode management, order management (accept, prepare, substitute, contact, ready, complete, cancel), pickup rules, notification logs + resend, basic reports.
- Role-based access control with the **Technology Specialist** role and **protected Owner** role.
- SMS + email notifications.

## Pickup-only rule (hard scope boundary)

**The MVP is pickup only.** There is no delivery, delivery-lite, courier, driver, delivery fee, or delivery address in the launch product. Saved addresses exist for account purposes only, not for shipping. Delivery is a clearly separated **future phase** (see below) that will require its own schema additions and is never to be slipped into MVP work.

## Customer app overview

React Native (Expo). Customers browse categories, search, scan barcodes with the device camera, view product detail (image, price, size, brand, stock), favorite items, build a cart, choose an available pickup time slot, add order notes (e.g., substitution preferences), pay in-app, and track status. They receive SMS/email updates and can view order history and reorder.

## Admin dashboard overview

React + Vite web app sharing the Supabase backend. Staff and elevated roles get a "today" view (orders, pending, completed, low stock, sales activity) and tools to manage products, inventory, prices, barcodes, orders, customers, pickup rules and time slots, notifications (with resend and failure tracking), users, roles, reports, and basic settings. Access to each tool is governed by role + permissions, enforced by RLS in the database — not just hidden in the UI.

## Inventory system overview

Each product has stock quantity, a low-stock threshold, and a status (in stock / low stock / out of stock / hidden / admin-only). Stock is **reserved** at checkout and **decremented** when an admin accepts the order; it is **restored** if the order is canceled. Out-of-stock items can't be ordered. Every stock change is written to an inventory log with who/when/why. Low-stock items raise dashboard alerts. Products can carry multiple barcodes, and barcode lookups are instant.

## Notification system overview

Customers receive SMS (Twilio) and email (Resend/SendGrid) for account creation, password reset, order placed, accepted, preparing, item unavailable/substitution, ready for pickup, completed, and canceled. Order-status messages always send; marketing respects opt-in. Every send is logged; failures are tracked and can be resent by staff. Email carries full receipt-style detail; SMS carries short urgent updates.

> **Compliance note:** US carrier registration (A2P 10DLC) is required before SMS reliably delivers and takes ~1–3 weeks to approve. Start it early; launch with email live and SMS enabled on approval. Password-reset OTP can use Twilio Verify, which is exempt.

## Barcode scanner overview

The device camera (via `expo-camera` `CameraView`) reads UPC/EAN codes. Customers scan to look up a product (price, stock, size, detail) and add it to the cart, with a clear "product not found" path. Admins scan to pull up a product, create a new product from a barcode, adjust stock, update price, and verify items while preparing an order, with duplicate-barcode warnings and a manual-entry fallback. One barcode maps to exactly one product; a product may have several barcodes.

## Future expansion notes (NOT in MVP)

- **Delivery** — its own build: fulfillment type, delivery addresses on orders, fees, zones, driver/hand-off flow, plus schema additions.
- Loyalty points, coupons/promo codes, saved payment methods.
- Push notifications.
- Advanced analytics and inventory forecasting; vendor/supplier ordering.
- Web ordering (browser) version.
- **Multi-location** support (per-store inventory and pricing).
