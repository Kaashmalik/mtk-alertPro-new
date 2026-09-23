/**
 * MTK AlertPro API Server
 * Handles camera management, streaming control, and media server integration
 * 
 * @module api/index
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '3001', 10);
const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://localhost:9997';
const MEDIAMTX_HLS_URL = process.env.MEDIAMTX_HLS_URL || 'http://localhost:8888';
const MEDIAMTX_RTSP_URL = process.env.MEDIAMTX_RTSP_URL || 'rtsp://localhost:8554';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR || path.join(process.cwd(), 'snapshots');
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(process.cwd(), 'recordings');
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// Ensure media directories exist
for (const dir of [SNAPSHOTS_DIR, RECORDINGS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// ============================================================================
// Initialize Services
// ============================================================================

const app = express();

// Supabase client with service key (admin access)
const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// MediaMTX API client
const mediamtx: AxiosInstance = axios.create({
  baseURL: MEDIAMTX_API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// ============================================================================
// Middleware
// ============================================================================

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS configuration
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// Types
// ============================================================================

interface CameraPathConfig {
  source: string;
  sourceOnDemand: boolean;
  sourceOnDemandStartTimeout: string;
  sourceOnDemandCloseAfter: string;
  record?: boolean;
  recordPath?: string;
}

interface StreamUrls {
  hls: string;
  webrtc: string;
  rtsp: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a safe path name for a camera
 */
function getCameraPathName(cameraId: string): string {
  return `cam_${cameraId.replace(/-/g, '')}`;
}

/**
 * Build stream URLs for a camera
 */
function buildStreamUrls(pathName: string): StreamUrls {
  const publicUrl = process.env.MEDIA_SERVER_PUBLIC_URL || 'http://localhost';
  return {
    hls: `${publicUrl}:8888/${pathName}/index.m3u8`,
    webrtc: `${publicUrl}:8889/${pathName}`,
    rtsp: `rtsp://${publicUrl.replace('http://', '').replace('https://', '')}:8554/${pathName}`,
  };
}

/**
 * Validate user owns the camera
 */
async function validateCameraOwnership(
  cameraId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('cameras')
    .select('id')
    .eq('id', cameraId)
    .eq('user_id', userId)
    .single();

  return !error && !!data;
}

/**
 * Capture one JPEG frame from an RTSP/HLS source via FFmpeg
 */
