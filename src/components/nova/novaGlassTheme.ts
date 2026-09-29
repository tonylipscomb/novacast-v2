/** Shared NovaCast glass tokens for the navbar and passive status HUD. */
export const NOVA_GLASS = {
  active: {
    backgroundColor: 'rgba(80,60,180,0.24)',
    borderColor: 'rgba(190,175,255,0.42)',
    secondaryTint: 'rgba(35,120,220,0.12)',
    topHighlight: 'rgba(255,255,255,0.16)',
    lowerEdge: 'rgba(70,200,255,0.24)',
  },
  focused: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: 'rgba(170,190,255,0.30)',
    topHighlight: 'rgba(255,255,255,0.10)',
    lowerEdge: 'rgba(70,200,255,0.12)',
  },
  activeFocused: {
    backgroundColor: 'rgba(105,70,235,0.26)',
    borderColor: 'rgba(215,200,255,0.55)',
  },
  subtle: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(180,195,255,0.12)',
  },
  text: {
    primary: 'rgba(255,255,255,0.96)',
    secondary: 'rgba(245,245,250,0.88)',
    muted: 'rgba(255,255,255,0.68)',
  },
  radius: { base: 14, pill: 15, subtle: 12 },
} as const;

/** Shared visual focus tiers. These tokens describe paint only; they do not own focus. */
export const NOVA_FOCUS = {
  poster: {
    backgroundColor: 'rgba(75,45,170,0.12)',
    borderColor: 'rgba(215,200,255,0.82)',
    violetEdge: 'rgba(150,85,255,0.72)',
    cyanEdge: 'rgba(55,205,255,0.68)',
    innerHighlight: 'rgba(255,255,255,0.24)',
  },
  control: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: 'rgba(170,190,255,0.30)',
    topHighlight: 'rgba(255,255,255,0.10)',
    cyanEdge: 'rgba(70,205,255,0.18)',
  },
  active: {
    backgroundColor: 'rgba(80,60,180,0.24)',
    borderColor: 'rgba(190,175,255,0.42)',
    cyanEdge: 'rgba(70,200,255,0.24)',
  },
  activeFocused: {
    backgroundColor: 'rgba(105,70,235,0.30)',
    borderColor: 'rgba(215,200,255,0.55)',
    cyanEdge: 'rgba(70,205,255,0.28)',
  },
  action: {
    backgroundColor: 'rgba(100,70,220,0.33)',
    borderColor: 'rgba(225,210,255,0.60)',
    cyanEdge: 'rgba(75,215,255,0.30)',
  },
  category: {
    default: {
      backgroundColor: 'rgba(5,10,24,0.40)',
      borderColor: 'rgba(150,170,220,0.18)',
      textColor: 'rgba(235,238,255,0.82)',
    },
    active: {
      backgroundColor: 'rgba(55,70,150,0.14)',
      borderColor: 'rgba(125,215,225,0.50)',
      edgeColor: 'rgba(60,225,205,0.56)',
      innerHighlight: 'rgba(255,255,255,0.08)',
      textColor: 'rgba(245,248,255,0.96)',
    },
    focused: {
      backgroundColor: 'rgba(85,55,180,0.16)',
      borderColor: 'rgba(185,175,255,0.52)',
      violetEdge: 'rgba(130,80,255,0.54)',
      cyanEdge: 'rgba(70,205,255,0.38)',
      topHighlight: 'rgba(255,255,255,0.14)',
      textColor: '#FFFFFF',
    },
    activeFocused: {
      backgroundColor: 'rgba(105,65,225,0.30)',
      secondaryTint: 'rgba(35,115,220,0.18)',
      borderColor: 'rgba(225,210,255,0.78)',
      violetEdge: 'rgba(155,80,255,0.76)',
      cyanEdge: 'rgba(55,210,255,0.68)',
      innerHighlight: 'rgba(255,255,255,0.20)',
      textColor: '#FFFFFF',
    },
  },
} as const;
