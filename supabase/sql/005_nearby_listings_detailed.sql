create or replace function nearby_listings_detailed(lon double precision, lat double precision, radius_m integer)
returns table (
  id uuid,
  title text,
  description text,
  price numeric,
  seller_id uuid,
  lat double precision,
  lon double precision
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
  where ST_DWithin(
    l.location,
    ST_SetSRID(ST_MakePoint(lon, lat), 4326),
    radius_m
  )
  order by ST_Distance(
    l.location,
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  );
$$;