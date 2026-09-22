# Storefront support and accuracy fixes — 22 September 2026

Contact enquiries now reach the existing support inbox through Resend. The form validates required fields, prevents simultaneous submissions, preserves text on failure, and reuses a provider idempotency key on retries. It confirms submission only when Resend returns an accepted email ID. Acceptance is not proof of inbox delivery. The endpoint uses the existing `RESEND_API_KEY` / `resend_api_key`; no new paid service is required.

Restock requests no longer report success when both Airtable and email fail. Responses distinguish a stored request from a request submitted to support for manual follow-up. Reopening the dialog resets its button; a response from an older dialog cannot overwrite the next product's state. Existing Airtable configuration is retained.

Feedback submissions validate the rating, escape submitted text, and preserve the comment on a delivery-service error instead of showing a false thank-you page. Feedback links avoid sending their order/email token in referrer headers.

The monthly giveaway popup was removed: it previously claimed entry without saving or submitting the address. No promotional list, draw or campaign was activated.

Checkout now says the order was received and is awaiting payment. Reopening checkout clears its stale loading indicator. NAD+ quantity is consistently 500mg, matching its existing catalog size and price. The generic 99% minimum claim was replaced with product-specific supplier specifications. Archive links are explicitly identified as a general supplier archive, not proof of the currently supplied lot. Dates sort chronologically, and the directory links to a preselected lot-documentation enquiry. Unsupported blanket storage/shelf-life claims were replaced with a request to follow product-specific documentation. Research-agreement storage failures no longer stop the storefront script.

Existing product prices, sizes, bundle tiers and reorder discounts are unchanged. This release does not change order storage, inventory reservation or payment processing.

## Validation

- `node --test tests/storefront-support.test.js`: 12 passing checks covering validation, provider failure, escaping, retry keys, fallback storage and script parsing.
- Browser checks on a local preview with simulated Resend/Airtable: contact failure preserves text; retry success clears fields; restock success, failure and support fallback; dialog reopening; lot-documentation request routing; mobile layout at 390px; no page JavaScript errors.
- No real test orders or support emails were sent. Live delivery and current lot certification cannot be proved by mocked-service tests.

## Remaining factual dependencies

Current lot numbers and actual matching certificate URLs must come from the business before publishing batch-specific verification claims. The legal business name and ABN also remain unverified. Product-specific promotion, automated repeat-sale campaigns, public advertising and new marketing providers remain dependent on the permitted sales model and applicable provider policies. No approvals or eligibility are implied by a research-use checkbox.
