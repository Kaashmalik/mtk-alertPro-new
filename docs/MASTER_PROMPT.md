# MTK AlertPro - Master Prompt

## Project Identity

**Name**: MTK AlertPro  
**Tagline**: Smart Alerts, Safer Homes - AI-Powered CCTV Security for Everyone  
**Built by**: MTK CODEX  
**License**: MIT

---

## Core Concept

MTK AlertPro is a React Native mobile application that transforms any IP camera into an intelligent security system using on-device AI. The app provides real-time person and vehicle detection, instant smart alerts, and privacy-first processing.

---

## Key Features

- **On-device AI**: Person & vehicle detection using Google ML Kit
- **Smart Alerts**: Instant push notifications with minimal false alarms
- **Privacy-First**: All AI processing happens locally on the device
- **Universal Compatibility**: Works with 80%+ of IP cameras
- **Real-time Performance**: < 2 second alert latency
- **Multi-tier Pricing**: Free, Pro ($3.99/mo), and Business ($14.99/mo) plans

---

## Technology Stack

### Frontend
- **Framework**: React Native 0.76
- **Platform**: Expo SDK 52
- **Language**: TypeScript 5.6
- **State Management**: Zustand 5, TanStack Query 5
- **Styling**: NativeWind 4 (Tailwind CSS for React Native)
- **Navigation**: React Navigation 6

### Backend & Services
- **Backend**: Supabase (Authentication, Database, Storage)
- **AI/ML**: Google ML Kit (Vision API for object detection)
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Payments**: RevenueCat
- **Camera Streaming**: RTSP/HTTP streaming libraries

### Development Tools
- **Package Manager**: pnpm 9+
- **Node.js**: v20+
- **Testing**: Jest, React Native Testing Library, Maestro (E2E)
- **CI/CD**: GitHub Actions

---

## Project Structure

```
mtk-alert-pro/
├── apps/
│   └── mobile/              # React Native Expo app
│       ├── src/
│       │   ├── components/  # Reusable UI components
│       │   ├── screens/     # Screen components
│       │   ├── navigation/  # Navigation configuration
│       │   ├── services/    # API & external service integrations
│       │   ├── hooks/       # Custom React hooks
│       │   ├── store/       # Zustand stores
│       │   └── utils/       # Utility functions
│       ├── app.json         # Expo configuration
│       └── package.json
├── packages/
│   └── shared/              # Shared code between packages
│       ├── types/           # TypeScript type definitions
│       └── constants/       # Shared constants
├── supabase/
│   ├── migrations/          # Database migrations
│   ├── functions/           # Edge functions
│   └── types/               # Generated TypeScript types
├── docs/
│   └── phases/              # Implementation phase documentation
└── .github/
    └── workflows/           # CI/CD workflows
```

---

## Implementation Phases

### Phase 0: Environment Setup (Day 0)
- Initialize monorepo with pnpm workspaces
- Set up Expo SDK 52 project
- Configure Supabase project
- Set up development environment

### Phase 1: Foundation (Week 1-2)
- Authentication system (Supabase Auth)
- Navigation structure
- Core UI components
- State management setup
- Environment configuration

### Phase 2: Camera Integration (Week 3-4)
- Camera discovery and connection
- RTSP/HTTP streaming implementation
- Camera management UI
- Stream performance optimization

### Phase 3: AI/ML Detection (Week 5-7)
- Google ML Kit integration
- Person detection model
- Vehicle detection model
- Detection optimization
- Alert triggering logic

### Phase 4: Core Features (Week 8-9)
- Push notification system (FCM)
- Alert history and playback
- Camera settings and preferences
- User profile management
- Payment integration (RevenueCat)

### Phase 5: Testing & Polish (Week 10-11)
- Unit and integration tests
- E2E testing with Maestro
- Performance optimization
- UI/UX refinements
- Security audit

### Phase 6: Store Launch (Week 12)
- Production builds
- App Store submission
- Play Store submission
- Documentation completion
- Marketing materials

---

## Business Model

### Free Tier ($0)
- 2 cameras
- Person/Vehicle detection
- 48-hour alert history
- Basic notifications

