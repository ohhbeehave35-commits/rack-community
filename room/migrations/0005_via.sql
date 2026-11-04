alter table talkback_messages
  add column if not exists via text not null default 'ui';

alter table talkback_presence
  add column if not exists wire_status text,
  add column if not exists wire_last_seen timestamptz;
