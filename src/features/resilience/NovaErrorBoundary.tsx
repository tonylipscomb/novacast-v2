import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { novaTheme } from '@/theme';
import { recordSanitizedDiagnostic } from './sanitizedDiagnostics';

type RecoveryAction = {
  id: string;
  label: string;
  onPress: () => void;
  preferred?: boolean;
};

type NovaErrorBoundaryProps = {
  children: ReactNode;
  /** Logical region for diagnostics (root, playback, provider, search). */
  region: string;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onRetry?: () => void;
  showHomeAction?: boolean;
  showProviderAction?: boolean;
};

type NovaErrorBoundaryState = {
  hasError: boolean;
  errorName: string;
};

/**
 * TV-safe recovery UI for render failures.
 * Must not depend on the failed subtree.
 */
export class NovaErrorBoundary extends Component<NovaErrorBoundaryProps, NovaErrorBoundaryState> {
  state: NovaErrorBoundaryState = { hasError: false, errorName: 'Error' };

  static getDerivedStateFromError(error: Error): NovaErrorBoundaryState {
    return {
      hasError: true,
      errorName: error?.name || 'Error',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordSanitizedDiagnostic({
      operation: 'react_render',
      screen: this.props.region,
      errorType: error?.name || 'Error',
      detail: typeof info.componentStack === 'string' ? info.componentStack.slice(0, 240) : undefined,
      outcome: 'boundary_caught',
    });
  }

  private handleRetry = () => {
    this.props.onRetry?.();
    this.setState({ hasError: false, errorName: 'Error' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <NovaErrorRecoveryView
        region={this.props.region}
        title={this.props.fallbackTitle ?? 'Something went wrong'}
        message={
          this.props.fallbackMessage ??
          'NovaCast hit an unexpected problem on this screen. You can retry or return home.'
        }
        onRetry={this.handleRetry}
        showHomeAction={this.props.showHomeAction !== false}
        showProviderAction={this.props.showProviderAction === true}
      />
    );
  }
}

function NovaErrorRecoveryView({
  region,
  title,
  message,
  onRetry,
  showHomeAction,
  showProviderAction,
}: {
  region: string;
  title: string;
  message: string;
  onRetry: () => void;
  showHomeAction: boolean;
  showProviderAction: boolean;
}) {
  const router = useRouter();
  const actions: RecoveryAction[] = [
    { id: 'retry', label: 'Retry', onPress: onRetry, preferred: true },
  ];
  if (showHomeAction) {
    actions.push({
      id: 'home',
      label: 'Return Home',
      onPress: () => {
        try {
          router.replace('/main-menu');
        } catch {
          // Router may be unavailable during catastrophic failure.
        }
      },
    });
  }
  if (showProviderAction) {
    actions.push({
      id: 'provider',
      label: 'Open Provider Manager',
      onPress: () => {
        try {
          router.push('/content-hub');
        } catch {
          // Ignore navigation failure.
        }
      },
    });
  }

  return (
    <View style={styles.root} accessibilityLabel={`NovaCast recovery ${region}`}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        {actions.map((action, index) => (
          <Pressable
            key={action.id}
            focusable
            hasTVPreferredFocus={index === 0}
            onPress={action.onPress}
            style={[styles.button, index === 0 && styles.buttonFocused]}>
            <Text style={[styles.buttonText, index === 0 && styles.buttonTextPrimary]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: novaTheme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
    gap: 16,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: novaTheme.colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 640,
    lineHeight: 24,
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  button: {
    minWidth: 160,
    minHeight: 48,
    paddingHorizontal: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonFocused: {
    borderColor: 'rgba(131, 180, 255, 0.72)',
    backgroundColor: 'rgba(18, 36, 72, 0.42)',
  },
  buttonText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  buttonTextPrimary: {
    fontWeight: '800',
  },
});
