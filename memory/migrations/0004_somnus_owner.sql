-- Somnus control plane: give every row an owner.
--
-- Before this migration the somnus_* tables had NO owner column and the daemon
-- was a single hardcoded row (`id = 'keel'`), so every server function in
-- src/lib/dream/control-fns.ts read and wrote the same rows for whoever asked.
-- Sign-in is now on (see the `auth` skill), so each row belongs to one
-- authenticated user and every query is scoped to `context.userId`.
--
-- The pre-auth rows are DROPPED, not adopted. They were written by anonymous
-- callers with no owner recorded, so there is nobody to attribute them to;
-- handing the daemon policy and the audit trail to whoever signs in first would
-- be a worse outcome than losing development history. Per the `auth` skill:
-- "Rows from before sign-in existed are development data: drop and recreate
-- them." Each signed-in owner instead gets a fresh daemon row created lazily on
-- their first write, carrying the same defaults the old 'keel' seed row had
-- (armed, cadence 'preview', not frozen, 6 sessions, default policy).
--
-- `id` is no longer a bare primary key on the history tables: ids are minted
-- client-side, so a global unique index would let one user's upsert land on
-- another user's row. The key is (user_id, id) and every write carries both.
-- somnus_daemon loses its constant `id` column entirely — `user_id` IS the key.

drop table if exists somnus_jobs;
drop table if exists somnus_audit;
drop table if exists somnus_deliveries;
drop table if exists somnus_hooks;
drop table if exists somnus_daemon;

create table if not exists somnus_jobs (
  user_id  text not null,
  id       text not null,
  kind     text not null,
  status   text not null,
  actor    text not null,
  at       text not null,
  ended_at text,
  detail   text not null default '',
  primary key (user_id, id)
);
create index if not exists somnus_jobs_user_at_idx on somnus_jobs (user_id, at desc);

create table if not exists somnus_audit (
  user_id text not null,
  id      text not null,
  at      text not null,
  actor   text not null,
  action  text not null,
  target  text not null default '',
  detail  text not null default '',
  primary key (user_id, id)
);
create index if not exists somnus_audit_user_at_idx on somnus_audit (user_id, at desc);

create table if not exists somnus_deliveries (
  user_id    text not null,
  id         text not null,
  at         text not null,
  channel    text not null,
  status     integer not null,
  target     text not null,
  body       text not null default '',
  attempts   integer not null default 1,
  next_retry bigint,
  primary key (user_id, id)
);
create index if not exists somnus_deliveries_user_at_idx on somnus_deliveries (user_id, at desc);

create table if not exists somnus_hooks (
  user_id text not null,
  id      text not null,
  at      text not null,
  body    text not null,
  primary key (user_id, id)
);
create index if not exists somnus_hooks_user_at_idx on somnus_hooks (user_id, at desc);

create table if not exists somnus_daemon (
  user_id     text primary key,
  armed       boolean not null default true,
  cadence     text not null default 'preview',
  frozen      boolean not null default false,
  sessions    integer not null default 6,
  next_full   bigint,
  next_apply  bigint,
  last_pulse  bigint,
  policy_json text not null default '{"dualControl":true,"precisionFloor":0.7,"autoApply":true,"deliverTo":"both","webhookUrl":"internal:sink","slaHours":48}'
);
