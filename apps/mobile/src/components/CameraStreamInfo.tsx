import { View, Text, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { AlertCircle, ExternalLink, Server } from 'lucide-react-native';
import { colors, spacing, fontSize, borderRadius } from '@/lib/theme';
import { getMediaServerEnvHint } from '@/lib/streaming/mediaServerHealth';

/**
 * Honest media-edge setup card (no fake stream claims)
 */
export function CameraStreamInfo() {
  const openGuide = () => {
    Linking.openURL(
      'https://github.com/Kaashmalik/mtk-alert-pro/blob/main/server/README.md'
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Server size={20} color={colors.status.warning} />
        <Text style={styles.title}>Media Edge Required for RTSP</Text>
      </View>

      <Text style={styles.description}>
        Live RTSP, AI snapshots, and cloud clips need the MediaMTX + API edge.
        HTTP/MJPEG cameras can preview without it.
      </Text>

      <Text style={styles.envHint}>{getMediaServerEnvHint()}</Text>

      <View style={styles.bulletList}>
        <Text style={styles.bullet}>• Start: server MediaMTX + `pnpm --filter @mtk/api dev`</Text>
        <Text style={styles.bullet}>• Set EXPO_PUBLIC_MEDIA_SERVER_URL to your LAN IP:3001</Text>
        <Text style={styles.bullet}>• Prefer WebRTC when available; app plays HLS via expo-av</Text>
      </View>

      <TouchableOpacity style={styles.guideButton} onPress={openGuide}>
        <Text style={styles.guideText}>Open server setup guide</Text>
        <ExternalLink size={16} color={colors.brand.accent} />
      </TouchableOpacity>

      <View style={styles.noteRow}>
        <AlertCircle size={14} color={colors.text.muted} />
        <Text style={styles.note}>
          The app never shows a sample video. You will see a clear offline or server-unavailable state instead.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    margin: spacing.lg,
    borderWidth: 1,
    borderColor: colors.status.warning + '40',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.status.warning,
    marginLeft: spacing.sm,
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  envHint: {
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginBottom: spacing.md,
    fontFamily: 'monospace',
  },
  bulletList: {
    marginBottom: spacing.md,
  },
  bullet: {
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  guideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  guideText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.brand.accent,
    marginRight: spacing.xs,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  note: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    lineHeight: 16,
  },
});
