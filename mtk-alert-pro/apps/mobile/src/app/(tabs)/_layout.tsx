import { Tabs } from 'expo-router';
import { Home, Camera, Bell, Settings } from 'lucide-react-native';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAlertStore } from '@/stores';
import { colors } from '@/lib/theme';

const TAB_BAR_CONTENT_HEIGHT = 60;

export default function TabsLayout() {
  const { unreadCount } = useAlertStore();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg.secondary,
          borderTopColor: colors.border.default,
          borderTopWidth: 1,
          // Do NOT hardcode `height`. React Navigation applies
          // `insets.bottom` before `tabBarStyle`, so a fixed height overrides
          // the safe area and the tab labels end up underneath the iOS home
          // indicator (and the Android gesture bar). Adding the inset to the
          // height preserves both.
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 10),
          paddingTop: 10,
        },
        tabBarActiveTintColor: colors.brand.red,
        tabBarInactiveTintColor: colors.text.tertiary,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home dashboard',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cameras"
        options={{
          title: 'Cameras',
          tabBarAccessibilityLabel: 'Cameras',
          tabBarIcon: ({ color, size }) => <Camera size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          // Announce the unread count so screen-reader users know the tab
          // holds unread alerts rather than only seeing a coloured dot.
          tabBarAccessibilityLabel:
            unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Bell size={size} color={color} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarAccessibilityLabel: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: colors.brand.red,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: colors.text.primary,
    fontSize: 10,
    fontWeight: '700',
  },
});
