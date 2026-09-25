/**
 * Recordings and Storage Playback Modal
 * Allows browsing, playing, and managing camera video recordings and clips
 * 
 * @module components/camera/RecordingsModal
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import * as Sharing from 'expo-sharing';
import {
  X,
  Play,
  Pause,
  Trash2,
  Share2,
  HardDrive,
  Film,
  Calendar,
  Clock,
  CheckCircle,
} from 'lucide-react-native';
import { recordingService, RecordingInfo } from '@/lib/recording/recordingService';
import { designSystem } from '@/theme/design-system';

interface RecordingsModalProps {
  visible: boolean;
  onClose: () => void;
  cameraId?: string;
  cameraName?: string;
}

export function RecordingsModal({
  visible,
  onClose,
  cameraId,
  cameraName = 'Camera',
}: RecordingsModalProps) {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [activeClip, setActiveClip] = useState<RecordingInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [totalStorageMB, setTotalStorageMB] = useState(0);

  const loadRecordings = useCallback(async () => {
    try {
      await recordingService.initialize();
      const allRecordings = cameraId
        ? recordingService.getCameraRecordings(cameraId)
        : recordingService.getRecordingHistory();

      setRecordings(allRecordings);

      const usage = await recordingService.getStorageUsage();
      setTotalStorageMB(Math.round((usage.localBytes / (1024 * 1024)) * 10) / 10);
    } catch (err) {
      console.warn('[RecordingsModal] Failed to load recordings:', err);
    }
  }, [cameraId]);

  useEffect(() => {
    if (visible) {
      loadRecordings();
    } else {
      setActiveClip(null);
      setIsPlaying(false);
    }
  }, [visible, loadRecordings]);

  const handleDelete = (recording: RecordingInfo) => {
    Alert.alert(
      'Delete Clip',
      'Are you sure you want to delete this recorded clip?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (activeClip?.id === recording.id) {
              setActiveClip(null);
              setIsPlaying(false);
            }
            await recordingService.deleteRecording(recording.id);
            await loadRecordings();
          },
        },
      ]
    );
  };

  const handleShare = async (recording: RecordingInfo) => {
    const path = recording.localPath || recording.cloudUrl;
    if (!path) {
      Alert.alert('Unavailable', 'Clip file is not stored locally.');
      return;
    }
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(path);
    } else {
      Alert.alert('Share', `Clip saved at: ${path}`);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 KB';
    if (bytes > 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Clips & Storage</Text>
            <Text style={styles.subtitle}>{cameraName}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color={designSystem.colors.text.primary} />
          </TouchableOpacity>
        </View>

        {/* Storage Bar */}
        <View style={styles.storageCard}>
          <View style={styles.storageIconWrap}>
            <HardDrive size={22} color={designSystem.colors.primary[400]} />
          </View>
          <View style={styles.storageInfo}>
            <Text style={styles.storageTitle}>Local Storage</Text>
            <Text style={styles.storageSubtitle}>
              {recordings.length} clip{recordings.length !== 1 ? 's' : ''} • {totalStorageMB} MB used
            </Text>
          </View>
        </View>

        {/* Video Player Preview if active clip selected */}
        {activeClip && (
          <View style={styles.playerContainer}>
            <Video
              source={{ uri: activeClip.localPath || activeClip.cloudUrl || '' }}
              style={styles.videoPlayer}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              isLooping
              shouldPlay={true}
              onPlaybackStatusUpdate={(status) => {
                if (status.isLoaded) {
                  setIsPlaying(status.isPlaying);
                }
              }}
            />
            <View style={styles.playerMetaRow}>
              <Text style={styles.playerMetaText}>
                {new Date(activeClip.startTime).toLocaleTimeString()} ({formatDuration(activeClip.duration)})
              </Text>
              <TouchableOpacity
                onPress={() => setActiveClip(null)}
                style={styles.closePlayerBtn}
              >
                <Text style={styles.closePlayerText}>Close Preview</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Recordings List */}
        {recordings.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Film size={48} color={designSystem.colors.text.muted} />
            <Text style={styles.emptyTitle}>No Recorded Clips</Text>
            <Text style={styles.emptyDesc}>
              Tap the record button while viewing the live stream to capture security footage.
            </Text>
          </View>
        ) : (
          <FlatList
            data={recordings}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isSelected = activeClip?.id === item.id;
              return (
                <View
                  style={[
                    styles.clipCard,
                    isSelected && styles.clipCardActive,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.clipLeft}
                    onPress={() => {
                      setActiveClip(item);
                    }}
                  >
                    <View style={styles.clipThumb}>
                      <Play size={18} color="white" fill="white" />
                    </View>
                    <View style={styles.clipDetails}>
                      <Text style={styles.clipDate}>
                        {new Date(item.startTime).toLocaleDateString()} at{' '}
                        {new Date(item.startTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                      <View style={styles.clipMetaRow}>
                        <Clock size={12} color={designSystem.colors.text.muted} />
                        <Text style={styles.clipMeta}>
                          {formatDuration(item.duration)}
                        </Text>
                        <Text style={styles.clipMetaDivider}>•</Text>
                        <Text style={styles.clipMeta}>
                          {formatBytes(item.fileSize)}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.clipActions}>
                    <TouchableOpacity
                      onPress={() => handleShare(item)}
                      style={styles.actionBtn}
                    >
                      <Share2 size={18} color={designSystem.colors.text.secondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(item)}
                      style={styles.actionBtn}
                    >
                      <Trash2 size={18} color={designSystem.colors.status.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
  },
  storageIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  storageInfo: {
    flex: 1,
  },
  storageTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
  },
  storageSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  playerContainer: {
    backgroundColor: '#000',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  videoPlayer: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  playerMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#1E293B',
  },
  playerMetaText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '500',
  },
  closePlayerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closePlayerText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  clipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  clipCardActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#24324D',
  },
  clipLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  clipThumb: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  clipDetails: {
    flex: 1,
  },
  clipDate: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  clipMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  clipMeta: {
    color: '#94A3B8',
    fontSize: 12,
    marginLeft: 4,
  },
  clipMetaDivider: {
    color: '#64748B',
    marginHorizontal: 6,
    fontSize: 12,
  },
  clipActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    padding: 8,
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptyDesc: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});
