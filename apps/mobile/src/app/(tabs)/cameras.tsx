/**
 * Cameras Screen
 *
 * List of all connected cameras with status and quick actions
 */

import { AdBanner } from '@/components/ads/BannerAd';
import { CameraCard } from '@/components/animated';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonCameraCard } from '@/components/ui/SkeletonLoader';
import { UsageLimitWarning } from '@/components/ui/UpgradePrompt';
import {
  useAlertStore,
  useCameraStore,
  useIsPremium,
  usePlanLimits,
  useSubscriptionStore,
} from '@/stores';
import { designSystem } from '@/theme/design-system';
import type { Camera as CameraType } from '@/types';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { AlertCircle, Camera, ChevronRight, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
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

// ============================================================================
// Component
// ============================================================================

import { RecordingsModal } from '@/components/camera/RecordingsModal';
import { HardDrive } from 'lucide-react-native';

export default function CamerasScreen() {
  const {
    cameras,
    fetchCameras,
    hydrateFromCache,
    isLoading,
    isHydrated,
    isOffline,
    offlineQueueError,
    cameraHealth,
    error: cameraError,
  } = useCameraStore();
  const { canAddCamera, getRemainingCameras } = useSubscriptionStore();
  const planLimits = usePlanLimits();
  const isPremium = useIsPremium();
  const alerts = useAlertStore((s) => s.alerts);
  const [showRecordingsModal, setShowRecordingsModal] = useState(false);

  useEffect(() => {
    // Stale-while-revalidate: paint cache first, then hit the network
    let cancelled = false;
    (async () => {
      await hydrateFromCache();
      if (!cancelled) {
        await fetchCameras();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromCache, fetchCameras]);

  const handleAddCamera = () => {
    if (!canAddCamera()) {
      router.push('/subscription');
      return;
    }
    router.push('/cameras/add');
  };

  const onRefresh = useCallback(() => {
    fetchCameras();
  }, [fetchCameras]);

  const renderCamera = ({
    item,
    index,
  }: { item: CameraType; index: number }) => {
    // Live heartbeat status first; fall back to last-known isActive flag
    const status =
      cameraHealth[item.id]?.status ?? (item.isActive ? 'online' : 'offline');
    const hasAlert = alerts.some((a) => a.cameraId === item.id && !a.isRead);
    return (
      <Animated.View entering={FadeInDown.delay(index * 100).duration(500)}>
        <CameraCard
          id={item.id}
          name={item.name}
          thumbnailUrl={item.thumbnailUrl}
          status={status}
          isOnline={item.isActive}
          hasAlert={hasAlert}
          onPress={(id) => router.push(`/cameras/${id}`)}
        />
      </Animated.View>
    );
  };

  const remainingCameras = getRemainingCameras();

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={designSystem.colors.background.primary}
      />

      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* Header */}
        <Animated.View
          entering={FadeInDown.duration(600)}
          style={styles.header}
        >
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Cameras</Text>
            <Text style={styles.headerSubtitle}>
              {cameras.length} camera{cameras.length !== 1 ? 's' : ''} connected
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              onPress={() => setShowRecordingsModal(true)}
              style={styles.storageButton}
              activeOpacity={0.8}
            >
              <HardDrive size={20} color="#38BDF8" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleAddCamera}
              style={styles.addButton}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[
                  designSystem.colors.primary[500],
                  designSystem.colors.primary[600],
                ]}
                style={styles.addButtonGradient}
              >
                <Plus size={22} color="white" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <RecordingsModal
          visible={showRecordingsModal}
          onClose={() => setShowRecordingsModal(false)}
          cameraName="All Cameras"
        />

        {/* Camera usage against the real plan limit. Uses the shared
            UsageLimitWarning so the meter matches the enforced quota instead
            of a bespoke banner. */}
        {!isPremium && remainingCameras !== Number.POSITIVE_INFINITY && (
          <Animated.View entering={FadeInDown.delay(200)}>
            <UsageLimitWarning
              current={cameras.length}
              max={planLimits.maxCameras}
              label="Cameras"
              onUpgrade={() => router.push('/subscription')}
            />
          </Animated.View>
        )}

        {/* Cold-start: nothing cached and still fetching — show spinner, not empty state */}
        {/* A failed load must not be indistinguishable from "no cameras yet".
            The error branch comes first so a user with a real account and a
            dead connection gets a retry instead of being told to add a camera. */}
        {cameraError && cameras.length === 0 ? (
          <ErrorState
            kind={isOffline ? 'network' : 'generic'}
            title={isOffline ? 'No connection' : "Couldn't load your cameras"}
            message={
              isOffline
                ? "You're offline. Your cameras are safe — reconnect to sync them."
                : cameraError
            }
            onRetry={fetchCameras}
          />
        ) : !isHydrated || (isLoading && cameras.length === 0 && isHydrated) ? (
          <View style={styles.loadingState}>
            <SkeletonCameraCard />
            <SkeletonCameraCard style={{ marginTop: 12 }} />
            <SkeletonCameraCard style={{ marginTop: 12 }} />
          </View>
        ) : cameras.length === 0 ? (
          <View style={styles.emptyState}>
            <Animated.View
              entering={FadeInDown.delay(300)}
              style={styles.emptyIcon}
            >
              <Camera size={48} color={designSystem.colors.text.muted} />
            </Animated.View>
            <Text style={styles.emptyTitle}>No Cameras Yet</Text>
            <Text style={styles.emptySubtitle}>
              Add your first camera to start monitoring your property
            </Text>

            <TouchableOpacity
              style={styles.emptyButton}
              onPress={handleAddCamera}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[
                  designSystem.colors.primary[500],
                  designSystem.colors.primary[600],
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.emptyButtonGradient}
              >
                <Plus size={20} color="white" />
                <Text style={styles.emptyButtonText}>Add Camera</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.helpLink}
              onPress={() => router.push('/help')}
            >
              <Text style={styles.helpText}>Need help setting up?</Text>
              <ChevronRight
                size={16}
                color={designSystem.colors.primary[500]}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {isOffline && (
              <View style={styles.offlineBanner}>
                <AlertCircle
                  size={14}
                  color={designSystem.colors.status.warning}
                />
                <Text style={styles.offlineText}>
                  Offline — showing saved cameras
                </Text>
              </View>
            )}
            {/* A queued change failed repeatedly — surface it instead of hiding it */}
            {offlineQueueError && (
              <View style={styles.syncErrorBanner}>
                <AlertCircle
                  size={14}
                  color={designSystem.colors.status.danger}
                />
                <Text style={styles.syncErrorText}>
                  Sync issue: {offlineQueueError}
                </Text>
              </View>
            )}
            <FlatList
              data={cameras}
              renderItem={renderCamera}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isLoading}
                  onRefresh={onRefresh}
                  tintColor={designSystem.colors.primary[500]}
                  colors={[designSystem.colors.primary[500]]}
                />
              }
            />
          </>
        )}
        <AdBanner />
      </SafeAreaView>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

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
    paddingHorizontal: designSystem.spacing.xl,
    paddingTop: designSystem.spacing.md,
    paddingBottom: designSystem.spacing.lg,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: designSystem.typography.size.xxl,
    fontWeight: '700',
    color: designSystem.colors.text.primary,
  },
  headerSubtitle: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.text.secondary,
    marginTop: designSystem.spacing.xs,
  },
  storageButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  addButton: {
    borderRadius: 22,
    overflow: 'hidden',
    ...designSystem.shadows.md,
  },
  addButtonGradient: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: designSystem.spacing.xl,
    paddingBottom: designSystem.spacing.xxxl,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: designSystem.spacing.md,
  },
  loadingText: {
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.text.secondary,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: designSystem.spacing.md,
    paddingVertical: designSystem.spacing.xs,
    borderRadius: designSystem.layout.radius.full,
    marginBottom: designSystem.spacing.md,
    gap: designSystem.spacing.xs,
  },
  offlineText: {
    fontSize: designSystem.typography.size.xs,
    color: designSystem.colors.status.warning,
    fontWeight: '500',
  },
  syncErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: designSystem.spacing.md,
    paddingVertical: designSystem.spacing.xs,
    borderRadius: designSystem.layout.radius.full,
    marginBottom: designSystem.spacing.md,
    gap: designSystem.spacing.xs,
  },
  syncErrorText: {
    fontSize: designSystem.typography.size.xs,
    color: designSystem.colors.status.danger,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designSystem.spacing.xxl,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: designSystem.spacing.xl,
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
    marginBottom: designSystem.spacing.xxl,
    lineHeight: 24,
  },
  emptyButton: {
    borderRadius: designSystem.layout.radius.xl,
    overflow: 'hidden',
    ...designSystem.shadows.md,
  },
  emptyButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSystem.spacing.xxl,
    paddingVertical: designSystem.spacing.lg,
    gap: designSystem.spacing.sm,
  },
  emptyButtonText: {
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
    color: 'white',
  },
  helpLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: designSystem.spacing.xl,
    gap: designSystem.spacing.xs,
  },
  helpText: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.primary[500],
    fontWeight: '500',
  },
});
