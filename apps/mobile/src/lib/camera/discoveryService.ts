/**
 * Camera discovery: HTTP subnet probe + ONVIF SOAP
 * Pure fetch from the phone — no UDP/mDNS native modules (Expo Go compatible).
 *
 * Flow:
 *  1. Derive local subnet from NetInfo (or accept an explicit subnet)
 *  2. Probe common HTTP ports across host IPs (bounded concurrency)
 *  3. For each live host, POST ONVIF GetDeviceInformation SOAP
 *  4. Optionally resolve media profile → RTSP URI via GetStreamUri
 *
 * @module lib/camera/discoveryService
 */

import NetInfo from '@react-native-community/netinfo';
import {
  CAMERA_BRANDS,
  detectCameraBrand,
  generateRtspUrl,
} from './rtspHelper';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredCamera {
  ip: string;
  /** HTTP port that answered */
  port: number;
  manufacturer?: string;
  model?: string;
  hardwareId?: string;
  firmware?: string;
  serialNumber?: string;
  /** Mapped brand id from CAMERA_BRANDS (or 'generic') */
  brandId?: string;
  /** RTSP URI from ONVIF GetStreamUri, when resolved */
  rtspUrl?: string;
  onvif: boolean;
}

export interface DiscoveryProgress {
  phase: 'probing' | 'identifying' | 'done';
  scanned: number;
  total: number;
  found: number;
}

export interface DiscoveryOptions {
  /** Explicit subnet override; when omitted, derived from NetInfo */
  subnet?: { ip: string; subnetMask: string };
  /** Optional credentials for ONVIF SOAP (WS-Security UsernameToken) */
  credentials?: { username: string; password: string };
  onProgress?: (progress: DiscoveryProgress) => void;
  /** Per-probe timeout (default 800ms) */
  timeoutMs?: number;
  /** Abort in-flight discovery */
  signal?: AbortSignal;
}

// ============================================================================
// Constants
// ============================================================================

/** HTTP ports probed during subnet sweep */
const DEFAULT_HTTP_PORTS = [80, 8080, 443, 8000, 88] as const;

/** Common ONVIF device service paths */
const ONVIF_DEVICE_PATHS = [
  '/onvif/device_service',
  '/onvif/device',
  '/onvif/devices',
  '/onvif/service',
  '/onvif',
] as const;

/** Max hosts to scan (safety cap — /22 ≈ 1022 hosts) */
const MAX_HOSTS = 1024;

/** Concurrent probes during the subnet sweep */
const PROBE_CONCURRENCY = 24;

const DEFAULT_PROBE_TIMEOUT_MS = 800;
const SOAP_TIMEOUT_MS = 4000;

// ============================================================================
// Pure helpers (exported for tests)
// ============================================================================

export function ipToInt(ip: string): number {
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10) & 0xff);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

export function intToIp(value: number): string {
  const v = value >>> 0;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(
    '.',
  );
}

/**
 * Enumerate host IPs for a subnet (excludes network, broadcast, and self).
 * Returns [] when the subnet is larger than MAX_HOSTS.
 */
export function generateHostIps(ip: string, subnetMask: string): string[] {
  const ipNum = ipToInt(ip);
  const maskNum = ipToInt(subnetMask);
  const network = (ipNum & maskNum) >>> 0;
  const invMask = ~maskNum >>> 0;
  const broadcast = (network | invMask) >>> 0;
  const hostCount = invMask + 1;

  if (hostCount > MAX_HOSTS + 2) return [];

  const hosts: string[] = [];
  for (let host = (network + 1) >>> 0; host < broadcast; host++) {
    const candidate = intToIp(host);
    if (candidate === ip) continue;
    hosts.push(candidate);
    if (hosts.length >= MAX_HOSTS) break;
  }
  return hosts;
}

