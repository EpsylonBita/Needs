# Market pricing

Two independent features:

- Buyer: `RetailComparison` beneath an item-for-sale listing. Store name and EUR item price only; each link opens the retailer product page in a new tab.
- Seller: `PriceGuidance` below the creation price field. An explicit lookup reveals a compact red-to-green gauge with a moving marker. Higher prices move left; more competitive prices move right. Evidence is collapsed behind Details. Price edits update the marker locally; unknown/invalid evidence stays gray. It never changes the entered price or blocks publication.

## Direct Greek catalogues — no paid API

The scraper searches the stores' own public catalogues, then requests and verifies the specific product pages. It calls neither SerpAPI nor Google/DuckDuckGo. It needs no external API key, account, subscription, proxy service or added package. Requests use the application's existing hosting/network resources.

Supported sources (expanded from three to nine):

| Store | Discovery and price evidence | Coverage limits |
| --- | --- | --- |
| e-shop.gr | Public `/search` form; primary Product/Offer microdata, explicit NewCondition, EUR, matching SKU/URL/name and visible whole price | Exact model and variant; phone search uses its observed category link. ISO-8859-7 decoded. Known S25 supplemental S931 code normalized only for the base S25. |
| MrCheap.gr | Public OpenCart product-search form; Product JSON-LD with explicit NewCondition and InStock, matching visible whole price | Exact product title/variant; Sony Black SKU alias requires matching product code and color in that product's own description. |
| Sony Center | Public CS-Cart search; primary Product/Offer microdata, InStock and matching visible whole price | WH-1000XM4/5/6 family only. Standard retail stock inferred from the authorized retailer's normal catalogue, factory-warranty text and terms; this is not fabricated per-SKU NewCondition metadata. Used/refurbished/outlet/open-box/bundle evidence is excluded. XM4C revision remains distinct. |
| Msystems | Public `/search/?keywords=` catalogue, explicit JSON-LD NewCondition, primary visible price agreement and orderable stock | General technology catalogue; ambiguous capacities, M.2 sizes and model editions remain distinct. |
| Cosmodata | Public `/search?aq=` results and the primary purchase panel; machine/visible price agreement | Audited regular peripherals only: SKU 0.*, explicit standard manufacturer warranty, no used/refurbished/open-box evidence. This is an isolated standard-stock inference. JavaScript-only category redirects stay unsupported. |
| Musicland | Public `/search?q=`, exact title, explicit Product NewCondition/InStock and visible price agreement | Musical instruments and audio with a specific recognized model and known variant; unavailable products excluded. |
| Photoagora | Public CS-Cart search and primary camera-body purchase panel | Body-only stock, actual color feature, immediate availability and 24+ month Greek-distributor warranty. Isolated stock inference; explicit used/open-box evidence overrides it. Structured metadata, if present, must agree. |
| MPAKAS DIY | Public PrestaShop search, exact primary product record and Product JSON-LD | Tools: explicit `data-product.condition=new`, matching ID/SKU/title/URL and visible/data/structured whole prices. Bare-tool descriptions may explicitly exclude batteries/chargers. |
| Βαβίζος | Public PrestaShop search and primary product data | Appliances: explicit `condition=new` and matching visible/data/structured prices. Model suffixes such as `/70` and `/90` are retained. |

These are individually supported templates, not universal coverage of Greek shops. No prices are hardcoded into application code. Blocked stores, ambiguous identities, unsupported variants and changed layouts can yield no offer. No search snippet, installment, membership price or related-product price is substituted.

Optional server configuration:

```dotenv
# Disable retail scraping when needed (enabled by default).
PRICING_RETAIL_ENABLED=false
# Optional shared traffic ceiling; default 100 fresh product lookups/day, maximum 1000.
PRICING_SEARCH_DAILY_LIMIT=100
```

