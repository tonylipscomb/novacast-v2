import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaPulseItem } from './novaPulseTypes';
import { formatNovaPulseCountdown, formatNovaPulseEventTime, formatNovaPulseResultSummary, formatNovaPulseStage, formatNovaPulseTeamLabel, getNovaPulseTeamInitials, getNovaPulseWinner } from './novaPulseLogic';

export function NovaPulseSportsCard({ item }: { item: NovaPulseItem }) {
  const { theme } = useAppTheme();
  const sports = item.sports;
  const isFinal = item.subtype === 'final' || sports?.eventStatus === 'FINAL';
  const isLive = item.subtype === 'live' || sports?.eventStatus === 'LIVE';
  const isFight = sports?.format === 'fight';
  const styles = createStyles(theme);
  const firstCompetitor = isFight ? sports?.competitorA : sports?.awayName;
  const secondCompetitor = isFight ? sports?.competitorB : sports?.homeName;
  const firstDisplayName = isFight ? firstCompetitor : formatNovaPulseTeamLabel(firstCompetitor);
  const secondDisplayName = isFight ? secondCompetitor : formatNovaPulseTeamLabel(secondCompetitor);
  const winner = isFinal ? getNovaPulseWinner(sports) : null;
  const firstScore = sports?.finalScoreA ?? sports?.awayScore;
  const secondScore = sports?.finalScoreB ?? sports?.homeScore;
  const eventTime = formatNovaPulseEventTime(isFinal ? sports?.completedAt ?? item.startsAt : item.startsAt);
  const stage = formatNovaPulseStage(sports?.eventStage);
  const footer = [eventTime, sports?.venue].filter(Boolean).join(' • ');

  return (
    <View style={styles.wrap}>
      {stage || isLive ? <View style={styles.contextRow}><Text style={styles.context}>{isLive ? 'LIVE NOW' : stage}</Text>{isLive && sports?.periodDetail ? <Text style={styles.contextDetail}>{sports.periodDetail}</Text> : null}</View> : null}
      <View style={styles.matchup}>
        <View style={[styles.competitor, winner === firstCompetitor ? styles.winnerCompetitor : null]}>
          <View style={[styles.identity, winner === firstCompetitor ? styles.winnerIdentity : null]}><Text style={styles.identityText}>{getNovaPulseTeamInitials(firstCompetitor)}</Text></View>
          <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.teamName, winner === firstCompetitor ? styles.winnerText : null]}>{firstDisplayName ?? 'Competitor A'}</Text>
          {isLive || isFinal ? (!isFight ? <Text style={styles.teamScore}>{firstScore ?? '—'}</Text> : null) : null}
        </View>
        <View style={styles.centerColumn}>
          <Text style={[styles.vs, isLive ? styles.liveVs : null]}>{isFinal ? 'FINAL' : isLive ? 'LIVE' : 'VS'}</Text>
        </View>
        <View style={[styles.competitor, styles.competitorRight, winner === secondCompetitor ? styles.winnerCompetitor : null]}>
          <View style={[styles.identity, winner === secondCompetitor ? styles.winnerIdentity : null]}><Text style={styles.identityText}>{getNovaPulseTeamInitials(secondCompetitor)}</Text></View>
          <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.teamName, styles.teamNameRight, winner === secondCompetitor ? styles.winnerText : null]}>{secondDisplayName ?? 'Competitor B'}</Text>
          {isLive || isFinal ? (!isFight ? <Text style={[styles.teamScore, styles.teamScoreRight]}>{secondScore ?? '—'}</Text> : null) : null}
        </View>
      </View>
      {isFinal && isFight ? <View style={styles.fightResult}><Text style={styles.resultLabel}>{winner ? 'WINNER' : sports?.isNoContest ? 'NO CONTEST' : sports?.isDraw ? 'DRAW' : 'RESULT'}</Text><Text numberOfLines={2} style={styles.resultText}>{winner ?? formatNovaPulseResultSummary(sports)}</Text></View> : null}
      {isFinal && !isFight ? <Text numberOfLines={1} style={styles.summary}>{formatNovaPulseResultSummary(sports)}</Text> : null}
      <View style={styles.footer}><Text numberOfLines={1} ellipsizeMode="tail" style={styles.footerText}>{isLive ? footer || 'Live event' : isFinal ? [sports?.wentOvertime ? 'OVERTIME' : null, sports?.shootout ? 'SHOOTOUT' : null, footer].filter(Boolean).join(' • ') || 'Final result' : footer || 'Date TBD'}</Text>{!isFinal && !isLive ? <Text numberOfLines={1} style={styles.countdown}>{formatNovaPulseCountdown(item.startsAt)}</Text> : null}</View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    wrap: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(180, 190, 255, 0.16)' },
    contextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
    context: { color: theme.colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
    contextDetail: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800' },
    matchup: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 58 },
    competitor: { width: '42%', flexGrow: 0, flexShrink: 1, alignItems: 'center', gap: 3, minWidth: 0 },
    competitorRight: { alignItems: 'center' },
    identity: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(170, 160, 255, 0.34)', backgroundColor: 'rgba(97, 65, 220, 0.28)' },
    winnerIdentity: { borderColor: theme.colors.accent, backgroundColor: 'rgba(118, 87, 255, 0.48)' },
    identityText: { color: theme.colors.textPrimary, fontSize: 11, fontWeight: '900' },
    teamName: { width: '100%', color: theme.colors.textSecondary, fontSize: 13, lineHeight: 15, fontWeight: '800', textAlign: 'center' },
    teamNameRight: { textAlign: 'center' },
    winnerCompetitor: { opacity: 1 },
    winnerText: { color: theme.colors.textPrimary, fontWeight: '900' },
    centerColumn: { width: '16%', flexGrow: 0, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
    vs: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
    liveVs: { color: '#ffbe73' },
    teamScore: { color: theme.colors.textPrimary, fontSize: 17, lineHeight: 19, fontWeight: '900' },
    teamScoreRight: { textAlign: 'center' },
    fightResult: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
    resultLabel: { color: theme.colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    resultText: { flex: 1, color: theme.colors.textPrimary, fontSize: 13, fontWeight: '800' },
    summary: { marginTop: 3, color: theme.colors.textPrimary, fontSize: 12, lineHeight: 15, fontWeight: '800' },
    footer: { marginTop: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
    footerText: { flex: 1, minWidth: 0, color: theme.colors.textMuted, fontSize: 10, lineHeight: 12, fontWeight: '700' },
    countdown: { flexShrink: 0, maxWidth: '43%', color: theme.colors.accent, fontSize: 10, lineHeight: 12, fontWeight: '800', textAlign: 'right' },
  });
}
