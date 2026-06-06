-- Run in Supabase SQL editor

-- One vote per anonymous user per entry per week (when anon_id is set)
CREATE UNIQUE INDEX IF NOT EXISTS votes_anon_entry_week_unique
  ON public.votes (anon_id, entry_id, week_number)
  WHERE anon_id IS NOT NULL;