/** Map ONVIF Manufacturer/Model strings to a CAMERA_BRANDS id */
export function mapManufacturerToBrand(
  manufacturer?: string,
  model?: string,
): string {
  const hay = `${manufacturer ?? ''} ${model ?? ''}`.toLowerCase();
  if (hay.includes('hikvision') || hay.includes('hilook')) return 'hikvision';
  if (hay.includes('dahua') || hay.includes('imax')) return 'dahua';
  if (hay.includes('amcrest')) return 'amcrest';
  if (hay.includes('reolink')) return 'reolink';
  if (hay.includes('axis')) return 'axis';
  if (hay.includes('uniview')) return 'uniview';
  if (hay.includes('hanwha') || hay.includes('samsung')) return 'hanwha';
  if (hay.includes('vivotek')) return 'vivotek';
  if (hay.includes('foscam')) return 'foscam';
  if (manufacturer?.trim()) return 'generic';
  return 'generic';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build WS-Security UsernameToken (PasswordDigest) header fragment.
 * Digest = Base64(SHA1(nonce + password + created))
 */
export function buildUsernameToken(username: string, password: string): string {
  // Lazy require keeps crypto-js out of the critical path when unauthenticated
  const CryptoJS = require('crypto-js') as typeof import('crypto-js');

  const nonce = CryptoJS.lib.WordArray.random(16);
  const nonceB64 = CryptoJS.enc.Base64.stringify(nonce);
  const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const hasher = CryptoJS.algo.SHA1.create();
  hasher.update(nonce);
  hasher.update(CryptoJS.enc.Utf8.parse(password));
  hasher.update(CryptoJS.enc.Utf8.parse(created));
  const digest = CryptoJS.enc.Base64.stringify(hasher.finalize());

  return `<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <UsernameToken>
        <Username>${escapeXml(username)}</Username>
        <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>
        <Nonce Encoding="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</Nonce>
        <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>
      </UsernameToken>
    </Security>`;
}

/**
 * Build a SOAP 1.2 envelope for an ONVIF request body
 */
export function buildSoapEnvelope(
  bodyInner: string,
  credentials?: { username: string; password: string },
): string {
  const header = credentials
    ? `<s:Header>${buildUsernameToken(credentials.username, credentials.password)}</s:Header>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">${header}
  <s:Body>${bodyInner}</s:Body>
</s:Envelope>`;
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  // Match with or without namespace prefix: <tds:Manufacturer> or <Manufacturer>
  const pattern = new RegExp(
    `<((?:[\\w.-]+:)?${tag})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`,
    'i',
  );
  const match = xml.match(pattern);
  if (!match) return undefined;
  const value = match[2].trim();
  return value || undefined;
}

export interface OnvifDeviceInformation {
  manufacturer?: string;
  model?: string;
  firmware?: string;
  serialNumber?: string;
  hardwareId?: string;
}

/** Parse ONVIF GetDeviceInformation SOAP response */
export function parseOnvifDeviceInformation(
  xml: string,
): OnvifDeviceInformation {
  return {
    manufacturer: extractXmlTag(xml, 'Manufacturer'),
    model: extractXmlTag(xml, 'Model'),
    firmware: extractXmlTag(xml, 'FirmwareVersion'),
    serialNumber: extractXmlTag(xml, 'SerialNumber'),
    hardwareId: extractXmlTag(xml, 'HardwareId'),
  };
}

/** Parse ONVIF GetCapabilities response → Media service XAddr */
export function parseMediaXAddr(xml: string): string | undefined {
  // Prefer the Media section specifically
  const mediaSection = xml.match(
    /<(?:[\w.-]+:)?Media(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?Media>/i,
  );
  const scope = mediaSection ? mediaSection[1] : xml;
  return extractXmlTag(scope, 'XAddr');
}

/** Parse ONVIF GetProfiles response → first profile token */
export function parseProfileToken(xml: string): string | undefined {
  const profileMatch = xml.match(
    /<(?:[\w.-]+:)?Profiles(?:\s[^>]*)?[^>]*token="([^"]+)"/i,
  );
  if (profileMatch) return profileMatch[1];
  return extractXmlTag(xml, 'token') ?? extractXmlTag(xml, 'Token');
}

