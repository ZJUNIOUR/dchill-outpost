# PROJECT_BRIEF.md

## Project title

**DChill Outpost — Pickup Ordering & Store Management Platform**

## Executive summary

DChill Outpost, a Caribbean/international grocery store in Rocky Mount, NC, will launch a custom mobile app and admin dashboard that lets customers browse the live catalog, check prices and stock, scan barcodes, and place **pickup** orders with in-app payment — while giving staff one secure dashboard to manage products, inventory, pricing, orders, pickup scheduling, customer communication, users, and reports. The platform is built on a managed, secure stack (Supabase + React Native/Expo + React admin, with **Clover** for payment processing) and ships with strict role-based access control, including a powerful new **Technology Specialist** role and a database-protected **Owner** role. The MVP is deliberately scoped to **pickup only** (delivery is future-ready but disabled) so it is realistic to build, easy to operate, and ready to grow.

## Problem statement

Today the store has no digital storefront. Customers can't see what's in stock or check prices before visiting, can't reserve hard-to-find Caribbean items, and have no way to order ahead. Staff manage inventory and pricing manually, with no central view of orders, stock levels, or customer communication. This costs time, causes wasted trips and missed sales, and makes it hard to scale or maintain accuracy.

## Proposed solution

A two-part system on one backend:

1. **Customer mobile app** — browse, search, scan, favorite, cart, choose a pickup time slot, pay in-app, and track the order, with SMS/email updates.
2. **Admin dashboard** — a single control center for products, inventory, pricing, barcodes, orders, pickup rules, notifications, users/roles, and reports.

Security is built in: role-based access enforced in the database (not just the UI), a protected Owner role, a capable-but-bounded Technology Specialist role, and server-only secrets.

## MVP scope

Pickup-only ordering with: customer accounts; catalog browse/search/filter/favorites/featured; barcode scanning; cart + pickup time-slot checkout + in-app payment; order tracking; full admin dashboard (products, inventory, pricing, barcodes, orders, pickup rules, notification logs + resend, basic reports); role-based access with Technology Specialist and protected Owner; SMS + email notifications.

## User groups

- **Customers / Guests** — shop, scan, order, track (guests can browse before signing up).
- **Staff / Order Staff / Inventory Staff** — prepare orders, update status, scan items, keep stock and prices accurate.
- **Manager / Admin** — run operations, manage staff and settings, view reports.
- **Technology Specialist** — maintain and configure the system, support staff, administer users below Owner.
- **Owner** — highest authority; protected at the database layer.

## Key features

- Live catalog with prices and stock status; barcode lookup.
- Pickup ordering with admin-controlled time slots, prep time, and cutoffs.
- In-app payment at checkout via **Clover Hosted Checkout** (server-side; all Clover credentials server-only).
- SMS + email notifications at every order step, with resend and failure tracking.
- Inventory with reserve/decrement/restore logic, low-stock alerts, and full audit logging.
- Role-based access control with a protected Owner and a powerful, bounded Technology Specialist.
- Admin reporting (orders, popular products, low stock, sales trends).

## Business value

- **More sales, fewer wasted trips:** customers see stock and reserve items, especially hard-to-find Caribbean goods.
- **Faster, more accurate operations:** one dashboard replaces manual tracking; inventory stays honest.
- **Customer trust:** timely SMS/email updates and reliable pickup.
- **Safe to operate and grow:** strong security model, clean roles, and a stack designed for a second location later.

## Success criteria

- A customer can register, browse, scan, place and pay for a pickup order, and receive accurate status updates end to end.
- Staff can run an order from received to completed and keep inventory/pricing correct from the dashboard.
- Role permissions behave exactly as specified; the **Owner boundary is provably enforced** (the RBAC security test suite passes 100%).
- No secret is ever exposed to a client or a non-owner.
- The system is stable enough for daily store use and documented enough for another developer/agent to extend.

## Out-of-scope items (MVP)

Delivery / delivery-lite, loyalty/points, coupons/promo codes, saved payment methods, push notifications, advanced analytics/forecasting, vendor/supplier ordering, web (browser) ordering, multi-location support.

## Future phases

1. **Delivery** (dedicated build: fulfillment type, delivery addresses, fees, zones, driver flow).
2. Loyalty, coupons, saved payment methods, push notifications.
3. Advanced analytics & inventory forecasting; vendor ordering.
4. Web ordering and **multi-location** support.
