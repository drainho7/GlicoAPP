import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { StoredReading } from '../storage/readings';
import { ui } from './ui';

const MEAL: Record<number, string> = { 1: 'Pré-prandial', 2: 'Pós-prandial', 3: 'Jejum', 4: 'Casual', 5: 'Ao deitar' };

export function ReadingsScreen({ readings }: { readings: StoredReading[] }) {
  return (
    <View style={ui.screen}>
      <Text style={ui.note}>{readings.length} medição(ões) salvas neste aparelho. Horários são os do medidor.</Text>
      <FlatList
        data={readings}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => (
          <View style={ui.card}>
            <Text style={ui.title}>{item.mgdl} mg/dL</Text>
            <Text style={ui.note}>
              {item.adjustedTime.replace('T', ' ')}
              {item.timeOffsetMinutes ? ` (base ${item.baseTime.replace('T', ' ')}, offset ${item.timeOffsetMinutes} min)` : ''}
            </Text>
            <Text style={ui.note}>
              #{item.sequence} · {item.deviceName ?? item.deviceId}
              {item.meal ? ` · ${MEAL[item.meal] ?? 'Contexto ' + item.meal}` : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={ui.note}>Nada importado ainda.</Text>}
      />
    </View>
  );
}
