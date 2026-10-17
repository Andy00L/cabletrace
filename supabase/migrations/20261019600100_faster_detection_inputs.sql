-- detection_inputs within the statement timeout: the detector's 17:04 UTC call on 17 Oct 2026 failed with "canceling
-- statement due to statement timeout" after 20261019500000_regional_recording.sql (12 s measured against 8 s). Only the
-- choice of cables changes; positions and vessels are the same as in that migration.

create or replace function public.detection_inputs(lookback_minutes integer default 360)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with window_positions as (
    select p.*
    from public.vessel_positions p
    where p.observed_at > now() - make_interval(mins => greatest(1, least(lookback_minutes, 1440)))
  ),
  -- DRAG_SPEED_MIN_KNOTS and DRAG_SPEED_MAX_KNOTS in src/lib/detection/drag-rules.ts. The drag-band report must also
  -- lie within its region's candidate distance of a cable; with candidate_cable_metres equal to near_cable_metres (3 km
  -- in every region today) that holds for every stored row, so the ships sent are those of 20261018300000.
  candidate_positions as (
    select w.*
    from window_positions w
    where w.mmsi in (
      select in_band.mmsi
      from window_positions as in_band
      join public.cables as cable on cable.id = in_band.nearest_cable_id
      join public.watched_regions as region on region.id = cable.region_id
      where (in_band.speed_knots is null or in_band.speed_knots between 2 and 9)
        and in_band.cable_distance_metres <= region.candidate_cable_metres
    )
  ),
  -- One box per candidate ship around its positions, grown by 0.25 degrees (more than the 10 km the detector looks for
  -- a cable within, up to about 78 N); a cable whose route overlaps a box comes clipped to the union of those boxes. A
  -- bounding-box test per ship, where the first form tested every position's geodesic distance to every cable: that
  -- took 12 s on 4,866 candidate rows (17 Oct 2026), past the 8 s statement timeout.
  ship_boxes as (
    select extensions.st_setsrid(extensions.st_expand(extensions.st_extent(candidate.position::extensions.geometry)::extensions.geometry, 0.25), 4326) as box
    from candidate_positions as candidate
    group by candidate.mmsi
  ),
  cable_reach as (
    select cables.id, extensions.st_union(ship_box.box) as reach
    from public.cables
    join ship_boxes as ship_box on cables.route::extensions.geometry && ship_box.box
    group by cables.id
  ),
  candidate_ships as (
    select distinct mmsi from candidate_positions
  )
  select jsonb_build_object(
    'positions', coalesce((
      select jsonb_agg(jsonb_build_array(
        p.mmsi,
        floor(extract(epoch from p.observed_at)),
        round(extensions.st_x(p.position::extensions.geometry)::numeric, 5),
        round(extensions.st_y(p.position::extensions.geometry)::numeric, 5),
        p.speed_knots,
        p.course_degrees,
        p.heading_degrees,
        p.navigation_status
      ) order by p.mmsi, p.observed_at)
      from candidate_positions p
    ), '[]'::jsonb),
    'vessels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mmsi', ship.mmsi,
        'name', coalesce(v.name, live.name),
        'shipType', coalesce(v.ship_type, live.ship_type),
        'draughtMetres', coalesce(v.draught_metres, live.draught_metres)
      ))
      from candidate_ships as ship
      left join public.vessels v on v.mmsi = ship.mmsi
      left join public.live_ships live on live.mmsi = ship.mmsi
      where v.mmsi is not null or live.mmsi is not null
    ), '[]'::jsonb),
    'cables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.name,
        'kind', c.kind,
        'route', extensions.st_asgeojson(
          extensions.st_multi(extensions.st_collectionextract(extensions.st_intersection(c.route::extensions.geometry, reach.reach), 2)),
          6
        )::jsonb
      ) order by c.id)
      from public.cables c
      join cable_reach as reach on reach.id = c.id
    ), '[]'::jsonb)
  );
$$;
