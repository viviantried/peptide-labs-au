# PeptideLab storefront research and redesign

Reviewed 11 September 2026. This is a website/merchandising comparison, not a product-safety endorsement, supplier quality audit, or recommendation for human use.

## What the current websites show

| Benchmark | Observed merchandising and trust pattern | Application to PeptideLab |
| --- | --- | --- |
| [Core Peptides](https://www.corepeptides.com/) | Searchable catalogue, visible unit sizes/prices, testing claims, support contact and a US free-delivery threshold. | Search and filter without account creation; show supplied quantity, prices and delivery rules before checkout. |
| [Biotech Peptides](https://biotechpeptides.com/) | Prominent search, HPLC-MS/independent-testing messaging and links to shipping and returns. The homepage features BPC-157, BPC-157/TB-500 blends and Tesamorelin among other products. | Specific documentation paths and nearby shipping/returns information. Do not copy manufacturing or test claims without evidence. |
| [Limitless Biotech](https://limitlesslifenootropics.com/) | Research-category navigation, quick view, wish lists, research bundles and add-ons. Its “Leading Research Products” section includes BPC-157, TB-500, GHK-Cu and reconstitution solution. | Compare specifications, optional laboratory-supply addition, and existing quantity savings. No health-goal stacks or auto-added products. |
| [Bachem](https://www.bachem.com/) | Institutional CDMO positioning, named locations, history, separate research and clinical/commercial services, analytical and regulatory information. | Clear business identity and research scope. Bachem's clinical manufacturing credentials must not be represented as PeptideLab's credentials. |
| [GenScript](https://www.genscript.com/peptide.html) | Detailed technical specifications, peptide FAQs, purity/content explanations and technical support. | Scannable specifications and visible documentation limitations, rather than generic purity badges alone. |
| [Peptide Sciences](https://www.peptidesciences.com/index.php) | Its official site currently announces that operations and research-product sales have ceased. | Exclude from active-supplier recommendations; older comparison articles can be stale. |

## Best-seller limitations

No audited sales volumes or market-wide best-seller rankings were available in the pages reviewed. A featured section, an alphabetically arranged catalogue, or a seller's “leading products” label does not establish sales rank.

BPC-157, TB-500 and GHK-Cu are recurring prominent catalogue examples. Retatrutide remains part of the user's existing catalogue. The site uses “Featured selection” and “Compound spotlight”, not unverified best-seller claims. Product-level paid-order data is needed to determine PeptideLab's actual top sellers.

## Conversion evidence applied

[Baymard's product-page research](https://baymard.com/blog/current-state-ecommerce-product-page-ux) supports showing unit prices, shipping estimates and return information in the buying area. It also highlights the discoverability problems of horizontal product-information tabs. The redesign adds delivery estimation and quantity pricing and replaces those tabs with expandable sections.

Competitor observations suggest useful patterns; they do not establish that an individual feature will increase conversion for this store. Measure the result with PeptideLab's own traffic and paid-order data.

## Implemented

- Existing logo preserved; light product surfaces and a dark navigation shell.
- Homepage, catalogue and product pages redesigned with responsive layouts.
- Discreet packaging and worldwide shipping featured with destination/customs qualifications.
- Interactive spotlight, product discovery, tolerant search, sorting and availability filtering.
- Comparison of up to three products by quantity, price and listed specification.
- One-, two-, three- and five-unit selectors with the existing discount tiers.
- AU/NZ/international delivery calculators using the same storefront shipping rules as checkout.
- Device-local cart recovery for seven days; only product IDs and quantities are stored, and prices are reconstructed from the catalogue.
- One optional laboratory-supply addition; no preselected add-on or forced bundle.
- Keyboard-operable cart controls, focus handling, reduced-motion styling and mobile product CTA.
- Generic popularity badges removed from rendered cards; NAD+ specification corrected to match its 500mg catalogue variant.
- Supplier certificate-directory links labelled as references rather than order-specific certificates.

## Unchanged commercial rules

- All requested product prices retained; payments remain in AUD.
- Free standard shipping at a pre-discount product subtotal of A$200; express upgrade A$5.
- Below A$200: AU A$10/A$15; NZ A$15/A$28; other eligible destinations A$20/A$40 (standard/express).
- Existing quantity discounts: 2 units 3%, 3–4 units 5%, 5+ units 10%.
- Existing bank-transfer APIs, customer emails, order records and inventory backend preserved.

## Verification and remaining work

Run `node tests/storefront.test.cjs` for dependency-free checks of asset references, HTML IDs, catalogue/API price and size parity, regional shipping, discounts, search/filter/sort, comparisons, stock limits and saved-cart repricing. No real orders, emails or transfers are created by these checks.

The Vercel preview requires authentication. Visual desktop/mobile QA and a real international payment reconciliation have not been completed. Do not treat a successful build or calculation check as proof of bank settlement.

Before production rollout, verify physical packaging, dispatch/transit estimates, carrier availability by destination, accurate bank/beneficiary details and batch-matched reports. Existing broader business/product claims elsewhere on the site still need the owner's documentary substantiation. No new reviews, laboratory credentials or legal compliance claims were invented.

For measurement, distinguish submitted orders from paid orders. Record product view → add to cart → checkout start → order submitted → payment verified, split by device and destination. Track revenue and paid-order AOV alongside abandonment; do not call an unpaid bank-transfer submission a completed sale.
