/**
 * Detection zone editor.
 *
 * A zone is a polygon drawn over the live frame. Only detections whose centre
 * falls inside an active zone - and clears that zone's confidence threshold -
 * raise an alert, which is how a user stops a busy street from generating
 * alerts while keeping the driveway sensitive.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Slider from '@react-native-community/slider';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import { ChevronLeft, Layers, Plus, Trash2 } from 'lucide-react-native';

import { designSystem } from '@/theme/design-system';
import { MjpegStreamPlayer } from '@/components/camera/MjpegStreamPlayer';
import { useCameraStore } from '@/stores';
import {
  MIN_POLYGON_POINTS,
  createZone,
  deleteZone,
  listZones,
  normalizePolygon,
  updateZone,
} from '@/lib/camera/zoneService';
import type { DetectionZone, ZonePoint } from '@/types';

const { colors, spacing } = designSystem;

export default function ZoneEditorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const cameraId = params.id;

  const camera = useCameraStore((s) => s.cameras.find((c) => c.id === cameraId));

  const [zones, setZones] = useState<DetectionZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ZonePoint[] | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSensitivity, setDraftSensitivity] = useState(0.6);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!cameraId) return;
    setLoading(true);
    setZones(await listZones(cameraId));
    setLoading(false);
  }, [cameraId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => zones.find((z) => z.id === selectedId) ?? null,
    [zones, selectedId]
  );

  const startDraft = useCallback(() => {
    setSelectedId(null);
    setDraft([]);
    setDraftName('');
    setDraftSensitivity(0.6);
  }, []);

  const cancelDraft = useCallback(() => setDraft(null), []);

  const handleSaveDraft = useCallback(async () => {
    if (!cameraId || !draft) return;
    if (draft.length < MIN_POLYGON_POINTS) {
      Alert.alert('Zone too small', `Add at least ${MIN_POLYGON_POINTS} points on the frame.`);
      return;
    }
    setSaving(true);
    const created = await createZone(cameraId, draftName, normalizePolygon(draft), draftSensitivity);
    setSaving(false);
    if (!created) {
      Alert.alert('Could not save zone', 'Please try again.');
      return;
    }
    setDraft(null);
    await refresh();
  }, [cameraId, draft, draftName, draftSensitivity, refresh]);

  const handleToggle = useCallback(
    async (zone: DetectionZone) => {
      const updated = await updateZone(zone.id, { isActive: !zone.isActive });
      if (updated) {
        setZones((prev) => prev.map((z) => (z.id === zone.id ? updated : z)));
      }
    },
    []
  );

  const handleDelete = useCallback(
    (zone: DetectionZone) => {
      Alert.alert('Delete zone', `Remove "${zone.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteZone(zone.id);
            if (selectedId === zone.id) setSelectedId(null);
            await refresh();
          },
        },
      ]);
    },
    [refresh, selectedId]
  );

  const handleRename = useCallback(async (zone: DetectionZone, name: string) => {
    const updated = await updateZone(zone.id, { name });
    if (updated) setZones((prev) => prev.map((z) => (z.id === zone.id ? updated : z)));
  }, []);

  const handleSensitivity = useCallback(async (zone: DetectionZone, sensitivity: number) => {
    const updated = await updateZone(zone.id, { sensitivity });
    if (updated) setZones((prev) => prev.map((z) => (z.id === zone.id ? updated : z)));
  }, []);

  // While drawing, a tap on the frame appends a vertex.
  const handleFramePress = useCallback(
    (e: { nativeEvent: { locationX: number; locationY: number } }, size: { width: number; height: number }) => {
      if (!draft || size.width <= 0 || size.height <= 0) return;
      const point = {
        x: clamp01(e.nativeEvent.locationX / size.width),
        y: clamp01(e.nativeEvent.locationY / size.height),
      };
      setDraft((prev) => (prev ? [...prev, point] : [point]));
    },
    [draft]
  );

  if (!cameraId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Text style={styles.muted}>Camera not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <ChevronLeft size={24} color={colors.text.primary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Detection zones</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {camera?.name ?? 'Camera'}
          </Text>
        </View>
        {draft ? (
          <Pressable onPress={cancelDraft} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Cancel drawing">
            <Text style={styles.linkText}>Cancel</Text>
          </Pressable>
        ) : (
          <Pressable onPress={startDraft} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Add a zone">
            <Plus size={22} color={colors.text.primary} />
          </Pressable>
        )}
      </View>

      <ZoneCanvas
        cameraName={camera?.name}
        streamUrl={camera?.rtspUrl}
        username={camera?.username}
        password={camera?.password}
        zones={zones}
        selectedId={selectedId}
        draft={draft}
        onSelect={setSelectedId}
        onFramePress={handleFramePress}
      />

      {draft ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>
            Tap the frame to outline the area
          </Text>
          <Text style={styles.muted}>
            {draft.length} point{draft.length === 1 ? '' : 's'} - need at least {MIN_POLYGON_POINTS}
          </Text>

          {draft.length > 0 && (
            <Pressable onPress={() => setDraft(draft.slice(0, -1))} style={styles.linkBtn}>
              <Text style={styles.linkText}>Undo last point</Text>
            </Pressable>
          )}

          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Zone name (e.g. Driveway)"
            placeholderTextColor={colors.text.secondary}
            style={styles.input}
            returnKeyType="done"
          />

          <Text style={styles.fieldLabel}>Sensitivity {(draftSensitivity * 100).toFixed(0)}%</Text>
          <Text style={styles.hint}>Lower reacts to weaker detections; higher ignores noise.</Text>
          <Slider
            style={styles.slider}
            minimumValue={0.1}
            maximumValue={0.95}
            step={0.05}
            value={draftSensitivity}
            onValueChange={setDraftSensitivity}
            minimumTrackTintColor={colors.primary[500]}
            thumbTintColor={colors.text.primary}
          />

          <Pressable
            onPress={handleSaveDraft}
            disabled={saving || draft.length < MIN_POLYGON_POINTS}
            style={({ pressed }) => [
              styles.primaryBtn,
              (saving || draft.length < MIN_POLYGON_POINTS) && styles.primaryBtnDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={colors.text.primary} />
            ) : (
              <Text style={styles.primaryBtnText}>Save zone</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
          {loading ? (
            <ActivityIndicator color={colors.primary[500]} style={styles.loader} />
          ) : zones.length === 0 ? (
            <View style={styles.empty}>
              <Layers size={32} color={colors.text.secondary} />
              <Text style={styles.emptyTitle}>No zones yet</Text>
              <Text style={styles.muted}>
                Without a zone, every detection in the frame raises an alert. Add a zone to
                limit alerts to the area you care about.
              </Text>
              <Pressable onPress={startDraft} style={styles.primaryBtn} accessibilityRole="button">
                <Text style={styles.primaryBtnText}>Add your first zone</Text>
              </Pressable>
            </View>
          ) : (
            zones.map((zone) => (
              <View
                key={zone.id}
                style={[styles.card, selectedId === zone.id && styles.cardSelected]}
              >
                <Pressable onPress={() => setSelectedId(selectedId === zone.id ? null : zone.id)} accessibilityRole="button">
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleWrap}>
                      <Text style={styles.cardTitle}>{zone.name}</Text>
                      <Text style={styles.muted}>
                        {zone.polygon.length} points - {(zone.sensitivity ?? 0.6) * 100 | 0}% sensitivity
                      </Text>
                    </View>
                    <Switch
                      value={zone.isActive}
                      onValueChange={() => handleToggle(zone)}
                      trackColor={{ true: colors.primary[500], false: '#334155' }}
                      thumbColor={colors.text.primary}
                    />
                  </View>
                </Pressable>

                {selectedId === zone.id && (
                  <View style={styles.cardBody}>
                    <TextInput
                      defaultValue={zone.name}
                      onEndEditing={(e) => handleRename(zone, e.nativeEvent.text)}
                      style={styles.input}
                      placeholder="Zone name"
                      placeholderTextColor={colors.text.secondary}
                    />

                    <Text style={styles.fieldLabel}>Sensitivity {((zone.sensitivity ?? 0.6) * 100).toFixed(0)}%</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={0.1}
                      maximumValue={0.95}
                      step={0.05}
                      value={zone.sensitivity ?? 0.6}
                      onSlidingComplete={(v) => handleSensitivity(zone, v)}
                      minimumTrackTintColor={colors.primary[500]}
                      thumbTintColor={colors.text.primary}
                    />

                    <Pressable
                      onPress={() => handleDelete(zone)}
                      style={styles.dangerBtn}
                      accessibilityRole="button"
                    >
                      <Trash2 size={16} color="#F87171" />
                      <Text style={styles.dangerText}>Delete zone</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Live frame with saved + in-progress zones drawn on top.
 *
 * The polygon is rendered with react-native-svg in the same normalised
 * coordinate space the detector uses, so what is drawn is what is evaluated.
 */
