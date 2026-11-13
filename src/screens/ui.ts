import { StyleSheet } from 'react-native';

export const ui = StyleSheet.create({
  screen: { flex: 1, padding: 12, backgroundColor: '#f4f5f4' },
  btn: { backgroundColor: '#2e7d32', padding: 12, borderRadius: 8, alignItems: 'center', marginVertical: 6 },
  btnDisabled: { backgroundColor: '#a5b8a6' },
  btnAlt: { backgroundColor: '#37474f' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  card: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginVertical: 5 },
  title: { fontSize: 16, fontWeight: '600', color: '#222' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#444' },
  note: { color: '#555', fontSize: 13, marginVertical: 4 },
  ok: { color: '#2e7d32', fontWeight: '600' },
  warn: { color: '#b26a00', fontWeight: '600' },
  bad: { color: '#c62828', fontWeight: '600' },
  badge: { fontSize: 11, color: '#fff', backgroundColor: '#546e7a', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginRight: 4, overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
});
