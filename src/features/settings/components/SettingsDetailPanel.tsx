import { useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import Constants from 'expo-constants';
import { findNodeHandle, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { NovaLogo } from '@/components/nova';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import {
  APPEARANCE_THEMES,
  type AppearanceThemeId,
} from '@/theme/variants';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import {
  appearanceThemeLabel,
  parentalRatingLabel,
  playbackQualityLabel,
  type AppSettings,
  type ParentalRating,
  type PlaybackAudio,
  type PlaybackQuality,
} from '../appSettingsStore';
import type { SettingsSectionId } from './SettingsRail';

type ProviderAccountInfo = {
  providerName: string;
  providerStatus: string;
  expirationLabel: string;
  connectionType: string;
  username: string;
  initialized: boolean;
  movieCount: number;
  seriesCount: number;
  liveChannelCount: number;
  lastSyncLabel: string;
};

type SettingsDetailPanelProps = {
  sectionId: SettingsSectionId;
  settings: AppSettings;
  pinConfigured: boolean;
  hideSmartCategories: boolean;
  account: ProviderAccountInfo;
  onAppearanceTheme: (theme: AppearanceThemeId) => void;
  onPlaybackQuality: (value: PlaybackQuality) => void;
  onPlaybackAudio: (value: PlaybackAudio) => void;
  onAutoplayNextEpisode: (value: boolean) => void;
  onResumePlayback: (value: boolean) => void;
  onParentalEnabled: (value: boolean) => void;
  onParentalMaxRating: (value: ParentalRating) => void;
  onSavePin: (pin: string) => Promise<void>;
  onClearPin: () => Promise<void>;
  onToggleSmartCategories: () => void;
  onReplayGuides: () => void;
  onSuppressGuides: () => void;
  onFocusHandleReady?: (handle: number | undefined) => void;
  nextFocusLeftHandle?: number;
};

const QUALITY_OPTIONS: PlaybackQuality[] = ['auto', '1080p', '720p'];
const AUDIO_OPTIONS: PlaybackAudio[] = ['stereo', 'surround'];
const RATING_OPTIONS: ParentalRating[] = ['off', 'pg', 'pg13', 'r'];
const PIN_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export function SettingsDetailPanel({
  sectionId,
  settings,
  pinConfigured,
  hideSmartCategories,
  account,
  onAppearanceTheme,
  onPlaybackQuality,
  onPlaybackAudio,
  onAutoplayNextEpisode,
  onResumePlayback,
  onParentalEnabled,
  onParentalMaxRating,
  onSavePin,
  onClearPin,
  onToggleSmartCategories,
  onReplayGuides,
  onSuppressGuides,
  onFocusHandleReady,
  nextFocusLeftHandle,
}: SettingsDetailPanelProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirmDraft, setPinConfirmDraft] = useState('');
  const [pinStep, setPinStep] = useState<'idle' | 'enter' | 'confirm'>('idle');
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const firstControlAssignedRef = useRef(false);
  const trackedSectionRef = useRef(sectionId);
  const firstControlNodeRef = useRef<ElementRef<typeof Pressable> | null>(null);

  // Reset before children mount so the first control of the new section can bind.
  if (trackedSectionRef.current !== sectionId) {
    trackedSectionRef.current = sectionId;
    firstControlAssignedRef.current = false;
    firstControlNodeRef.current = null;
  }

  // Account is read-only — never hand focus into the detail pane.
  useEffect(() => {
    if (sectionId === 'account') {
      onFocusHandleReady?.(undefined);
    }
  }, [sectionId, onFocusHandleReady]);

  // Publish the first real control handle after layout so Right from the rail is reliable.
  useEffect(() => {
    if (sectionId === 'account') {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const node = firstControlNodeRef.current;
      if (!node) {
        return;
      }
      onFocusHandleReady?.(findNodeHandle(node) ?? undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [sectionId, onFocusHandleReady]);

  const bindFirstControlRef = (instance: ElementRef<typeof Pressable> | null) => {
    if (sectionId === 'account') {
      return;
    }
    firstControlNodeRef.current = instance;
    if (!instance || firstControlAssignedRef.current) {
      return;
    }
    firstControlAssignedRef.current = true;
    requestAnimationFrame(() => {
      onFocusHandleReady?.(findNodeHandle(instance) ?? undefined);
    });
  };

  const leftFocusProps = nextFocusLeftHandle != null ? { nextFocusLeft: nextFocusLeftHandle } : null;

  const appendPinDigit = (digit: string) => {
    setPinMessage(null);
    if (pinStep === 'enter') {
      setPinDraft((current) => (current.length >= 4 ? current : `${current}${digit}`));
      return;
    }
    if (pinStep === 'confirm') {
      setPinConfirmDraft((current) => (current.length >= 4 ? current : `${current}${digit}`));
    }
  };

  const startPinSetup = () => {
    setPinDraft('');
    setPinConfirmDraft('');
    setPinMessage(null);
    setPinStep('enter');
  };

  const submitPinStep = async () => {
    if (pinStep === 'enter') {
      if (pinDraft.length !== 4) {
        setPinMessage('Enter a 4-digit PIN.');
        return;
      }
      setPinStep('confirm');
      setPinConfirmDraft('');
      return;
    }

    if (pinConfirmDraft !== pinDraft) {
      setPinMessage('PINs do not match. Try again.');
      setPinStep('enter');
      setPinDraft('');
      setPinConfirmDraft('');
      return;
    }

    await onSavePin(pinDraft);
    setPinStep('idle');
    setPinDraft('');
    setPinConfirmDraft('');
    setPinMessage('PIN saved.');
  };

  const renderToggle = (id: string, label: string, copy: string, value: boolean, onToggle: () => void, isFirst = false) => (
    <Pressable
      key={id}
      ref={isFirst ? bindFirstControlRef : undefined}
      focusable
      {...leftFocusProps}
      onFocus={() => setFocusedControl(id)}
      onBlur={() => setFocusedControl((current) => (current === id ? null : current))}
      onPress={onToggle}
      style={[styles.toggleRow, novaTvFocus.base, focusedControl === id && styles.rowFocused]}>
      <View style={styles.toggleCopy}>
        <Text style={[styles.rowTitle, focusedControl === id && styles.rowTitleFocused]}>{label}</Text>
        <Text style={[styles.rowMeta, focusedControl === id && styles.rowMetaFocused]}>{copy}</Text>
      </View>
      <MaterialCommunityIcons
        name={value ? 'toggle-switch' : 'toggle-switch-off-outline'}
        size={28}
        color={value ? theme.colors.accentHover : theme.colors.textMuted}
      />
    </Pressable>
  );

  const renderCycleRow = <T extends string>(
    id: string,
    label: string,
    copy: string,
    options: T[],
    value: T,
    formatter: (option: T) => string,
    onSelect: (option: T) => void,
    isFirst = false,
  ) => {
    const index = Math.max(0, options.indexOf(value));
    const cycle = () => onSelect(options[(index + 1) % options.length]);
    return (
      <Pressable
        key={id}
        ref={isFirst ? bindFirstControlRef : undefined}
        focusable
        {...leftFocusProps}
        onFocus={() => setFocusedControl(id)}
        onBlur={() => setFocusedControl((current) => (current === id ? null : current))}
        onPress={cycle}
        style={[styles.toggleRow, novaTvFocus.base, focusedControl === id && styles.rowFocused]}>
        <View style={styles.toggleCopy}>
          <Text style={[styles.rowTitle, focusedControl === id && styles.rowTitleFocused]}>{label}</Text>
          <Text style={[styles.rowMeta, focusedControl === id && styles.rowMetaFocused]}>{copy}</Text>
        </View>
        <View style={styles.cycleValue}>
          <Text style={[styles.cycleValueText, focusedControl === id && styles.rowTitleFocused]}>{formatter(value)}</Text>
          <MaterialCommunityIcons
            name="swap-horizontal"
            size={18}
            color={focusedControl === id ? theme.colors.accentHover : theme.colors.textMuted}
          />
        </View>
      </Pressable>
    );
  };

  const renderChoiceRow = <T extends string>(
    groupId: string,
    label: string,
    options: T[],
    value: T,
    formatter: (option: T) => string,
    onSelect: (option: T) => void,
    bindFirstOption = false,
  ) => (
    <View style={styles.block}>
      <Text style={styles.blockLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((option, optionIndex) => {
          const id = `${groupId}-${option}`;
          const selected = option === value;
          return (
            <Pressable
              key={option}
              ref={bindFirstOption && optionIndex === 0 ? bindFirstControlRef : undefined}
              focusable
              {...leftFocusProps}
              onFocus={() => setFocusedControl(id)}
              onBlur={() => setFocusedControl((current) => (current === id ? null : current))}
              onPress={() => onSelect(option)}
              style={[
                styles.choiceChip,
                selected && styles.choiceChipSelected,
                novaTvFocus.base,
                focusedControl === id && styles.choiceChipFocused,
              ]}>
              <Text
                style={[
                  styles.choiceChipText,
                  selected && styles.choiceChipTextSelected,
                  focusedControl === id && styles.choiceChipTextFocused,
                ]}>
                {formatter(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderAccount = () => (
    <View style={styles.section} pointerEvents="none">
      <Text style={styles.sectionTitle}>Account</Text>
      <Text style={styles.sectionCopy}>Provider connection and library snapshot.</Text>
      <View style={styles.infoGrid}>
        <InfoCell label="Provider" value={account.providerName} styles={styles} />
        <InfoCell label="Status" value={account.providerStatus} styles={styles} />
        <InfoCell label="Expires" value={account.expirationLabel} styles={styles} />
        <InfoCell label="Connection" value={account.connectionType} styles={styles} />
        <InfoCell label="Username" value={account.username} styles={styles} />
        <InfoCell label="Last sync" value={account.lastSyncLabel} styles={styles} />
      </View>
      <View style={styles.statRow}>
        <StatChip label="Movies" value={account.movieCount} styles={styles} />
        <StatChip label="Series" value={account.seriesCount} styles={styles} />
        <StatChip label="Channels" value={account.liveChannelCount} styles={styles} />
      </View>
    </View>
  );

  const renderPlayback = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Playback</Text>
      <Text style={styles.sectionCopy}>
        Press OK to change a value. These save on the device — the player does not apply them yet.
      </Text>
      {renderCycleRow(
        'quality',
        'Stream quality',
        'Preferred max quality when the stream offers options',
        QUALITY_OPTIONS,
        settings.playbackQuality,
        playbackQualityLabel,
        onPlaybackQuality,
        true,
      )}
      {renderCycleRow(
        'audio',
        'Audio output',
        'Preferred track when surround and stereo are both available',
        AUDIO_OPTIONS,
        settings.playbackAudio,
        (value) => (value === 'surround' ? 'Surround' : 'Stereo'),
        onPlaybackAudio,
      )}
      {renderToggle(
        'autoplay',
        'Autoplay next episode',
        'Start the next episode when one ends',
        settings.autoplayNextEpisode,
        () => onAutoplayNextEpisode(!settings.autoplayNextEpisode),
      )}
      {renderToggle(
        'resume',
        'Resume where left off',
        'Offer continue-watching from the last position',
        settings.resumePlayback,
        () => onResumePlayback(!settings.resumePlayback),
      )}
    </View>
  );

  const renderAppearance = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Appearance</Text>
      <Text style={styles.sectionCopy}>Choose a visual theme for NovaCast.</Text>
      <View style={styles.themeGrid}>
        {APPEARANCE_THEMES.map((item, index) => {
          const id = `theme-${item.id}`;
          const selected = settings.appearanceTheme === item.id;
          return (
            <Pressable
              key={item.id}
              ref={index === 0 ? bindFirstControlRef : undefined}
              focusable
              {...leftFocusProps}
              onFocus={() => setFocusedControl(id)}
              onBlur={() => setFocusedControl((current) => (current === id ? null : current))}
              onPress={() => onAppearanceTheme(item.id)}
              style={[
                styles.themeCard,
                selected && styles.themeCardSelected,
                novaTvFocus.base,
                focusedControl === id && styles.themeCardFocused,
              ]}>
              <View style={styles.themeSwatches}>
                {item.swatch.map((color) => (
                  <View key={color} style={[styles.themeSwatch, { backgroundColor: color }]} />
                ))}
              </View>
              <Text style={[styles.themeTitle, focusedControl === id && styles.rowTitleFocused]}>{item.label}</Text>
              <Text style={[styles.themeCopy, focusedControl === id && styles.rowMetaFocused]}>{item.copy}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderParental = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Parental Controls</Text>
      <Text style={styles.sectionCopy}>Require a PIN before restricted content plays.</Text>
      {renderToggle(
        'parental-enabled',
        'Parental lock',
        pinConfigured ? 'PIN required for restricted content' : 'Set a PIN to enable parental lock',
        settings.parentalEnabled && pinConfigured,
        () => {
          if (!pinConfigured) {
            startPinSetup();
            return;
          }
          onParentalEnabled(!settings.parentalEnabled);
        },
        true,
      )}
      {renderChoiceRow('rating', 'Maximum rating', RATING_OPTIONS, settings.parentalMaxRating, parentalRatingLabel, onParentalMaxRating)}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>PIN setup</Text>
        <Text style={styles.rowMeta}>
          {pinConfigured ? 'PIN is configured' : 'No PIN configured yet'}
        </Text>
        {pinStep !== 'idle' ? (
          <View style={styles.pinPanel}>
            <Text style={styles.pinPrompt}>
              {pinStep === 'enter' ? 'Enter a 4-digit PIN' : 'Confirm your PIN'}
            </Text>
            <Text style={styles.pinDots}>
              {`${'•'.repeat(pinStep === 'enter' ? pinDraft.length : pinConfirmDraft.length)}${'○'.repeat(4 - (pinStep === 'enter' ? pinDraft.length : pinConfirmDraft.length))}`}
            </Text>
            <View style={styles.pinPad}>
              {PIN_DIGITS.map((digit) => {
                const id = `pin-${digit}`;
                return (
                  <Pressable
                    key={digit}
                    focusable
                    {...leftFocusProps}
                    onFocus={() => setFocusedControl(id)}
                    onBlur={() => setFocusedControl((current) => (current === id ? null : current))}
                    onPress={() => appendPinDigit(digit)}
                    style={[styles.pinKey, novaTvFocus.base, focusedControl === id && styles.rowFocused]}>
                    <Text style={styles.pinKeyText}>{digit}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.pinActions}>
              <Pressable
                focusable
                {...leftFocusProps}
                onPress={() => {
                  setPinStep('idle');
                  setPinDraft('');
                  setPinConfirmDraft('');
                }}
                style={[styles.inlineButton, novaTvFocus.base]}>
                <Text style={styles.inlineButtonText}>Cancel</Text>
              </Pressable>
              <Pressable focusable {...leftFocusProps} onPress={() => void submitPinStep()} style={[styles.inlineButtonPrimary, novaTvFocus.base]}>
                <Text style={styles.inlineButtonPrimaryText}>{pinStep === 'enter' ? 'Continue' : 'Save PIN'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.pinActions}>
            <Pressable focusable {...leftFocusProps} onPress={startPinSetup} style={[styles.inlineButtonPrimary, novaTvFocus.base]}>
              <Text style={styles.inlineButtonPrimaryText}>{pinConfigured ? 'Change PIN' : 'Set PIN'}</Text>
            </Pressable>
            {pinConfigured ? (
              <Pressable
                focusable
                {...leftFocusProps}
                onPress={() => void onClearPin()}
                style={[styles.inlineButton, novaTvFocus.base]}>
                <Text style={styles.inlineButtonText}>Remove PIN</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        {pinMessage ? <Text style={styles.pinMessage}>{pinMessage}</Text> : null}
      </View>
    </View>
  );

  const renderSmartCategories = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Smart Categories</Text>
      <Text style={styles.sectionCopy}>Discover collections like Features and New Releases.</Text>
      {renderToggle(
        'smart-categories',
        'Show Discover collections',
        hideSmartCategories ? 'Discover rails are hidden in Movies and Series' : 'Discover rails are visible in Movies and Series',
        !hideSmartCategories,
        onToggleSmartCategories,
        true,
      )}
    </View>
  );

  const renderAbout = () => (
    <View style={styles.aboutSection}>
      <Text style={styles.sectionTitle}>About</Text>

      <View style={styles.aboutHeader}>
        <NovaLogo variant="mark" size="md" />
        <View style={styles.aboutHeaderCopy}>
          <Text style={styles.aboutTitle}>NovaCast TV</Text>
          <Text style={styles.aboutCopy}>Entertainment. Anytime. Anywhere.</Text>
        </View>
      </View>

      <View style={styles.aboutMetaRow}>
        <Text style={styles.aboutMetaItem}>
          <Text style={styles.aboutMetaLabel}>Version </Text>
          {version}
        </Text>
        <Text style={styles.aboutMetaDot}>·</Text>
        <Text style={styles.aboutMetaItem}>
          <Text style={styles.aboutMetaLabel}>Build </Text>
          V2 Preview
        </Text>
        <Text style={styles.aboutMetaDot}>·</Text>
        <Text style={styles.aboutMetaItem}>
          <Text style={styles.aboutMetaLabel}>Theme </Text>
          {appearanceThemeLabel(settings.appearanceTheme)}
        </Text>
      </View>

      <View style={styles.aboutActions}>
        <Pressable
          ref={bindFirstControlRef}
          focusable
          {...leftFocusProps}
          onFocus={() => setFocusedControl('replay-guides')}
          onBlur={() => setFocusedControl((current) => (current === 'replay-guides' ? null : current))}
          onPress={onReplayGuides}
          style={[styles.inlineButton, novaTvFocus.base, focusedControl === 'replay-guides' && styles.rowFocused]}>
          <MaterialCommunityIcons
            name="reload"
            size={16}
            color={focusedControl === 'replay-guides' ? theme.colors.accentHover : theme.colors.textPrimary}
          />
          <Text style={[styles.inlineButtonText, focusedControl === 'replay-guides' && styles.rowTitleFocused]}>
            Replay guides
          </Text>
        </Pressable>
        <Pressable
          focusable
          {...leftFocusProps}
          onFocus={() => setFocusedControl('suppress-guides')}
          onBlur={() => setFocusedControl((current) => (current === 'suppress-guides' ? null : current))}
          onPress={onSuppressGuides}
          style={[styles.inlineButton, novaTvFocus.base, focusedControl === 'suppress-guides' && styles.rowFocused]}>
          <MaterialCommunityIcons
            name="shield-off-outline"
            size={16}
            color={focusedControl === 'suppress-guides' ? theme.colors.accentHover : theme.colors.textPrimary}
          />
          <Text style={[styles.inlineButtonText, focusedControl === 'suppress-guides' && styles.rowTitleFocused]}>
            Disable guides
          </Text>
        </Pressable>
      </View>
    </View>
  );

  const content =
    sectionId === 'account'
      ? renderAccount()
      : sectionId === 'playback'
        ? renderPlayback()
        : sectionId === 'appearance'
          ? renderAppearance()
          : sectionId === 'parental'
            ? renderParental()
            : sectionId === 'smart-categories'
              ? renderSmartCategories()
              : renderAbout();

  return (
    <View style={styles.panel}>
      <ScrollView
        key={sectionId}
        focusable={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
    </View>
  );
}

function InfoCell({
  label,
  value,
  styles,
  accent,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  accent?: string;
}) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, accent ? { color: accent } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function StatChip({
  label,
  value,
  styles,
}: {
  label: string;
  value: number;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    panel: {
      flex: 1,
      minWidth: 0,
      borderTopWidth: 1,
      borderTopColor: theme.colors.borderSubtle,
      paddingTop: 10,
    },
    scrollContent: {
      paddingBottom: 24,
      paddingRight: 8,
    },
    section: {
      gap: 10,
    },
    sectionTitle: {
      color: theme.colors.textPrimary,
      fontSize: 22,
      fontWeight: '900',
    },
    sectionCopy: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    block: {
      marginTop: 8,
      gap: 8,
    },
    blockLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    infoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 4,
    },
    infoCell: {
      width: '48%',
      minWidth: 220,
      gap: 3,
    },
    infoLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    infoValue: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    statRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 6,
    },
    statChip: {
      minWidth: 96,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: theme.colors.backgroundRaised,
      gap: 2,
    },
    statValue: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '900',
    },
    statLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    choiceRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    choiceChip: {
      minHeight: 34,
      paddingHorizontal: 4,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      backgroundColor: 'transparent',
    },
    choiceChipSelected: {
      borderBottomColor: theme.colors.success,
      backgroundColor: 'transparent',
    },
    choiceChipFocused: {
      borderBottomColor: theme.scheme === 'light' ? theme.colors.focusRing : theme.colors.accentHover,
      backgroundColor: 'transparent',
    },
    choiceChipText: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '800',
    },
    choiceChipTextSelected: {
      color: theme.colors.accentHover,
    },
    choiceChipTextFocused: {
      color: theme.scheme === 'light' ? theme.colors.accent : theme.colors.accentHover,
      ...(theme.scheme === 'light'
        ? {}
        : {
            textShadowColor: theme.colors.accentHover,
            textShadowRadius: 10,
            textShadowOffset: { width: 0, height: 0 },
          }),
    },
    toggleRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
    },
    toggleCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    rowTitle: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    rowTitleFocused: {
      color: theme.scheme === 'light' ? theme.colors.accent : theme.colors.accentHover,
      ...(theme.scheme === 'light'
        ? {}
        : {
            textShadowColor: theme.colors.accentHover,
            textShadowRadius: 10,
            textShadowOffset: { width: 0, height: 0 },
          }),
    },
    rowMeta: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    rowMetaFocused: {
      color: theme.scheme === 'light' ? theme.colors.accentHover : theme.colors.textSecondary,
    },
    rowFocused: {
      borderBottomColor: theme.scheme === 'light' ? theme.colors.focusRing : theme.colors.accentHover,
      backgroundColor: 'transparent',
    },
    cycleValue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cycleValueText: {
      color: theme.colors.accentHover,
      fontSize: 13,
      fontWeight: '800',
      textTransform: 'capitalize',
    },
    themeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    themeCard: {
      width: 210,
      minHeight: 108,
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      gap: 6,
    },
    themeCardSelected: {
      borderBottomColor: theme.colors.success,
      backgroundColor: 'transparent',
    },
    themeCardFocused: {
      borderBottomColor: theme.scheme === 'light' ? theme.colors.focusRing : theme.colors.accentHover,
      backgroundColor: 'transparent',
    },
    themeSwatches: {
      flexDirection: 'row',
      gap: 6,
    },
    themeSwatch: {
      width: 22,
      height: 22,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
    },
    themeTitle: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '900',
    },
    themeCopy: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
    },
    pinPanel: {
      marginTop: 4,
      gap: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: theme.colors.backgroundRaised,
    },
    pinPrompt: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
    pinDots: {
      color: theme.colors.accentHover,
      fontSize: 24,
      letterSpacing: 8,
      fontWeight: '900',
    },
    pinPad: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      maxWidth: 220,
    },
    pinKey: {
      width: 52,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
    },
    pinKeyText: {
      color: theme.colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
    },
    pinActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 4,
    },
    inlineActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    inlineButton: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 4,
      paddingVertical: 6,
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      backgroundColor: 'transparent',
    },
    inlineButtonText: {
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    inlineButtonPrimary: {
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
      paddingVertical: 6,
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.accentHover,
      backgroundColor: 'transparent',
    },
    inlineButtonPrimaryText: {
      color: theme.colors.accentHover,
      fontSize: 12,
      fontWeight: '900',
    },
    pinMessage: {
      color: theme.colors.accentHover,
      fontSize: 12,
      fontWeight: '700',
    },
    aboutSection: {
      gap: 12,
    },
    aboutHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    aboutHeaderCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    aboutTitle: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '900',
    },
    aboutCopy: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    aboutMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
    },
    aboutMetaItem: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    aboutMetaLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    aboutMetaDot: {
      color: theme.colors.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    aboutActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 16,
      marginTop: 2,
    },
  });
}
