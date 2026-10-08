-- ============================================================================
-- Real account deletion.
--
-- The problem: lib/profile/profileService.ts#deleteAccount() issues
--   DELETE FROM public.profiles WHERE id = auth.uid()
-- but public.profiles has no DELETE policy, so RLS rejects it. The client logs
-- a warning and carries on to signOut(), and the screen reports success. Nothing
-- is deleted -- the account, its cameras, its alerts and its uploaded snapshots
-- all survive. Google Play rejects a listing whose in-app account deletion does
-- not actually delete the account, so this is a launch blocker, not a nicety.
--
-- Why a DELETE policy is the wrong fix: `profiles.id` is the parent of cameras,
-- alerts, zones, automations, contacts and subscriptions, all ON DELETE CASCADE.
-- A bare `DELETE FROM profiles` would wipe all of that while leaving the
-- auth.users row in place. The user could then never sign in again (no profile,
-- and handle_new_user only fires on INSERT), and could not sign up again either,
-- because the email is still taken. That is worse than the no-op.
--
-- So deletion goes through auth.users instead, which cascades the whole graph in
-- one statement and genuinely removes the identity. Storage objects are not in
-- that FK graph -- they are keyed by a path prefix, not a foreign key -- so they
-- are deleted explicitly, otherwise every alert snapshot and recording the user
-- ever uploaded would stay publicly readable at a URL that outlives the account.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $BODY$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted_objects bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Uploaded files first. (storage.foldername(name))[1] is the user id for every
  -- bucket the app writes to (avatars, recordings, alert-snapshots), which is
  -- the same convention the storage.objects policies enforce.
  WITH removed AS (
    DELETE FROM storage.objects
    WHERE bucket_id IN ('avatars', 'recordings', 'alert-snapshots')
      AND (storage.foldername(name))[1] = v_uid::text
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_objects FROM removed;

  -- The FK graph: auth.users -> profiles -> { cameras, alerts, detection_zones,
  -- camera_automations, emergency_contacts, subscriptions, detection_events }.
  DELETE FROM auth.users WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  RETURN json_build_object(
    'success', true,
    'deleted_storage_objects', v_deleted_objects
  );
END;
$BODY$;

-- SECURITY DEFINER because deleting a row from auth.users is not something a
-- client role may do directly. The target is always auth.uid() and is never a
-- parameter, so there is no argument a caller could use to delete someone else.
REVOKE ALL ON FUNCTION public.delete_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated, service_role;

COMMENT ON FUNCTION public.delete_account() IS
  'Deletes the caller''s account: their auth.users row (cascading to profile, cameras, alerts, zones, automations, contacts, subscriptions, detection_events) plus every storage object they uploaded. Target is always auth.uid(), never a parameter.';