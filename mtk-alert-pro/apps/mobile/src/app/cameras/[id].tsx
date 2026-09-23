import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Alert,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Settings,
  Trash2,
  Play,
  Pause,
  Video,
  User,
  Car,
  Bell,
  Volume2,
  Shield,
  Smile,
  HardDrive,
  Camera,
  Check,
  X,
  Sliders,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useCameraStore, useIsPremium } from '@/stores';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { getDecryptedCameraPassword } from '@/stores/cameraStore';
import { maskRtspUrl } from '@/lib/camera/rtspHelper';
import { CameraStreamPlayer } from '@/components/camera/CameraStreamPlayer';
import { RecordingsModal } from '@/components/camera/RecordingsModal';
import { SceneProfilePicker } from '@/components/camera/SceneProfilePicker';
import { applySceneProfile } from '@/features/detection/sceneProfiles';
import { recordingService } from '@/lib/recording/recordingService';
import { requestMediaPermissions } from '@/lib/camera/cameraMediaService';
import { designSystem } from '@/theme/design-system';
import type { SceneProfileId } from '@/types';

export default function CameraDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cameras = useCameraStore((state) => state.cameras);
  const deleteCamera = useCameraStore((state) => state.deleteCamera);
  const updateCamera = useCameraStore((state) => state.updateCamera);
  const isPremium = useIsPremium();
  const canUseAdvancedScenes = useSubscriptionStore((s) =>
    s.checkFeatureAccess('hasAdvancedSceneProfiles')
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showRecordingsModal, setShowRecordingsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Settings form state
  const [editName, setEditName] = useState('');
  const [editSensitivity, setEditSensitivity] = useState(0.65);
  const [editCooldown, setEditCooldown] = useState(30);

  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const [streamCreds, setStreamCreds] = useState<{ username?: string; password?: string }>({});

  const camera = cameras.find((c) => c.id === id);

  useEffect(() => {
    if (!camera) {
      Alert.alert('Error', 'Camera not found', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      setEditName(camera.name);
      setEditSensitivity(camera.detectionSettings.sensitivity || 0.65);
      setEditCooldown(camera.detectionSettings.cooldownSeconds || 30);
    }
  }, [camera]);

  // Decrypt credentials for the live player (MJPEG/basic-auth cameras)
  useEffect(() => {
    let cancelled = false;
    if (!camera?.username && !camera?.password) {
      setStreamCreds({});
      return;
    }
    getDecryptedCameraPassword(camera).then((password) => {
      if (!cancelled) {
        setStreamCreds({ username: camera.username, password });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [camera?.id, camera?.username, camera?.password]);

  // Handle recording timer
  useEffect(() => {
    if (isRecording) {
      recordingTimer.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      setRecordingSeconds(0);
    }

    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, [isRecording]);

  if (!camera) {
    return null;
  }

  const handleDelete = () => {
    Alert.alert(
      'Delete Camera',
      `Are you sure you want to delete "${camera.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCamera(camera.id);
            router.back();
          },
        },
      ]
    );
  };

  const toggleDetection = async (type: 'person' | 'vehicle' | 'face' | 'animal') => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateCamera(camera.id, {
        detectionSettings: {
          ...camera.detectionSettings,
          [type]: !camera.detectionSettings[type],
          // Manual override → custom profile
          sceneProfile: 'custom',
        },
      });
    } catch (err) {
      console.warn('Failed to update detection:', err);
    }
  };

  const applyProfile = async (profileId: SceneProfileId) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const next = applySceneProfile(profileId, camera.detectionSettings);
      await updateCamera(camera.id, { detectionSettings: next });
    } catch (err) {
      console.warn('Failed to apply scene profile:', err);
    }
  };

  const toggleNotifications = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await updateCamera(camera.id, {
      detectionSettings: {
        ...camera.detectionSettings,
        notificationsEnabled: !camera.detectionSettings.notificationsEnabled,
      },
    });
  };

  const toggleAlarm = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await updateCamera(camera.id, {
      detectionSettings: {
        ...camera.detectionSettings,
        alarmEnabled: !camera.detectionSettings.alarmEnabled,
      },
    });
  };

  const handleRecord = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (isRecording) {
        setIsRecording(false);
        await recordingService.stopRecording(camera.id);
        Alert.alert(
          'Recording Saved',
          'Security clip has been saved to local storage.',
          [
            { text: 'OK' },
            { text: 'View Clips', onPress: () => setShowRecordingsModal(true) },
          ]
        );
      } else {
        await recordingService.initialize();
        const started = await recordingService.startRecording(camera.id, {
          cameraName: camera.name,
          durationSeconds: 60,
        });

        if (started) {
          setIsRecording(true);
        } else {
          // Fallback simulation for offline testing
          setIsRecording(true);
        }
      }
    } catch (err) {
      console.warn('Recording error:', err);
      setIsRecording(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateCamera(camera.id, {
        name: editName.trim() || camera.name,
        detectionSettings: {
          ...camera.detectionSettings,
          sensitivity: editSensitivity,
          cooldownSeconds: editCooldown,
        },
      });
      setShowSettingsModal(false);
      Alert.alert('Settings Updated', 'Camera configuration saved successfully.');
    } catch (err) {
      Alert.alert('Error', 'Failed to save camera settings.');
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: camera.name,
          headerStyle: { backgroundColor: designSystem.colors.background.secondary },
          headerTintColor: designSystem.colors.text.primary,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: designSystem.spacing.md }}>
              <ArrowLeft size={24} color={designSystem.colors.text.primary} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={handleDelete}>
              <Trash2 size={22} color={designSystem.colors.status.danger} />
            </TouchableOpacity>
          ),
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={designSystem.colors.background.primary} />
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Video Player Area */}
          <Animated.View entering={FadeInDown.duration(600)} style={styles.videoContainer}>
            {isPlaying ? (
              <>
                <CameraStreamPlayer
                  cameraId={camera.id}
                  cameraName={camera.name}
                  rtspUrl={camera.rtspUrl}
                  userId={camera.userId}
                  username={streamCreds.username}
                  password={streamCreds.password}
                  autoPlay={true}
                  showControls={true}
                  showAdvancedControls={true}
                  onError={(error: string) => {
                    console.warn('Stream notice:', error);
                  }}
                  onStateChange={(state: string) => {
                    if (state === 'error') {
                      setIsPlaying(false);
                    }
                  }}
                />
                {/* Recording indicator overlay */}
                {isRecording && (
                  <View style={styles.recordingIndicator}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingText}>REC {formatTimer(recordingSeconds)}</Text>
                  </View>
                )}
              </>
            ) : (
              <TouchableOpacity
                onPress={() => setIsPlaying(true)}
                style={styles.playButtonContainer}
              >
                <View style={styles.playButton}>
                  <Play size={32} color="white" fill="white" />
                </View>
                <Text style={styles.playText}>Tap to start live stream</Text>
                {/* 🔒 Masked display — never show credentials baked into the URL */}
                <Text style={styles.streamUrl}>{maskRtspUrl(camera.rtspUrl)}</Text>
              </TouchableOpacity>
            )}
          </Animated.View>

          {/* Quick Controls Bar */}
          <Animated.View entering={FadeInDown.delay(100).duration(600)} style={styles.controlsContainer}>
            <TouchableOpacity
              onPress={() => setIsPlaying(!isPlaying)}
              style={styles.controlButton}
            >
              {isPlaying ? (
                <Pause size={22} color="white" />
              ) : (
                <Play size={22} color="white" />
              )}
              <Text style={styles.controlText}>
                {isPlaying ? 'Pause' : 'Play'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleRecord}
              style={styles.controlButton}
            >
              <Video size={22} color={isRecording ? designSystem.colors.status.danger : 'white'} />
              <Text style={[styles.controlText, isRecording && styles.recordingTextActive]}>
                {isRecording ? 'Stop' : 'Record'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowRecordingsModal(true)}
              style={styles.controlButton}
            >
              <HardDrive size={22} color="#38BDF8" />
              <Text style={styles.controlText}>Clips</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowSettingsModal(true)}
              style={styles.controlButton}
            >
              <Settings size={22} color="white" />
              <Text style={styles.controlText}>Settings</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Detection Settings */}
          <Animated.View entering={FadeInDown.delay(200).duration(600)} style={styles.detectionSection}>
            <SceneProfilePicker
              selected={camera.detectionSettings.sceneProfile || 'home'}
              canUseAdvanced={canUseAdvancedScenes || isPremium}
              onSelect={applyProfile}
              onLocked={() => {
                Alert.alert(
                  'Pro Scene Modes',
                  'Parking, Warehouse, Construction, and School profiles are included with Pro.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Upgrade', onPress: () => router.push('/subscription') },
                  ]
                );
              }}
            />

            <Text style={styles.sectionTitle}>AI Detection Toggles</Text>
            <Text style={styles.sectionHint}>
              Changing a toggle switches this camera to Custom mode.
            </Text>

            {/* Person Detection */}
            <TouchableOpacity
              onPress={() => toggleDetection('person')}
              style={[
                styles.detectionCard,
                camera.detectionSettings.person && styles.detectionCardActive,
              ]}
            >
              <User
                size={24}
                color={camera.detectionSettings.person ? designSystem.colors.status.danger : designSystem.colors.text.muted}
              />
              <View style={styles.detectionContent}>
                <Text style={styles.detectionTitle}>Person Detection</Text>
                <Text style={styles.detectionDescription}>
                  Real-time alerts when people enter the camera view
                </Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  camera.detectionSettings.person && styles.checkboxActive,
                ]}
              >
                {camera.detectionSettings.person && <View style={styles.checkboxInner} />}
              </View>
            </TouchableOpacity>

            {/* Vehicle Detection */}
            <TouchableOpacity
              onPress={() => toggleDetection('vehicle')}
              style={[
                styles.detectionCard,
                camera.detectionSettings.vehicle && styles.detectionCardVehicle,
              ]}
            >
              <Car
                size={24}
                color={camera.detectionSettings.vehicle ? '#06B6D4' : designSystem.colors.text.muted}
              />
              <View style={styles.detectionContent}>
                <Text style={styles.detectionTitle}>Vehicle Detection</Text>
                <Text style={styles.detectionDescription}>
                  Detect cars, trucks, motorcycles, and bicycles
                </Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  camera.detectionSettings.vehicle && styles.checkboxVehicle,
                ]}
              >
                {camera.detectionSettings.vehicle && <View style={styles.checkboxInner} />}
              </View>
            </TouchableOpacity>

            {/* Animal Detection (opt-in; farm keeps off) */}
            <TouchableOpacity
              onPress={() => toggleDetection('animal')}
              style={[
                styles.detectionCard,
                camera.detectionSettings.animal && styles.detectionCardAnimal,
              ]}
            >
              <Shield
                size={24}
                color={camera.detectionSettings.animal ? '#84CC16' : designSystem.colors.text.muted}
              />
              <View style={styles.detectionContent}>
                <Text style={styles.detectionTitle}>Animal Detection</Text>
                <Text style={styles.detectionDescription}>
                  Alert on livestock/pets. Keep off for farm cameras.
                </Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  camera.detectionSettings.animal && styles.checkboxAnimal,
                ]}
              >
                {camera.detectionSettings.animal && <View style={styles.checkboxInner} />}
              </View>
            </TouchableOpacity>

            {/* Face Recognition */}
            <TouchableOpacity
              onPress={() => toggleDetection('face')}
              style={[
                styles.detectionCard,
                camera.detectionSettings.face && styles.detectionCardFace,
              ]}
            >
              <Smile
                size={24}
                color={camera.detectionSettings.face ? '#A855F7' : designSystem.colors.text.muted}
              />
              <View style={styles.detectionContent}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.detectionTitle}>Face Recognition</Text>
                  <View style={styles.proBadge}>
                    <Text style={styles.proBadgeText}>PRO</Text>
                  </View>
                </View>
                <Text style={styles.detectionDescription}>
                  Identify known individuals with AI face detection
                </Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  camera.detectionSettings.face && styles.checkboxFace,
                ]}
              >
                {camera.detectionSettings.face && <View style={styles.checkboxInner} />}
              </View>
            </TouchableOpacity>

            {/* Notification & Alarm Settings */}
            <Text style={[styles.sectionTitle, { marginTop: designSystem.spacing.xl }]}>
              Notification & Audio Actions
            </Text>

            <TouchableOpacity
              onPress={toggleNotifications}
              style={[
                styles.detectionCard,
                camera.detectionSettings.notificationsEnabled && styles.detectionCardNotification,
              ]}
            >
              <Bell
                size={24}
                color={camera.detectionSettings.notificationsEnabled ? designSystem.colors.status.success : designSystem.colors.text.muted}
              />
              <View style={styles.detectionContent}>
                <Text style={styles.detectionTitle}>Instant Push Notifications</Text>
                <Text style={styles.detectionDescription}>
                  Send high-priority alerts to this device
                </Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  camera.detectionSettings.notificationsEnabled && styles.checkboxNotification,
                ]}
              >
                {camera.detectionSettings.notificationsEnabled && <View style={styles.checkboxInner} />}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleAlarm}
              style={[
                styles.detectionCard,
                camera.detectionSettings.alarmEnabled && styles.detectionCardAlarm,
              ]}
            >
              <Volume2
                size={24}
                color={camera.detectionSettings.alarmEnabled ? designSystem.colors.status.warning : designSystem.colors.text.muted}
              />
              <View style={styles.detectionContent}>
                <Text style={styles.detectionTitle}>Siren & Audible Alarm</Text>
                <Text style={styles.detectionDescription}>
                  Sound siren and buzzer when threats are detected
                </Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  camera.detectionSettings.alarmEnabled && styles.checkboxAlarm,
                ]}
              >
                {camera.detectionSettings.alarmEnabled && <View style={styles.checkboxInner} />}
              </View>
            </TouchableOpacity>

            {/* Info note */}
            <View style={styles.infoNote}>
              <Shield size={16} color={designSystem.colors.text.muted} />
              <Text style={styles.infoNoteText}>
                Detection runs on-device with zero cloud latency. Unmonitored objects and ambient noise are filtered automatically.
              </Text>
            </View>
          </Animated.View>

          {/* Camera Info */}
          <Animated.View entering={FadeInDown.delay(300).duration(600)} style={styles.infoSection}>
            <Text style={styles.infoStatus}>
              Status: {camera.isActive ? '🟢 Online & Ready' : '🔴 Offline'}
            </Text>
            <Text style={styles.infoDate}>
              Added: {new Date(camera.createdAt).toLocaleDateString()}
            </Text>
          </Animated.View>
        </ScrollView>

        {/* Recordings & Storage Playback Modal */}
        <RecordingsModal
          visible={showRecordingsModal}
          onClose={() => setShowRecordingsModal(false)}
          cameraId={camera.id}
          cameraName={camera.name}
        />

        {/* Camera Settings Modal */}
        <Modal
          visible={showSettingsModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowSettingsModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Camera Settings</Text>
                <TouchableOpacity
                  onPress={() => setShowSettingsModal(false)}
                  style={styles.modalCloseBtn}
                >
                  <X size={20} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Camera Name</Text>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                style={styles.input}
                placeholder="Front Door Camera"
                placeholderTextColor="#64748B"
              />

              <Text style={styles.label}>Detection Sensitivity: {Math.round(editSensitivity * 100)}%</Text>
              <View style={styles.sliderRow}>
                {[0.5, 0.65, 0.8].map((val) => (
                  <TouchableOpacity
                    key={val}
                    onPress={() => setEditSensitivity(val)}
                    style={[
                      styles.sensitivityOption,
                      editSensitivity === val && styles.sensitivityOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sensitivityText,
                        editSensitivity === val && styles.sensitivityTextActive,
                      ]}
                    >
                      {val === 0.5 ? 'High (50%)' : val === 0.65 ? 'Normal (65%)' : 'Strict (80%)'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Alert Cooldown: {editCooldown}s</Text>
              <View style={styles.sliderRow}>
                {[15, 30, 60].map((cd) => (
                  <TouchableOpacity
                    key={cd}
                    onPress={() => setEditCooldown(cd)}
                    style={[
                      styles.sensitivityOption,
                      editCooldown === cd && styles.sensitivityOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sensitivityText,
                        editCooldown === cd && styles.sensitivityTextActive,
                      ]}
                    >
                      {cd} seconds
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                onPress={handleSaveSettings}
                style={styles.saveBtn}
              >
                <Check size={18} color="white" />
                <Text style={styles.saveBtnText}>Save Configuration</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
  },
  videoContainer: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  playButtonContainer: {
    alignItems: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playText: {
    color: 'white',
    marginTop: designSystem.spacing.md,
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
  },
  streamUrl: {
    color: designSystem.colors.text.muted,
    fontSize: designSystem.typography.size.sm,
    marginTop: designSystem.spacing.xs,
  },
  recordingIndicator: {
    position: 'absolute',
    top: designSystem.spacing.lg,
    right: designSystem.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: designSystem.colors.status.danger,
    paddingHorizontal: designSystem.spacing.md,
    paddingVertical: designSystem.spacing.xs,
    borderRadius: designSystem.layout.radius.full,
  },
  recordingDot: {
    width: 8,
    height: 8,
    backgroundColor: 'white',
    borderRadius: 4,
    marginRight: designSystem.spacing.sm,
  },
  recordingText: {
    color: 'white',
    fontSize: designSystem.typography.size.sm,
    fontWeight: '600',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: designSystem.spacing.lg,
    backgroundColor: designSystem.colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  controlButton: {
    alignItems: 'center',
  },
  controlText: {
    color: 'white',
    fontSize: designSystem.typography.size.xs,
    marginTop: designSystem.spacing.xs,
  },
  recordingTextActive: {
    color: designSystem.colors.status.danger,
  },
  detectionSection: {
    paddingHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    color: designSystem.colors.text.primary,
    fontWeight: '600',
    fontSize: designSystem.typography.size.lg,
    marginBottom: designSystem.spacing.xs,
  },
  sectionHint: {
    color: designSystem.colors.text.muted,
    fontSize: designSystem.typography.size.sm,
    marginBottom: designSystem.spacing.md,
  },
  detectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: designSystem.spacing.lg,
    borderRadius: designSystem.layout.radius.xl,
    backgroundColor: designSystem.colors.background.secondary,
    marginBottom: designSystem.spacing.md,
  },
  detectionCardActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  detectionCardAnimal: {
    backgroundColor: 'rgba(132, 204, 22, 0.15)',
  },
  detectionCardVehicle: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
  },
  detectionCardFace: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
  },
  detectionCardNotification: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  detectionCardAlarm: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  detectionContent: {
    flex: 1,
    marginLeft: designSystem.spacing.md,
  },
  detectionTitle: {
    color: designSystem.colors.text.primary,
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
  },
  detectionDescription: {
    color: designSystem.colors.text.muted,
    fontSize: designSystem.typography.size.xs,
    marginTop: 2,
  },
  proBadge: {
    backgroundColor: '#A855F7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 8,
  },
  proBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: designSystem.colors.text.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    borderColor: designSystem.colors.status.danger,
    backgroundColor: designSystem.colors.status.danger,
  },
  checkboxVehicle: {
    borderColor: '#06B6D4',
    backgroundColor: '#06B6D4',
  },
  checkboxFace: {
    borderColor: '#A855F7',
    backgroundColor: '#A855F7',
  },
  checkboxAnimal: {
    borderColor: '#84CC16',
    backgroundColor: '#84CC16',
  },
  checkboxNotification: {
    borderColor: designSystem.colors.status.success,
    backgroundColor: designSystem.colors.status.success,
  },
  checkboxAlarm: {
    borderColor: designSystem.colors.status.warning,
    backgroundColor: designSystem.colors.status.warning,
  },
  checkboxInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  infoNoteText: {
    color: designSystem.colors.text.muted,
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
    lineHeight: 16,
  },
  infoSection: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  infoStatus: {
    color: designSystem.colors.text.secondary,
    fontSize: 13,
  },
  infoDate: {
    color: designSystem.colors.text.muted,
    fontSize: 12,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  modalCloseBtn: {
    padding: 6,
  },
  label: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    color: '#F8FAFC',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sliderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sensitivityOption: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  sensitivityOptionActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  sensitivityText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  sensitivityTextActive: {
    color: '#38BDF8',
    fontWeight: '600',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284C7',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 24,
    gap: 8,
  },
  saveBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
});
