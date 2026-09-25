# Certificate Pinning for Production

## Overview

Certificate pinning is a security technique that ensures your mobile app only communicates with servers presenting specific, trusted SSL/TLS certificates. This prevents man-in-the-middle (MITM) attacks even if a device has compromised root certificates.

## Why It's Important

- **Prevents MITM Attacks**: Attackers cannot intercept communications even with compromised device certificates
- **Protects User Data**: Ensures all data sent to Supabase is encrypted and authenticated
- **Compliance**: Required for many security standards and app store reviews
- **Production Best Practice**: Essential for production mobile applications

## Implementation Options

### Option 1: React Native SSL Pinning (Recommended)

```bash
npm install react-native-ssl-pinning
# or
yarn add react-native-ssl-pinning
```

#### Configuration

1. **Get Supabase Certificate SHA256 Hash**

```bash
openssl s_client -connect wqvtwboepqegwndxhzcr.supabase.co:443 -showcerts | \
openssl x509 -noout -fingerprint -sha256 | \
sed 's/SHA256 Fingerprint=//g' | \
sed 's/://g' | \
tr '[:upper:]' '[:lower:]'
```

2. **Update Supabase Client**

```typescript
import { SslPinningPlugin } from 'react-native-ssl-pinning';

const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      'X-App-Version': Constants.expoConfig?.version || '1.0.0',
      'X-Platform': Platform.OS,
    },
  },
  db: {
    schema: 'public',
  },
  // Add certificate pinning
  fetch: (url, options) => {
    return fetch(url, {
      ...options,
      sslPinning: {
        certs: ['YOUR_CERTIFICATE_SHA256_HASH_HERE'],
      },
    });
  },
});
```

### Option 2: Expo Secure Store + Custom Fetch

For Expo projects, you can use a custom fetch implementation:

```typescript
import * as SecureStore from 'expo-secure-store';

// Store certificate hash securely
const CERTIFICATE_HASH = 'YOUR_CERTIFICATE_SHA256_HASH_HERE';

async function secureFetch(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    // Add certificate validation logic
  });
  
  // Validate certificate
  // This requires additional implementation
  
  return response;
}
```

### Option 3: react-native-networking

```bash
npm install react-native-networking
```

```typescript
import { NetworkingModule } from 'react-native-networking';

NetworkingModule.addPinningExceptionDomain('wqvtwboepqegwndxhzcr.supabase.co');
NetworkingModule.pinCertificatesForDomains([{
  hostname: 'wqvtwboepqegwndxhzcr.supabase.co',
  certificateSha256: ['YOUR_CERTIFICATE_SHA256_HASH_HERE'],
}]);
```

## Getting Certificate Hash

### Using OpenSSL

```bash
# Get certificate from Supabase
openssl s_client -connect wqvtwboepqegwndxhzcr.supabase.co:443 -showcerts </dev/null 2>/dev/null | \
openssl x509 -outform PEM > supabase_cert.pem

# Get SHA256 hash
openssl x509 -in supabase_cert.pem -noout -fingerprint -sha256 | \
sed 's/SHA256 Fingerprint=//g' | \
sed 's/://g' | \
tr '[:upper:]' '[:lower:]'
```

### Using Online Tools

1. Visit https://www.ssllabs.com/ssltest/
2. Enter: `wqvtwboepqegwndxhzcr.supabase.co`
3. Look for "SHA-256 Fingerprint" in the certificate chain

## Testing

### Development Mode

```typescript
if (__DEV__) {
  console.log('Certificate pinning disabled in development');
  // Use regular fetch without pinning
} else {
  // Use certificate pinning
}
```

### Testing Certificate Pinning

1. **Test with Valid Certificate**: Ensure normal operation works
2. **Test with Invalid Certificate**: Try connecting to a different domain to verify rejection
3. **Test Certificate Rotation**: Plan for how to handle certificate updates

## Certificate Rotation

Supabase certificates may rotate. You need a strategy:

### Option 1: Pin to Root CA (More Flexible)

Pin to the Supabase root CA certificate instead of the leaf certificate. This allows certificate rotation while maintaining security.

### Option 2: Multiple Certificates

Support multiple certificate hashes to allow for rotation:

```typescript
sslPinning: {
  certs: [
    'CURRENT_CERT_HASH',
    'BACKUP_CERT_HASH',
  ],
}
```

### Option 3: Remote Configuration

Fetch allowed certificate hashes from a secure endpoint:

```typescript
async function getAllowedCerts(): Promise<string[]> {
  const response = await fetch('https://your-api.com/certificates');
  return response.json();
}
```

## Current Status

### Frontend (apps/mobile)

The certificate pinning code is already prepared in `@/lib/supabase/client.ts`:

```typescript
// TODO: Implement actual certificate pinning
// import { NetworkingModule } from 'react-native-networking';
// NetworkingModule.addPinningExceptionDomain(supabaseUrl);
// NetworkingModule.pinCertificatesForDomains([{
//   hostname: new URL(supabaseUrl).hostname,
//   certificateSha256: ['// Add your Supabase certificate SHA256 hashes'],
// }]);
```

### Next Steps

1. **Get Certificate Hash**: Run the OpenSSL command to get the SHA256 hash
2. **Choose Implementation**: Select one of the implementation options above
3. **Install Dependencies**: Add required packages
4. **Implement Pinning**: Update `@/lib/supabase/client.ts`
5. **Test Thoroughly**: Test in both development and production builds
6. **Plan Rotation**: Document certificate rotation strategy

## Security Best Practices

1. **Never Hardcode in Plain Text**: Store certificate hashes in secure storage or environment variables
2. **Use Multiple Hashes**: Support current and backup certificates
3. **Monitor Certificate Expiry**: Set up alerts for certificate expiration
4. **Test Regularly**: Verify pinning works in production builds
5. **Document Rotation**: Have a clear process for certificate updates

## Resources

- [Supabase Security Documentation](https://supabase.com/docs/guides/platform/security)
- [OWASP Certificate Pinning](https://owasp.org/www-community/controls/Certificate_and_Public_Key_Pinning)
- [React Native SSL Pinning](https://github.com/valentine-mike/react-native-ssl-pinning)
- [Expo Security](https://docs.expo.dev/guides/security/)

## Checklist

- [ ] Get Supabase certificate SHA256 hash
- [ ] Choose and install certificate pinning library
- [ ] Implement certificate pinning in Supabase client
- [ ] Test in development environment
- [ ] Test in production build
- [ ] Document certificate rotation strategy
- [ ] Set up monitoring for certificate expiry
- [ ] Update app store submission notes about security
