import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, View } from 'react-native';
import { searchDestinations, type Destination } from '../lib/destinations';
import { C, HIT } from '../theme';
import { Icon } from './Icon';
import { Field, Txt } from './ui';

/**
 * "Şehir" alanı: yazdıkça şehir ve ülke önerir (Türkçe/İngilizce adlar, çevrimdışı). Listede olmayan bir yer
 * de elle yazılabilir; öneri seçmek zorunlu değildir.
 */
export function DestinationField({ value, onChange, testID = 'list-city' }: {
  value: string; onChange: (v: string) => void; testID?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const results = useMemo(
    () => (focused && value.trim() && value !== picked ? searchDestinations(value, 6) : []),
    [focused, value, picked],
  );

  function pick(d: Destination) {
    setPicked(d.name);
    onChange(d.name);
    setFocused(false);
    Keyboard.dismiss();
  }

  return (
    <View style={{ gap: 6, zIndex: 10 }}>
      <Field
        label="Şehir"
        value={value}
        onChangeText={(t) => { setPicked(null); onChange(t); }}
        onFocus={() => { if (blur.current) clearTimeout(blur.current); setFocused(true); }}
        onBlur={() => { blur.current = setTimeout(() => setFocused(false), 250); }}
        placeholder="Şehir ya da ülke ara: örn. Roma, London"
        autoCorrect={false}
        testID={testID}
      />
      {results.length ? (
        <View testID="city-suggest" accessibilityRole="list" style={{ backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
          {results.map((d, i) => (
            <Pressable
              key={`${d.kind}:${d.countryCode}:${d.name}:${i}`}
              testID="city-suggest-item"
              accessibilityRole="button"
              accessibilityLabel={`${d.name}, ${d.detail}`}
              onPress={() => pick(d)}
              style={({ pressed }) => ({
                minHeight: HIT + 8, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8,
                backgroundColor: pressed ? C.greenCard : C.white, borderTopWidth: i ? 1 : 0, borderTopColor: C.border,
              })}
            >
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.greenCard, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={d.kind === 'country' ? 'compass' : 'pin'} size={17} color={C.greenDark} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt weight="bold" size={15} numberOfLines={1} testID="city-suggest-name">{d.name}</Txt>
                <Txt size={12} color={C.secondary} numberOfLines={1} testID="city-suggest-detail">{d.detail}</Txt>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
