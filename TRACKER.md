# PeptideLab order and inventory tracker

Implementation is prepared on `codex/order-inventory-tracker`. It is not active until the database is provisioned, migrated, and the production deployment has `TRACKER_ENABLED=true`.

## Store owner

After activation, open `/admin` on the store and enter the admin key. New orders save directly to a private database before any email attempt. The dashboard shows contact and shipping details, line items, payment/dispatch state, email acceptance/failure, and live stock. It refreshes every 30 seconds while open. Optional browser alerts require this tab to remain open; they are not background push notifications.

Inventory shows physical units, reserved units, and available units. New orders reserve stock for 24 hours. Marking payment received retains that reservation; dispatch removes physical units. Cancelling or expiring an unpaid order releases the reservation. Expiry is reconciled on inventory reads, dashboard reads and checkout; no scheduled job is required for accurate availability at the next request.

Payment must be verified against the bank account manually. Dashboard actions record payment and dispatch; they do not send customer messages. Existing signed email actions also update the database. Confirmation links now ask for an explicit submit so email scanning cannot confirm payment automatically. The old stocktake page redirects to the tracker once activated.

Email “accepted” means accepted by the provider, not delivered to the inbox. Failed or unfinished email attempts remain visible. No automatic resends or delivery webhook are included. A successful checkout never depends on email availability after the tracker is enabled.

Export orders to CSV for a separate copy. The dashboard displays the latest 500 orders; export includes up to 10,000 and refuses to silently truncate larger histories.

## Activation checklist

1. Sign in to the Vercel CLI and verify which project owns **aupeptidelab.com**. The account has both `peptide-labs` and `peptide-labs-au`; do not infer the production target from its name. Current source origin is `viviantried/peptide-labs-au`.
2. Provision a Neon database using the Vercel Marketplace, choosing a free plan if available. Keep preview and production databases separate. Link the correct Vercel project before using environment commands.
3. Set `DATABASE_URL` through the integration. Set a strong private `TRACKER_ADMIN_KEY` (32 random bytes); otherwise the existing `admin_key` / `ADMIN_KEY` is used. Never put the admin key in a URL, Git, public assets, or a customer email.
4. Run `npm run db:migrate` with the target database environment. Migration is repeatable; opening counts are copied from `inventory.json` only for SKUs that do not already exist. Existing stock and orders are not overwritten.
5. Reconcile opening stock with a physical count and any outstanding orders before activation. Existing `inventory.json` is a starting balance, not proof of physical stock. Historic Airtable orders have not been imported and must not be assumed to be present. If available, inspect and reconcile them separately without subtracting stock twice.
6. Validate checkout and the dashboard against a separate preview database, with email sending disabled for test orders. Check failed email, failed persistence, retry, bundle quantities, insufficient stock, payment, cancellation and dispatch.
7. Enable `TRACKER_ENABLED=true` on production, deploy the tested branch, and verify `/api/inventory` plus authenticated `/api/tracker`. Keep the existing payment and email configuration. Avoid test orders that email real customers or change production inventory.
8. Record the activation time, initial count and private admin-key handover. Verify provider backups/retention and make an initial CSV export. Do not describe automatic off-provider backups as enabled: only manual CSV export is included.

## Verification and local preview

`npm test` exercises the SQL schema in an isolated Postgres-compatible PGlite database and the real checkout handler with email delivery disabled. It covers order/stock atomicity, duplicate retries, conflicting requests, stock contention, payment/dispatch, cancellation/expiry, stale stocktake protection, bundle quantities, email failure, database failure, and authentication.

`node scripts/preview-tracker.js` serves a local-only end-to-end preview at `http://127.0.0.1:4318/admin`. Its key is `local-preview-only`; all records are test data, and every outbound fetch is blocked. It does not connect to Neon or send email. This script, the schema, and tests are excluded from deployment.

## Operations

If the database cannot confirm a new order, checkout responds with an error and no payment reference. If the network loses the response after a successful write, the browser reuses its checkout key and retrieves the original order rather than reserving twice. Keep database credentials and deployment access available independently of email.

Once production has accepted tracker orders, do not disable the tracker or roll back to the old static-inventory checkout: doing so would ignore reservations and stop capturing orders. Fix forward or temporarily pause checkout while reconciling the database.
