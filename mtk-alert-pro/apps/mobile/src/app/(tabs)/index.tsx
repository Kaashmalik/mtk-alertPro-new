/**
 * Home Screen / Dashboard
 * 
 * Main surveillance control center with master defense switch,
 * live camera grid, recent alerts, and storage playback.
 */

import { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import {
  Shield,
  Camera,
  Bell,
  Activity,
  Plus,
  Settings,
  Crown,
  WifiOff,
  Users,
  Car,
  Zap,
  HardDrive,
  CheckCircle2,
  Play,
  Radio,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  useAuthStore,
  useCameraStore,
  useAlertStore,
  useSettingsStore,
  useIsPremium,
} from '@/stores';
import { useDetectionCoordinator } from '@/hooks/useDetectionCoordinator';
import { designSystem } from '@/theme/design-system';
import { AlertCard } from '@/components/animated';
import { RecordingsModal } from '@/components/camera/RecordingsModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function HomeScreen() {
  const user = useAuthStore((state) => state.user);
  const cameras = useCameraStore((state) => state.cameras);
  const fetchCameras = useCameraStore((state) => state.fetchCameras);
  const camerasLoading = useCameraStore((state) => state.isLoading);
  const alerts = useAlertStore((state) => state.alerts);
  const unreadCount = useAlertStore((state) => state.unreadCount);
  const fetchAlerts = useAlertStore((state) => state.fetchAlerts);
  const detection = useSettingsStore((state) => state.detection);
  const isPremium = useIsPremium();

  const { isMonitoring, toggleMasterDetection, activeMonitoringCount } =
    useDetectionCoordinator();

  const [showRecordingsModal, setShowRecordingsModal] = useState(false);

  // Animation values
  const toggleScale = useSharedValue(1);

  useEffect(() => {
    fetchCameras();
    fetchAlerts();
  }, []);

  const onRefresh = useCallback(() => {
    fetchCameras();
    fetchAlerts();
  }, [fetchCameras, fetchAlerts]);

  // Computed values
  const activeCameras = cameras.filter((c) => c.isActive).length;
  const offlineCameras = cameras.length - activeCameras;
  const recentAlerts = alerts.slice(0, 3);
  const personAlerts = alerts.filter((a) => a.type === 'person').length;
  const vehicleAlerts = alerts.filter((a) => a.type === 'vehicle').length;

  const handleToggleRedAlert = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {}

    toggleScale.value = withSpring(0.9, {}, () => {
      toggleScale.value = withSpring(1);
    });

    toggleMasterDetection();
  };

  const animatedToggleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: toggleScale.value }],
  }));

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={designSystem.colors.background.primary} />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={camerasLoading}
            onRefresh={onRefresh}
            tintColor={designSystem.colors.primary[500]}
            colors={[designSystem.colors.primary[500]]}
          />
        }
      >
        <SafeAreaView edges={['top']}>
          {/* Header */}
          <Animated.View entering={FadeInDown.duration(600)} style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.greeting}>{getGreeting()}</Text>
              <View style={styles.nameRow}>
                <Text style={styles.userName}>{user?.displayName || 'Home Security'}</Text>
                {isPremium && (
                  <View style={styles.premiumBadge}>
                    <Crown size={12} color={designSystem.colors.status.warning} />
                    <Text style={styles.premiumText}>PRO</Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => router.push('/(tabs)/settings')}
            >
              <Settings size={22} color={designSystem.colors.text.secondary} />
            </TouchableOpacity>
          </Animated.View>

          {/* Master Defense / Red Alert Toggle */}
          <Animated.View entering={FadeInDown.delay(100).duration(600)} style={styles.redAlertContainer}>
            <TouchableOpacity
              onPress={handleToggleRedAlert}
              style={[
                styles.redAlertCard,
                detection.redAlertMode && styles.redAlertCardGlow,
              ]}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={
                  detection.redAlertMode
                    ? ['#DC2626', '#991B1B']
                    : ['#1E293B', '#0F172A']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.redAlertGradient}
              >
                <View style={styles.redAlertContent}>
                  <View
                    style={[
                      styles.redAlertIcon,
                      detection.redAlertMode && styles.redAlertIconActive,
                    ]}
                  >
                    <Zap
                      size={28}
                      color={detection.redAlertMode ? 'white' : '#EF4444'}
                      fill={detection.redAlertMode ? 'white' : 'transparent'}
                    />
                  </View>
                  <View style={styles.redAlertText}>
                    <View style={styles.statusBadgeRow}>
                      <Text style={styles.redAlertTitle}>
                        {detection.redAlertMode ? 'SYSTEM ARMED' : 'STANDBY MODE'}
                      </Text>
                      <View
                        style={[
                          styles.liveDotBadge,
                          detection.redAlertMode && styles.liveDotBadgeActive,
                        ]}
                      >
                        <View
                          style={[
                            styles.liveDot,
                            detection.redAlertMode && styles.liveDotActive,
                          ]}
                        />
                        <Text style={styles.liveDotText}>
                          {detection.redAlertMode ? 'ACTIVE INFERENCE' : 'OFF'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.redAlertSubtitle}>
                      {detection.redAlertMode
                        ? `On-device AI actively monitoring ${activeMonitoringCount || activeCameras} cameras`
                        : 'Tap to arm all cameras with real-time AI detection'}
                    </Text>
                  </View>
                </View>

                {/* Animated Switch Pill */}
                <View
                  style={[
                    styles.toggle,
                    detection.redAlertMode && styles.toggleActive,
                  ]}
                >
                  <Animated.View
                    style={[
                      styles.toggleThumb,
                      detection.redAlertMode && styles.toggleThumbActive,
                      animatedToggleStyle,
                    ]}
                  />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* Quick Metrics Grid */}
          <Animated.View entering={FadeInDown.delay(200).duration(600)} style={styles.statsGrid}>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/cameras')}
              activeOpacity={0.8}
            >
              <View style={[styles.statIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Camera size={20} color={designSystem.colors.status.info} />
              </View>
              <Text style={styles.statValue}>{activeCameras}</Text>
              <Text style={styles.statLabel}>Active Cameras</Text>
              {offlineCameras > 0 && (
                <View style={styles.offlineBadge}>
                  <WifiOff size={10} color={designSystem.colors.status.danger} />
                  <Text style={styles.offlineText}>{offlineCameras} offline</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/alerts')}
              activeOpacity={0.8}
            >
              <View style={[styles.statIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Bell size={20} color={designSystem.colors.status.danger} />
              </View>
              <Text style={styles.statValue}>{unreadCount}</Text>
              <Text style={styles.statLabel}>Unread Alerts</Text>
            </TouchableOpacity>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                <Users size={20} color={designSystem.colors.status.warning} />
              </View>
              <Text style={styles.statValue}>{personAlerts}</Text>
              <Text style={styles.statLabel}>Humans Detected</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(6, 182, 212, 0.15)' }]}>
                <Car size={20} color="#06B6D4" />
              </View>
              <Text style={styles.statValue}>{vehicleAlerts}</Text>
              <Text style={styles.statLabel}>Vehicles Detected</Text>
            </View>
          </Animated.View>

          {/* Quick Actions Bar */}
          <Animated.View entering={FadeInDown.delay(300).duration(600)} style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Surveillance Actions</Text>
            <View style={styles.quickActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => router.push('/cameras/add')}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={[designSystem.colors.primary[500], designSystem.colors.primary[600]]}
                  style={styles.actionGradient}
                >
                  <Plus size={20} color="white" />
                </LinearGradient>
                <Text style={styles.actionLabel}>Add Camera</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => router.push('/(tabs)/cameras')}
                activeOpacity={0.8}
              >
                <View style={[styles.actionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                  <Camera size={20} color={designSystem.colors.status.info} />
                </View>
                <Text style={styles.actionLabel}>Live Feeds</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => setShowRecordingsModal(true)}
                activeOpacity={0.8}
              >
                <View style={[styles.actionIcon, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                  <HardDrive size={20} color="#38BDF8" />
                </View>
                <Text style={styles.actionLabel}>Clips & Storage</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => router.push('/subscription')}
                activeOpacity={0.8}
              >
                <View style={[styles.actionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                  <Crown size={20} color={designSystem.colors.status.warning} />
                </View>
                <Text style={styles.actionLabel}>{isPremium ? 'PRO Active' : 'Upgrade'}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Active Cameras Live Preview Snippet */}
          {cameras.length > 0 && (
            <Animated.View entering={FadeInDown.delay(400).duration(600)} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Connected Cameras</Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/cameras')}>
                  <Text style={styles.viewAll}>View All ({cameras.length})</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cameraRowContent}
              >
                {cameras.map((cam) => (
                  <TouchableOpacity
                    key={cam.id}
                    style={styles.cameraThumbCard}
                    onPress={() => router.push(`/cameras/${cam.id}`)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.cameraThumbPlaceholder}>
                      <Camera size={28} color="#64748B" />
                      <View style={styles.playOverlayBadge}>
                        <Play size={14} color="white" fill="white" />
                      </View>
                      <View
                        style={[
                          styles.camStatusDot,
                          { backgroundColor: cam.isActive ? '#10B981' : '#EF4444' },
                        ]}
                      />
                    </View>
                    <View style={styles.cameraThumbInfo}>
                      <Text style={styles.cameraThumbName} numberOfLines={1}>
                        {cam.name}
                      </Text>
                      <Text style={styles.cameraThumbStatus}>
                        {cam.isActive ? 'Live Stream' : 'Offline'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Animated.View>
          )}

          {/* Recent Alerts */}
          <Animated.View entering={FadeInDown.delay(500).duration(600)} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Security Alerts</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/alerts')}>
                <Text style={styles.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>

            {recentAlerts.length === 0 ? (
              <View style={styles.emptyAlerts}>
                <View style={styles.emptyIconContainer}>
                  <Shield size={32} color={designSystem.colors.text.muted} />
                </View>
                <Text style={styles.emptyTitle}>Surveillance Perimeter Clear</Text>
                <Text style={styles.emptyText}>
                  No threats detected. All cameras are monitoring on-device.
                </Text>
              </View>
            ) : (
              recentAlerts.map((alert, index) => (
                <View
                  key={alert.id}
                  style={index !== recentAlerts.length - 1 ? { marginBottom: designSystem.spacing.sm } : {}}
                >
                  <AlertCard
                    id={alert.id}
                    type={alert.type as any}
                    confidence={0.95}
                    timestamp={new Date(alert.createdAt)}
                    thumbnailUrl={undefined}
                    cameraName={`Camera ${alert.cameraId.slice(0, 4)}`}
                    onPress={() => router.push('/(tabs)/alerts')}
                  />
                </View>
              ))
            )}
          </Animated.View>

          {/* Upgrade Banner for Free Users */}
          {!isPremium && (
            <Animated.View entering={FadeInUp.delay(600).duration(600)}>
              <TouchableOpacity
                style={styles.upgradeBanner}
                onPress={() => router.push('/subscription')}
                activeOpacity={0.9}
              >
                <LinearGradient
                  colors={['rgba(239, 68, 68, 0.2)', 'rgba(245, 158, 11, 0.15)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.upgradeGradient}
                >
                  <View style={styles.upgradeContent}>
                    <Crown size={24} color={designSystem.colors.status.warning} />
                    <View style={styles.upgradeText}>
                      <Text style={styles.upgradeTitle}>Upgrade to MTK AlertPro</Text>
                      <Text style={styles.upgradeSubtitle}>
                        Unlock Unlimited Cameras, Face Recognition, & Cloud Backup
                      </Text>
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          )}

          <View style={{ height: 40 }} />
        </SafeAreaView>
      </ScrollView>

      {/* Recordings & Storage Modal */}
      <RecordingsModal
        visible={showRecordingsModal}
        onClose={() => setShowRecordingsModal(false)}
        cameraName="All Cameras"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  premiumText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F59E0B',
    marginLeft: 4,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  redAlertContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  redAlertCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  redAlertCardGlow: {
    borderColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  redAlertGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
  },
  redAlertContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  redAlertIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  redAlertIconActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  redAlertText: {
    flex: 1,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  redAlertTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.5,
  },
  liveDotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveDotBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#64748B',
    marginRight: 4,
  },
  liveDotActive: {
    backgroundColor: '#4ADE80',
  },
  liveDotText: {
    color: 'white',
    fontSize: 9,
    fontWeight: '700',
  },
  redAlertSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 16,
  },
  toggle: {
    width: 52,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#334155',
    padding: 3,
    justifyContent: 'center',
  },
  toggleActive: {
    backgroundColor: '#22C55E',
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'white',
  },
  toggleThumbActive: {
    alignSelf: 'flex-end',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 20,
  },
  statCard: {
    width: (SCREEN_WIDTH - 40) / 2,
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  statLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  offlineText: {
    fontSize: 10,
    color: '#EF4444',
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 12,
  },
  viewAll: {
    fontSize: 13,
    color: '#38BDF8',
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    alignItems: 'center',
    width: (SCREEN_WIDTH - 56) / 4,
  },
  actionGradient: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
    textAlign: 'center',
  },
  cameraRowContent: {
    gap: 12,
    paddingRight: 16,
  },
  cameraThumbCard: {
    width: 140,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  cameraThumbPlaceholder: {
    height: 85,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  playOverlayBadge: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camStatusDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cameraThumbInfo: {
    padding: 8,
  },
  cameraThumbName: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  cameraThumbStatus: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  emptyAlerts: {
    backgroundColor: '#1E293B',
    padding: 24,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(51, 65, 85, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
  },
  upgradeBanner: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  upgradeGradient: {
    padding: 16,
  },
  upgradeContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  upgradeText: {
    marginLeft: 12,
    flex: 1,
  },
  upgradeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  upgradeSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
});
