-- Strip plaintext credentials embedded in rtsp_url
--
-- Security fix: credentials must only ever live in the (encrypted)
-- username/password columns. Older builds baked "user:pass@" into rtsp_url.
-- This migration clears that userinfo from existing rows so the database no
-- longer persists plaintext secrets inside a URL string.
--
-- Postgres regexp \1 backreference requires advanced regex (default in ARE mode).

UPDATE public.cameras
SET rtsp_url = regexp_replace(
      rtsp_url,
      '^((rtsp|rtsps|http|https)://)([^@/]*@)+',
      '\1',
      'g'
    ),
    updated_at = NOW()
WHERE rtsp_url ~ '^((rtsp|rtsps|http|https)://)([^@/]*@)+';