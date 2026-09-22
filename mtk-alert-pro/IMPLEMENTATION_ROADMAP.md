# 🚀 MTK AlertPro - Complete Implementation Roadmap

**Version:** 2.0  
**Target Completion:** 12 Weeks  
**Last Updated:** December 2024

---

## 📋 Executive Summary

This document provides a systematic, phase-by-phase implementation plan to transform MTK AlertPro from a prototype into a production-ready, 2025-competitive security application.

### Current State Assessment
- ✅ UI/UX Foundation: Complete
- ✅ Authentication: Working
- ✅ Database Schema: Ready
- ❌ RTSP Streaming: Not functional
- ❌ AI Detection: Not implemented
- ❌ Recording: Fake/placeholder
- ❌ Camera Health Monitoring: Missing

### Target State
- Real-time camera streaming via HLS/WebRTC
- On-device AI detection (person/vehicle)
- Cloud recording with clip storage
- Background monitoring & alerts
- Production-grade security & reliability

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        PRODUCTION ARCHITECTURE                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│  │ IP Cameras  │───▶│  Media Server   │───▶│  Mobile App     │   │
│  │ (RTSP)      │    │  (MediaMTX)     │    │  (React Native) │   │
│  └─────────────┘    │                 │    │                 │   │
│                     │  • RTSP→HLS     │    │  • HLS Playback │   │
│                     │  • RTSP→WebRTC  │    │  • AI Detection │   │
│                     │  • Recording    │    │  • Alerts       │   │
│                     │  • Snapshots    │    │  • Offline Mode │   │
│                     └────────┬────────┘    └────────┬────────┘   │
│                              │                      │             │
│                              ▼                      ▼             │
│                     ┌─────────────────────────────────────────┐  │
│                     │           Supabase Backend              │  │
│                     │  • PostgreSQL (cameras, alerts, users)  │  │
│                     │  • Storage (clips, snapshots)           │  │
│                     │  • Realtime (WebSocket subscriptions)   │  │
│                     │  • Edge Functions (push notifications)  │  │
│                     └─────────────────────────────────────────┘  │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📅 Implementation Phases

### Phase Overview

| Phase | Focus | Duration | Dependencies |
|-------|-------|----------|--------------|
| **Phase 1** | Foundation & Security Fixes | Week 1-2 | None |
| **Phase 2** | Media Server Setup | Week 2-3 | Phase 1 |
| **Phase 3** | Real Video Streaming | Week 3-4 | Phase 2 |
| **Phase 4** | AI/ML Detection | Week 5-7 | Phase 3 |
| **Phase 5** | Recording & Storage | Week 7-8 | Phase 3 |
| **Phase 6** | Background Processing | Week 8-9 | Phase 4 |
| **Phase 7** | Advanced Features | Week 9-11 | Phase 5, 6 |
| **Phase 8** | Polish & Launch | Week 11-12 | All |

---

## 📦 Phase 1: Foundation & Security Fixes (Week 1-2)

### 1.1 Fix Critical Security Issues

#### Task 1.1.1: Implement Password Encryption

**File:** `apps/mobile/src/lib/crypto/encryption.ts` (NEW)

```typescript
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.EXPO_PUBLIC_ENCRYPTION_KEY || 'fallback-key-change-in-prod';

export function encryptPassword(password: string, salt: string): string {
  const saltedPassword = password + salt;
  return CryptoJS.AES.encrypt(saltedPassword, ENCRYPTION_KEY).toString();
}

export function decryptPassword(encryptedPassword: string, salt: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedPassword, ENCRYPTION_KEY);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  return decrypted.replace(salt, '');
}

export function hashForComparison(password: string): string {
  return CryptoJS.SHA256(password).toString();
}
```

#### Task 1.1.2: Update Camera Store with Encryption

**File:** `apps/mobile/src/stores/cameraStore.ts`

```typescript
// Add to addCamera function
import { encryptPassword } from '@/lib/crypto/encryption';

addCamera: async (cameraData) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Encrypt password before storing
  const encryptedPassword = cameraData.password 
    ? encryptPassword(cameraData.password, user.id)
    : undefined;

  const { data, error } = await supabase
    .from('cameras')
    .insert({
      user_id: user.id,
      name: cameraData.name,
      rtsp_url: cameraData.rtspUrl,
      username: cameraData.username,
      password: encryptedPassword, // Store encrypted
      is_active: cameraData.isActive ?? true,
      detection_settings: cameraData.detectionSettings,
    })
    .select()
    .single();

  // ... rest of function
},
```

### 1.2 Add Proper Error Handling

#### Task 1.2.1: Create Error Handling Utilities

**File:** `apps/mobile/src/lib/utils/errorHandler.ts` (NEW)

```typescript
import { Alert } from 'react-native';

export interface AppError {
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
}

export const ErrorCodes = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  CAMERA_ERROR: 'CAMERA_ERROR',
  STREAM_ERROR: 'STREAM_ERROR',
  DETECTION_ERROR: 'DETECTION_ERROR',
} as const;

export function createAppError(
  code: keyof typeof ErrorCodes,
  message: string,
  userMessage?: string
): AppError {
  return {
    code,
    message,
    userMessage: userMessage || getDefaultUserMessage(code),
    recoverable: isRecoverable(code),
  };
}

function getDefaultUserMessage(code: string): string {
  const messages: Record<string, string> = {
    NETWORK_ERROR: 'Unable to connect. Please check your internet connection.',
    AUTH_ERROR: 'Session expired. Please sign in again.',
    CAMERA_ERROR: 'Camera connection failed. Please verify camera settings.',
    STREAM_ERROR: 'Video stream unavailable. Retrying...',
    DETECTION_ERROR: 'Detection service temporarily unavailable.',
  };
  return messages[code] || 'An unexpected error occurred.';
}

function isRecoverable(code: string): boolean {
  return ['NETWORK_ERROR', 'STREAM_ERROR', 'DETECTION_ERROR'].includes(code);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  
  throw lastError;
}

export function showErrorAlert(error: AppError, onRetry?: () => void) {
  const buttons = error.recoverable && onRetry
    ? [
        { text: 'Cancel', style: 'cancel' as const },
        { text: 'Retry', onPress: onRetry },
      ]
    : [{ text: 'OK' }];

  Alert.alert('Error', error.userMessage, buttons);
}
```

### 1.3 Add Network Monitoring

#### Task 1.3.1: Install Dependencies

```bash
cd apps/mobile
npm install @react-native-community/netinfo
```

#### Task 1.3.2: Create Network Monitor Hook

**File:** `apps/mobile/src/hooks/useNetworkStatus.ts` (NEW)

```typescript
import { useState, useEffect } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface NetworkStatus {
  isConnected: boolean;
  isWifi: boolean;
  type: string;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isWifi: false,
    type: 'unknown',
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setStatus({
        isConnected: state.isConnected ?? false,
        isWifi: state.type === 'wifi',
        type: state.type,
      });
    });

    return () => unsubscribe();
  }, []);

  return status;
}
```

