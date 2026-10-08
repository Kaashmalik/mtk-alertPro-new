import { Stack, router } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionSetupGuide } from '@/components/camera/ConnectionSetupGuide';
import { colors } from '@/lib/theme';

export default function CameraSetupScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <StatusBar barStyle="light-content" backgroundColor={colors.bg.primary} />
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.bg.primary }}
        edges={['top', 'bottom']}
      >
        <ConnectionSetupGuide onClose={() => router.back()} />
      </SafeAreaView>
    </>
  );
}
