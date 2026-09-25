/**
 * Discovery service tests (pure helpers + orchestrated flow with mocks)
 */

import NetInfo from '@react-native-community/netinfo';
import {
  generateHostIps,
  ipToInt,
  intToIp,
  mapManufacturerToBrand,
  buildSoapEnvelope,
  parseOnvifDeviceInformation,
  parseMediaXAddr,
  parseProfileToken,
  parseStreamUri,
  discoverCameras,
} from '@/lib/camera/discoveryService';

describe('discoveryService', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      isConnected: true,
      type: 'wifi',
      details: { ipAddress: '192.168.1.50', subnet: '255.255.255.0' },
    });
  });

  describe('ipToInt / intToIp', () => {
    it('round-trips', () => {
      expect(intToIp(ipToInt('192.168.1.50'))).toBe('192.168.1.50');
      expect(ipToInt('0.0.0.0')).toBe(0);
      expect(ipToInt('255.255.255.255')).toBe(4294967295);
    });
  });

  describe('generateHostIps', () => {
    it('enumerates a /24 excluding self, network, broadcast', () => {
      const hosts = generateHostIps('192.168.1.50', '255.255.255.0');
      expect(hosts).toHaveLength(253);
      expect(hosts).not.toContain('192.168.1.50');
      expect(hosts).not.toContain('192.168.1.0');
      expect(hosts).not.toContain('192.168.1.255');
      expect(hosts[0]).toBe('192.168.1.1');
      expect(hosts).toContain('192.168.1.254');
    });

    it('rejects subnets larger than /22', () => {
      expect(generateHostIps('10.0.0.5', '255.255.0.0')).toEqual([]);
    });
  });

  describe('mapManufacturerToBrand', () => {
    it('maps known manufacturers', () => {
      expect(mapManufacturerToBrand('Hikvision', 'DS-2CD2143')).toBe('hikvision');
      expect(mapManufacturerToBrand('Dahua', 'IPC-HFW')).toBe('dahua');
      expect(mapManufacturerToBrand('Reolink', 'RLC-810A')).toBe('reolink');
      expect(mapManufacturerToBrand('AXIS', 'M3045')).toBe('axis');
      expect(mapManufacturerToBrand('Amcrest', 'IP8M')).toBe('amcrest');
    });

    it('falls back to generic for unknown or empty', () => {
      expect(mapManufacturerToBrand('AcmeCams', 'X1')).toBe('generic');
      expect(mapManufacturerToBrand(undefined, undefined)).toBe('generic');
      expect(mapManufacturerToBrand('   ', '')).toBe('generic');
    });
  });

  describe('buildSoapEnvelope', () => {
    it('wraps body without credentials', () => {
      const xml = buildSoapEnvelope('<tds:GetDeviceInformation/>');
      expect(xml).toContain('<s:Envelope');
      expect(xml).toContain('<tds:GetDeviceInformation/>');
      expect(xml).not.toContain('UsernameToken');
    });

    it('includes WS-Security UsernameToken with credentials', () => {
      const xml = buildSoapEnvelope('<tds:GetDeviceInformation/>', {
        username: 'admin',
        password: 'secret',
      });
      expect(xml).toContain('<s:Header>');
      expect(xml).toContain('UsernameToken');
      expect(xml).toContain('<Username>admin</Username>');
      expect(xml).toContain('PasswordDigest');
    });

    it('escapes XML special chars in username', () => {
      const xml = buildSoapEnvelope('<x/>', { username: 'a<b>&c', password: 'p' });
      expect(xml).toContain('a&lt;b&gt;&amp;c');
    });
  });

  describe('XML parsers', () => {
    const deviceInfoXml = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <tds:GetDeviceInformationResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
            <tds:Manufacturer>Hikvision</tds:Manufacturer>
            <tds:Model>DS-2CD2143G2-I</tds:Model>
            <tds:FirmwareVersion>V5.6.3</tds:FirmwareVersion>
            <tds:SerialNumber>DS-2CD2143G2-12345</tds:SerialNumber>
            <tds:HardwareId>abc</tds:HardwareId>
          </tds:GetDeviceInformationResponse>
        </soap:Body>
      </soap:Envelope>`;

    it('parses GetDeviceInformation', () => {
      const info = parseOnvifDeviceInformation(deviceInfoXml);
      expect(info.manufacturer).toBe('Hikvision');
      expect(info.model).toBe('DS-2CD2143G2-I');
      expect(info.firmware).toBe('V5.6.3');
      expect(info.serialNumber).toBe('DS-2CD2143G2-12345');
      expect(info.hardwareId).toBe('abc');
    });

    it('parses Media XAddr from GetCapabilities', () => {
      const caps = `
        <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
          <s:Body>
            <tds:GetCapabilitiesResponse>
              <tds:Capabilities>
                <tt:Media>
                  <tt:XAddr>http://192.168.1.10/onvif/media_service</tt:XAddr>
                </tt:Media>
              </tds:Capabilities>
            </tds:GetCapabilitiesResponse>
          </s:Body>
        </s:Envelope>`;
      expect(parseMediaXAddr(caps)).toBe('http://192.168.1.10/onvif/media_service');
    });

    it('parses profile token', () => {
      const profiles = `
        <trt:GetProfilesResponse>
          <trt:Profiles token="Profile_1" fixed="true">
            <tt:Name>MainStream</tt:Name>
          </trt:Profiles>
        </trt:GetProfilesResponse>`;
      expect(parseProfileToken(profiles)).toBe('Profile_1');
    });

    it('parses RTSP stream URI', () => {
      const stream = `
        <trt:GetStreamUriResponse>
          <trt:StreamUri>
            <tt:MediaUri>
              <tt:Uri>rtsp://192.168.1.10:554/Streaming/Channels/101</tt:Uri>
            </tt:MediaUri>
          </trt:StreamUri>
        </trt:GetStreamUriResponse>`;
      expect(parseStreamUri(stream)).toBe(
        'rtsp://192.168.1.10:554/Streaming/Channels/101'
      );
    });

    it('rejects non-rtsp URIs', () => {
      expect(parseStreamUri('<Uri>http://example.com</Uri>')).toBeUndefined();
    });
  });

  describe('discoverCameras', () => {
    it('throws when subnet cannot be determined', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: false,
        type: 'none',
        details: null,
      });

      await expect(discoverCameras()).rejects.toThrow(/local subnet/i);
    });

    it('probes subnet and returns ONVIF cameras', async () => {
      const deviceInfoXml = `
        <tds:GetDeviceInformationResponse>
          <tds:Manufacturer>Hikvision</tds:Manufacturer>
          <tds:Model>DS-2CD</tds:Model>
          <tds:SerialNumber>DS-1</tds:SerialNumber>
        </tds:GetDeviceInformationResponse>`;

      const capsXml = `
        <tds:GetCapabilitiesResponse>
          <tds:Capabilities>
            <tt:Media>
              <tt:XAddr>http://192.168.1.5/onvif/media_service</tt:XAddr>
            </tt:Media>
          </tds:Capabilities>
        </tds:GetCapabilitiesResponse>`;

      const profilesXml = `
        <trt:GetProfilesResponse>
          <trt:Profiles token="Profile_1"><tt:Name>Main</tt:Name></trt:Profiles>
        </trt:GetProfilesResponse>`;

      const streamXml = `
        <trt:GetStreamUriResponse>
          <tt:Uri>rtsp://192.168.1.5:554/Streaming/Channels/101</tt:Uri>
        </trt:GetStreamUriResponse>`;

      (global.fetch as jest.Mock).mockImplementation(
        (input: string, init?: { method?: string; body?: string }) => {
          const url = String(input);
          const body = init?.body || '';

          // HEAD probes: only .5 is "live"
          if (!init?.method || init.method === 'HEAD') {
            if (url.startsWith('http://192.168.1.5:')) {
              return Promise.resolve({ ok: true, status: 200, headers: { get: () => null } });
            }
            return Promise.reject(new Error('Network error'));
          }

          // SOAP posts
          if (body.includes('GetDeviceInformation')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () => deviceInfoXml,
            });
          }
          if (body.includes('GetCapabilities')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () => capsXml,
            });
          }
          if (body.includes('GetProfiles')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () => profilesXml,
            });
          }
          if (body.includes('GetStreamUri')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () => streamXml,
            });
          }
          return Promise.resolve({
            ok: false,
            status: 404,
            text: async () => '',
          });
        }
      );

      const progress: string[] = [];
      const cameras = await discoverCameras({
        subnet: { ip: '192.168.1.50', subnetMask: '255.255.255.0' },
        onProgress: p => progress.push(p.phase),
        timeoutMs: 50,
      });

      expect(progress).toContain('probing');
      expect(progress).toContain('identifying');
      expect(progress).toContain('done');

      // Narrow to the live host for assertions (scan is /24)
      const found = cameras.find(c => c.ip === '192.168.1.5');
      expect(found).toBeDefined();
      expect(found?.onvif).toBe(true);
      expect(found?.manufacturer).toBe('Hikvision');
      expect(found?.brandId).toBe('hikvision');
      expect(found?.rtspUrl).toBe('rtsp://192.168.1.5:554/Streaming/Channels/101');
    });

    it('respects abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      (global.fetch as jest.Mock).mockRejectedValue(new Error('aborted'));

      const result = await discoverCameras({
        subnet: { ip: '192.168.1.50', subnetMask: '255.255.255.0' },
        signal: controller.signal,
        timeoutMs: 10,
      });

      expect(result).toEqual([]);
    });
  });
});
