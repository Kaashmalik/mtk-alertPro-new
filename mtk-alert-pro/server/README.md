# MTK AlertPro Media Server

This directory contains the backend media server for MTK AlertPro. It handles RTSP camera stream conversion to HLS/WebRTC for mobile app playback.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   IP Cameras    │────▶│    MediaMTX     │────▶│   Mobile App    │
│   (RTSP)        │     │  (Port 8888)    │     │   (HLS/WebRTC)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │    API Server   │
                        │  (Port 3001)    │
                        └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)

### Setup

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your Supabase credentials:**
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```

3. **Start the servers:**
   ```bash
   docker-compose up -d
   ```

4. **Check health:**
   ```bash
   curl http://localhost:3001/health
   ```

## Services

### MediaMTX (Port 8554, 8888, 8889)

- **8554**: RTSP server (for camera input)
- **8888**: HLS server (for mobile app playback)
- **8889**: WebRTC server (for low-latency playback)
- **9997**: API (for path management)
- **9998**: Metrics (Prometheus)

### API Server (Port 3001)

Endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/cameras/test-connection` | Test camera RTSP URL |
| POST | `/api/cameras/register` | Register camera with MediaMTX |
| DELETE | `/api/cameras/:id/unregister` | Remove camera from MediaMTX |
| GET | `/api/cameras/:id/status` | Get stream status |
| POST | `/api/cameras/:id/snapshot` | Capture snapshot |
| POST | `/api/cameras/:id/record/start` | Start recording |
| POST | `/api/cameras/:id/record/stop` | Stop recording |

## Development

### Local Development (without Docker)

1. **Start MediaMTX:**
   ```bash
   docker run -d --name mediamtx \
     -p 8554:8554 -p 8888:8888 -p 8889:8889 -p 9997:9997 \
     -v $(pwd)/mediamtx.yml:/mediamtx.yml \
     bluenviron/mediamtx:latest-ffmpeg
   ```

2. **Start API server:**
   ```bash
   cd api
   npm install
   npm run dev
   ```

### Testing Camera Connection

```bash
curl -X POST http://localhost:3001/api/cameras/test-connection \
  -H "Content-Type: application/json" \
  -d '{"rtspUrl": "rtsp://192.168.1.100:554/stream"}'
```

### Registering a Camera

```bash
curl -X POST http://localhost:3001/api/cameras/register \
  -H "Content-Type: application/json" \
  -d '{
    "cameraId": "camera-uuid-here",
    "rtspUrl": "rtsp://admin:password@192.168.1.100:554/stream",
    "userId": "user-uuid-here"
  }'
```

## Production Deployment

### Cloud Providers

- **Railway.app**: Easy Docker deployment
- **DigitalOcean**: Droplet with Docker
- **AWS ECS**: Containerized deployment
- **Google Cloud Run**: Serverless containers

### Important Considerations

1. **SSL/TLS**: Use a reverse proxy (nginx, Caddy) for HTTPS
2. **Firewall**: Only expose necessary ports
3. **Scaling**: MediaMTX is single-instance; use load balancer for API
4. **Storage**: Mount persistent volume for recordings

### Example nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name media.yourdomain.com;
    
    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;
    
    # HLS streams
    location /hls/ {
        proxy_pass http://localhost:8888/;
        proxy_http_version 1.1;
        add_header Cache-Control no-cache;
        add_header Access-Control-Allow-Origin *;
    }
    
    # API
    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Troubleshooting

### Camera Not Connecting

1. Check if camera is on same network
2. Verify RTSP URL format: `rtsp://[user:pass@]ip[:port]/path`
3. Check firewall allows RTSP (port 554)
4. Test with VLC: `vlc rtsp://192.168.1.100:554/stream`

### Stream Not Playing in App

1. Check MediaMTX logs: `docker logs mtk-media-server`
2. Verify HLS URL: `curl http://localhost:8888/cam_xxx/index.m3u8`
3. Check CORS headers

### High Latency

1. Use WebRTC instead of HLS for lower latency
2. Reduce HLS segment duration in `mediamtx.yml`
3. Check network bandwidth

## License

MIT License - MTK CODEX

