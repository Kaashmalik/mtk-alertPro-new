/**
 * Known People — enrollment manager for face recognition.
 *
 * Each enrolled person stores a 128-d embedding produced by the on-device
 * model. Snapshots are picked via expo-image-picker (camera roll or capture)
 * and embedded locally; the photo itself is never uploaded.
 */

import * as ImagePicker from 'expo-image-picker';
import { Stack, router } from 'expo-router';
import { ChevronLeft, Trash2, UserPlus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { embedFromFile, isConfigured, useFaceStore } from '@/features/faces';
import { useSubscriptionStore } from '@/stores';
import { designSystem } from '@/theme/design-system';

export default function KnownPeopleScreen() {
  const { profiles, isHydrated, hydrate, enroll, remove } = useFaceStore();
  const checkFeatureAccess = useSubscriptionStore((s) => s.checkFeatureAccess);
  const entitled = checkFeatureAccess('hasFaceRecognition');

  const [name, setName] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const addPerson = async () => {
    if (!entitled) {
      Alert.alert(
        'Pro Feature',
        'Face recognition requires a Pro or Business plan.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Upgrade', onPress: () => router.push('/subscription') },
        ],
      );
      return;
    }
    if (!isConfigured()) {
      Alert.alert(
        'Model not configured',
        'Set EXPO_PUBLIC_FACE_MODEL_URL and rebuild the app to enable face recognition.',
      );
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name required', 'Enter the person\u2019s name first.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to enroll a face.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    setIsEnrolling(true);
    try {
      const embedding = await embedFromFile(result.assets[0].uri);
      if (!embedding) {
        Alert.alert(
          'Could not process',
          'The model could not read a face from that photo. Try a clearer, front-facing photo.',
        );
        return;
      }
      await enroll(name, embedding);
      setName('');
    } finally {
      setIsEnrolling(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={24} color={designSystem.colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>Known People</Text>
        </View>

        <Text style={styles.hint}>
          Enrolled faces are recognized on cameras with Face Recognition
          enabled. Photos never leave the device.
        </Text>

        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Person's name"
            placeholderTextColor={designSystem.colors.text.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <TouchableOpacity
            style={[styles.addButton, isEnrolling && { opacity: 0.6 }]}
            onPress={addPerson}
            disabled={isEnrolling}
          >
            <UserPlus size={20} color="#fff" />
            <Text style={styles.addButtonText}>
              {isEnrolling ? 'Adding…' : 'Enroll'}
            </Text>
          </TouchableOpacity>
        </View>

        {isHydrated && (
          <FlatList
            data={profiles}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>
                No known people yet. Add someone to get alerts like \u201cAlice
                spotted\u201d.
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.rowName}>{item.name}</Text>
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert('Remove', `Remove ${item.name}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => remove(item.id),
                      },
                    ])
                  }
                  accessibilityLabel={`Remove ${item.name}`}
                >
                  <Trash2 size={18} color={designSystem.colors.status.danger} />
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
  },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  backButton: { padding: 4 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: designSystem.colors.text.primary,
  },
  hint: {
    color: designSystem.colors.text.muted,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  addRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  input: {
    flex: 1,
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: designSystem.colors.text.primary,
    fontSize: 15,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: designSystem.colors.status.danger,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: 12,
    padding: 14,
  },
  rowName: {
    color: designSystem.colors.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  empty: {
    color: designSystem.colors.text.muted,
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 20,
  },
});
