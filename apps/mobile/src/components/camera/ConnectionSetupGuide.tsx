/**
 * In-app camera connection guide.
 *
 * The relay status is the single biggest source of "my camera won't connect"
 * support questions, and it used to be invisible: the app only surfaced a raw
 * fetch error deep in an add-camera form. This component makes the whole chain
 * explicit and *verifiable* — it performs a real request against the relay's
 * /health endpoint, so the user can tell "not configured" apart from "configured
 * but unreachable" (wrong IP / relay down / phone on another network) without
 * leaving the app or reading a web page.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Lightbulb,
  Play,
  Radio,
  RefreshCw,
  Server,
  Smartphone,
  XCircle,
} from 'lucide-react-native';

import { mediaServerStatus } from '@/lib/camera/connectionDiagnostics';
import { borderRadius, colors, fontSize, spacing } from '@/lib/theme';

type RelayState =
  | 'unknown'
  | 'checking'
  | 'ok'
  | 'degraded'
  | 'unreachable'
  | 'not_configured';

interface HealthResponse {
  status?: string;
  services?: { mediamtx?: string };
}

export function ConnectionSetupGuide({ onClose }: { onClose?: () => void }) {
  const relay = mediaServerStatus();
  const [state, setState] = useState<RelayState>('unknown');
  const [latency, setLatency] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const checkRelay = useCallback(async () => {
    if (!relay.configured || !relay.url) {
      setState('not_configured');
      setMessage(
        'No relay configured. Set EXPO_PUBLIC_MEDIA_SERVER_URL and rebuild the app.',
      );
      return;
    }

    setState('checking');
    setMessage(null);
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${relay.url!.replace(/\/$/, '')}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      setLatency(Date.now() - started);

      if (res.status === 503) {
        setState('degraded');
        setMessage(
          'Relay is up, but MediaMTX is not connected. Start MediaMTX.',
        );
        return;
      }
      if (!res.ok) {
        setState('unreachable');
        setMessage(`Relay responded with HTTP ${res.status}.`);
        return;
      }

      const body = (await res.json()) as HealthResponse;
      if (body.services?.mediamtx === 'connected') {
        setState('ok');
        setMessage('Relay and MediaMTX are both running.');
      } else {
        setState('degraded');
        setMessage(
          'Relay is up, but MediaMTX is not connected. Start MediaMTX.',
        );
      }
    } catch (_error) {
      setState('unreachable');
      setMessage(
        'Could not reach the relay. Check the computer is on the same Wi‑Fi as the ' +
          'phone, that the relay is running, and that the IP in the app is correct.',
      );
    }
  }, [relay.configured, relay.url]);

  // Check once on mount so the user does not have to tap to learn anything.
  useEffect(() => {
    void checkRelay();
  }, [checkRelay]);

  const STEPS = [
    {
      icon: <Radio size={20} color={colors.brand.primary} />,
      title: 'Start MediaMTX',
      body:
        'MediaMTX converts your camera’s RTSP feed into a stream the phone can play. ' +
        'Download it from github.com/bluenviron/mediamtx and run the "mediamtx" command. ' +
        'Leave it running.',
    },
    {
      icon: <Server size={20} color={colors.brand.primary} />,
      title: 'Start the camera relay',
      body:
        'In this project run:  cd server/api  →  npm install  →  npm run dev. ' +
        'It serves the app on port 3001. Leave it running. ' +
        'Check it: curl http://localhost:3001/health',
    },
    {
      icon: <Smartphone size={20} color={colors.brand.primary} />,
      title: 'Point the app at your computer',
      body:
        'Find your computer’s LAN IP (Windows: ipconfig → "IPv4 Address", e.g. 192.168.1.23). ' +
        'Then in apps/mobile/.env set:\n' +
        'EXPO_PUBLIC_MEDIA_SERVER_URL=http://<your-ip>:3001\n' +
        'EXPO_PUBLIC_HLS_SERVER_URL=http://<your-ip>:8888\n' +
        'Use your LAN IP, not localhost — on the phone, localhost means the phone itself.',
    },
    {
      icon: <RefreshCw size={20} color={colors.brand.primary} />,
      title: 'Rebuild or reload the app',
      body:
        'The address is compiled into the app, so reload it (npx expo start, then ' +
        'reload) — or rebuild the APK after changing it. Then tap "Check again" above.',
    },
    {
      icon: <Camera size={20} color={colors.brand.primary} />,
      title: 'Add your camera',
      body:
        'Cameras → Add Camera. Enter the RTSP URL, usually:\n' +
        'rtsp://admin:admin@<camera-ip>:554/stream\n' +
        'Common defaults: username "admin", password "admin" (or the one printed on the ' +
        'camera). Tap Test Connection, then Save.',
    },
  ];

  const TIPS = [
    'The phone, the computer running the relay, and the camera must all be on the same Wi‑Fi network.',
    'Some guest/office Wi‑Fi isolates devices from each other. Use a normal home network, or a phone hotspot the computer also joins.',
    'If the camera works in VLC or ffmpeg on the computer, the problem is the address in the app, not the camera.',
    'If a stream is choppy, lower the resolution or move closer to the router.',
  ];

  const renderStatus = () => {
    if (state === 'checking') {
      return (
        <View style={[styles.statusRow, styles.statusChecking]}>
          <ActivityIndicator color={colors.text.secondary} />
          <Text style={styles.statusLabel}>Checking relay…</Text>
        </View>
      );
    }
    if (state === 'ok') {
      return (
        <View style={[styles.statusRow, styles.statusOk]}>
          <CheckCircle2 size={20} color={colors.status.success} />
          <View style={styles.statusBody}>
            <Text style={styles.statusLabel}>Relay connected</Text>
            {latency != null && (
              <Text style={styles.statusSub}>{latency} ms</Text>
            )}
          </View>
        </View>
      );
    }
    if (state === 'degraded') {
      return (
        <View style={[styles.statusRow, styles.statusWarn]}>
          <AlertCircle size={20} color={colors.status.warning} />
          <View style={styles.statusBody}>
            <Text style={styles.statusLabel}>
              Relay up, MediaMTX not connected
            </Text>
            {message && <Text style={styles.statusSub}>{message}</Text>}
          </View>
        </View>
      );
    }
    if (state === 'unreachable') {
      return (
        <View style={[styles.statusRow, styles.statusError]}>
          <XCircle size={20} color={colors.status.error} />
          <View style={styles.statusBody}>
            <Text style={styles.statusLabel}>Relay unreachable</Text>
            {message && <Text style={styles.statusSub}>{message}</Text>}
          </View>
        </View>
      );
    }
    // not_configured / unknown
    return (
      <View style={[styles.statusRow, styles.statusWarn]}>
        <AlertCircle size={20} color={colors.status.warning} />
        <View style={styles.statusBody}>
          <Text style={styles.statusLabel}>No relay configured</Text>
          <Text style={styles.statusSub}>{relay.label}</Text>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Connect a camera</Text>
          <Text style={styles.subtitle}>
            Your phone can’t open an RTSP stream directly, so a small relay on
            your computer connects to the camera for you. Follow the steps
            below.
          </Text>
        </View>
        {onClose && (
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Live status */}
      <View style={styles.statusCard}>
        {renderStatus()}
        <TouchableOpacity
          style={styles.checkButton}
          onPress={checkRelay}
          accessibilityRole="button"
          accessibilityLabel="Check relay connection"
        >
          <RefreshCw size={16} color="#FFFFFF" />
          <Text style={styles.checkButtonText}>Check again</Text>
        </TouchableOpacity>
      </View>

      {/* Steps */}
      <Text style={styles.sectionTitle}>Setup steps</Text>
      {STEPS.map((step, i) => (
        <View key={step.title} style={styles.step} accessibilityRole="summary">
          <View style={styles.stepIcon}>{step.icon}</View>
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>
              {i + 1}. {step.title}
            </Text>
            <Text style={styles.stepText}>{step.body}</Text>
          </View>
        </View>
      ))}

      {/* Tips */}
      <View style={styles.tipsCard}>
        <View style={styles.tipsHeader}>
          <Lightbulb size={18} color={colors.status.warning} />
          <Text style={styles.tipsTitle}>Before you start</Text>
        </View>
        {TIPS.map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={styles.helpLink}
        onPress={() =>
          Linking.openURL('https://github.com/kaashmalik/mtk-alertpro')
        }
        accessibilityRole="link"
      >
        <Play size={14} color={colors.brand.primary} />
        <Text style={styles.helpLinkText}>Read the full guide online</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerTextWrap: { flex: 1, paddingRight: spacing.md },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  close: {
    fontSize: fontSize.sm,
    color: colors.brand.primary,
    fontWeight: '700',
    paddingTop: 4,
  },

  statusCard: {
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusOk: {},
  statusWarn: {},
  statusError: {},
  statusChecking: {},
  statusBody: { flex: 1 },
  statusLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text.primary,
  },
  statusSub: {
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.brand.primary,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  checkButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: '700',
  },

  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  step: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBody: { flex: 1 },
  stepTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text.primary,
  },
  stepText: {
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
    lineHeight: 18,
  },

  tipsCard: {
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tipsTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text.primary,
  },
  tipRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  tipBullet: { color: colors.status.warning, fontSize: fontSize.sm },
  tipText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    lineHeight: 18,
  },

  helpLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
  },
  helpLinkText: {
    fontSize: fontSize.xs,
    color: colors.brand.primary,
    fontWeight: '600',
  },
});
