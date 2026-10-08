-- Storage buckets used by the mobile client.
--
-- These were previously created by hand in the dashboard, so a fresh
-- environment (preview branch, new dev) silently failed on snapshot upload,
-- recording upload, and avatar upload. Declaring them here makes the setup
-- reproducible.
--
-- All three are public-read because the app builds URLs via
-- storage.getPublicUrl(); write access is restricted to the owning user via
-- the first path segment, which the app always sets to its auth user id.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', true),
  ('recordings', 'recordings', true),
  ('alert-snapshots', 'alert-snapshots', true)
ON CONFLICT (id) DO NOTHING;

-- Avatars: users manage only their own folder
CREATE POLICY avatars_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY avatars_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY avatars_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Alert snapshots
CREATE POLICY alert_snapshots_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'alert-snapshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY alert_snapshots_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'alert-snapshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Recordings
CREATE POLICY recordings_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'recordings' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY recordings_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'recordings' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Public read for all authenticated users (buckets are public-read overall;
-- this policy governs the Supabase-authenticated listing path).
CREATE POLICY buckets_public_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('avatars', 'recordings', 'alert-snapshots'));
