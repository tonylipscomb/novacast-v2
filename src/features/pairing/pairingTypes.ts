export type PairingConnectionPayload = {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
};

export type PendingPairingSession = {
  id: string;
  code: string;
  pairUrl: string;
  expiresAt: number;
  redemptionToken?: string;
  providerName?: string;
  redeemedPayload?: PairingConnectionPayload;
};

export type PairingSession = PendingPairingSession;

export type PairingPollResult =
  | { status: 'waiting' }
  | { status: 'validating' }
  | { status: 'expired' }
  | { status: 'completed'; redemptionToken: string; providerName: string };

export interface PairingService {
  restoreSession(): Promise<PairingSession | null>;
  resumeOrCreateSession(): Promise<PairingSession>;
  createSession(): Promise<PairingSession>;
  pollSession(sessionId: string, options?: { preserveOnExpired?: boolean }): Promise<PairingPollResult>;
  redeemSession(sessionId: string, redemptionToken: string): Promise<PairingConnectionPayload>;
  cancelSession(sessionId: string): Promise<void>;
  regenerateSession(sessionId: string): Promise<PairingSession>;
}
