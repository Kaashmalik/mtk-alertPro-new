import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import {
  Camera,
  Link2,
  User,
  Lock,
  ArrowLeft,
  Wifi,
  ChevronDown,
  ChevronUp,
  Radar,
  Search,
  CheckCircle2,
  XCircle,
  Plug,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Input } from '@/components/ui';
import { useCameraStore } from '@/stores';
import { designSystem } from '@/theme/design-system';
import {
  CAMERA_BRANDS,
  generateRtspUrl,
  isValidIpAddress,
  parseRtspUrl,
} from '@/lib/camera/rtspHelper';
import {
  discoverCameras,
  type DiscoveredCamera,
  type DiscoveryProgress,
} from '@/lib/camera/discoveryService';
import {
  testCameraConnection,
  type ConnectionTestResult,
} from '@/lib/camera/connectionService';

const cameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required'),
  rtspUrl: z.string().min(1, 'RTSP URL is required'),
  username: z.string().optional(),
  password: z.string().optional(),
});

type CameraForm = z.infer<typeof cameraSchema>;

type DiscoveryState = {
  status: 'idle' | 'scanning' | 'done' | 'error';
  progress: DiscoveryProgress | null;
  results: DiscoveredCamera[];
  error: string | null;
};

const INITIAL_DISCOVERY: DiscoveryState = {
  status: 'idle',
  progress: null,
  results: [],
  error: null,
};

/** Build an RTSP URL from structured fields (path overrides the brand template) */
function buildStructuredRtspUrl(opts: {
  brandId: string;
  ip: string;
  port: number;
  streamPath: string;
  username?: string;
  password?: string;
}): string {
  const path = opts.streamPath.trim();
  if (path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    // 🔒 Credentials are never embedded into the URL — the form keeps them in
    // the separate username/password fields (encrypted on save).
    return `rtsp://${opts.ip}:${opts.port}${normalized}`;
  }
  return generateRtspUrl(opts.brandId, opts.ip, {
    port: opts.port,
  });
}

function suggestCameraName(cam: DiscoveredCamera): string {
  const detail = [cam.manufacturer, cam.model].filter(Boolean).join(' ');
  return detail || cam.ip;
}

function phaseLabel(phase: DiscoveryProgress['phase']): string {
  if (phase === 'probing') return 'Scanning network…';
  if (phase === 'identifying') return 'Identifying devices…';
  return 'Done';
}

