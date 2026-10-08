/**
 * Offline Banner Component
 * Displays when the app is offline
 *
 * @module components/OfflineBanner
 */

import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors, spacing } from '@/lib/theme';
import { WifiOff } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();

  if (isConnected) return null;

  return (
    <View style={styles.container}>
      <WifiOff size={16} color={colors.text.primary} />
      <Text style={styles.text}>
        You're offline. Some features may be limited.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.status.warning,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  text: {
    color: colors.text.primary,
    fontSize: 12,
    fontWeight: '500',
  },
});