The existing `consume_rate_limit` RPC and server Supabase configuration must be available: crawling fails closed otherwise. Fresh lookups are limited to three per minute and 100 per day by default across application instances. At most two product lookups run concurrently per process. Each lookup checks the nine registered catalogues through a pool of three concurrent merchant flows, with a shared 25-second deadline. Each merchant performs one search and at most three candidate product reads, sequentially and stopping at its first verified quote. A failed merchant does not discard other stores' quotes. Results are deduplicated by store host, sorted by price and capped at 12; the buyer UI accepts this expanded bound.

Positive results are cached per process for six hours; empty/error results for ten minutes. Identical concurrent lookups share work. Within the shared deadline, each merchant has a 15-second total deadline, with at most seven seconds per page including DNS. HTTPS requests pin a verified public IPv4 address, follow at most two same-host/www redirects, cap HTML at 1 MiB and decode the declared charset. They do not execute JavaScript or bypass challenges. Unsupported HTTP responses, private IPs, cross-store URLs and unsafe redirects are rejected. The E2E server sets `PRICING_RETAIL_ENABLED=false`; `NEEDS_E2E=1` independently disables external crawling.

## Live verification, 2026-10-27

The final integrated scraper, including the real DNS-pinned HTTP transport and price-consistency guards, returned these observations at 19:10 UTC. These are observations at that time, not permanent prices:

| Exact product | Store | Observed price | Direct product page |
| --- | --- | ---: | --- |
| Sony WH-1000XM5 Black | MrCheap.gr | €227.00 | [Product](https://mrcheap.gr/sony-wh-1000xm5-wireless-bluetooth-headphones-wh1000xm5bce7) |
| Sony WH-1000XM5 Black | Sony Center | €299.00 | [Product](https://sonycenters.gr/ixos/akoystika/akoystika-kefalis/sony-wh-1000xm5b-asyrmata-akoystika-eksoydeterosis-thoryboy-mayro/) |
| iPhone 16 128GB Pink | MrCheap.gr | €1,023.00 | [Product](https://mrcheap.gr/iphone-16-128gb-pink-myea3ql-a) |
| Samsung Galaxy S25 128GB / 12GB / 5G Blue Black | e-shop.gr | €599.00 | [Product](https://www.e-shop.gr/kinito-samsung-galaxy-s25-128gb-12gb-5g-s931-blue-black-p-TEL.096612) |

Each lookup took approximately 2–3 seconds on this machine. The Samsung page marks the item PreOrder/orderable, not immediate stock; shipping/availability are intentionally absent from the buyer UI per the user's request. Additional research verified S25 Silver Shadow and Sony WH-1000XM4C Black independently. Some other stores blocked requests and were not integrated.

Run a bounded, read-only live check from `frontend` with the project's Node runtime and installed development dependencies:

```powershell
node scripts/verify-retail-live.mjs "Sony WH-1000XM5 Black" "iPhone 16 128GB Pink" "Samsung Galaxy S25 128GB 12GB 5G Blue Black"
```

The script accepts up to five explicit titles, emits timestamped actual results and exits nonzero when a requested product returns no quote. It directly exercises the production scraper; it creates no listing and is a manual diagnostic rather than an automatically recurring crawl. Application requests additionally use the shared rate limiter and result cache.

## Expanded live verification

On 2026-10-27 at 19:31–19:33 UTC, the integrated nine-store engine (actual public HTTPS transport, no price mocks) additionally returned:

| Product | Actual returned stores and EUR item prices |
| --- | --- |
| Logitech G305 Black | Msystems 42.50; e-shop.gr 44.79; Cosmodata 64.90 |
| Kingston NV3 1TB M.2 | Msystems 212.90 |
| Yamaha F370 Natural | Musicland 189.00 |
| Canon EOS R5 Black, body | Photoagora 2,799.00 |
| Makita DHP484Z | MPAKAS DIY 197.00 |
| Philips HD9252/70 | Βαβίζος 89.00 |
| Philips HD9255/60 | Βαβίζος 99.00 |
| Sony WH-1000XM5 Black (regression) | MrCheap.gr 227.00; Sony Center 299.00 |

Observed whole-look-up durations were 2.1–5.2 seconds. These prices are timestamped observations, not constants. Raw results are in `live-greek-pricing-expansion/root-live-new-products.jsonl` and `root-live-home-regression.jsonl`. Each new adapter also has two independently recorded product examples, normal search fixtures and negative evidence tests.

After independent review fixes, a final integrated live replay at 19:39 UTC returned the same G305, Yamaha, Canon, Makita and Philips quotes (`root-final-live.jsonl`), exercising every new source. Explicit used/open-box contradictions and hidden primary prices now override otherwise valid-looking metadata.

Recognition now includes computer peripherals/storage, networking, musical instruments, cameras, power tools and household appliances in addition to the existing phone/headphone families. Technical units such as 18V/DPI/PCIe are not mistaken for extra models. Meaningful distinctions remain: regional SKU suffixes, capacity/color, M.2 form factor, camera C/Mark editions, Logitech G502 variants and Mac/business editions, and musical keyboard key counts. Explicit accessory-for-product listings are rejected; unsupported generic goods still cannot be compared exactly.
## Identity and seller evidence

Identity comes from title/description text. Specific model families/codes, capacity, color and edition must match. Generic descriptions such as the current demonstration listing “Ακουστική κιθάρα · Δοκιμαστική” have no identifiable exact product and intentionally return no prices. Retailer adapters enrich a product name only with evidence from that product's own metadata; unknown SKU revisions remain unmatched. Some stores include additional RAM/connectivity/color detail, so complete titles improve coverage.

Seller comparisons read only active public NEEDS offers from the last 180 days through anonymous Supabase access. The bounded prefilter retrieves at most 100 recent candidates. It excludes requests, free items, demo/test records and the seller's own profiles. Private chats/payments and completed-sale amounts are never used.

- Products require matching model/variant and explicit comparable condition.
- Services require matching normalized title and described scope, the same explicit hourly/daily/monthly/fixed-job basis, and coordinates within 25km. Removing the stated price preserves work quantities and inclusions.
- At least five distinct sellers must remain after outlier filtering. Each seller contributes one median-price vote. The range is observed asking-price evidence, not a claim about completed sales.
- Three verified new-retail offers can guide an explicitly new item. Used items receive new-retail prices only as a separate reference; no invented depreciation or used-price color is derived from them.

Insufficient evidence and errors remain neutral. Draft endpoints are authenticated, CSRF-protected, bounded and rate-limited. Changed drafts cancel/discard stale results. No database migration is required.

## Verification

The final pricing suite covers captured real merchant markup, exact variants, new-stock evidence, conflicting visible/structured prices, installments/member prices, related products, URL/DNS safety, failed sources, quotas and caching. Existing creation/search suites cover the unchanged buyer and seller UI contracts. TypeScript, scoped ESLint and a production build are checked.

Nine Playwright checks displayed the freshly scraped Sony/iPhone/Samsung prices in desktop light, desktop dark and Greek 320px layouts: correct price/store-only rows, direct new-tab links, no horizontal overflow or browser errors. Only listing storage/API presentation was simulated; quoted amounts came from the separate live scraper run. No live listings were created or changed. Raw timestamped observations and browser screenshots are in the task's `live-greek-pricing` artifact directory.

The expanded final version passed 576 affected unit/component tests, scoped ESLint, TypeScript and a production build. Sixteen additional Playwright checks on that production build covered seven products on desktop and Greek320, plus an explicitly synthetic nine-store capacity check. Actual displayed merchant amounts came from the live observations above; fixture listings were never written to the live database. There were no page errors or horizontal overflow. Evidence is under `live-greek-pricing-expansion/browser-qa`.