### 1.4 Implement Real Camera Connection Testing

#### Task 1.4.1: Create Camera Connection Service

**File:** `apps/mobile/src/lib/camera/connectionService.ts` (NEW)

```typescript
import { parseRtspUrl } from './rtspHelper';

export interface ConnectionTestResult {
  success: boolean;
  latency?: number;
  error?: string;
  streamInfo?: {
    width?: number;
    height?: number;
    codec?: string;
  };
}

/**
 * Test camera connectivity by attempting to reach the camera's HTTP interface
 * Note: Full RTSP testing requires a backend service
 */
export async function testCameraConnection(
  rtspUrl: string,
  timeoutMs: number = 5000
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  
  try {
    const parsed = parseRtspUrl(rtspUrl);
    if (!parsed) {
      return { success: false, error: 'Invalid RTSP URL format' };
    }

    // Try to reach camera's HTTP port (most cameras have web interface)
    const httpUrl = `http://${parsed.ip}:${parsed.port === 554 ? 80 : parsed.port}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(httpUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;
      return {
        success: response.ok || response.status === 401, // 401 means camera responded
        latency,
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // If HTTP fails, camera might still be reachable via RTSP only
      // For now, we'll consider it a failure - backend service needed for full test
      return {
        success: false,
        error: 'Camera not reachable. Ensure it\'s on the same network.',
        latency: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed',
    };
  }
}

/**
 * Test connection via media server (requires MediaMTX backend)
 */
export async function testConnectionViaMediaServer(
  mediaServerUrl: string,
  cameraPath: string,
  timeoutMs: number = 10000
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Check if stream is available on media server
    const response = await fetch(`${mediaServerUrl}/v3/paths/get/${cameraPath}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        latency: Date.now() - startTime,
        streamInfo: {
          // MediaMTX API response parsing
        },
      };
    }

    return {
      success: false,
      error: 'Stream not available on media server',
      latency: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Media server test failed',
    };
  }
}
```

### 1.5 Update Camera Store with Real Connection Testing

**File:** `apps/mobile/src/stores/cameraStore.ts` - Update testConnection

```typescript
import { testCameraConnection, ConnectionTestResult } from '@/lib/camera/connectionService';
import { withRetry } from '@/lib/utils/errorHandler';

// Update the store interface
interface CameraState {
  // ... existing fields
  connectionTests: Record<string, ConnectionTestResult>;
  testingCameras: Set<string>;
}

// Update testConnection method
testConnection: async (rtspUrl: string): Promise<ConnectionTestResult> => {
  try {
    const result = await withRetry(
      () => testCameraConnection(rtspUrl, 5000),
      2,
      1000
    );
    return result;
  } catch (error) {
    return {
      success: false,
      error: 'Connection test failed after multiple attempts',
    };
  }
},

// Add new method for continuous health monitoring
startHealthMonitoring: () => {
  const intervalId = setInterval(async () => {
    const { cameras, testConnection, set } = get();
    
    const results: Record<string, ConnectionTestResult> = {};
    
    for (const camera of cameras) {
      const result = await testConnection(camera.rtspUrl);
      results[camera.id] = result;
      
      // Update camera status based on result
      if (result.success !== camera.isActive) {
        await get().updateCamera(camera.id, { isActive: result.success });
      }
    }
    
    set({ connectionTests: results });
  }, 30000); // Every 30 seconds
  
  return () => clearInterval(intervalId);
},
```

### Phase 1 Checklist

- [ ] 1.1.1 Create encryption utility
- [ ] 1.1.2 Update camera store with encryption
- [ ] 1.2.1 Create error handling utilities
- [ ] 1.3.1 Install NetInfo dependency
- [ ] 1.3.2 Create network status hook
- [ ] 1.4.1 Create camera connection service
- [ ] 1.5 Update camera store with real connection testing
- [ ] Test all changes on Android device
- [ ] Test all changes on iOS simulator

---

## 🎬 Phase 2: Media Server Setup (Week 2-3)

### 2.1 Set Up MediaMTX Server

MediaMTX (formerly rtsp-simple-server) will handle RTSP→HLS/WebRTC conversion.

#### Task 2.1.1: Create Docker Configuration

**File:** `server/docker-compose.yml` (NEW - create server folder)

```yaml
version: '3.8'

services:
  mediamtx:
    image: bluenviron/mediamtx:latest-ffmpeg
    container_name: mtk-media-server
    restart: unless-stopped
    ports:
      - "8554:8554"   # RTSP
      - "1935:1935"   # RTMP
      - "8888:8888"   # HLS
      - "8889:8889"   # WebRTC
      - "9997:9997"   # API
      - "9998:9998"   # Metrics
    volumes:
      - ./mediamtx.yml:/mediamtx.yml:ro
      - ./recordings:/recordings
    environment:
      - MTX_PROTOCOLS=tcp,udp
    networks:
      - mtk-network

  # API service for camera management
  api:
    build: ./api
    container_name: mtk-api
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - MEDIAMTX_API_URL=http://mediamtx:9997
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    depends_on:
      - mediamtx
    networks:
      - mtk-network

networks:
  mtk-network:
    driver: bridge
```

#### Task 2.1.2: Create MediaMTX Configuration

**File:** `server/mediamtx.yml` (NEW)

```yaml
###############################################
# MTK AlertPro Media Server Configuration
###############################################

# General settings
logLevel: info
logDestinations: [stdout]

# API configuration
api: yes
apiAddress: :9997

# Metrics for monitoring
metrics: yes
metricsAddress: :9998

# RTSP server
rtsp: yes
protocols: [tcp, udp]
rtspAddress: :8554

# HLS server (for mobile app playback)
hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsSegmentCount: 3
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
hlsSegmentMaxSize: 50M
hlsAllowOrigin: '*'

# WebRTC server (for low-latency)
webrtc: yes
webrtcAddress: :8889
webrtcAllowOrigin: '*'
webrtcICEServers2:
  - url: stun:stun.l.google.com:19302

# Recording settings
record: no  # We'll enable per-path
recordPath: /recordings/%path/%Y-%m-%d_%H-%M-%S
recordFormat: mp4
recordSegmentDuration: 1h

# Path configuration
pathDefaults:
  # Source settings
  source: publisher
  sourceOnDemand: yes
  sourceOnDemandStartTimeout: 10s
  sourceOnDemandCloseAfter: 10s
  
  # Recording disabled by default
  record: no
  
  # Authentication (will be managed via API)
  publishUser: ""
  publishPass: ""
  readUser: ""
  readPass: ""

# Dynamic paths - cameras will be added via API
paths:
  # Example static path (for testing)
  test:
    source: rtsp://rtsp.stream/pattern
    sourceOnDemand: yes
```

#### Task 2.1.3: Create Backend API Service

**File:** `server/api/package.json` (NEW)

```json
{
  "name": "@mtk/api",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "@supabase/supabase-js": "^2.45.0",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/node": "^20.10.0",
    "tsx": "^4.6.2",
    "typescript": "^5.3.2"
  }
}
```

**File:** `server/api/src/index.ts` (NEW)

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({ origin: '*' })); // Configure properly in production
app.use(express.json());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
}));

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// MediaMTX API client
const mediamtx = axios.create({
  baseURL: process.env.MEDIAMTX_API_URL || 'http://localhost:9997',
  timeout: 10000,
});

