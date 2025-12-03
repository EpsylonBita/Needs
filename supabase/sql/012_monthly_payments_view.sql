create or replace view monthly_payments_agg as
select
  date_trunc('month', created_at) as month_start,
  extract(year from created_at)::int as year,
  extract(month from created_at)::int as month,
  sum(amount)::numeric(12,2) as volume,
  sum(platform_fee)::numeric(12,2) as fee
from payments
group by 1,2,3
order by 1;