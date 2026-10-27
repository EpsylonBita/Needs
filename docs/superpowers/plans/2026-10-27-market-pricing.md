# Market Pricing Implementation Plan

**Goal:** Implement two independent experiences: direct retailer prices beneath a product listing, and evidence-based price guidance in listing creation.

**Architecture:** Server-only direct Greek retailer search and verified product-page parsing, cached and rate-limited route handlers, and two isolated UI components. Public NEEDS asking prices supply product/service comparisons. Existing listing text supplies identity and scope; ambiguous data returns a neutral result rather than invented prices. No database migration or private transaction access is needed. Direct e-shop.gr, MrCheap.gr and Sony Center adapters replace the unsuccessful search-engine discovery approach and initial paid SerpAPI design.

**Tech Stack:** Existing Next 16.4 / React / TypeScript / Supabase anonymous public reads / Vitest / Playwright; no additional dependencies.

**Spec:** The user approved implementation in this conversation after choosing retailer-direct links and only store + price in the buyer rows. Seller suggestions remain separate and never overwrite the entered price.

## Constraints and acceptance criteria

- Preserve all preceding design changes and the excluded homepage hero.
- Buyer: exact product and known variant, EUR item price agreeing with the primary visible price, retailer product URL opening a new tab. NewCondition is explicit for e-shop/MrCheap; Sony Center uses documented standard-catalogue/factory-warranty inference confined to that adapter. No shipping or other offer metadata in the UI.
- Seller: explicit reference lookup, then immediate text-and-color feedback as price changes. Products require a specific model and known comparable condition. Services require matching service scope, rate unit and nearby location. Exclude requests, freebies, own offers, duplicates and demonstration data. Require sufficient distinct sellers; label asking-price evidence honestly.
- New retail references never imply a fair used-item price. Unknown matches/data/provider failures remain neutral.
- No paid-provider calls or API key requirement; limit payload sizes, external timeouts, search traffic and cache lifetime. Never fetch a URL supplied by a browser.
- No live listing writes, deployment or remote migration. Commit/push were excluded from the original implementation phase and were subsequently authorized after verification. Live discovery checks must not bypass challenges; failed matching remains neutral.

## Ownership and execution

- [x] Shared contract: `frontend/lib/pricing/types.ts` (root).
- [x] Matching and statistics: `frontend/lib/pricing/matching.ts`, matching tests (listing_audit). Verify exact models/variants, condition, service scope/unit/location, sample floor/outliers and distinct sellers.
- [x] Seller UI: `frontend/components/features/ads/price-guidance.tsx`, minimal create-ad-dialog integration and component tests (creation_motion). Verify stale-response handling, input price independence and accessible neutral/colored states.
- [x] Retail adapter, public data access, routes, buyer panel and tests (root). Verify provider schema, new-condition evidence, safe direct URLs, caching, rate limits, auth and no fabricated fallback.
- [x] Independent review and provider schema review (motion_research).
- [x] Fresh integrated typecheck, scoped lint, tests and browser checks (root). Cover desktop/mobile and outage/empty/ready states with clearly marked fixtures; separately check live configuration without publishing anything.

## Review focus

- Similar product models, accessories and different capacities must not be called identical.
- An absent condition field must not become a generic guarantee of new stock; isolate and document any supported retailer-specific stock inference.
- Private chats, payments and authenticated-only listings must not become public benchmarks.
- Delayed requests must not show a previous draft's price advice.
- Missing API key or insufficient marketplace data must not block publishing a listing.

## Activation

No API key is needed. `PRICING_RETAIL_ENABLED=false` disables external crawling. The final integrated scraper was live-verified on 2026-10-27 with Sony WH-1000XM5 Black (two stores), iPhone 16 128GB Pink and Galaxy S25 128GB Blue Black. Real quotes appear in the existing buyer UI; no paid service or search engine is called. Unsupported identities/stores remain neutral. See `docs/market-pricing.md` for observed prices, source-specific coverage and the repeatable live verification command.

## Wider Greek coverage follow-up

The user requested more stores and product categories, still without paid APIs. Six additional audited catalogue integrations extend the source list to nine: Msystems, Cosmodata, Musicland, Photoagora, MPAKAS DIY and Βαβίζος. New recognition covers peripherals, SSDs, musical instruments, cameras, tools and appliances. Exact model/variant requirements, neutral failure behavior and the store/price-only UI remain binding.

- [x] Two live product examples per new source and bounded pure parsing adapters with recorded fixtures.
- [x] Shared model/brand normalization, slash suffixes, technical-unit handling and edition/form-factor regressions.
- [x] Three-worker catalogue pool, 25-second overall deadline, per-shop bounds and expanded 12-offer server/UI contract.
- [x] Root live integration: six new product categories, a three-store G305 comparison and prior Sony regression.
- [x] Final integrated regression tests, lint/type/build and desktop/mobile presentation checks after independent review fixes: 576 affected tests, 16 Playwright checks, scoped ESLint and production compilation/TypeScript passed. Final live replay at 19:39 UTC revalidated all six new sources through five representative products.