// Types
interface CameraPath {
  cameraId: string;
  rtspUrl: string;
  pathName: string;
}

// Routes

/**
 * Test camera connection
 */
app.post('/api/cameras/test-connection', async (req, res) => {
  try {
    const { rtspUrl } = req.body;
    
    if (!rtspUrl) {
      return res.status(400).json({ error: 'rtspUrl required' });
    }

    // Create temporary path on MediaMTX
    const tempPath = `test_${Date.now()}`;
    
    try {
      // Add path to MediaMTX
      await mediamtx.post('/v3/config/paths/add/' + tempPath, {
        source: rtspUrl,
        sourceOnDemand: true,
        sourceOnDemandStartTimeout: '5s',
      });

      // Wait for stream to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if stream is ready
      const pathInfo = await mediamtx.get('/v3/paths/get/' + tempPath);
      
      const connected = pathInfo.data?.ready === true;
      
      // Clean up temporary path
      await mediamtx.delete('/v3/config/paths/delete/' + tempPath);

      return res.json({
        connected,
        streamInfo: connected ? {
          ready: pathInfo.data.ready,
          tracks: pathInfo.data.tracks,
        } : null,
      });
    } catch (error) {
      // Clean up on error
      try {
        await mediamtx.delete('/v3/config/paths/delete/' + tempPath);
      } catch {}
      
      throw error;
    }
  } catch (error) {
    console.error('Connection test error:', error);
    return res.status(500).json({
      connected: false,
      error: 'Connection test failed',
    });
  }
});

/**
 * Register camera stream with MediaMTX
 */
app.post('/api/cameras/register', async (req, res) => {
  try {
    const { cameraId, rtspUrl, userId } = req.body;

    // Validate ownership via Supabase
    const { data: camera, error } = await supabase
      .from('cameras')
      .select('*')
      .eq('id', cameraId)
      .eq('user_id', userId)
      .single();

    if (error || !camera) {
      return res.status(403).json({ error: 'Camera not found or access denied' });
    }

    const pathName = `cam_${cameraId}`;

    // Register path with MediaMTX
    await mediamtx.post('/v3/config/paths/add/' + pathName, {
      source: rtspUrl,
      sourceOnDemand: true,
      sourceOnDemandStartTimeout: '10s',
      sourceOnDemandCloseAfter: '30s',
    });

    // Return stream URLs
    const baseUrl = process.env.MEDIA_SERVER_PUBLIC_URL || 'http://localhost';
    
    return res.json({
      success: true,
      streams: {
        hls: `${baseUrl}:8888/${pathName}/index.m3u8`,
        webrtc: `${baseUrl}:8889/${pathName}`,
        rtsp: `rtsp://${baseUrl}:8554/${pathName}`,
      },
    });
  } catch (error) {
    console.error('Camera registration error:', error);
    return res.status(500).json({ error: 'Failed to register camera' });
  }
});

/**
 * Unregister camera stream
 */
app.delete('/api/cameras/:cameraId/unregister', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const pathName = `cam_${cameraId}`;

    await mediamtx.delete('/v3/config/paths/delete/' + pathName);
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Camera unregistration error:', error);
    return res.status(500).json({ error: 'Failed to unregister camera' });
  }
});

/**
 * Get stream status
 */
app.get('/api/cameras/:cameraId/status', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const pathName = `cam_${cameraId}`;

    const response = await mediamtx.get('/v3/paths/get/' + pathName);
    
    return res.json({
      online: response.data?.ready === true,
      readers: response.data?.readers?.length || 0,
      source: response.data?.source || null,
    });
  } catch (error) {
    return res.json({ online: false, readers: 0 });
  }
});

/**
 * Capture snapshot from stream
 */
app.post('/api/cameras/:cameraId/snapshot', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const pathName = `cam_${cameraId}`;

    // Use ffmpeg to capture a frame (MediaMTX docker image includes ffmpeg)
    // This would need to be implemented with a background worker
    // For now, return placeholder
    
    return res.json({
      success: true,
      snapshotUrl: `https://placeholder.com/snapshot/${cameraId}`,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to capture snapshot' });
  }
});

/**
 * Start recording for camera
 */
app.post('/api/cameras/:cameraId/record/start', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const { durationSeconds = 30 } = req.body;
    const pathName = `cam_${cameraId}`;

    // Enable recording for this path
    await mediamtx.patch('/v3/config/paths/patch/' + pathName, {
      record: true,
      recordPath: `/recordings/${pathName}/%Y-%m-%d_%H-%M-%S`,
    });

    // Schedule recording stop
    setTimeout(async () => {
      try {
        await mediamtx.patch('/v3/config/paths/patch/' + pathName, {
          record: false,
        });
      } catch {}
    }, durationSeconds * 1000);

    return res.json({ success: true, durationSeconds });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to start recording' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`MTK API Server running on port ${PORT}`);
});
```

### Phase 2 Checklist

- [ ] 2.1.1 Create server folder structure
- [ ] 2.1.2 Create docker-compose.yml
- [ ] 2.1.3 Create mediamtx.yml configuration
- [ ] 2.1.4 Create API service package.json
- [ ] 2.1.5 Implement API endpoints
- [ ] 2.1.6 Test docker-compose up locally
- [ ] 2.1.7 Test camera registration endpoint
- [ ] 2.1.8 Test HLS stream output
- [ ] Deploy to cloud provider (DigitalOcean/AWS/Railway)

---

## 🎥 Phase 3: Real Video Streaming (Week 3-4)

### 3.1 Create Streaming Service for Mobile App

**File:** `apps/mobile/src/lib/streaming/streamingService.ts` (NEW)

```typescript
const MEDIA_SERVER_URL = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL || 'http://localhost:3001';
const HLS_SERVER_URL = process.env.EXPO_PUBLIC_HLS_SERVER_URL || 'http://localhost:8888';

export interface StreamUrls {
  hls: string;
  webrtc: string;
  rtsp: string;
}

export interface StreamStatus {
  online: boolean;
  readers: number;
  latency?: number;
}

class StreamingService {
  private registeredCameras: Set<string> = new Set();

  /**
   * Register camera with media server and get stream URLs
   */
  async registerCamera(
    cameraId: string,
    rtspUrl: string,
    userId: string
  ): Promise<StreamUrls | null> {
    try {
      const response = await fetch(`${MEDIA_SERVER_URL}/api/cameras/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cameraId, rtspUrl, userId }),
      });

      if (!response.ok) {
        throw new Error('Failed to register camera');
      }

      const data = await response.json();
      this.registeredCameras.add(cameraId);
      
      return data.streams;
    } catch (error) {
      console.error('Camera registration error:', error);
      return null;
    }
  }

  /**
   * Unregister camera from media server
   */
  async unregisterCamera(cameraId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/unregister`,
        { method: 'DELETE' }
      );

      this.registeredCameras.delete(cameraId);
      return response.ok;
    } catch (error) {
      console.error('Camera unregistration error:', error);
      return false;
    }
  }

