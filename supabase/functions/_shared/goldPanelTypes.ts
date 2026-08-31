export type GoldAccountCredentials = {
  type: 'xtream';
  baseUrl: string;
  username: string;
  password: string;
  upstreamUrl: string;
  output?: string | null;
};

export type GoldPackage = { id: string; name: string };
export type GoldPackagesResult = { packages: GoldPackage[]; emptyReason?: 'no_custom_bouquets' };

export type GoldAccountInfo = {
  goldUserId: string | null;
  username: string | null;
  expire: string | null;
  country: string | null;
  notes: string | null;
  upstreamUrl: string | null;
  enabled: boolean | null;
};

export type GoldReseller = { username: string | null; credits: number | null; enabled: boolean | null };

export type GoldRouteHealth = {
  reachable: boolean;
  status: number | null;
  latencyMs: number;
  responseSummary: string;
  checkedAt: string;
};

export type GoldRecovery = { recoveryReference: string; goldUserId: string };
