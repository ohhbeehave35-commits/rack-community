-- Reactions are shown in the order they were added. created_at alone can tie when two are saved in the
-- same clock tick, so each row also gets a sequence number to break the tie.
alter table talkback_reactions add column if not exists seq bigserial;
