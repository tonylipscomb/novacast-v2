import type { OnboardingGuideKey } from './onboardingModel';
import type { WalkthroughStep } from './WalkthroughOverlay';

export type OnboardingGuideConfig = {
  key: OnboardingGuideKey;
  title: string;
  steps: WalkthroughStep[];
};

export const ONBOARDING_GUIDES: Record<
  'pairing' | 'hub' | 'liveTv' | 'movies' | 'series' | 'guide' | 'settings',
  OnboardingGuideConfig
> = {
  pairing: {
    key: 'pairingGuideSeen',
    title: 'Connect a Provider',
    steps: [
      {
        icon: 'qrcode-scan',
        title: 'Scan the QR code',
        body: 'Use your phone camera to scan the pairing code shown on the TV.',
      },
      {
        icon: 'web',
        title: 'Finish on your phone',
        body: 'Open novacast.tv/connect, enter the code, and confirm the provider connection.',
      },
      {
        icon: 'shield-check-outline',
        title: 'Back to the TV',
        body: 'Once pairing completes, NovaCast returns you to Home automatically.',
      },
    ],
  },
  hub: {
    key: 'hubGuideSeen',
    title: 'Welcome to NovaCast',
    steps: [
      {
        icon: 'home-outline',
        title: 'Your Home dashboard',
        body: 'Continue watching, browse Live Now, and jump into Movies, Series, Live TV, and Guide from here.',
      },
      {
        icon: 'remote-tv',
        title: 'Use the remote',
        body: 'Move left and right through each row. Select opens playback or the full screen for that item.',
      },
      {
        icon: 'cog-outline',
        title: 'Settings and guides',
        body: 'Open Settings anytime to replay these tips, manage preferences, or reset pairing.',
      },
    ],
  },
  liveTv: {
    key: 'liveTvGuideSeen',
    title: 'Live TV Basics',
    steps: [
      {
        icon: 'television-play',
        title: 'Move through categories',
        body: 'Use the left rail to switch categories, then browse channels in the center list.',
      },
      {
        icon: 'play-circle-outline',
        title: 'Preview first',
        body: 'Select a channel once to preview it, then choose Watch Full Screen when you are ready.',
      },
      {
        icon: 'arrow-left',
        title: 'Back one layer at a time',
        body: 'Back leaves fullscreen, then the overlay, and finally returns to the Content Hub.',
      },
    ],
  },
  movies: {
    key: 'moviesGuideSeen',
    title: 'Movies Browsing',
    steps: [
      {
        icon: 'movie-open-outline',
        title: 'Pick a category',
        body: 'Choose a category on the left, then move through posters on the right.',
      },
      {
        icon: 'television-classic',
        title: 'Keep focus visible',
        body: 'Poster focus stays readable while scrolling so the current selection never disappears.',
      },
      {
        icon: 'arrow-left',
        title: 'Return to the same poster',
        body: 'Back from details restores the selected poster where you left it.',
      },
    ],
  },
  series: {
    key: 'seriesGuideSeen',
    title: 'Series Browsing',
    steps: [
      {
        icon: 'play-box-multiple-outline',
        title: 'Browse shows by row',
        body: 'Use the category rail first, then move through the series posters with the remote.',
      },
      {
        icon: 'television-classic',
        title: 'Stay on the current item',
        body: 'Focus and selection are preserved so it is easy to keep browsing after a detail view.',
      },
      {
        icon: 'arrow-left',
        title: 'Back to browsing',
        body: 'Back closes the current view before moving you out of the screen.',
      },
    ],
  },
  guide: {
    key: 'guideScreenGuideSeen',
    title: 'Guide Navigation',
    steps: [
      {
        icon: 'calendar-clock-outline',
        title: 'Move focus, do not tune',
        body: 'Directional navigation only changes focus. Select is what tunes the highlighted program.',
      },
      {
        icon: 'clock-outline',
        title: 'Follow the time window',
        body: 'The channel column stays visible while you move across the program grid.',
      },
      {
        icon: 'arrow-left',
        title: 'Return from playback cleanly',
        body: 'Back restores the previous guide position instead of starting over.',
      },
    ],
  },
  settings: {
    key: 'settingsGuideSeen',
    title: 'Settings',
    steps: [
      {
        icon: 'cog-outline',
        title: 'TV-first controls',
        body: 'Keep the screen simple, readable, and easy to operate with the remote.',
      },
      {
        icon: 'reload',
        title: 'Replay any walkthrough',
        body: 'Use settings to replay the onboarding cards if you want a quick refresher.',
      },
      {
        icon: 'shield-outline',
        title: 'Reset onboarding',
        body: 'You can restore the first-run guides whenever you need them again.',
      },
    ],
  },
};
