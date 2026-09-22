# Giveaway entries in Resend

The monthly A$250 giveaway popup is restored with an actual server-side Resend integration. Its footer button allows visitors to reopen it. Automatic display waits until the research notice is dismissed, avoids contact/cart/checkout pages, and only appears if the configured Resend list is reachable. A dismissal suppresses it for seven days; a confirmed entry suppresses automatic display in that browser. The old popup's unsaved-entry flag is deliberately ignored.

`POST /api/giveaway` validates the email and entry consent, looks up an existing Resend contact, creates it if needed, and adds it to the configured list. Success requires Resend to acknowledge both the contact and its list membership. Existing contacts and opt-outs are preserved. New contacts are globally unsubscribed unless they explicitly select optional marketing. This endpoint does not send emails, run a draw, select winners or schedule campaigns.

The existing `RESEND_API_KEY` / `resend_api_key` and `RESEND_AUDIENCE_ID` / `resend_audience_id` settings are supported. If set, `RESEND_GIVEAWAY_SEGMENT_ID` overrides the general audience for separate giveaway membership. Resend now calls audiences segments. The API key must permit contact/list management. `GET /api/giveaway` verifies access to the configured list and returns only an availability flag.

Run `npm test` for regression tests, including provider failure, duplicate entry, concurrent creation, subscription preferences and the existing order tracker. Browser validation uses a local mock of Resend; no real entrants or emails are needed for those tests. A successful live availability check validates the configured connection but does not itself create an entry.
