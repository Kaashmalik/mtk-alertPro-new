import { AdBanner } from '@/components/ads/BannerAd';
import { useInterstitialAd } from '@/components/ads/InterstitialAd';
import { AlertCard } from '@/components/animated';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonAlertCard } from '@/components/ui/SkeletonLoader';
import { useAlertStore, useCameraStore } from '@/stores';
import { designSystem } from '@/theme/design-system';
import type { Alert } from '@/types';
import { Bell, Check } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import {
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AlertsScreen() {
  const {
    alerts,
    fetchAlerts,
    markAsRead,
    markAllAsRead,
    deleteAlert,
    isLoading,
    error: alertError,
  } = useAlertStore();
  const { cameras } = useCameraStore();
  const { show: showInterstitial } = useInterstitialAd();
  // Counts actual dismissals. The previous trigger read `unreadCount` from a
  // stale render closure, and `0 % 3 === 0` meant emptying the list fired an
  // interstitial every single time.
  const dismissCountRef = useRef(0);

  useEffect(() => {
    void fetchAlerts();
    // No realtime subscribe here on purpose. The root layout owns one
    // 'alerts-realtime' channel for the whole authenticated session; opening
    // this tab used to open a second channel on the same topic, and Supabase
    // rejects a duplicate postgres_changes registration.
  }, [fetchAlerts]);

  const getCameraName = (cameraId: string | null, type?: Alert['type']) => {
    // SOS alerts are raised by the user, so there is no camera to name.
    if (!cameraId) return type === 'emergency' ? 'Emergency SOS' : 'No camera';
    return cameras.find((c) => c.id === cameraId)?.name || 'Unknown Camera';
  };

  const renderAlert = ({ item, index }: { item: Alert; index: number }) => (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(400)}>
      <AlertCard
        id={item.id}
        type={item.type}
        confidence={item.confidence}
        timestamp={new Date(item.createdAt)}
        cameraName={getCameraName(item.cameraId, item.type)}
        personName={
          typeof item.metadata?.personName === 'string'
            ? item.metadata.personName
            : undefined
        }
        thumbnailUrl={item.thumbnailUrl} // Ensure Alert type supports this, or pass undefined
        isRead={item.isRead}
        onPress={() => {
          // markAsRead/deleteAlert rethrow on a Supabase failure. Unhandled
          // here they became unhandled rejections on every tap while offline,
          // and the tap silently did nothing.
          void markAsRead(item.id).catch(() => {
            console.warn('[Alerts] markAsRead failed for', item.id);
          });
        }}
        onDismiss={async () => {
          try {
            await deleteAlert(item.id);
          } catch {
            console.warn('[Alerts] deleteAlert failed for', item.id);
            return;
          }
          dismissCountRef.current += 1;
          // Trigger interstitial every 3 dismissals
          if (dismissCountRef.current % 3 === 0) {
            try {
              await showInterstitial();
            } catch {
              console.warn('[Alerts] interstitial failed to show');
            }
          }
        }}
      />
    </Animated.View>
  );

  const unreadCount = alerts.filter((a) => !a.isRead).length;

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={designSystem.colors.background.primary}
      />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header */}
        <Animated.View
          entering={FadeInDown.duration(600)}
          style={styles.header}
        >
          <View>
            <Text style={styles.headerTitle}>Alerts</Text>
            {unreadCount > 0 && (
              <Text style={styles.unreadCount}>{unreadCount} unread</Text>
            )}
          </View>
          {unreadCount > 0 && (
            <TouchableOpacity
              onPress={() => {
                // markAllAsRead rethrows on a Supabase failure. Passing it
                // straight to onPress returned a rejected promise that nothing
                // awaited, so an offline tap produced an unhandled rejection.
                void markAllAsRead().catch(() => {
                  console.warn('[Alerts] markAllAsRead failed');
                });
              }}
              style={styles.markAllButton}
            >
              <Check size={18} color={designSystem.colors.status.success} />
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* A failed load must read as an error, not as "no alerts yet". */}
        {alertError && alerts.length === 0 ? (
          <ErrorState
            kind="generic"
            title="Couldn't load your alerts"
            message={alertError}
            onRetry={fetchAlerts}
          />
        ) : alerts.length === 0 && isLoading ? (
          <SkeletonAlertCard />
        ) : alerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Animated.View
              entering={FadeInDown.delay(200)}
              style={styles.emptyIcon}
            >
              <Bell size={40} color={designSystem.colors.text.muted} />
            </Animated.View>
            <Text style={styles.emptyTitle}>No Alerts</Text>
            <Text style={styles.emptySubtitle}>
              You'll see detection alerts here when your cameras spot something
            </Text>
          </View>
        ) : (
          <FlatList
            data={alerts}
            renderItem={renderAlert}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={fetchAlerts}
                tintColor={designSystem.colors.primary[500]}
                colors={[designSystem.colors.primary[500]]}
              />
            }
          />
        )}
        <AdBanner />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designSystem.spacing.xxl,
    paddingTop: designSystem.spacing.lg,
    paddingBottom: designSystem.spacing.lg,
  },
  headerTitle: {
    fontSize: designSystem.typography.size.xxl,
    fontWeight: '700',
    color: designSystem.colors.text.primary,
  },
  unreadCount: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    marginTop: 2,
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: designSystem.spacing.md,
    paddingVertical: designSystem.spacing.xs,
    borderRadius: designSystem.layout.radius.full,
  },
  markAllText: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.status.success,
    marginLeft: designSystem.spacing.xs,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: designSystem.spacing.xxl,
    paddingBottom: designSystem.spacing.xxl,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designSystem.spacing.xxl,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: designSystem.spacing.lg,
  },
  emptyTitle: {
    fontSize: designSystem.typography.size.xl,
    fontWeight: '600',
    color: designSystem.colors.text.primary,
    marginBottom: designSystem.spacing.sm,
  },
  emptySubtitle: {
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.text.secondary,
    textAlign: 'center',
  },
});
