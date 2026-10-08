/**
 * 2×2 live camera mosaic for home / armed view
 */

import { CameraStreamPlayer } from '@/components/camera/CameraStreamPlayer';
import { designSystem } from '@/theme/design-system';
import type { Camera } from '@/types';
import { router } from 'expo-router';
import { Camera as CameraIcon, WifiOff } from 'lucide-react-native';
import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

const GAP = 8;
const H_PADDING = 32;

interface LiveCameraGridProps {
  cameras: Camera[];
  userId: string;
  maxTiles?: number;
  getPassword?: (cameraId: string) => string | undefined;
}

export function LiveCameraGrid({
  cameras,
  userId,
  maxTiles = 4,
  getPassword,
}: LiveCameraGridProps) {
  // Reactive: the tile size was derived from a module-scope
  // Dimensions.get('window') snapshot, so the mosaic kept its phone-boot size
  // after rotation or on a tablet.
  const { width } = useWindowDimensions();
  const tileWidth = (width - H_PADDING - GAP) / 2;
  const tiles = useMemo(
    () => cameras.filter((c) => c.isActive).slice(0, maxTiles),
    [cameras, maxTiles],
  );

  if (tiles.length === 0) {
    return (
      <View style={styles.empty}>
        <CameraIcon size={32} color={designSystem.colors.text.muted} />
        <Text style={styles.emptyTitle}>No live cameras</Text>
        <Text style={styles.emptySub}>
          Add a camera and keep it active to see the mosaic.
        </Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push('/cameras/add')}
        >
          <Text style={styles.addBtnText}>Add Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {tiles.map((cam) => (
        <TouchableOpacity
          key={cam.id}
          style={[styles.tile, { width: tileWidth }]}
          activeOpacity={0.9}
          onPress={() => router.push(`/cameras/${cam.id}`)}
        >
          <View style={styles.playerWrap}>
            <CameraStreamPlayer
              cameraId={cam.id}
              cameraName={cam.name}
              rtspUrl={cam.rtspUrl}
              userId={userId}
              username={cam.username}
              password={getPassword?.(cam.id)}
              autoPlay
              showControls={false}
              showAdvancedControls={false}
            />
          </View>
          <View style={styles.tileFooter}>
            <Text style={styles.tileName} numberOfLines={1}>
              {cam.name}
            </Text>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: cam.isActive
                    ? designSystem.colors.status.success
                    : designSystem.colors.status.danger,
                },
              ]}
            />
          </View>
        </TouchableOpacity>
      ))}
      {tiles.length < maxTiles &&
        Array.from({ length: maxTiles - tiles.length }).map((_, i) => (
          <TouchableOpacity
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder tiles
            key={`empty-${i}`}
            style={[styles.tile, styles.emptyTile, { width: tileWidth }]}
            onPress={() => router.push('/cameras/add')}
          >
            <WifiOff size={20} color={designSystem.colors.text.muted} />
            <Text style={styles.emptyTileText}>Add slot</Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  playerWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tileName: {
    flex: 1,
    color: designSystem.colors.text.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
  },
  empty: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: 16,
  },
  emptyTitle: {
    color: designSystem.colors.text.primary,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySub: {
    color: designSystem.colors.text.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  addBtn: {
    backgroundColor: designSystem.colors.primary[500],
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyTile: {
    aspectRatio: 16 / 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  emptyTileText: {
    color: designSystem.colors.text.muted,
    fontSize: 12,
    marginTop: 6,
  },
});