function captureFrameWithFfmpeg(
  sourceUrl: string,
  outputPath: string,
  timeoutMs = 15000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-rtsp_transport', 'tcp',
      '-i', sourceUrl,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ];

    const proc = spawn(FFMPEG_PATH, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('FFmpeg snapshot timed out'));
    }, timeoutMs);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-500)}`));
      }
    });
  });
}

/**
 * Find newest recording file for a camera path
 */
function findLatestRecording(pathName: string): string | null {
  const cameraDir = path.join(RECORDINGS_DIR, pathName);
  if (!fs.existsSync(cameraDir)) {
    // Also search flat recordings dir for matching prefix
    if (!fs.existsSync(RECORDINGS_DIR)) return null;
    const files = fs.readdirSync(RECORDINGS_DIR)
      .filter((f) => f.startsWith(pathName) && (f.endsWith('.mp4') || f.endsWith('.mkv')))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(RECORDINGS_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0] ? path.join(RECORDINGS_DIR, files[0].name) : null;
  }

  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else if (e.name.endsWith('.mp4') || e.name.endsWith('.mkv')) out.push(full);
    }
    return out;
  };

  const files = walk(cameraDir)
    .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return files[0]?.f ?? null;
}

// ============================================================================
// Routes
// ============================================================================

// Static media
app.use('/snapshots', express.static(SNAPSHOTS_DIR));
app.use('/recordings', express.static(RECORDINGS_DIR));
/**
 * Health check endpoint
 */
app.get('/health', async (_req: Request, res: Response) => {
  try {
    // Check MediaMTX connection
    await mediamtx.get('/v3/paths/list');
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        mediamtx: 'connected',
        supabase: 'configured',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        mediamtx: 'disconnected',
        supabase: 'configured',
      },
    });
  }
});

/**
 * Test camera connection
 * POST /api/cameras/test-connection
 */
app.post('/api/cameras/test-connection', async (req: Request, res: Response) => {
  try {
    const { rtspUrl } = req.body;

    if (!rtspUrl || typeof rtspUrl !== 'string') {
      return res.status(400).json({ error: 'rtspUrl is required' });
    }

    // Validate RTSP URL format
    if (!rtspUrl.startsWith('rtsp://')) {
      return res.status(400).json({
        connected: false,
        error: 'Invalid URL format. Must start with rtsp://',
      });
    }

    // Create a temporary path for testing
    const tempPath = `test_${uuidv4().replace(/-/g, '')}`;

    try {
      // Add temporary path to MediaMTX
      await mediamtx.post(`/v3/config/paths/add/${tempPath}`, {
        source: rtspUrl,
        sourceOnDemand: true,
        sourceOnDemandStartTimeout: '5s',
        sourceOnDemandCloseAfter: '5s',
      });

      // Wait for stream to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if stream is ready
      const pathResponse = await mediamtx.get(`/v3/paths/get/${tempPath}`);
      const isReady = pathResponse.data?.ready === true;

      // Clean up temporary path
      await mediamtx.delete(`/v3/config/paths/delete/${tempPath}`).catch(() => {});

      return res.json({
        connected: isReady,
        streamInfo: isReady ? {
          ready: true,
          tracks: pathResponse.data?.tracks || [],
        } : null,
      });
    } catch (error) {
      // Clean up on error
      await mediamtx.delete(`/v3/config/paths/delete/${tempPath}`).catch(() => {});

      console.error('Connection test error:', error);
      return res.json({
        connected: false,
        error: 'Failed to connect to camera stream',
      });
    }
  } catch (error) {
    console.error('Connection test error:', error);
    return res.status(500).json({
      connected: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Register camera stream with MediaMTX
 * POST /api/cameras/register
 */
app.post('/api/cameras/register', async (req: Request, res: Response) => {
  try {
    const { cameraId, rtspUrl, userId } = req.body;

    if (!cameraId || !rtspUrl || !userId) {
      return res.status(400).json({
        error: 'cameraId, rtspUrl, and userId are required',
      });
    }

    // Validate camera ownership
    const isOwner = await validateCameraOwnership(cameraId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Camera not found or access denied',
      });
    }

    const pathName = getCameraPathName(cameraId);

    // Check if path already exists
    try {
      await mediamtx.get(`/v3/paths/get/${pathName}`);
      // Path exists, update it
      await mediamtx.patch(`/v3/config/paths/patch/${pathName}`, {
        source: rtspUrl,
        sourceOnDemand: true,
        sourceOnDemandStartTimeout: '10s',
        sourceOnDemandCloseAfter: '30s',
      });
    } catch {
      // Path doesn't exist, create it
      await mediamtx.post(`/v3/config/paths/add/${pathName}`, {
        source: rtspUrl,
        sourceOnDemand: true,
        sourceOnDemandStartTimeout: '10s',
        sourceOnDemandCloseAfter: '30s',
      });
    }

    const streams = buildStreamUrls(pathName);

    return res.json({
      success: true,
      pathName,
      streams,
    });
  } catch (error) {
    console.error('Camera registration error:', error);
    return res.status(500).json({
      error: 'Failed to register camera',
    });
  }
});

/**
 * Unregister camera stream
 * DELETE /api/cameras/:cameraId/unregister
 */
app.delete('/api/cameras/:cameraId/unregister', async (req: Request, res: Response) => {
  try {
    const { cameraId } = req.params;
    const pathName = getCameraPathName(cameraId);

    try {
      await mediamtx.delete(`/v3/config/paths/delete/${pathName}`);
    } catch {
      // Path might not exist, that's okay
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Camera unregistration error:', error);
    return res.status(500).json({
      error: 'Failed to unregister camera',
    });
  }
});

/**
 * Get stream status
 * GET /api/cameras/:cameraId/status
 */
app.get('/api/cameras/:cameraId/status', async (req: Request, res: Response) => {
  try {
    const { cameraId } = req.params;
    const pathName = getCameraPathName(cameraId);

    try {
      const response = await mediamtx.get(`/v3/paths/get/${pathName}`);

      return res.json({
        online: response.data?.ready === true,
        readers: response.data?.readers?.length || 0,
        source: response.data?.source ? {
          type: response.data.source.type,
        } : null,
        tracks: response.data?.tracks || [],
      });
    } catch {
      return res.json({
        online: false,
        readers: 0,
        source: null,
        tracks: [],
      });
    }
  } catch (error) {
    console.error('Status check error:', error);
    return res.json({ online: false, readers: 0 });
  }
});

/**
 * Capture snapshot from stream
 * POST /api/cameras/:cameraId/snapshot
 */
app.post('/api/cameras/:cameraId/snapshot', async (req: Request, res: Response) => {
  try {
    const { cameraId } = req.params;
    const pathName = getCameraPathName(cameraId);

    // Check if stream is available
    try {
      const pathResponse = await mediamtx.get(`/v3/paths/get/${pathName}`);
      if (!pathResponse.data?.ready) {
        return res.status(404).json({
          error: 'Stream not available',
        });
      }
    } catch {
      return res.status(404).json({
        error: 'Camera not registered',
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${cameraId}_${timestamp}.jpg`;
    const outputPath = path.join(SNAPSHOTS_DIR, filename);

    // Prefer local MediaMTX RTSP re-publish (stable for FFmpeg)
    const rtspSource = `${MEDIAMTX_RTSP_URL}/${pathName}`;
    const hlsSource = `${MEDIAMTX_HLS_URL}/${pathName}/index.m3u8`;

    try {
      await captureFrameWithFfmpeg(rtspSource, outputPath);
    } catch (rtspErr) {
      console.warn('[Snapshot] RTSP grab failed, trying HLS:', rtspErr);
      await captureFrameWithFfmpeg(hlsSource, outputPath);
    }

    return res.json({
      success: true,
      snapshotUrl: `/snapshots/${filename}`,
      absoluteUrl: `http://localhost:${PORT}/snapshots/${filename}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Snapshot error:', error);
    return res.status(500).json({
      error: 'Failed to capture snapshot',
      detail: error instanceof Error ? error.message : 'unknown',
    });
  }
});

/**
 * Start recording
 * POST /api/cameras/:cameraId/record/start
 */
app.post('/api/cameras/:cameraId/record/start', async (req: Request, res: Response) => {
  try {
    const { cameraId } = req.params;
    const { durationSeconds = 30 } = req.body;
    const pathName = getCameraPathName(cameraId);

    // Validate duration (max 5 minutes)
    const duration = Math.min(Math.max(durationSeconds, 5), 300);

    // Enable recording for this path
    await mediamtx.patch(`/v3/config/paths/patch/${pathName}`, {
      record: true,
      recordPath: `${RECORDINGS_DIR}/${pathName}/%Y-%m-%d_%H-%M-%S`,
      recordFormat: 'mp4',
    });

    // Ensure camera recording subdirectory exists
    const cameraRecDir = path.join(RECORDINGS_DIR, pathName);
    if (!fs.existsSync(cameraRecDir)) {
      fs.mkdirSync(cameraRecDir, { recursive: true });
    }

    // Schedule recording stop
    const stopRecordingTimeout = setTimeout(async () => {
      try {
        await mediamtx.patch(`/v3/config/paths/patch/${pathName}`, {
          record: false,
        });
      } catch (error) {
        console.error('Failed to stop recording:', error);
      }
    }, duration * 1000);

    // Store timeout reference (in production, use Redis or similar)
    // For now, we just fire and forget

    return res.json({
      success: true,
      durationSeconds: duration,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Recording start error:', error);
    return res.status(500).json({
      error: 'Failed to start recording',
    });
  }
});

/**
 * Stop recording
 * POST /api/cameras/:cameraId/record/stop
 */
app.post('/api/cameras/:cameraId/record/stop', async (req: Request, res: Response) => {
  try {
    const { cameraId } = req.params;
    const pathName = getCameraPathName(cameraId);

    await mediamtx.patch(`/v3/config/paths/patch/${pathName}`, {
      record: false,
    });

    // Brief wait for MediaMTX to finalize the file
    await new Promise((r) => setTimeout(r, 1500));
    const latest = findLatestRecording(pathName);

    return res.json({
      success: true,
      stoppedAt: new Date().toISOString(),
      recordingPath: latest
        ? `/recordings/${path.relative(RECORDINGS_DIR, latest).replace(/\\/g, '/')}`
        : null,
    });
  } catch (error) {
    console.error('Recording stop error:', error);
    return res.status(500).json({
      error: 'Failed to stop recording',
    });
  }
});

/**
 * Download latest (or named) recording
 * GET /api/cameras/:cameraId/record/download
 */
app.get('/api/cameras/:cameraId/record/download', async (req: Request, res: Response) => {
  try {
    const { cameraId } = req.params;
    const filename = typeof req.query.file === 'string' ? req.query.file : undefined;
    const pathName = getCameraPathName(cameraId);

    let filePath: string | null = null;
    if (filename) {
      const candidate = path.join(RECORDINGS_DIR, pathName, filename);
      const flat = path.join(RECORDINGS_DIR, filename);
      if (fs.existsSync(candidate)) filePath = candidate;
      else if (fs.existsSync(flat)) filePath = flat;
    } else {
      filePath = findLatestRecording(pathName);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'No recording found' });
    }

    const relative = path.relative(RECORDINGS_DIR, filePath).replace(/\\/g, '/');
    return res.json({
      success: true,
      downloadUrl: `/recordings/${relative}`,
      absoluteUrl: `http://localhost:${PORT}/recordings/${relative}`,
      filename: path.basename(filePath),
      sizeBytes: fs.statSync(filePath).size,
    });
  } catch (error) {
    console.error('Recording download error:', error);
    return res.status(500).json({ error: 'Failed to resolve recording' });
  }
});

/**
 * List all registered paths
 * GET /api/paths
 */
app.get('/api/paths', async (_req: Request, res: Response) => {
  try {
    const response = await mediamtx.get('/v3/paths/list');

    return res.json({
      paths: response.data?.items || [],
    });
  } catch (error) {
    console.error('Paths list error:', error);
    return res.status(500).json({
      error: 'Failed to list paths',
    });
  }
});

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('MTK AlertPro API Server');
  console.log('='.repeat(50));
  console.log(`Server running on port ${PORT}`);
  console.log(`MediaMTX API: ${MEDIAMTX_API_URL}`);
  console.log(`CORS Origin: ${CORS_ORIGIN}`);
  console.log('='.repeat(50));
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

