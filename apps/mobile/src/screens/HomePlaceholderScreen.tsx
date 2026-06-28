import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/useAuth.js';

/**
 * Placeholder home — no catalog, cart, barcode, orders, Clover, or delivery features yet.
 * RLS governs all future data access.
 */
export function HomePlaceholderScreen(): JSX.Element {
  const { user, profile, signOut, error } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome</Text>
      <Text style={styles.note}>
        Phase 1D shell only. Pickup ordering and payments come in later phases. RLS is the real
        security layer.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>{profile?.full_name ?? user?.email ?? user?.id ?? '—'}</Text>
        <Text style={styles.label}>Role</Text>
        <Text style={styles.value}>{profile?.role ?? '—'}</Text>
      </View>

      <Pressable style={styles.button} onPress={() => void signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  note: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 24 },
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  label: { fontSize: 12, color: '#666', marginTop: 8 },
  value: { fontSize: 16, fontWeight: '500' },
  button: {
    backgroundColor: '#1a5f4a',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b00020', marginTop: 16 },
});
