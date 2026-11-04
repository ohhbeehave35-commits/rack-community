create table if not exists talkback_messages (
  id serial primary key,
  user_id text not null,
  from_seat text not null,
  to_seat text,
  kind text not null default 'chat',
  body text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists talkback_messages_user_idx
  on talkback_messages (user_id, id desc);

create table if not exists talkback_presence (
  user_id text not null,
  role text not null,
  status text not null default 'listening',
  last_seen timestamptz not null default now(),
  primary key (user_id, role)
);