export default function AddCameraScreen() {
  const addCamera = useCameraStore((state) => state.addCamera);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>('hikvision');
  const [ipAddress, setIpAddress] = useState('');
  const [rtspPort, setRtspPort] = useState('554');
  const [streamPath, setStreamPath] = useState('');
  const [showBrandSelector, setShowBrandSelector] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryState>(INITIAL_DISCOVERY);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const discoveryAbortRef = useRef<AbortController | null>(null);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CameraForm>({
    resolver: zodResolver(cameraSchema),
    defaultValues: {
      name: '',
      rtspUrl: '',
      username: '',
      password: '',
    },
  });

  const watchedUsername = watch('username');
  const watchedPassword = watch('password');
  const watchedRtspUrl = watch('rtspUrl');

  // A new URL invalidates the previous test result
  useEffect(() => {
    setTestResult(null);
  }, [watchedRtspUrl]);

  // Cancel any in-flight discovery when leaving the screen
  useEffect(() => {
    return () => {
      discoveryAbortRef.current?.abort();
    };
  }, []);

  const handleGenerateUrl = useCallback(() => {
    if (!isValidIpAddress(ipAddress)) {
      Alert.alert('Invalid IP', 'Please enter a valid IP address');
      return;
    }

    const port = parseInt(rtspPort, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      Alert.alert('Invalid Port', 'Port must be between 1 and 65535');
      return;
    }

    const url = buildStructuredRtspUrl({
      brandId: selectedBrand,
      ip: ipAddress,
      port,
      streamPath,
      username: watchedUsername || undefined,
      password: watchedPassword || undefined,
    });

    if (url) {
      setValue('rtspUrl', url);
    }
  }, [ipAddress, selectedBrand, rtspPort, streamPath, watchedUsername, watchedPassword, setValue]);

  const selectedBrandData = CAMERA_BRANDS.find((b) => b.id === selectedBrand);

  const startDiscovery = useCallback(async () => {
    discoveryAbortRef.current?.abort();
    const controller = new AbortController();
    discoveryAbortRef.current = controller;

    setDiscovery({
      status: 'scanning',
      progress: { phase: 'probing', scanned: 0, total: 0, found: 0 },
      results: [],
      error: null,
    });

    const username = watchedUsername?.trim();
    try {
      const results = await discoverCameras({
        credentials: username
          ? { username, password: watchedPassword || '' }
          : undefined,
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setDiscovery((prev) =>
            prev.status === 'scanning' ? { ...prev, progress } : prev
          );
        },
      });
      if (controller.signal.aborted) return;
      setDiscovery({ status: 'done', progress: null, results, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      setDiscovery({
        status: 'error',
        progress: null,
        results: [],
        error: error instanceof Error ? error.message : 'Discovery failed',
      });
    }
  }, [watchedUsername, watchedPassword]);

  const cancelDiscovery = useCallback(() => {
    discoveryAbortRef.current?.abort();
    setDiscovery(INITIAL_DISCOVERY);
  }, []);

  const applyDiscoveredCamera = useCallback(
    (cam: DiscoveredCamera) => {
      if (cam.brandId && CAMERA_BRANDS.some((b) => b.id === cam.brandId)) {
        setSelectedBrand(cam.brandId);
      }
      setIpAddress(cam.ip);

      const brand =
        CAMERA_BRANDS.find((b) => b.id === cam.brandId) ?? selectedBrandData;
      setRtspPort(String(cam.port && cam.port !== 80 ? 554 : brand?.rtspPort ?? 554));

      if (cam.rtspUrl) {
        setValue('rtspUrl', cam.rtspUrl);
        const parsed = parseRtspUrl(cam.rtspUrl);
        if (parsed) {
          setRtspPort(String(parsed.port));
          if (parsed.path && parsed.path !== '/') {
            setStreamPath(parsed.path);
          }
          if (parsed.username && !watch('username')) {
            setValue('username', parsed.username);
          }
        }
      }

      if (!watch('name')) {
        setValue('name', suggestCameraName(cam));
      }
    },
    [setValue, watch, selectedBrandData]
  );

  const handleTestConnection = useCallback(async () => {
    const url = watch('rtspUrl')?.trim();
    if (!url) {
      Alert.alert('Missing URL', 'Enter or generate an RTSP URL first.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testCameraConnection(url, {
        timeoutMs: 5000,
        retryCount: 1,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
        timestamp: new Date(),
      });
    } finally {
      setIsTesting(false);
    }
  }, [watch]);

  const onSubmit = async (data: CameraForm) => {
    setIsLoading(true);
    try {
      await saveCamera(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add camera';
      Alert.alert('Error', message);
      setIsLoading(false);
    }
  };

  const saveCamera = async (data: CameraForm) => {
    await addCamera({
      name: data.name,
      rtspUrl: data.rtspUrl,
      username: data.username,
      password: data.password,
      isActive: true,
      detectionSettings: {
        person: true,
        vehicle: true,
        face: false,
        sensitivity: 0.7,
        notificationsEnabled: true,
        alarmEnabled: true,
      },
    });
    Alert.alert('Success', 'Camera added successfully!', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  const isScanning = discovery.status === 'scanning';
  const progressPct =
    discovery.progress && discovery.progress.total > 0
      ? Math.min(
          100,
          Math.round((discovery.progress.scanned / discovery.progress.total) * 100)
        )
      : 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Add Camera',
          headerStyle: { backgroundColor: designSystem.colors.background.secondary },
          headerTintColor: designSystem.colors.text.primary,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: designSystem.spacing.md }}>
              <ArrowLeft size={24} color={designSystem.colors.text.primary} />
            </TouchableOpacity>
          ),
        }}
      />

      <SafeAreaView style={styles.container} edges={['bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={designSystem.colors.background.primary} />
        <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">

          {/* Network Discovery */}
          <Animated.View entering={FadeInDown.duration(600)} style={styles.discoveryCard}>
            <View style={styles.discoveryHeader}>
              <View style={styles.discoveryHeaderIcon}>
                <Radar size={24} color={designSystem.colors.primary[500]} />
              </View>
              <View style={styles.discoveryHeaderText}>
                <Text style={styles.discoveryTitle}>Find Cameras</Text>
                <Text style={styles.discoveryDesc}>
                  Scan your Wi-Fi network for ONVIF cameras
                </Text>
              </View>
            </View>

            {discovery.status !== 'scanning' ? (
              <Button
                variant="secondary"
                size="sm"
                onPress={startDiscovery}
                style={styles.discoveryButton}
              >
                <Search size={16} color={designSystem.colors.text.primary} />
                <Text style={styles.discoveryButtonText}> Scan Network</Text>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onPress={cancelDiscovery}
                style={styles.discoveryButton}
              >
                Cancel Scan
              </Button>
            )}

            {isScanning && discovery.progress && (
              <View style={styles.progressSection}>
                <Text style={styles.progressLabel}>
                  {phaseLabel(discovery.progress.phase)}
                  {'  '}
                  {discovery.progress.scanned}/{discovery.progress.total}
                  {discovery.progress.found > 0
                    ? `  ·  ${discovery.progress.found} found`
                    : ''}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[styles.progressFill, { width: `${progressPct}%` }]}
                  />
                </View>
              </View>
            )}

            {discovery.status === 'error' && discovery.error && (
              <Text style={styles.discoveryError}>{discovery.error}</Text>
            )}

            {discovery.status === 'done' && (
              <>
                {discovery.results.length === 0 ? (
                  <Text style={styles.discoveryEmpty}>
                    No cameras found. Make sure you&apos;re on the same Wi-Fi network
                    as your cameras.
                  </Text>
                ) : (
                  <View style={styles.resultsList}>
                    {discovery.results.map((cam, index) => (
                      <TouchableOpacity
                        key={`${cam.ip}-${cam.port}-${index}`}
                        style={styles.resultItem}
                        onPress={() => applyDiscoveredCamera(cam)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.resultIcon}>
                          <Camera
                            size={18}
                            color={
                              cam.onvif
                                ? designSystem.colors.primary[500]
                                : designSystem.colors.text.muted
                            }
                          />
                        </View>
                        <View style={styles.resultBody}>
                          <Text style={styles.resultTitle} numberOfLines={1}>
                            {cam.manufacturer || cam.model || cam.ip}
                          </Text>
                          <Text style={styles.resultSubtitle} numberOfLines={1}>
                            {cam.ip}:{cam.port}
                            {cam.model ? ` · ${cam.model}` : ''}
                            {' · '}
                            {cam.onvif ? 'ONVIF' : 'HTTP only'}
                          </Text>
                        </View>
                        <Text style={styles.resultAction}>Use</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </Animated.View>

          {/* Smart URL Builder Header */}
          <Animated.View entering={FadeInDown.delay(100).duration(600)} style={styles.urlBuilderHeader}>
            <View style={styles.urlBuilderHeaderIcon}>
              <Wifi size={24} color={designSystem.colors.primary[500]} />
            </View>
            <View style={styles.urlBuilderHeaderText}>
              <Text style={styles.urlBuilderHeaderTitle}>Smart Camera Setup</Text>
              <Text style={styles.urlBuilderHeaderDesc}>
                Enter your camera's IP address and we'll generate the RTSP URL
              </Text>
            </View>
          </Animated.View>

          {/* Smart URL Builder */}
          <Animated.View entering={FadeInDown.delay(150).duration(600)} style={styles.urlBuilder}>
            <Text style={styles.urlBuilderTitle}>Smart URL Builder</Text>

            {/* Brand Selector */}
            <TouchableOpacity
              style={styles.brandSelector}
              onPress={() => setShowBrandSelector(!showBrandSelector)}
            >
              <Text style={styles.brandSelectorLabel}>Camera Brand</Text>
              <View style={styles.brandSelectorValue}>
                <Text style={styles.brandSelectorText}>
                  {selectedBrandData?.name || 'Select Brand'}
                </Text>
                {showBrandSelector ? (
                  <ChevronUp size={20} color={designSystem.colors.text.secondary} />
                ) : (
                  <ChevronDown size={20} color={designSystem.colors.text.secondary} />
                )}
              </View>
            </TouchableOpacity>

            {showBrandSelector && (
              <View style={styles.brandDropdown}>
                {CAMERA_BRANDS.filter(b => b.id !== 'custom').map((brand) => (
                  <TouchableOpacity
                    key={brand.id}
                    style={[
                      styles.brandDropdownItem,
                      selectedBrand === brand.id && styles.brandDropdownItemActive,
                    ]}
                    onPress={() => {
                      setSelectedBrand(brand.id);
                      setRtspPort(String(brand.rtspPort));
                      setShowBrandSelector(false);
                    }}
                  >
                    <Text style={[
                      styles.brandDropdownText,
                      selectedBrand === brand.id && styles.brandDropdownTextActive,
                    ]}>
                      {brand.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* IP Address Input */}
            <View style={styles.ipInputContainer}>
              <Text style={styles.ipInputLabel}>Camera IP Address</Text>
              <TextInput
                style={styles.ipInput}
                placeholder="192.168.1.100"
                placeholderTextColor={designSystem.colors.text.muted}
                value={ipAddress}
                onChangeText={setIpAddress}
                keyboardType="numeric"
                autoCapitalize="none"
              />
            </View>

            {/* Port + Stream Path */}
            <View style={styles.portPathRow}>
              <View style={styles.portCol}>
                <Text style={styles.ipInputLabel}>RTSP Port</Text>
                <TextInput
                  style={styles.ipInput}
                  placeholder="554"
                  placeholderTextColor={designSystem.colors.text.muted}
                  value={rtspPort}
                  onChangeText={setRtspPort}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.pathCol}>
                <Text style={styles.ipInputLabel}>Stream Path (optional)</Text>
                <TextInput
                  style={styles.ipInput}
                  placeholder="/Streaming/Channels/101"
                  placeholderTextColor={designSystem.colors.text.muted}
                  value={streamPath}
                  onChangeText={setStreamPath}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            <TouchableOpacity
              style={styles.generateButton}
              onPress={handleGenerateUrl}
            >
              <Text style={styles.generateButtonText}>Generate RTSP URL</Text>
            </TouchableOpacity>

            <Text style={styles.urlBuilderHint}>
              💡 Leave stream path empty to use the brand default. Enter credentials below for authenticated cameras.
            </Text>
          </Animated.View>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or enter manually</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Form */}
          <Animated.View entering={FadeInDown.delay(200).duration(600)} style={styles.form}>
            <Controller
              control={control}
              name="name"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Camera Name"
                  placeholder="e.g., Front Door, Backyard"
                  leftIcon={<Camera size={20} color={designSystem.colors.text.muted} />}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.name?.message}
                />
              )}
            />

            <View style={{ height: designSystem.spacing.md }} />

            <Controller
              control={control}
              name="rtspUrl"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="RTSP URL"
                  placeholder="rtsp://192.168.1.100:554/stream"
                  leftIcon={<Link2 size={20} color={designSystem.colors.text.muted} />}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.rtspUrl?.message}
                />
              )}
            />

            <View style={{ height: designSystem.spacing.md }} />

            <Text style={styles.credentialsLabel}>
              Camera Credentials (optional)
            </Text>

            <Controller
              control={control}
              name="username"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Username"
                  placeholder="admin"
                  leftIcon={<User size={20} color={designSystem.colors.text.muted} />}
                  autoCapitalize="none"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
              )}
            />

            <View style={{ height: designSystem.spacing.md }} />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Password"
                  placeholder="••••••••"
                  leftIcon={<Lock size={20} color={designSystem.colors.text.muted} />}
                  secureTextEntry
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
              )}
            />
          </Animated.View>

          {/* Test Connection */}
          <Animated.View entering={FadeInDown.delay(250).duration(600)} style={styles.testSection}>
            <Button
              variant="outline"
              onPress={handleTestConnection}
              loading={isTesting}
              disabled={isLoading}
              style={styles.testButton}
            >
              <Plug size={18} color={designSystem.colors.text.primary} />
              <Text style={styles.testButtonText}> Test Connection</Text>
            </Button>

            {testResult && (
              <View
                style={[
                  styles.testResultBanner,
                  testResult.success
                    ? styles.testResultSuccess
                    : styles.testResultFailure,
                ]}
              >
                {testResult.success ? (
                  <CheckCircle2
                    size={20}
                    color={designSystem.colors.status.success}
                  />
                ) : (
                  <XCircle size={20} color={designSystem.colors.status.danger} />
                )}
                <View style={styles.testResultBody}>
                  <Text
                    style={[
                      styles.testResultTitle,
                      {
                        color: testResult.success
                          ? designSystem.colors.status.success
                          : designSystem.colors.status.danger,
                      },
                    ]}
                  >
                    {testResult.success
                      ? `Connected${testResult.latency != null ? ` · ${testResult.latency}ms` : ''}`
                      : 'Connection failed'}
                  </Text>
                  {!testResult.success && testResult.error && (
                    <Text style={styles.testResultDetail}>{testResult.error}</Text>
                  )}
                </View>
              </View>
            )}
          </Animated.View>

          {/* Help Text */}
          <Animated.View entering={FadeInDown.delay(300).duration(600)} style={styles.helpCard}>
            <Text style={styles.helpText}>
              💡 <Text style={styles.helpBold}>Tip:</Text> Use “Scan Network” to find cameras automatically, or enter your camera's IP and brand to generate the RTSP URL. Most cameras use port 554.
            </Text>
          </Animated.View>

          {/* Submit Button */}
          <Button
            style={styles.submitButton}
            onPress={handleSubmit(onSubmit)}
            loading={isLoading}
            disabled={isTesting}
          >
            Add Camera
          </Button>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: designSystem.spacing.xxl,
  },
  discoveryCard: {
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.layout.radius.xl,
    padding: designSystem.spacing.lg,
    marginTop: designSystem.spacing.lg,
    marginBottom: designSystem.spacing.lg,
  },
  discoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: designSystem.spacing.md,
  },
  discoveryHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: designSystem.spacing.md,
  },
  discoveryHeaderText: {
    flex: 1,
  },
  discoveryTitle: {
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
    color: designSystem.colors.text.primary,
    marginBottom: designSystem.spacing.xs,
  },
  discoveryDesc: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    lineHeight: 18,
  },
  discoveryButton: {
    alignSelf: 'flex-start',
  },
  discoveryButtonText: {
    fontSize: designSystem.typography.size.sm,
    fontWeight: '600',
    color: designSystem.colors.text.primary,
  },
  progressSection: {
    marginTop: designSystem.spacing.md,
  },
  progressLabel: {
    fontSize: designSystem.typography.size.xs,
    color: designSystem.colors.text.secondary,
    marginBottom: designSystem.spacing.xs,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: designSystem.colors.background.tertiary,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: designSystem.colors.primary[500],
  },
  discoveryError: {
    marginTop: designSystem.spacing.md,
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.status.danger,
  },
  discoveryEmpty: {
    marginTop: designSystem.spacing.md,
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    lineHeight: 20,
  },
  resultsList: {
    marginTop: designSystem.spacing.md,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: designSystem.colors.background.tertiary,
    borderRadius: designSystem.layout.radius.lg,
    padding: designSystem.spacing.md,
    marginBottom: designSystem.spacing.sm,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: designSystem.colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: designSystem.spacing.md,
  },
  resultBody: {
    flex: 1,
  },
  resultTitle: {
    fontSize: designSystem.typography.size.sm,
    fontWeight: '600',
    color: designSystem.colors.text.primary,
    marginBottom: 2,
  },
  resultSubtitle: {
    fontSize: designSystem.typography.size.xs,
    color: designSystem.colors.text.secondary,
  },
  resultAction: {
    fontSize: designSystem.typography.size.sm,
    fontWeight: '600',
    color: designSystem.colors.primary[500],
    marginLeft: designSystem.spacing.sm,
  },
  urlBuilderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.layout.radius.xl,
    padding: designSystem.spacing.lg,
    marginBottom: designSystem.spacing.lg,
  },
  urlBuilderHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: designSystem.spacing.md,
  },
  urlBuilderHeaderText: {
    flex: 1,
  },
  urlBuilderHeaderTitle: {
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
    color: designSystem.colors.text.primary,
    marginBottom: designSystem.spacing.xs,
  },
  urlBuilderHeaderDesc: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    lineHeight: 18,
  },
  urlBuilder: {
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.layout.radius.xl,
    padding: designSystem.spacing.lg,
    marginBottom: designSystem.spacing.xl,
  },
  urlBuilderTitle: {
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
    color: designSystem.colors.text.primary,
    marginBottom: designSystem.spacing.lg,
  },
  brandSelector: {
    marginBottom: designSystem.spacing.md,
  },
  brandSelectorLabel: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    marginBottom: designSystem.spacing.xs,
  },
  brandSelectorValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: designSystem.colors.background.tertiary,
    borderRadius: designSystem.layout.radius.lg,
    padding: designSystem.spacing.md,
  },
  brandSelectorText: {
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.text.primary,
  },
  brandDropdown: {
    backgroundColor: designSystem.colors.background.tertiary,
    borderRadius: designSystem.layout.radius.lg,
    marginBottom: designSystem.spacing.md,
    overflow: 'hidden',
  },
  brandDropdownItem: {
    paddingVertical: designSystem.spacing.md,
    paddingHorizontal: designSystem.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: designSystem.colors.border.default,
  },
  brandDropdownItemActive: {
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },
  brandDropdownText: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.primary,
  },
  brandDropdownTextActive: {
    color: designSystem.colors.primary[500],
    fontWeight: '600',
  },
  ipInputContainer: {
    marginBottom: designSystem.spacing.md,
  },
  ipInputLabel: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    marginBottom: designSystem.spacing.xs,
  },
  ipInput: {
    backgroundColor: designSystem.colors.background.tertiary,
    borderRadius: designSystem.layout.radius.lg,
    padding: designSystem.spacing.md,
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.text.primary,
  },
  portPathRow: {
    flexDirection: 'row',
    marginBottom: designSystem.spacing.md,
  },
  portCol: {
    width: 96,
    marginRight: designSystem.spacing.md,
  },
  pathCol: {
    flex: 1,
  },
  generateButton: {
    backgroundColor: designSystem.colors.primary[500],
    borderRadius: designSystem.layout.radius.lg,
    padding: designSystem.spacing.md,
    alignItems: 'center',
  },
  generateButtonText: {
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
    color: 'white',
  },
  urlBuilderHint: {
    fontSize: designSystem.typography.size.xs,
    color: designSystem.colors.text.muted,
    marginTop: designSystem.spacing.md,
    textAlign: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: designSystem.spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: designSystem.colors.border.default,
  },
  dividerText: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.muted,
    paddingHorizontal: designSystem.spacing.md,
  },
  form: {
    marginBottom: designSystem.spacing.lg,
  },
  credentialsLabel: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    marginBottom: designSystem.spacing.sm,
  },
  testSection: {
    marginTop: designSystem.spacing.sm,
    marginBottom: designSystem.spacing.md,
  },
  testButton: {
    flexDirection: 'row',
    gap: designSystem.spacing.sm,
  },
  testButtonText: {
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
    color: designSystem.colors.text.primary,
  },
  testResultBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: designSystem.layout.radius.lg,
    padding: designSystem.spacing.md,
    marginTop: designSystem.spacing.md,
    borderWidth: 1,
  },
  testResultSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  testResultFailure: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  testResultBody: {
    flex: 1,
    marginLeft: designSystem.spacing.sm,
  },
  testResultTitle: {
    fontSize: designSystem.typography.size.sm,
    fontWeight: '600',
  },
  testResultDetail: {
    fontSize: designSystem.typography.size.xs,
    color: designSystem.colors.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
  helpCard: {
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.layout.radius.xl,
    padding: designSystem.spacing.lg,
    marginTop: designSystem.spacing.xl,
  },
  helpText: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    lineHeight: 20,
  },
  helpBold: {
    fontWeight: '600',
    color: designSystem.colors.text.primary,
  },
  submitButton: {
    marginTop: designSystem.spacing.xxl,
    marginBottom: designSystem.spacing.xxxl,
  },
});