  /**
   * Get stream status
   */
  async getStreamStatus(cameraId: string): Promise<StreamStatus> {
    try {
      const response = await fetch(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/status`
      );

      if (!response.ok) {
        return { online: false, readers: 0 };
      }

      return await response.json();
    } catch (error) {
      return { online: false, readers: 0 };
    }
  }

  /**
   * Get HLS stream URL for camera
   */
  getHlsUrl(cameraId: string): string {
    return `${HLS_SERVER_URL}/cam_${cameraId}/index.m3u8`;
  }

  /**
   * Check if camera is registered
   */
  isRegistered(cameraId: string): boolean {
    return this.registeredCameras.has(cameraId);
  }

  /**
   * Capture snapshot from stream
   */
  async captureSnapshot(cameraId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/snapshot`,
        { method: 'POST' }
      );

      if (!response.ok) return null;

      const data = await response.json();
      return data.snapshotUrl;
    } catch (error) {
      console.error('Snapshot error:', error);
      return null;
    }
  }
}

export const streamingService = new StreamingService();
```

### 3.2 Create Enhanced Video Player Component

**File:** `apps/mobile/src/components/camera/CameraStreamPlayer.tsx` (NEW)

```typescript
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  RefreshCw,
  WifiOff,
  Camera as CameraIcon,
} from 'lucide-react-native';
import { streamingService, StreamStatus } from '@/lib/streaming/streamingService';
import { colors, spacing, fontSize, borderRadius } from '@/lib/theme';

interface CameraStreamPlayerProps {
  cameraId: string;
  rtspUrl: string;
  userId: string;
  autoPlay?: boolean;
  showControls?: boolean;
  onError?: (error: string) => void;
  onStreamReady?: () => void;
}