### Pro Tier ($3.99/month)
- Unlimited cameras
- Face recognition
- Cloud backup
- 30-day alert history
- Priority support

### Business Tier ($14.99/month)
- 50GB cloud storage
- License plate recognition
- API access
- Multi-user support
- Advanced analytics

---

## Performance Targets

| Metric | Target |
|--------|--------|
| APK Size | < 50MB |
| Cold Start Time | < 3 seconds |
| Detection Latency | < 500ms |
| Detection Accuracy | > 85% |
| Crash-Free Rate | > 99.5% |
| Alert Delivery Time | < 2 seconds |

---

## Key Technical Considerations

### Privacy & Security
- All AI processing performed on-device
- No video footage uploaded to cloud (unless user opts in)
- End-to-end encryption for cloud storage
- Secure authentication with Supabase
- API key management through environment variables

### Performance Optimization
- Efficient video streaming with adaptive bitrate
- ML model optimization for mobile devices
- Background processing for continuous monitoring
- Memory management for long-running processes
- Battery optimization strategies

### Camera Compatibility
- Support for RTSP, HTTP, and ONVIF protocols
- Auto-discovery of cameras on local network
- Manual camera configuration
- Stream format conversion (H.264, H.265, MJPEG)

### User Experience
- Intuitive onboarding flow
- Real-time camera preview
- Easy alert management
- Offline mode support
- Dark mode support

---

## Development Commands

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run on Android
pnpm android

# Run on iOS
pnpm ios

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run E2E tests
pnpm test:e2e

# Build development APK
pnpm build:android:dev

# Build production AAB
pnpm build:android:prod
```

---

## Environment Variables

Required environment variables in `apps/mobile/.env`:

```env
# Supabase
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Firebase
EXPO_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_firebase_project_id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
EXPO_PUBLIC_FIREBASE_APP_ID=your_firebase_app_id

# RevenueCat
EXPO_PUBLIC_REVENUECAT_API_KEY=your_revenuecat_api_key
```

---

## Database Schema (Supabase)

### Core Tables
- `profiles` - User profiles and settings
- `cameras` - Camera configurations
- `alerts` - Detection alerts history
- `subscriptions` - User subscription status
- `alert_media` - Stored media clips (optional cloud backup)

### Key Relationships
- One user (profile) can have multiple cameras
- One camera can generate multiple alerts
- One alert can have associated media clips

---

## Edge Functions

Key Supabase Edge Functions:
- Camera stream authentication
- Alert notification processing
- Subscription management
- Cloud storage operations
- Analytics aggregation

---

## Testing Strategy

### Unit Tests
- Component testing with React Native Testing Library
- Hook testing
- Utility function testing
- Service layer testing

### Integration Tests
- API integration tests
- Database integration tests
- Navigation flow tests

### E2E Tests
- Critical user flows with Maestro
- Camera setup flow
- Alert receiving flow
- Subscription purchase flow

---

## Deployment & CI/CD

### GitHub Actions Workflows
- Pull request validation
- Automated testing on push
- Build verification
- Deployment to staging/production

### Build Process
- Development: EAS Build for development
- Production: EAS Build for App Store and Play Store
- Version management with semantic versioning

---

## Support & Resources

- **Email**: support@mtkalertpro.com
- **Documentation**: help.mtkalertpro.com
- **Community**: discord.gg/mtkalertpro
- **GitHub Issues**: https://github.com/Kaashmalik/mtk-alert-pro/issues

---

## Contributing Guidelines

1. Follow the existing code style and conventions
2. Write tests for new features
3. Update documentation as needed
4. Submit pull requests with clear descriptions
5. Ensure all tests pass before submission
6. Follow semantic versioning for releases

---

## Future Enhancements

- Face recognition and identification
- License plate recognition
- Multi-camera timeline view
- Advanced analytics dashboard
- Integration with smart home devices
- Web dashboard for monitoring
- Team/organization features
- Custom detection zones
- Scheduled monitoring
- Integration with emergency services

---

*Last Updated: January 2026*
