create table if not exists talkback_tasks (
  id serial primary key,
  user_id text not null,
  role text not null,
  title text not null,
  detail text not null default '',
  state text not null default 'open',
  updated_at timestamptz not null default now()
);
create index if not exists talkback_tasks_user_idx
  on talkback_tasks (user_id, id desc);

create table if not exists talkback_acks (
  user_id text not null,
  message_id integer not null,
  desk text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, message_id, desk)
);
