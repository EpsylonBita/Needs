create or replace function nearby_listings(lon double precision, lat double precision, radius_m integer)
returns setof listings
language sql
stable
as $$
  select *
  from listings
  where ST_DWithin(
    location,
    ST_SetSRID(ST_MakePoint(lon, lat), 4326),
    radius_m
  )
  order by ST_Distance(
    location,
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  );
$$;