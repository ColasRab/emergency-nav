-- Run once in this project's Supabase SQL editor. No image/video storage.
create table if not exists public.hazards (
  id uuid primary key,
  "buildingId" text not null check ("buildingId" in ('admin','ynares')),
  floor integer not null,
  "nodeIds" integer[] not null check (cardinality("nodeIds") between 1 and 1000),
  edge integer[],
  type text not null check (type in ('crowd','fire','smoke','blocked','obstruction','flood','other')),
  severity integer not null check (severity between 1 and 3),
  confidence double precision not null check (confidence between 0 and 1),
  source text not null check (source in ('auto','user','admin')),
  confirmations integer not null default 0,
  dismissals integer not null default 0,
  "createdAt" bigint not null,
  "expiresAt" bigint not null
);
create index if not exists hazards_building_expiry on public.hazards("buildingId","expiresAt");
create table if not exists public.hazard_votes (
  hazard_id uuid not null references public.hazards(id) on delete cascade,
  voter text not null,
  value integer not null check (value in (-1,1)),
  primary key(hazard_id,voter)
);
alter table public.hazards enable row level security;
alter table public.hazard_votes enable row level security;
drop policy if exists "Read current hazards" on public.hazards;
create policy "Read current hazards" on public.hazards for select to anon, authenticated using ("expiresAt" > extract(epoch from now())*1000);
-- Writes and vote records are server-only; service key stays in .env.local.
revoke all on public.hazard_votes from anon, authenticated;
revoke insert,update,delete on public.hazards from anon, authenticated;
grant select on public.hazards to anon, authenticated;

create or replace function public.vote_hazard(p_id uuid,p_voter text,p_value integer)
returns public.hazards language plpgsql security definer set search_path=public as $$
declare result public.hazards;
begin
  if p_value not in (-1,1) then raise exception 'Invalid vote'; end if;
  -- Lock the hazard so concurrent votes and expiry cannot lose increments.
  perform id from public.hazards where id=p_id for update;
  insert into public.hazard_votes(hazard_id,voter,value) values(p_id,p_voter,p_value)
    on conflict(hazard_id,voter) do update set value=excluded.value;
  update public.hazards set
    confirmations=(select count(*) from public.hazard_votes where hazard_id=p_id and value=1),
    dismissals=(select count(*) from public.hazard_votes where hazard_id=p_id and value=-1)
    where id=p_id returning * into result;
  if result.dismissals >= result.confirmations+2 then
    update public.hazards set "expiresAt"=least("expiresAt",(extract(epoch from now())*1000)::bigint) where id=p_id returning * into result;
  end if;
  return result;
end $$;
revoke all on function public.vote_hazard(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.vote_hazard(uuid,text,integer) to service_role;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='hazards') then
    alter publication supabase_realtime add table public.hazards;
  end if;
end $$;
