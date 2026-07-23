import { buildCategoryRegionalProfile } from '@/features/providers/categoryRegionalPipeline';
import type { CategoryRegionGroup } from '@/features/providers/categoryRegionalConfig';
import { deviceFeatureFlags } from '@/features/device/deviceFeatureFlags';
import { getDeviceState } from '@/features/device/deviceActivation';

export type ContentPolicyId = 'us_only' | 'unrestricted';

export type ContentPolicyDecision = {
  allowed: boolean;
  reason: string;
  regionGroup: CategoryRegionGroup;
  policy: ContentPolicyId;
};

const ADULT_MARKERS =
  /\b(adult|xxx|porn|18\+|erotic|playboy|brazzers|onlyfans|sex\b|nude|nsfw)\b/i;

/**
 * Closed-beta US-only: hide named foreign packages and adult.
 * Unmarked Latin catalogs often resolve as `international` in the regional
 * pipeline — those stay visible. Explicit "English"/UK/CA/EU/foreign stay hidden.
 */
const BLOCKED_REGION_GROUPS = new Set<CategoryRegionGroup>([
  'uk',
  'canada',
  'australia',
  'europe',
  'intlEnglish',
  'mixed',
  'foreign',
]);

let activePolicyOverride: ContentPolicyId | null = null;

export function setContentPolicyOverride(policy: ContentPolicyId | null) {
  activePolicyOverride = policy;
}

export function getActiveContentPolicy(): ContentPolicyId {
  if (activePolicyOverride) {
    return activePolicyOverride;
  }

  const fromDevice = getDeviceState().status?.contentPolicy;
  if (fromDevice === 'us_only' || fromDevice === 'unrestricted') {
    return fromDevice;
  }

  if (deviceFeatureFlags.closedBetaMode || deviceFeatureFlags.managedBetaProviderEnabled) {
    return 'us_only';
  }

  return 'unrestricted';
}

/**
 * Central content gate for closed beta. Screens should ask this instead of
 * implementing independent country filters.
 */
export function canDisplayContent(input: {
  name: string;
  rawName?: string;
  countryCode?: string;
  contentType?: 'live' | 'movie' | 'series';
}): ContentPolicyDecision {
  const policy = getActiveContentPolicy();
  const profile = buildCategoryRegionalProfile({
    name: input.name,
    rawName: input.rawName,
    countryCode: input.countryCode,
    contentType: input.contentType,
  });

  if (policy === 'unrestricted') {
    return {
      allowed: true,
      reason: 'unrestricted',
      regionGroup: profile.regionGroup,
      policy,
    };
  }

  const label = `${input.rawName ?? ''} ${input.name}`.trim();
  if (ADULT_MARKERS.test(label)) {
    return {
      allowed: false,
      reason: 'adult_blocked',
      regionGroup: profile.regionGroup,
      policy,
    };
  }

  if (BLOCKED_REGION_GROUPS.has(profile.regionGroup)) {
    return {
      allowed: false,
      reason: `region_blocked:${profile.regionGroup}`,
      regionGroup: profile.regionGroup,
      policy,
    };
  }

  return {
    allowed: true,
    reason: 'us_policy_allow',
    regionGroup: profile.regionGroup,
    policy,
  };
}

export function filterContentByPolicy<T extends { name: string; rawName?: string; countryCode?: string }>(
  items: T[],
  contentType?: 'live' | 'movie' | 'series',
): T[] {
  return items.filter((item) =>
    canDisplayContent({
      name: item.name,
      rawName: item.rawName,
      countryCode: item.countryCode,
      contentType,
    }).allowed,
  );
}
