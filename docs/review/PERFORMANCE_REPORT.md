# Performance Analysis Report

## Executive Summary
The application performs well for basic monitoring but faces potential bottlenecks in the ML detection pipeline and video streaming components. Bundle size is likely large due to TensorFlow.js and other heavy dependencies.

## 1. Bundle Size
**Status**: ⚠️ Optimization Needed
- **Dependencies**: Heavy libraries include:
    - `@tensorflow/tfjs` & `@tensorflow/tfjs-react-native` (Major contributor)
    - `expo-av`
    - `react-native-reanimated`
    - `react-native-svg`
- **Recommendation**: Enable Hermes engine (if not already). Use `babel-plugin-transform-remove-console` for prod. Consider lazy loading TensorFlow models.

## 2. Runtime Performance
**Status**: ⚠️ Monitoring Required
- **Detection Loop**: `DetectionManager` runs a periodic capture loop (`captureIntervalMs: 1000`).
    - **Risk**: On lower-end devices, processing frames every second with TFJS might cause UI jank (JS thread blocking).
    - **Mitigation**: Offload processing to a background thread or service where possible (WorkManager/Headless JS), or increase interval dynamically based on device load.
- **Video Streaming**: `VideoPlayer` uses `expo-av`. Multiple streams on one screen (Dashboard) will be heavy.
    - **Mitigation**: Use thumbnails for the grid view, only load live stream on interaction or for a single "featured" camera.

## 3. Memory Management
**Status**: ⚠️ Moderate
- **Frame Capture**: `frameCaptureService` saves images to disk.
    - **Risk**: Rapid file creation/deletion can cause fragmentation or storage bloat if cleanup fails.
    - **Check**: Ensure strict cleanup policy in `DetectionManager.processFrame` (currently present).
- **Listeners**: `DetectionManager` uses `Set` for event handlers. `VideoPlayer` uses `setTimeout`. Ensure `useEffect` cleanup functions are robust (observed: `resetControlsTimeout` has cleanup).

## 4. Network Efficiency
**Status**: ✅ Good
- **Supabase**: Uses `select` and `insert`.
- **RTSP**: Streaming consumes significant bandwidth.
    - **Risk**: Users on mobile data might exhaust limits.
    - **Mitigation**: Implement "Data Saver" mode that defaults to snapshots instead of live video when on cellular.

## 5. Recommendations
1.  **Lazy Load**: Load ML models only when needed (e.g., when a camera is active or detection is starting).
2.  **Grid Optimization**: Dashboard should show low-res snapshots w/ periodic refresh, not N live video streams.
3.  **Hermes**: Verification required that Hermes is enabled in `app.json`.
