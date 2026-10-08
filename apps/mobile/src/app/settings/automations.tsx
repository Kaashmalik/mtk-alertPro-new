import { AutomationCard } from '@/components/automation/AutomationCard';
import { UsageLimitWarning } from '@/components/ui/UpgradePrompt';
import {
  MAX_AUTOMATIONS,
  isTierActive,
  normalizeTier,
} from '@/lib/subscription/planLimits';
import {
  useAutomationStore,
  useCameraStore,
  useIsPremium,
  useSubscriptionStore,
} from '@/stores';
import { designSystem } from '@/theme/design-system';
import type { CameraAutomation } from '@/types/automation';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Clock, Plus } from 'lucide-react-native';
import { useEffect } from 'react';
import {
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AutomationsScreen() {
  const { automations, fetchAutomations, toggleAutomation } =
    useAutomationStore();
  const { cameras } = useCameraStore();
  const isPremium = useIsPremium();
  const currentTier = useSubscriptionStore((state) => state.currentTier);
  const expiresAt = useSubscriptionStore((state) => state.expiresAt);

  /**
   * The real quota, resolved from the plan table.
   *
   * This used to be hardcoded to 3, while MAX_AUTOMITS is free:1 / pro:4 /
   * business:9 — so the UI let a free user press "add" twice more than
   * allowed and only then did the store (and now the DB trigger) refuse. The
   * screen and the enforcement layer must read the same number.
   */
  const automationLimit = (() => {
    const tier = isTierActive(currentTier, expiresAt)
      ? normalizeTier(currentTier)
      : 'free';
    return MAX_AUTOMATIONS[tier];
  })();

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only or stable store refs
  useEffect(() => {
    fetchAutomations();
  }, []);

  const handleToggle = async (id: string) => {
    try {
      await toggleAutomation(id);
    } catch (error) {
      console.error('Failed to toggle automation:', error);
    }
  };

  const handleEdit = (automation: CameraAutomation) => {
    router.push({
      pathname: '/settings/automations/create',
      params: { id: automation.id },
    });
  };

  const handleAdd = () => {
    // Same resolved limit the store and the DB trigger enforce.
    if (
      automationLimit !== Number.POSITIVE_INFINITY &&
      automations.length >= automationLimit
    ) {
      router.push('/subscription');
      return;
    }

    router.push('/settings/automations/create');
  };

  const getCameraName = (cameraId: string) => {
    return cameras.find((c) => c.id === cameraId)?.name || 'Unknown Camera';
  };

  const renderAutomation = ({
    item,
    index,
  }: { item: CameraAutomation; index: number }) => (
    <AutomationCard
      automation={item}
      cameraName={getCameraName(item.cameraId)}
      onPress={() => handleEdit(item)}
      onToggle={() => handleToggle(item.id)}
      index={index}
    />
  );

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
          <View>
            <Text style={styles.headerTitle}>Automations</Text>
            <Text style={styles.headerSubtitle}>
              {automations.length} automation
              {automations.length !== 1 ? 's' : ''} configured
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleAdd}
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
        </Animated.View>

        {/* Usage against the real plan limit. Replaces a hand-rolled
                    banner keyed to a hardcoded ">= 2" that disagreed with the
                    enforced quota. */}
        {!isPremium && automationLimit !== Number.POSITIVE_INFINITY && (
          <UsageLimitWarning
            current={automations.length}
            max={automationLimit}
            label="Automations"
            onUpgrade={() => router.push('/subscription')}
          />
        )}

        {/* Automation List */}
        {automations.length === 0 ? (
          <View style={styles.emptyState}>
            <Animated.View
              entering={FadeInDown.delay(300)}
              style={styles.emptyIcon}
            >
              <Clock size={48} color={designSystem.colors.text.muted} />
            </Animated.View>
            <Text style={styles.emptyTitle}>No Automations Yet</Text>
            <Text style={styles.emptySubtitle}>
              Create automated schedules to control camera settings during
              specific times
            </Text>

            <TouchableOpacity
              style={styles.emptyButton}
              onPress={handleAdd}
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
                <Text style={styles.emptyButtonText}>Create Automation</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={automations}
            renderItem={renderAutomation}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
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
    paddingHorizontal: designSystem.spacing.xl,
    paddingTop: designSystem.spacing.md,
    paddingBottom: designSystem.spacing.lg,
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
});
