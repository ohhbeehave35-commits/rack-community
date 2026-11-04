create table if not exists somnus_jobs (
  id text primary key,
  kind text not null,
  status text not null,
  actor text not null,
  at text not null,
  ended_at text,
  detail text not null default ''
);

create table if not exists somnus_audit (
  id text primary key,
  at text not null,
  actor text not null,
  action text not null,
  target text not null default '',
  detail text not null default ''
);

create table if not exists somnus_deliveries (
  id text primary key,
  at text not null,
  channel text not null,
  status integer not null,
  target text not null,
  body text not null default ''
);

create table if not exists somnus_hooks (
  id text primary key,
  at text not null,
  body text not null
);

create table if not exists somnus_daemon (
  id text primary key,
  armed boolean not null default true,
  cadence text not null default 'preview',
  frozen boolean not null default false,
  sessions integer not null default 6,
  next_full bigint,
  next_apply bigint,
  last_pulse bigint,
  policy_json text not null
);

insert into somnus_daemon (
  id, armed, cadence, frozen, sessions, policy_json
) values (
  'keel',
  true,
  'preview',
  false,
  6,
  '{"dualControl":true,"precisionFloor":0.7,"autoApply":true,"deliverTo":"both","webhookUrl":"internal:sink","slaHours":48}'
) on conflict (id) do nothing;