/** Parse ONVIF GetStreamUri response → RTSP URI */
export function parseStreamUri(xml: string): string | undefined {
  const uri = extractXmlTag(xml, 'Uri');
  return uri?.toLowerCase().startsWith('rtsp') ? uri : undefined;
}

// ============================================================================
// Network helpers
// ============================================================================

async function getLocalSubnetFromNetInfo(): Promise<{
  ip: string;
  subnetMask: string;
} | null> {
  try {
    const state = await NetInfo.fetch();
    if (state.type !== 'wifi' && state.type !== 'ethernet') return null;
    const details = state.details as {
      ipAddress?: string;
      subnet?: string;
    } | null;
    if (!details?.ipAddress) return null;
    // NetInfo may omit subnet on some platforms — assume /24
    const subnetMask =
      details.subnet && /^\d+\.\d+\.\d+\.\d+$/.test(details.subnet)
        ? details.subnet
        : '255.255.255.0';
    return { ip: details.ipAddress, subnetMask };
  } catch {
    return null;
  }
}

/** Probe a single host:port — returns true on any HTTP response */
async function probeHttp(
  ip: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`http://${ip}:${port}/`, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe one host across several ports; resolves with the first live port (or null) */
async function probeHostPorts(
  ip: string,
  ports: readonly number[],
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    let pending = ports.length;
    let resolved = false;
    if (pending === 0) {
      resolve(null);
      return;
    }
    ports.forEach((port) => {
      probeHttp(ip, port, timeoutMs).then((live) => {
        if (live && !resolved) {
          resolved = true;
          resolve(port);
        } else if (!--pending && !resolved) {
          resolve(null);
        }
      });
    });
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

// ============================================================================
// ONVIF SOAP
// ============================================================================

async function soapPost(
  endpoint: string,
  bodyInner: string,
  credentials: DiscoveryOptions['credentials'],
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/soap+xml; charset=utf-8; action="http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation"',
      },
      body: buildSoapEnvelope(bodyInner, credentials),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok && response.status !== 500) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Try ONVIF GetDeviceInformation on common device_service paths */
async function identifyOnvifHost(
  ip: string,
  httpPort: number,
  credentials: DiscoveryOptions['credentials'],
): Promise<OnvifDeviceInformation | null> {
  const body = '<tds:GetDeviceInformation/>';

  for (const path of ONVIF_DEVICE_PATHS) {
    const scheme = httpPort === 443 ? 'https' : 'http';
    const host =
      (scheme === 'http' && httpPort === 80) ||
      (scheme === 'https' && httpPort === 443)
        ? ip
        : `${ip}:${httpPort}`;
    const endpoint = `${scheme}://${host}${path}`;

    const xml = await soapPost(endpoint, body, credentials, SOAP_TIMEOUT_MS);
    if (!xml) continue;

    const info = parseOnvifDeviceInformation(xml);
    if (info.manufacturer || info.model) {
      return info;
    }
    // SOAP fault often means ONVIF is present but auth/args wrong — still counts
    if (xml.includes('SoapFault') || xml.includes('ter:InvalidArgs')) {
      return info.manufacturer ? info : {};
    }
  }
  return null;
}

/** Resolve RTSP URI via GetCapabilities → GetProfiles → GetStreamUri */
async function resolveOnvifStreamUri(
  ip: string,
  httpPort: number,
  credentials: DiscoveryOptions['credentials'],
): Promise<string | undefined> {
  const scheme = httpPort === 443 ? 'https' : 'http';
  const host =
    (scheme === 'http' && httpPort === 80) ||
    (scheme === 'https' && httpPort === 443)
      ? ip
      : `${ip}:${httpPort}`;

  // 1. Media XAddr from GetCapabilities
  const capsXml = await soapPost(
    `${scheme}://${host}/onvif/device_service`,
    '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>',
    credentials,
    SOAP_TIMEOUT_MS,
  );
  const mediaXAddr = capsXml ? parseMediaXAddr(capsXml) : undefined;
  if (!mediaXAddr) return undefined;

  // 2. First profile token
  const profilesXml = await soapPost(
    mediaXAddr,
    '<trt:GetProfiles/>',
    credentials,
    SOAP_TIMEOUT_MS,
  );
  const profileToken = profilesXml ? parseProfileToken(profilesXml) : undefined;
  if (!profileToken) return undefined;

  // 3. Stream URI
  const streamXml = await soapPost(
    mediaXAddr,
    `<trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>${escapeXml(profileToken)}</trt:ProfileToken>
    </trt:GetStreamUri>`,
    credentials,
    SOAP_TIMEOUT_MS,
  );
  return streamXml ? parseStreamUri(streamXml) : undefined;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Discover ONVIF-capable cameras on the local subnet.
 *
 * @example
 * ```ts
 * const cameras = await discoverCameras({
 *   onProgress: p => console.log(p.phase, p.scanned, '/', p.total),
 * });
 * ```
 */
export async function discoverCameras(
  options: DiscoveryOptions = {},
): Promise<DiscoveredCamera[]> {
  const {
    credentials,
    onProgress,
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    signal,
  } = options;

  const subnet = options.subnet ?? (await getLocalSubnetFromNetInfo());
  if (!subnet) {
    throw new Error(
      'Could not determine local subnet. Connect to Wi-Fi or enter a subnet manually.',
    );
  }

  const hosts = generateHostIps(subnet.ip, subnet.subnetMask);
  if (hosts.length === 0) {
    throw new Error('Subnet too large to scan safely (max /22).');
  }

  const total = hosts.length;
  let scanned = 0;
  let found = 0;

  const report = (phase: DiscoveryProgress['phase']) => {
    onProgress?.({ phase, scanned, total, found });
  };

  report('probing');

  // --- Phase 1: HTTP sweep ---
  const liveHosts: Array<{ ip: string; port: number }> = [];
  await mapWithConcurrency(hosts, PROBE_CONCURRENCY, async (ip) => {
    if (signal?.aborted) return;
    const port = await probeHostPorts(ip, DEFAULT_HTTP_PORTS, timeoutMs);
    scanned += 1;
    if (port !== null) {
      liveHosts.push({ ip, port });
      found = liveHosts.length;
    }
    if (scanned % 16 === 0 || scanned === total) {
      report('probing');
    }
  });

  if (signal?.aborted) {
    report('done');
    return [];
  }

  // --- Phase 2: ONVIF identify ---
  report('identifying');

  const results: DiscoveredCamera[] = [];
  await mapWithConcurrency(liveHosts, 8, async ({ ip, port }) => {
    if (signal?.aborted) return;

    let info: OnvifDeviceInformation | null = null;
    try {
      info = await identifyOnvifHost(ip, port, credentials);
    } catch {
      info = null;
    }

    if (!info) {
      // Live HTTP host but not ONVIF — still surface it so the user can add manually
      results.push({ ip, port, onvif: false });
      return;
    }

    const brandId =
      (detectCameraBrand(ip, info.serialNumber) ??
        mapManufacturerToBrand(info.manufacturer, info.model)) ||
      'generic';

    let rtspUrl: string | undefined;
    try {
      rtspUrl = await resolveOnvifStreamUri(ip, port, credentials);
    } catch {
      rtspUrl = undefined;
    }

    if (!rtspUrl) {
      // Fall back to brand URL template
      const brand = CAMERA_BRANDS.find((b) => b.id === brandId);
      if (brand) {
        // 🔒 Never embed credentials into the URL — they stay in the encrypted
        // username/password fields and are supplied separately at connection time.
        rtspUrl = generateRtspUrl(brandId, ip, {});
      }
    }

    results.push({
      ip,
      port,
      manufacturer: info.manufacturer,
      model: info.model,
      firmware: info.firmware,
      serialNumber: info.serialNumber,
      hardwareId: info.hardwareId,
      brandId,
      rtspUrl,
      onvif: true,
    });
  });

  report('done');
  return results;
}
