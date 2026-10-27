Sony Center fixture provenance
==============================

Captured from anonymous HTTP 200 responses on 2026-10-27. These are excerpts of actual server-rendered HTML: primary Product/Offer ancestry, h1, canonical link and factory-warranty text are retained. Unrelated blocks are omitted. Test-only mutations cover rejected cases.

Sources:

- Search: https://sonycenters.gr/?dispatch=products.search&search_performed=Y&q=WH-1000XM5&pname=Y&pcode_from_q=Y
- Search: https://sonycenters.gr/?dispatch=products.search&search_performed=Y&q=WH-1000XM4&pname=Y&pcode_from_q=Y
- XM5 Black: https://sonycenters.gr/ixos/akoystika/akoystika-kefalis/sony-wh-1000xm5b-asyrmata-akoystika-eksoydeterosis-thoryboy-mayro/
- XM4C Black: https://sonycenters.gr/ixos/akoystika/akoystika-kefalis/sony-wh-1000xm4c-noise-cancelling-asyrmata-over-ear-akoystika-black/
- Retailer policy: https://sonycenters.gr/oroi-khrisis
- Manufacturer retailer reference: https://www.sony.gr/electronics/akoustika-me-sthrigma-kefalhs/wh-1000xm5/buy/wh1000xm5b.ce7

Observed whole-item prices were EUR 299.00 and EUR 259.00, with InStock in the same Offer. These values are historical fixtures, never production fallback prices. The XM4C revision must remain distinct from XM4. The XM5B suffix identifies the explicitly black variant; the adapter's source-specific normalization does not remove other revision suffixes.

Condition evidence: the retailer does not publish itemCondition on these pages. The isolated adapter uses a documented standard-catalogue inference: manufacturer-linked Sony Center, normal retail product layout, explicit factory Sony warranty, and retailer terms describing manufacturer warranty from purchase and new-unit DOA replacement. Used/refurbished/outlet/open-box and conflicting explicit condition evidence are rejected. This inference is not an explicit per-unit NewCondition assertion and must not be reused by the generic merchant verifier.

A separate fresh anonymous Node HTTP run at 2026-10-27T19:04:38Z followed each adapter-generated search URL, selected the exact product and parsed its full live HTML successfully. Both searches and both product requests returned HTTP 200. Full response snapshots and the timestamped JSON report are in the task's external `live-greek-pricing/plaisio-research` evidence directory.