export function CameraStreamPlayer({
  cameraId,
  rtspUrl,
  userId,
  autoPlay = false,
  showControls = true,
  onError,
  onStreamReady,
}: CameraStreamPlayerProps) {
  const videoRef = useRef<Video>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'playing' | 'error'>('idle');
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Register camera and get HLS URL
  const initializeStream = useCallback(async () => {
    setStatus('connecting');
    
    try {
      const streams = await streamingService.registerCamera(cameraId, rtspUrl, userId);
      
      if (!streams) {
        throw new Error('Failed to register camera stream');
      }

      setHlsUrl(streams.hls);
      
      // Check stream status
      const statusResult = await streamingService.getStreamStatus(cameraId);
      setStreamStatus(statusResult);

      if (autoPlay) {
        setStatus('playing');
        setIsPlaying(true);
      } else {
        setStatus('idle');
      }

      onStreamReady?.();
    } catch (error) {
      console.error('Stream initialization error:', error);
      setStatus('error');
      onError?.(error instanceof Error ? error.message : 'Stream initialization failed');
    }
  }, [cameraId, rtspUrl, userId, autoPlay, onError, onStreamReady]);

  useEffect(() => {
    initializeStream();

    // Cleanup on unmount
    return () => {
      streamingService.unregisterCamera(cameraId);
    };
  }, [cameraId]);

  // Monitor stream status
  useEffect(() => {
    if (status !== 'playing') return;

    const statusInterval = setInterval(async () => {
      const result = await streamingService.getStreamStatus(cameraId);
      setStreamStatus(result);

      if (!result.online && status === 'playing') {
        // Stream went offline, try to reconnect
        handleRetry();
      }
    }, 10000);

    return () => clearInterval(statusInterval);
  }, [status, cameraId]);

  const handlePlaybackStatusUpdate = (playbackStatus: AVPlaybackStatus) => {
    if (!playbackStatus.isLoaded) {
      if (playbackStatus.error) {
        console.error('Playback error:', playbackStatus.error);
        if (retryCount < 3) {
          handleRetry();
        } else {
          setStatus('error');
          onError?.(playbackStatus.error);
        }
      }
      return;
    }

    setIsPlaying(playbackStatus.isPlaying);
  };

  const handlePlayPause = async () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      await videoRef.current.playAsync();
    }
  };

  const handleMute = async () => {
    if (!videoRef.current) return;
    await videoRef.current.setIsMutedAsync(!isMuted);
    setIsMuted(!isMuted);
  };

  const handleRetry = async () => {
    setRetryCount(prev => prev + 1);
    setStatus('connecting');
    
    // Unregister and re-register
    await streamingService.unregisterCamera(cameraId);
    await new Promise(resolve => setTimeout(resolve, 2000));
    await initializeStream();
  };

  const handleStartStream = () => {
    setStatus('playing');
    setIsPlaying(true);
  };

  // Idle state - show play button
  if (status === 'idle' && !autoPlay) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.playOverlay} onPress={handleStartStream}>
          <View style={styles.playButton}>
            <Play size={40} color="white" fill="white" />
          </View>
          <Text style={styles.playText}>Tap to start stream</Text>
          <Text style={styles.urlText} numberOfLines={1}>{rtspUrl}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Connecting state
  if (status === 'connecting') {
    return (
      <View style={styles.container}>
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.brand.red} />
          <Text style={styles.loadingText}>Connecting to camera...</Text>
          <Text style={styles.loadingSubtext}>Setting up secure stream</Text>
        </View>
      </View>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.errorOverlay}>
          <WifiOff size={48} color={colors.status.error} />
          <Text style={styles.errorTitle}>Stream Unavailable</Text>
          <Text style={styles.errorText}>
            Unable to connect to camera. Please check:
          </Text>
          <Text style={styles.errorList}>
            • Camera is powered on{'\n'}
            • Camera is on the same network{'\n'}
            • RTSP URL is correct
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <RefreshCw size={20} color="white" />
            <Text style={styles.retryText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Playing state
  return (
    <View style={styles.container}>
      {hlsUrl && (
        <Video
          ref={videoRef}
          source={{ uri: hlsUrl }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay={isPlaying}
          isMuted={isMuted}
          isLooping={false}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          useNativeControls={false}
        />
      )}

      {/* Stream status indicator */}
      <View style={styles.statusBadge}>
        <View style={[
          styles.statusDot,
          { backgroundColor: streamStatus?.online ? colors.status.success : colors.status.error }
        ]} />
        <Text style={styles.statusText}>
          {streamStatus?.online ? 'LIVE' : 'OFFLINE'}
        </Text>
      </View>

      {/* Controls overlay */}
      {showControls && (
        <View style={styles.controlsOverlay}>
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.controlButton} onPress={handlePlayPause}>
              {isPlaying ? (
                <Pause size={24} color="white" />
              ) : (
                <Play size={24} color="white" />
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlButton} onPress={handleMute}>
              {isMuted ? (
                <VolumeX size={24} color="white" />
              ) : (
                <Volume2 size={24} color="white" />
              )}
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <TouchableOpacity style={styles.controlButton} onPress={handleRetry}>
              <RefreshCw size={20} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
  },
  video: {
    flex: 1,
  },
  playOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  playText: {
    color: 'white',
    fontSize: fontSize.base,
    marginBottom: spacing.xs,
  },
  urlText: {
    color: colors.text.muted,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.xxl,
  },
  loadingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  loadingText: {
    color: 'white',
    fontSize: fontSize.base,
    marginTop: spacing.md,
  },
  loadingSubtext: {
    color: colors.text.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  errorOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: spacing.xxl,
  },
  errorTitle: {
    color: colors.status.error,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  errorText: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  errorList: {
    color: colors.text.muted,
    fontSize: fontSize.sm,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand.red,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  retryText: {
    color: 'white',
    fontSize: fontSize.base,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  statusBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  statusText: {
    color: 'white',
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  controlsOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: spacing.md,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlButton: {
    padding: spacing.sm,
    marginHorizontal: spacing.xs,
  },
});

export default CameraStreamPlayer;
```

### 3.3 Update Camera Detail Screen

**File:** `apps/mobile/src/app/cameras/[id].tsx` - Update to use new player

Replace the video section with:

```typescript
import { CameraStreamPlayer } from '@/components/camera/CameraStreamPlayer';
import { useAuthStore } from '@/stores';

// Inside the component:
const user = useAuthStore((state) => state.user);

// In the render:
<View style={styles.videoContainer}>
  <CameraStreamPlayer
    cameraId={camera.id}
    rtspUrl={camera.rtspUrl}
    userId={user?.id || ''}
    autoPlay={isPlaying}
    showControls={true}
    onError={(error) => {
      console.error('Stream error:', error);
      Alert.alert('Stream Error', error);
    }}
    onStreamReady={() => {
      console.log('Stream ready!');
    }}
  />
</View>
```

### Phase 3 Checklist

- [ ] 3.1 Create streaming service
- [ ] 3.2 Create CameraStreamPlayer component
- [ ] 3.3 Update camera detail screen
- [ ] 3.4 Add environment variables for media server URLs
- [ ] 3.5 Test HLS playback on Android
- [ ] 3.6 Test HLS playback on iOS
- [ ] 3.7 Test reconnection logic
- [ ] 3.8 Add loading skeletons

---

## 🤖 Phase 4: AI/ML Detection (Week 5-7)

### 4.1 Install Dependencies

```bash
cd apps/mobile
npm install @tensorflow/tfjs @tensorflow/tfjs-react-native expo-gl expo-gl-cpp
npm install @react-native-async-storage/async-storage  # If not already installed
```

### 4.2 Create Detection Service

**File:** `apps/mobile/src/features/detection/detectionService.ts` (NEW)

```typescript
import * as tf from '@tensorflow/tfjs';
import { bundleResourceIO, decodeJpeg } from '@tensorflow/tfjs-react-native';
import * as FileSystem from 'expo-file-system';
import { DetectionResult } from '@/types';

// Detection configuration
const DETECTION_CONFIG = {
  inputSize: 320, // Model input size
  scoreThreshold: 0.5,
  iouThreshold: 0.45,
  maxDetections: 10,
};

// COCO class labels we care about
const PERSON_VEHICLE_CLASSES: Record<number, 'person' | 'vehicle'> = {
  0: 'person',    // person
  2: 'vehicle',   // car
  3: 'vehicle',   // motorcycle
  5: 'vehicle',   // bus
  7: 'vehicle',   // truck
};

class DetectionService {
  private model: tf.GraphModel | null = null;
  private isReady = false;
  private isProcessing = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize TensorFlow.js and load model
   */
  async initialize(): Promise<void> {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('[Detection] Initializing TensorFlow.js...');
      
      // Initialize TF.js with React Native backend
      await tf.ready();
      console.log('[Detection] TF.js ready, backend:', tf.getBackend());

      // Load the model
      // Option 1: Use a bundled model
      // const modelJson = require('@/assets/models/ssd_mobilenet/model.json');
      // const modelWeights = require('@/assets/models/ssd_mobilenet/weights.bin');
      // this.model = await tf.loadGraphModel(bundleResourceIO(modelJson, modelWeights));

      // Option 2: Load from remote URL (easier for updates)
      console.log('[Detection] Loading model...');
      this.model = await tf.loadGraphModel(
        'https://tfhub.dev/tensorflow/tfjs-model/ssd_mobilenet_v2/1/default/1',
        { fromTFHub: true }
      );

      console.log('[Detection] Model loaded successfully');
      this.isReady = true;
    } catch (error) {
      console.error('[Detection] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Detect objects in an image
   */
  async detect(imageUri: string): Promise<DetectionResult[]> {
    if (!this.isReady || !this.model) {
      throw new Error('Detection service not initialized');
    }

    if (this.isProcessing) {
      console.log('[Detection] Already processing, skipping...');
      return [];
    }

    this.isProcessing = true;

    try {
      // Load and preprocess image
      const imageTensor = await this.loadImage(imageUri);
      
      // Run inference
      const predictions = await this.runInference(imageTensor);
      
      // Clean up tensors
      imageTensor.dispose();

      return predictions;
    } catch (error) {
      console.error('[Detection] Detection failed:', error);
      return [];
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Load image and convert to tensor
   */
  private async loadImage(imageUri: string): Promise<tf.Tensor3D> {
    // Read image file
    const imageData = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Decode JPEG to tensor
    const rawImageData = tf.util.encodeString(imageData, 'base64');
    const imageTensor = decodeJpeg(new Uint8Array(rawImageData.buffer));

    // Resize to model input size
    const resized = tf.image.resizeBilinear(
      imageTensor as tf.Tensor3D,
      [DETECTION_CONFIG.inputSize, DETECTION_CONFIG.inputSize]
    );

    // Normalize to [0, 1]
    const normalized = resized.div(255.0);

    // Add batch dimension
    const batched = normalized.expandDims(0);

    // Clean up intermediate tensors
    imageTensor.dispose();
    resized.dispose();
    normalized.dispose();

    return batched as unknown as tf.Tensor3D;
  }

  /**
   * Run model inference and parse results
   */
  private async runInference(imageTensor: tf.Tensor): Promise<DetectionResult[]> {
    if (!this.model) return [];

    // Run model
    const predictions = await this.model.executeAsync(imageTensor) as tf.Tensor[];

    // Parse outputs (format depends on model)
    // SSD MobileNet outputs: [detection_boxes, detection_classes, detection_scores, num_detections]
    const boxes = await predictions[0].array() as number[][][];
    const classes = await predictions[1].array() as number[][];
    const scores = await predictions[2].array() as number[][];
    const numDetections = (await predictions[3].array()) as number[];

    // Clean up prediction tensors
    predictions.forEach(t => t.dispose());

    const results: DetectionResult[] = [];
    const count = Math.min(numDetections[0], DETECTION_CONFIG.maxDetections);

    for (let i = 0; i < count; i++) {
      const classId = Math.round(classes[0][i]);
      const score = scores[0][i];

      // Filter by score threshold and only include person/vehicle
      if (score < DETECTION_CONFIG.scoreThreshold) continue;
      if (!(classId in PERSON_VEHICLE_CLASSES)) continue;

      const [y1, x1, y2, x2] = boxes[0][i];

      results.push({
        type: PERSON_VEHICLE_CLASSES[classId],
        confidence: score,
        boundingBox: {
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
        },
      });
    }

    return results;
  }

  /**
   * Check if service is ready
   */
  isInitialized(): boolean {
    return this.isReady;
  }

  /**
   * Check if currently processing
   */
  isBusy(): boolean {
    return this.isProcessing;
  }

  /**
   * Dispose of model and free memory
   */
  async dispose(): Promise<void> {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.isReady = false;
    this.initPromise = null;
  }
}

// Export singleton instance
export const detectionService = new DetectionService();
```

### 4.3 Create Frame Capture Service

**File:** `apps/mobile/src/features/detection/frameCaptureService.ts` (NEW)

```typescript
import * as FileSystem from 'expo-file-system';
import { streamingService } from '@/lib/streaming/streamingService';

const FRAME_CACHE_DIR = `${FileSystem.cacheDirectory}frames/`;

class FrameCaptureService {
  private isCapturing = false;
  private captureInterval: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    // Ensure frame cache directory exists
    const dirInfo = await FileSystem.getInfoAsync(FRAME_CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(FRAME_CACHE_DIR, { intermediates: true });
    }
  }

  /**
   * Capture a frame from camera stream
   * Note: This requires backend support - MediaMTX + FFmpeg
   */
  async captureFrame(cameraId: string): Promise<string | null> {
    try {
      // Request snapshot from backend
      const snapshotUrl = await streamingService.captureSnapshot(cameraId);
      
      if (!snapshotUrl) {
        return null;
      }

      // Download snapshot to local cache
      const localPath = `${FRAME_CACHE_DIR}${cameraId}_${Date.now()}.jpg`;
      
      await FileSystem.downloadAsync(snapshotUrl, localPath);
      
      return localPath;
    } catch (error) {
      console.error('[FrameCapture] Error:', error);
      return null;
    }
  }

  /**
   * Start periodic frame capture for a camera
   */
  startPeriodicCapture(
    cameraId: string,
    intervalMs: number,
    onFrame: (framePath: string) => void
  ): void {
    if (this.captureInterval) {
      this.stopPeriodicCapture();
    }

    this.isCapturing = true;

    this.captureInterval = setInterval(async () => {
      if (!this.isCapturing) return;

      const framePath = await this.captureFrame(cameraId);
      if (framePath) {
        onFrame(framePath);
      }
    }, intervalMs);
  }

  /**
   * Stop periodic capture
   */
  stopPeriodicCapture(): void {
    this.isCapturing = false;
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
  }

  /**
   * Clean up old frames
   */
  async cleanupOldFrames(maxAgeMs: number = 60000): Promise<void> {
    try {
      const files = await FileSystem.readDirectoryAsync(FRAME_CACHE_DIR);
      const now = Date.now();

      for (const file of files) {
        const filePath = `${FRAME_CACHE_DIR}${file}`;
        const info = await FileSystem.getInfoAsync(filePath);
        
        if (info.exists && info.modificationTime) {
          const age = now - info.modificationTime * 1000;
          if (age > maxAgeMs) {
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          }
        }
      }
    } catch (error) {
      console.error('[FrameCapture] Cleanup error:', error);
    }
  }
}

export const frameCaptureService = new FrameCaptureService();
```

### 4.4 Create Detection Manager

**File:** `apps/mobile/src/features/detection/detectionManager.ts` (NEW)

```typescript
import { detectionService } from './detectionService';
import { frameCaptureService } from './frameCaptureService';
import { supabase } from '@/lib/supabase/client';
import { DetectionResult, Camera, DetectionSettings } from '@/types';

interface DetectionEvent {
  cameraId: string;
  type: 'person' | 'vehicle';
  confidence: number;
  timestamp: Date;
  snapshotPath?: string;
}

interface DetectionManagerConfig {
  captureIntervalMs: number;
  cooldownMs: number;
  minConfidence: number;
}

const DEFAULT_CONFIG: DetectionManagerConfig = {
  captureIntervalMs: 1000, // Capture frame every 1 second
  cooldownMs: 30000,       // 30 second cooldown between alerts
  minConfidence: 0.7,      // 70% confidence threshold
};

class DetectionManager {
  private config: DetectionManagerConfig;
  private activeCameras: Map<string, Camera> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private isRunning = false;
  private eventHandlers: ((event: DetectionEvent) => void)[] = [];

  constructor(config: Partial<DetectionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize detection system
   */
  async initialize(): Promise<void> {
    console.log('[DetectionManager] Initializing...');
    
    await frameCaptureService.initialize();
    await detectionService.initialize();
    
    console.log('[DetectionManager] Ready');
  }

  /**
   * Start monitoring a camera
   */
  async startMonitoring(camera: Camera): Promise<void> {
    if (!camera.detectionSettings.person && !camera.detectionSettings.vehicle) {
      console.log(`[DetectionManager] Camera ${camera.id} has no detection enabled`);
      return;
    }

    console.log(`[DetectionManager] Starting monitoring for camera: ${camera.name}`);
    
    this.activeCameras.set(camera.id, camera);

    // Start periodic frame capture and detection
    frameCaptureService.startPeriodicCapture(
      camera.id,
      this.config.captureIntervalMs,
      async (framePath) => {
        await this.processFrame(camera, framePath);
      }
    );

    this.isRunning = true;
  }

  /**
   * Stop monitoring a camera
   */
  stopMonitoring(cameraId: string): void {
    console.log(`[DetectionManager] Stopping monitoring for camera: ${cameraId}`);
    
    this.activeCameras.delete(cameraId);
    
    if (this.activeCameras.size === 0) {
      frameCaptureService.stopPeriodicCapture();
      this.isRunning = false;
    }
  }

  /**
   * Stop all monitoring
   */
  stopAll(): void {
    console.log('[DetectionManager] Stopping all monitoring');
    
    this.activeCameras.clear();
    frameCaptureService.stopPeriodicCapture();
    this.isRunning = false;
  }

  /**
   * Process a captured frame
   */
  private async processFrame(camera: Camera, framePath: string): Promise<void> {
    try {
      // Run detection
      const detections = await detectionService.detect(framePath);

      // Filter by camera settings and confidence
      const validDetections = detections.filter(d => {
        // Check if detection type is enabled
        if (d.type === 'person' && !camera.detectionSettings.person) return false;
        if (d.type === 'vehicle' && !camera.detectionSettings.vehicle) return false;

        // Check confidence threshold
        const threshold = camera.detectionSettings.sensitivity || this.config.minConfidence;
        return d.confidence >= threshold;
      });

      // Process each valid detection
      for (const detection of validDetections) {
        await this.handleDetection(camera, detection, framePath);
      }

      // Clean up frame file after processing
      // (Keep it if we need to attach to alert)
    } catch (error) {
      console.error('[DetectionManager] Frame processing error:', error);
    }
  }

  /**
   * Handle a valid detection
   */
  private async handleDetection(
    camera: Camera,
    detection: DetectionResult,
    snapshotPath: string
  ): Promise<void> {
    const cameraKey = `${camera.id}_${detection.type}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(cameraKey) || 0;

    // Check cooldown
    if (now - lastAlert < this.config.cooldownMs) {
      console.log(`[DetectionManager] Cooldown active for ${cameraKey}`);
      return;
    }

    // Update last alert time
    this.lastAlertTime.set(cameraKey, now);

    // Create detection event
    const event: DetectionEvent = {
      cameraId: camera.id,
      type: detection.type,
      confidence: detection.confidence,
      timestamp: new Date(),
      snapshotPath,
    };

    console.log(`[DetectionManager] Detection: ${detection.type} (${Math.round(detection.confidence * 100)}%)`);

    // Notify handlers
    this.eventHandlers.forEach(handler => handler(event));

    // Create alert in database
    await this.createAlert(camera, detection, snapshotPath);
  }

  /**
   * Create alert in Supabase
   */
  private async createAlert(
    camera: Camera,
    detection: DetectionResult,
    snapshotPath: string
  ): Promise<void> {
    try {
      // TODO: Upload snapshot to Supabase Storage first
      // const snapshotUrl = await this.uploadSnapshot(snapshotPath, camera.userId);

      const { error } = await supabase.from('alerts').insert({
        camera_id: camera.id,
        user_id: camera.userId,
        type: detection.type,
        confidence: detection.confidence,
        // snapshot_url: snapshotUrl,
        metadata: {
          boundingBox: detection.boundingBox,
        },
        is_read: false,
      });

      if (error) {
        console.error('[DetectionManager] Failed to create alert:', error);
      }
    } catch (error) {
      console.error('[DetectionManager] Alert creation error:', error);
    }
  }

  /**
   * Register event handler
   */
  onDetection(handler: (event: DetectionEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DetectionManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if running
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Get monitored camera count
   */
  getMonitoredCameraCount(): number {
    return this.activeCameras.size;
  }
}

// Export singleton
export const detectionManager = new DetectionManager();
```

### 4.5 Integrate Detection with App

**File:** `apps/mobile/src/app/_layout.tsx` - Add detection initialization

Add this to the root layout:

```typescript
import { detectionManager } from '@/features/detection/detectionManager';

// In the init effect:
useEffect(() => {
  const init = async () => {
    try {
      await initialize(); // Auth
      
      // Initialize detection system
      if (isAuthenticated) {
        await detectionManager.initialize();
      }
    } catch (error) {
      console.error('Initialization error:', error);
    } finally {
      // ...
    }
  };
  init();
}, [initialize]);

// Start detection when cameras change
useEffect(() => {
  if (!isAuthenticated || !appReady) return;

  const cameras = useCameraStore.getState().cameras;
  
  // Start monitoring active cameras
  cameras
    .filter(c => c.isActive)
    .forEach(camera => {
      detectionManager.startMonitoring(camera);
    });

  // Listen for detection events
  const unsubscribe = detectionManager.onDetection((event) => {
    console.log('Detection event:', event);
    // Play alarm, send notification, etc.
  });

  return () => {
    unsubscribe();
    detectionManager.stopAll();
  };
}, [isAuthenticated, appReady]);
```

### Phase 4 Checklist

- [ ] 4.1 Install TensorFlow.js dependencies
- [ ] 4.2 Create detection service
- [ ] 4.3 Create frame capture service
- [ ] 4.4 Create detection manager
- [ ] 4.5 Integrate with app layout
- [ ] 4.6 Test on Android device
- [ ] 4.7 Test on iOS device
- [ ] 4.8 Optimize performance (reduce frame rate if needed)
- [ ] 4.9 Add detection visualization overlay

---

## 📹 Phase 5: Recording & Storage (Week 7-8)

### 5.1 Create Recording Service

**File:** `apps/mobile/src/lib/recording/recordingService.ts` (NEW)

```typescript
import * as FileSystem from 'expo-file-system';
import { supabase } from '@/lib/supabase/client';

const MEDIA_SERVER_URL = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL || 'http://localhost:3001';
const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

export interface RecordingInfo {
  id: string;
  cameraId: string;
  startTime: Date;
  duration: number;
  localPath?: string;
  cloudUrl?: string;
  status: 'recording' | 'completed' | 'uploading' | 'uploaded' | 'failed';
}

class RecordingService {
  private activeRecordings: Map<string, RecordingInfo> = new Map();

  async initialize(): Promise<void> {
    // Ensure recordings directory exists
    const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    }
  }

  /**
   * Start recording for a camera
   */
  async startRecording(cameraId: string, durationSeconds: number = 30): Promise<RecordingInfo> {
    const recordingId = `rec_${cameraId}_${Date.now()}`;
    
    const recordingInfo: RecordingInfo = {
      id: recordingId,
      cameraId,
      startTime: new Date(),
      duration: durationSeconds,
      status: 'recording',
    };

    // Tell backend to start recording
    const response = await fetch(
      `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/record/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationSeconds }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to start recording');
    }

    this.activeRecordings.set(cameraId, recordingInfo);

    // Schedule completion check
    setTimeout(async () => {
      await this.completeRecording(cameraId);
    }, durationSeconds * 1000 + 2000); // Extra 2 seconds buffer

    return recordingInfo;
  }

  /**
   * Stop recording early
   */
  async stopRecording(cameraId: string): Promise<RecordingInfo | null> {
    const recording = this.activeRecordings.get(cameraId);
    if (!recording) return null;

    // Tell backend to stop
    await fetch(
      `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/record/stop`,
      { method: 'POST' }
    );

    return this.completeRecording(cameraId);
  }

  /**
   * Complete recording and download file
   */
  private async completeRecording(cameraId: string): Promise<RecordingInfo | null> {
    const recording = this.activeRecordings.get(cameraId);
    if (!recording) return null;

    try {
      // Get recording file from backend
      const response = await fetch(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/record/download`
      );

      if (response.ok) {
        const localPath = `${RECORDINGS_DIR}${recording.id}.mp4`;
        
        // Download file
        const downloadResult = await FileSystem.downloadAsync(
          response.url,
          localPath
        );

        recording.localPath = downloadResult.uri;
        recording.status = 'completed';
      } else {
        recording.status = 'failed';
      }
    } catch (error) {
      console.error('Recording completion error:', error);
      recording.status = 'failed';
    }

    this.activeRecordings.delete(cameraId);
    return recording;
  }

  /**
   * Upload recording to cloud storage
   */
  async uploadToCloud(recording: RecordingInfo, userId: string): Promise<string | null> {
    if (!recording.localPath) return null;

    try {
      recording.status = 'uploading';

      // Read file
      const fileInfo = await FileSystem.getInfoAsync(recording.localPath);
      if (!fileInfo.exists) return null;

      // Upload to Supabase Storage
      const fileName = `${userId}/${recording.id}.mp4`;
      
      const fileContent = await FileSystem.readAsStringAsync(recording.localPath, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { data, error } = await supabase.storage
        .from('recordings')
        .upload(fileName, decode(fileContent), {
          contentType: 'video/mp4',
        });

      if (error) throw error;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('recordings')
        .getPublicUrl(fileName);

      recording.cloudUrl = urlData.publicUrl;
      recording.status = 'uploaded';

      return urlData.publicUrl;
    } catch (error) {
      console.error('Upload error:', error);
      recording.status = 'failed';
      return null;
    }
  }

  /**
   * Get recording status
   */
  getRecordingStatus(cameraId: string): RecordingInfo | null {
    return this.activeRecordings.get(cameraId) || null;
  }

  /**
   * List local recordings
   */
  async listLocalRecordings(): Promise<string[]> {
    try {
      const files = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
      return files.map(f => `${RECORDINGS_DIR}${f}`);
    } catch {
      return [];
    }
  }

  /**
   * Delete local recording
   */
  async deleteLocalRecording(path: string): Promise<boolean> {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage usage
   */
  async getStorageUsage(): Promise<{ used: number; files: number }> {
    try {
      const files = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
      let totalSize = 0;

      for (const file of files) {
        const info = await FileSystem.getInfoAsync(`${RECORDINGS_DIR}${file}`);
        if (info.exists && info.size) {
          totalSize += info.size;
        }
      }

      return { used: totalSize, files: files.length };
    } catch {
      return { used: 0, files: 0 };
    }
  }
}

// Helper to decode base64
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const recordingService = new RecordingService();
```

### Phase 5 Checklist

- [ ] 5.1 Create recording service
- [ ] 5.2 Update camera detail screen with real recording
- [ ] 5.3 Create Supabase storage bucket for recordings
- [ ] 5.4 Implement upload to cloud
- [ ] 5.5 Add recording list view
- [ ] 5.6 Add playback for local recordings
- [ ] 5.7 Implement storage quota management

---

## ⚡ Phase 6: Background Processing (Week 8-9)

### 6.1 Install Background Task Dependencies

```bash
cd apps/mobile
npm install expo-task-manager expo-background-fetch
```

### 6.2 Create Background Detection Task

**File:** `apps/mobile/src/lib/background/backgroundDetection.ts` (NEW)

```typescript
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { detectionManager } from '@/features/detection/detectionManager';
import { useCameraStore } from '@/stores';

const BACKGROUND_DETECTION_TASK = 'background-detection-task';

// Define the background task
TaskManager.defineTask(BACKGROUND_DETECTION_TASK, async () => {
  try {
    console.log('[Background] Running detection task...');
    
    // Get active cameras
    const cameras = useCameraStore.getState().cameras.filter(c => c.isActive);
    
    if (cameras.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Run detection cycle for each camera
    for (const camera of cameras) {
      // Note: Full detection might not work in background
      // Consider using push notifications from server instead
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('[Background] Task error:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register background detection task
 */
export async function registerBackgroundDetection(): Promise<boolean> {
  try {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_DETECTION_TASK, {
      minimumInterval: 60 * 15, // 15 minutes (iOS minimum)
      stopOnTerminate: false,
      startOnBoot: true,
    });
    
    console.log('[Background] Detection task registered');
    return true;
  } catch (error) {
    console.error('[Background] Registration failed:', error);
    return false;
  }
}

/**
 * Unregister background task
 */
export async function unregisterBackgroundDetection(): Promise<void> {
  try {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_DETECTION_TASK);
    console.log('[Background] Detection task unregistered');
  } catch (error) {
    console.error('[Background] Unregistration failed:', error);
  }
}

/**
 * Check if background task is registered
 */
export async function isBackgroundDetectionRegistered(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_DETECTION_TASK);
}
```

### Phase 6 Checklist

- [ ] 6.1 Install background task dependencies
- [ ] 6.2 Create background detection task
- [ ] 6.3 Register task on app start
- [ ] 6.4 Test background execution on Android
- [ ] 6.5 Test background execution on iOS
- [ ] 6.6 Implement server-side detection as fallback

---

## 🎨 Phase 7: Advanced Features (Week 9-11)

### 7.1 Multi-Camera Grid View

### 7.2 Detection Zones

### 7.3 Timeline View

### 7.4 Share Access

### 7.5 Widgets (iOS/Android)

*(Detailed implementation guides for each feature)*

---

## 🚀 Phase 8: Polish & Launch (Week 11-12)

### 8.1 Performance Optimization

- [ ] Add React.memo to frequently re-rendering components
- [ ] Implement FlatList optimization (windowSize, maxToRenderPerBatch)
- [ ] Add image caching with expo-image
- [ ] Profile and fix memory leaks
- [ ] Reduce bundle size

### 8.2 Error Tracking & Analytics

- [ ] Integrate Sentry for crash reporting
- [ ] Add Firebase Analytics
- [ ] Implement custom event tracking

### 8.3 Testing

- [ ] Write unit tests for services
- [ ] Add E2E tests with Maestro
- [ ] Test on multiple Android devices
- [ ] Test on multiple iOS devices
- [ ] Accessibility testing

### 8.4 App Store Preparation

- [ ] Create screenshots for both platforms
- [ ] Write app description and keywords
- [ ] Prepare privacy policy
- [ ] Generate release builds
- [ ] Submit for review

---

## 📊 Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| APK Size | < 50MB | TBD |
| Cold Start | < 3s | TBD |
| Detection Latency | < 500ms | TBD |
| Detection Accuracy | > 85% | TBD |
| Crash-Free Rate | > 99.5% | TBD |
| Stream Start Time | < 3s | TBD |

---

## 🛠️ Development Commands

```bash
# Install dependencies
pnpm install

# Start development
cd apps/mobile && pnpm start

# Run on Android
pnpm android

# Run on iOS
pnpm ios

# Build APK
pnpm build:android

# Start media server
cd server && docker-compose up -d

# View media server logs
docker logs -f mtk-media-server

# Run tests
pnpm test
```

---

## 📞 Support & Resources

- **TensorFlow.js React Native:** https://github.com/nicholasnjihian/tfjs-react-native-examples
- **MediaMTX Documentation:** https://github.com/bluenviron/mediamtx
- **Expo Background Tasks:** https://docs.expo.dev/versions/latest/sdk/task-manager/
- **Supabase Storage:** https://supabase.com/docs/guides/storage

---

*Last Updated: December 2024*  
*Author: MTK CODEX Development Team*

