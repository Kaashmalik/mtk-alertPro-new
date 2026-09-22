# Security Audit

## Executive Summary
The application implements a solid security foundation using Supabase Auth and Row Level Security (RLS). Sensitive data like camera passwords are encrypted before storage. However, reliance on client-side environment variables for encryption keys poses a risk if not managed correctly in production builds.

## 1. Authentication & Authorization
**Status**: ✅ Strong
- **Implementation**: Supabase Auth is correctly integrated via `authStore`.
- **Access Control**: RLS policies are comprehensive, ensuring users can only access their own profiles, cameras, and alerts.
- **Session Management**: Session persistence is handled via `AsyncStorage`.

## 2. Data Encryption
**Status**: ⚠️ Attention Required
- **Encryption at Rest**: Camera passwords are encrypted using AES (via `crypto-js`) before being sent to the database.
- **Key Management**: `encryption.ts` uses `process.env.EXPO_PUBLIC_ENCRYPTION_KEY`.
    - 🚨 **Critical Issue**: There is a fallback hardcoded key (`mtk-alertpro-dev-key...`) enabled in development. Ensure this is STRICTLY disabled in production builds.
    - **Recommendation**: Implement a build-time check to fail if the encryption key is missing in production.

## 3. Input Validation & API Security
**Status**: ✅ Good
- **Validation**: `add.tsx` uses `zod` schema to validate camera inputs (RTSP URL, names), reducing injection risks.
- **API**: Supabase client is used, which handles parameterization, mitigating SQL injection risks (PostgREST).

## 4. Camera Stream Security
**Status**: ⚠️ Moderate
- **Credentials**: RTSP URLs are constructed with credentials.
- **Exposure**: If `VideoPlayer` logs errors or URLs to the console, credentials might be leaked in logs. Ensure debug logs are stripped in production.
- **Transport**: RTSP over HTTP (or non-TLS RTSP) transmits video in plain text. Prefer RTSPS where possible.

## 5. Recommendations
1.  **Secure Key Storage**: Use `expo-secure-store` for storing the encryption key locally instead of relying solely on env vars if possible, or ensure env vars are baked securely.
2.  **Audit Logs**: Ensure no sensitive data (passwords, auth tokens) is logged to the console.
3.  **Dependency Audit**: Regularly audit `crypto-js` and other deps for vulnerabilities.
