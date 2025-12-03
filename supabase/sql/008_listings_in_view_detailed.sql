create or replace function listings_in_view_detailed(min_lat float, min_lon float, max_lat float, max_lon float)
returns table (
  id uuid,
  title text,
  description text,
  price numeric,
  seller_id uuid,
  lat float,
  lon float
)
language sql
stable
as $$
  select
    l.id,
    l.title,
    l.description,
    l.price,
    l.seller_id,
    ST_Y(l.location::geometry) as lat,
    ST_X(l.location::geometry) as lon
  from listings l
  where l.location && ST_SetSRID(ST_MakeBox2D(ST_Point(min_lon, min_lat), ST_Point(max_lon, max_lat)), 4326)
$$;