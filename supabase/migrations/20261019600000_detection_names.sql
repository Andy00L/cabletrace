-- Detections in the aisstream regions name their ship. public.vessels holds the names Digitraffic sends for the Gulf
-- of Finland; ships heard only by aisstream have theirs in public.live_ships (20261018400000_ship_frames.sql), which
-- the two public detection functions now read when vessels has none. Both stay capped as before.

create or replace function public.recent_detections(since_hours integer default 72)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'mmsi', ranked.mmsi,
    'name', ranked.name,
    'level', ranked.level,
    'score', ranked.score,
    'startAt', ranked.start_at,
    'endAt', ranked.end_at,
    'evidence', ranked.evidence,
    'cableCrossings', ranked.cable_crossings,
    'firstDetectedAt', ranked.first_detected_at,
    'updatedAt', ranked.updated_at
  ) order by ranked.rank_order), '[]'::jsonb)
  from (
    select d.*, coalesce(v.name, live.name) as name, row_number() over (order by d.level = 'alert' desc, d.score desc, d.start_at desc) as rank_order
    from public.detections d
    left join public.vessels v on v.mmsi = d.mmsi
    left join public.live_ships live on live.mmsi = d.mmsi
    where d.end_at > now() - make_interval(hours => greatest(1, least(since_hours, 168)))
    order by rank_order
    limit 50
  ) ranked;
$$;

create or replace function public.detection_detail(detection_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'mmsi', d.mmsi,
    'name', coalesce(v.name, live.name),
    'level', d.level,
    'score', d.score,
    'startAt', d.start_at,
    'endAt', d.end_at,
    'evidence', d.evidence,
    'cableCrossings', d.cable_crossings,
    'anchorPath', d.anchor_path,
    'anchorModel', d.anchor_model,
    'gaps', d.gaps,
    'firstDetectedAt', d.first_detected_at,
    'updatedAt', d.updated_at
  )
  from public.detections d
  left join public.vessels v on v.mmsi = d.mmsi
  left join public.live_ships live on live.mmsi = d.mmsi
  where d.id = detection_id;
$$;
