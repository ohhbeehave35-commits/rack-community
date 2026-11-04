-- PARITY8E (31 Oct 2026): channels, threads, edit/delete, pins, mentions, reactions, files, huddles, workflows.
-- Additive only: every old row keeps working (channel general, no parent, not deleted, not pinned).
alter table talkback_messages
  add column if not exists channel text not null default 'general',
  add column if not exists parent_id integer,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists pinned_at timestamptz,
  add column if not exists mentions text not null default '';

create index if not exists talkback_messages_parent_idx on talkback_messages (user_id, parent_id);

create table if not exists talkback_channels (
  user_id text not null,
  name text not null,
  topic text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, name)
);

create table if not exists talkback_reactions (
  user_id text not null,
  message_id integer not null,
  desk text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id, desk, emoji)
);

create table if not exists talkback_files (
  id serial primary key,
  user_id text not null,
  message_id integer not null,
  name text not null,
  mime text not null default 'application/octet-stream',
  size integer not null,
  data text not null,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists talkback_files_msg_idx on talkback_files (user_id, message_id);

create table if not exists talkback_huddles (
  id serial primary key,
  user_id text not null,
  channel text not null default 'general',
  started_by text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists talkback_huddles_open_idx on talkback_huddles (user_id, channel) where ended_at is null;

create table if not exists talkback_huddle_members (
  huddle_id integer not null,
  user_id text not null,
  desk text not null,
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (huddle_id, desk)
);

create table if not exists talkback_workflows (
  id serial primary key,
  user_id text not null,
  name text not null,
  trigger_kind text not null,
  trigger_value text not null,
  action_kind text not null,
  action_seat text not null,
  action_text text not null,
  enabled boolean not null default true,
  runs integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists talkback_workflows_user_idx on talkback_workflows (user_id, id);
