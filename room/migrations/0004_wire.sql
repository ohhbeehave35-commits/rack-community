create table if not exists talkback_tokens (
  id serial primary key,
  user_id text not null,
  desk text not null,
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  last_used timestamptz
);
create unique index if not exists talkback_tokens_user_desk_idx
  on talkback_tokens (user_id, desk);
