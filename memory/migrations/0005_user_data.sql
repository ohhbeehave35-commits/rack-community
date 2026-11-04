-- Per-user data store for panel persistence.
--
-- Stores user-created data (locked projects, summon packs, crash-kits, etc.)
-- server-side so it survives browser clears and works across devices.
-- localStorage remains the offline cache; this table is the source of truth.
--
-- `kind` partitions data by type (e.g. "lockedProject", "snapshot", "report").
-- `key` is the item's client-side id within that kind.
-- `version` enables last-write-wins conflict detection: every write bumps it,
-- and the client can detect a newer server version before overwriting.

create table if not exists somnus_user_data (
  user_id    text not null,
  kind       text not null,
  key        text not null,
  payload    jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, kind, key)
);

create index if not exists somnus_user_data_user_kind_idx
  on somnus_user_data (user_id, kind);
