/**
 * Horizontal scene profile chip picker (Farm, Shop, Home, …)
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {
  SCENE_PROFILES,
  isAdvancedSceneProfile,
  type SceneProfileDefinition,
} from '@/features/detection/sceneProfiles';
import type { SceneProfileId } from '@/types';
import { designSystem } from '@/theme/design-system';

interface SceneProfilePickerProps {
  selected: SceneProfileId | undefined;
  onSelect: (id: SceneProfileId) => void;
  /** When false, advanced profiles show PRO badge and call onLocked instead */
  canUseAdvanced: boolean;
  onLocked?: (profile: SceneProfileDefinition) => void;
}

export function SceneProfilePicker({
  selected,
  onSelect,
  canUseAdvanced,
  onLocked,
}: SceneProfilePickerProps) {
  const activeId = selected || 'home';
  const active = SCENE_PROFILES.find((p) => p.id === activeId) || SCENE_PROFILES[0];

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Scene mode</Text>
      <Text style={styles.helper}>{active.description}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {SCENE_PROFILES.map((profile) => {
          const locked = isAdvancedSceneProfile(profile.id) && !canUseAdvanced;
          const isSelected = activeId === profile.id;
          return (
            <TouchableOpacity
              key={profile.id}
              style={[
                styles.chip,
                isSelected && styles.chipActive,
                locked && styles.chipLocked,
              ]}
              onPress={() => {
                if (locked) {
                  onLocked?.(profile);
                  return;
                }
                onSelect(profile.id);
              }}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.chipLabel,
                  isSelected && styles.chipLabelActive,
                ]}
              >
                {profile.label}
              </Text>
              {locked && <Text style={styles.proBadge}>PRO</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: designSystem.spacing.lg,
  },
  heading: {
    color: designSystem.colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  helper: {
    color: designSystem.colors.text.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  row: {
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: designSystem.colors.background.secondary,
    borderWidth: 1,
    borderColor: designSystem.colors.border.default,
  },
  chipActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderColor: designSystem.colors.status.danger,
  },
  chipLocked: {
    opacity: 0.75,
  },
  chipLabel: {
    color: designSystem.colors.text.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  chipLabelActive: {
    color: designSystem.colors.text.primary,
  },
  proBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: designSystem.colors.status.warning,
    letterSpacing: 0.5,
  },
});
