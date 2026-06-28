import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { HomePlaceholderScreen } from './screens/HomePlaceholderScreen.js';
import { LoginScreen } from './screens/LoginScreen.js';

function AppContent(): JSX.Element {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return user ? <HomePlaceholderScreen /> : <LoginScreen />;
}

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <AppContent />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
});
