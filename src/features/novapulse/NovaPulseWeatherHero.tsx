import { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop, Svg } from 'react-native-svg';

import { parseNovaPulseWeatherArtKey, type NovaPulseWeatherArtSelection } from './novaPulseWeatherArt';

type Props = { selection?: NovaPulseWeatherArtSelection; artKey?: string };
type SceneProps = { selection: NovaPulseWeatherArtSelection };

const palette = {
  clear: ['#163d75', '#8b5cf6'],
  partly_cloudy: ['#254d83', '#9a78e8'],
  cloudy: ['#24334f', '#6d73a8'],
  rain: ['#172b54', '#526ea8'],
  storm: ['#171536', '#5a3f91'],
  snow: ['#29496d', '#a3c5e6'],
  fog: ['#364761', '#8995af'],
} as const;

function SceneBase({ selection }: SceneProps) {
  const colors = palette[selection.conditionGroup];
  const night = selection.time === 'night';
  return (
    <G>
      <Defs>
        <LinearGradient id="weather-sky" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={night ? '#080d29' : colors[0]} />
          <Stop offset="1" stopColor={colors[1]} />
        </LinearGradient>
        <RadialGradient id="weather-glow" cx="78%" cy="30%" r="42%">
          <Stop offset="0" stopColor={night ? '#c7b9ff' : '#fff2b8'} stopOpacity="0.92" />
          <Stop offset="1" stopColor={night ? '#7964df' : '#ffd76a'} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width="640" height="360" fill="url(#weather-sky)" />
      <Rect width="640" height="360" fill="url(#weather-glow)" />
      {night ? <Circle cx="495" cy="86" r="32" fill="#e8e3ff" opacity="0.9" /> : <Circle cx="498" cy="88" r="38" fill="#ffe28b" opacity="0.92" />}
      <G opacity="0.24" fill="#fff">
        <Circle cx="122" cy="70" r="2" /><Circle cx="190" cy="112" r="1.5" /><Circle cx="570" cy="44" r="2" /><Circle cx="425" cy="142" r="1.5" />
      </G>
      <Path d="M0 287 C105 248 155 270 238 251 C331 230 380 275 466 249 C544 226 594 245 640 226 L640 360 L0 360 Z" fill="#0b1635" opacity="0.9" />
      <Path d="M0 314 C106 294 187 319 276 296 C374 270 441 311 520 286 C576 268 611 286 640 279 L640 360 L0 360 Z" fill="#071027" opacity="0.96" />
    </G>
  );
}

function UrbanDetail() {
  return <G fill="#08142f" opacity="0.95"><Path d="M45 300 V218 H94 V300 Z M106 300 V178 H143 V300 Z M154 300 V232 H205 V300 Z M217 300 V145 H252 V300 Z M264 300 V203 H315 V300 Z" /><Path d="M78 238h10v12H78zM119 200h8v10h-8zM119 224h8v10h-8zM231 171h8v10h-8zM231 196h8v10h-8zM281 225h10v12h-10z" fill="#8fa7d8" opacity="0.35" /></G>;
}

function CoastalDetail() {
  return <G fill="none" stroke="#b7dcff" strokeWidth="4" opacity="0.45"><Path d="M0 286 C95 255 160 315 260 282 S445 251 640 291" /><Path d="M0 314 C105 282 170 340 286 307 S470 281 640 318" /></G>;
}

function DesertDetail() {
  return <G fill="#e7b16f" opacity="0.52"><Path d="M0 292 C90 260 155 294 230 275 C320 253 395 301 488 274 C548 257 601 270 640 254 V360 H0 Z" /><Path d="M520 270 C540 216 566 216 574 270 Z" /></G>;
}

function MountainDetail() {
  return <G fill="#101e43" opacity="0.9"><Path d="M0 310 L115 174 L181 248 L272 119 L402 292 L477 208 L640 330 V360 H0 Z" /><Path d="M115 174 L139 211 L126 205 L112 224 L99 214 Z M272 119 L321 190 L294 174 L275 197 L253 178 Z" fill="#d5e4ff" opacity="0.55" /></G>;
}

function ConditionDetail({ selection }: SceneProps) {
  if (selection.conditionGroup === 'storm') {
    return <G stroke="#d6e6ff" strokeWidth="4" opacity="0.58"><Path d="M350 190l-12 34M390 190l-12 34M430 190l-12 34M470 190l-12 34" /><Path d="M413 166 L385 219 H409 L393 261 L438 202 H414 Z" fill="#ffe38c" stroke="none" opacity="0.88" /></G>;
  }
  if (selection.conditionGroup === 'rain') {
    return <G stroke="#d6e6ff" strokeWidth="4" opacity="0.58"><Path d="M350 190l-12 34M390 190l-12 34M430 190l-12 34M470 190l-12 34" /></G>;
  }
  if (selection.conditionGroup === 'snow') {
    return <G fill="#fff" opacity="0.75"><Circle cx="360" cy="195" r="4" /><Circle cx="405" cy="224" r="3" /><Circle cx="451" cy="190" r="4" /><Circle cx="500" cy="229" r="3" /></G>;
  }
  if (selection.conditionGroup === 'fog') {
    return <G stroke="#e0e7ff" strokeWidth="8" opacity="0.28"><Path d="M260 205h220M228 238h260M286 271h210" /></G>;
  }
  if (selection.conditionGroup === 'cloudy' || selection.conditionGroup === 'partly_cloudy') {
    return <G fill="#dce5ff" opacity="0.48"><Circle cx="365" cy="178" r="28" /><Circle cx="397" cy="165" r="38" /><Circle cx="438" cy="181" r="25" /><Rect x="355" y="178" width="105" height="28" rx="14" /></G>;
  }
  return null;
}

export function NovaPulseWeatherArt({ selection: providedSelection, artKey }: Props) {
  const selection = providedSelection ?? parseNovaPulseWeatherArtKey(artKey);
  return (
    <Svg width="100%" height="100%" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice">
      <SceneBase selection={selection} />
      {selection.theme === 'urban' ? <UrbanDetail /> : null}
      {selection.theme === 'coastal' ? <CoastalDetail /> : null}
      {selection.theme === 'desert' ? <DesertDetail /> : null}
      {selection.theme === 'mountain' ? <MountainDetail /> : null}
      <ConditionDetail selection={selection} />
    </Svg>
  );
}
