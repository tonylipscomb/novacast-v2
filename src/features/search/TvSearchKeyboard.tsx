import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', "'"],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-', '.', '/'],
] as const;

type TvSearchKeyboardProps = {
  onType: (char: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSpace: () => void;
};

function Key({
  label,
  wide,
  onPress,
}: {
  label: string;
  wide?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      {...({ onClick: onPress } as object)}
      style={[styles.key, wide && styles.keyWide, novaTvFocus.base, focused && novaTvFocus.active]}>
      <Text style={[styles.keyLabel, focused && styles.keyLabelFocused]}>{label}</Text>
    </Pressable>
  );
}

export function TvSearchKeyboard({ onType, onBackspace, onClear, onSpace }: TvSearchKeyboardProps) {
  const append = useCallback(
    (char: string) => {
      onType(char);
    },
    [onType],
  );

  return (
    <View style={styles.root}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((char) => (
            <Key key={char} label={char} onPress={() => append(char.toLowerCase())} />
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <Key label="Space" wide onPress={onSpace} />
        <Key label="Delete" wide onPress={onBackspace} />
        <Key label="Clear" wide onPress={onClear} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 4,
    paddingTop: 4,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  key: {
    minWidth: 42,
    minHeight: 34,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: 'rgba(18,24,34,0.88)',
  },
  keyWide: {
    minWidth: 88,
    paddingHorizontal: 12,
  },
  keyLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  keyLabelFocused: {
    color: '#FFFFFF',
  },
});
