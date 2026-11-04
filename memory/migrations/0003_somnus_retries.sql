alter table somnus_deliveries add column if not exists attempts integer not null default 1;
alter table somnus_deliveries add column if not exists next_retry bigint;
