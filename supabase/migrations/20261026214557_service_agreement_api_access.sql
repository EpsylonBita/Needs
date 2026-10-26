-- Agreement data is read through the authenticated API, which validates the
-- exact conversation participants. Keep RLS as defense in depth without an
-- unnecessary browser/GraphQL table-read grant.
begin;
revoke select on public.service_price_agreements from authenticated;
commit;
