import { Tabs } from 'expo-router';

// TODO(M1): render <MiniPlayer /> above the tab bar via the `tabBar` prop.
export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Library' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="downloads" options={{ title: 'Downloads' }} />
    </Tabs>
  );
}