function ZoneCanvas({
  cameraName,
  streamUrl,
  username,
  password,
  zones,
  selectedId,
  draft,
  onSelect,
  onFramePress,
}: {
  cameraName?: string;
  streamUrl?: string;
  username?: string;
  password?: string;
  zones: DetectionZone[];
  selectedId: string | null;
  draft: ZonePoint[] | null;
  onSelect: (id: string | null) => void;
  onFramePress: (e: any, size: { width: number; height: number }) => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const toPoints = useCallback(
    (pts: ZonePoint[]) => pts.map((p) => `${p.x * size.width},${p.y * size.height}`).join(' '),
    [size]
  );

  return (
    <View
      style={styles.canvas}
      onLayout={(e) =>
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
    >
      {streamUrl ? (
        <MjpegStreamPlayer
          url={streamUrl}
          cameraName={cameraName}
          username={username}
          password={password}
          autoPlay
          fps={1}
        />
      ) : (
        <View style={styles.canvasFallback}>
          <Text style={styles.muted}>No stream URL for this camera</Text>
        </View>
      )}

      {size.width > 0 && (
        <>
          {/* Tap surface. Only active while drawing so taps can select zones. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            // While drawing, this surface must receive taps. While browsing,
            // it must get out of the way so the SVG polygons below can be
            // pressed to select a saved zone.
            pointerEvents={draft ? 'auto' : 'none'}
            onPress={(e) => (draft ? onFramePress(e, size) : undefined)}
            accessibilityLabel={draft ? 'Tap to add a zone point' : undefined}
          />

          {/* box-none lets the polygon children receive presses while the SVG
              root itself stays transparent to touches. */}
          <Svg style={StyleSheet.absoluteFill} pointerEvents={draft ? 'none' : 'box-none'}>
            {zones.map((zone) => {
              if (zone.polygon.length < 3) return null;
              const highlighted = zone.id === selectedId;
              return (
                <Polygon
                  key={zone.id}
                  points={toPoints(zone.polygon)}
                  fill={zone.isActive ? 'rgba(56,189,248,0.18)' : 'rgba(148,163,184,0.10)'}
                  stroke={zone.isActive ? '#38BDF8' : '#64748B'}
                  strokeWidth={highlighted ? 3 : 2}
                  strokeDasharray={zone.isActive ? undefined : '6 4'}
                  onPress={() => onSelect(highlighted ? null : zone.id)}
                />
              );
            })}

            {draft && draft.length > 0 && (
              <>
                <Polygon
                  points={toPoints(draft)}
                  fill="rgba(248,113,113,0.18)"
                  stroke="#F87171"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
                {draft.map((p, i) => (
                  <React.Fragment key={`draft-${i}`}>
                    {i > 0 && (
                      <Line
                        x1={draft[i - 1].x * size.width}
                        y1={draft[i - 1].y * size.height}
                        x2={p.x * size.width}
                        y2={p.y * size.height}
                        stroke="#F87171"
                        strokeWidth={2}
                      />
                    )}
                    <Circle
                      cx={p.x * size.width}
                      cy={p.y * size.height}
                      r={7}
                      fill="#F87171"
                      stroke="#0F172A"
                      strokeWidth={2}
                    />
                  </React.Fragment>
                ))}
              </>
            )}
          </Svg>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text.primary },
  subtitle: { fontSize: 13, color: colors.text.secondary },
  iconBtn: { padding: 6 },
  linkBtn: { paddingVertical: 6 },
  linkText: { color: colors.primary[500], fontSize: 15, fontWeight: '600' },
  canvas: {
    width: '100%',
    aspectRatio: 16 / 10,
    backgroundColor: '#020617',
    overflow: 'hidden',
  },
  canvasFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { flex: 1, padding: spacing.lg },
  panelContent: { paddingBottom: spacing.xxl },
  panelTitle: { fontSize: 15, fontWeight: '600', color: colors.text.primary, marginBottom: 4 },
  muted: { fontSize: 13, color: colors.text.secondary, lineHeight: 19 },
  hint: { fontSize: 12, color: colors.text.secondary, marginTop: 2 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text.primary, marginTop: spacing.md },
  slider: { width: '100%', height: 40 },
  input: {
    marginTop: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text.primary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  primaryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary[500],
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#0F172A', fontWeight: '700', fontSize: 15 },
  pressed: { opacity: 0.8 },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardSelected: { borderColor: colors.primary[500] },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
  cardBody: { marginTop: spacing.md },
  dangerBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
  },
  dangerText: { color: '#F87171', fontWeight: '600', fontSize: 14 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  loader: { marginTop: spacing.xxl },
});
