import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { categoryInfo } from '../lib/categories';

export type IconName =
  | 'back' | 'plus' | 'search' | 'sort' | 'map' | 'pin' | 'compass' | 'listPin' | 'chat' | 'user'
  | 'lock' | 'people' | 'globe' | 'check' | 'trash' | 'more' | 'send' | 'up' | 'down' | 'close'
  | 'locate' | 'share' | 'chevron' | 'logout' | 'navigate';

interface Props { name: IconName; size?: number; color?: string; strokeWidth?: number }

/** Stroke icons drawn like the design files (24×24 viewBox, round caps). */
export function Icon({ name, size = 22, color = '#17251E', strokeWidth = 2 }: Props) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  let body: React.ReactNode;
  switch (name) {
    case 'back': body = <Path d="M15 5l-7 7 7 7" {...common} />; break;
    case 'chevron': body = <Path d="M9 5l7 7-7 7" {...common} />; break;
    case 'plus': body = <Path d="M12 5v14M5 12h14" {...common} />; break;
    case 'search': body = <><Circle cx={11} cy={11} r={7} {...common} /><Path d="M20 20l-4-4" {...common} /></>; break;
    case 'sort': body = <Path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4" {...common} />; break;
    case 'map': body = <><Path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" {...common} /><Path d="M9 4v14M15 6v14" {...common} /></>; break;
    case 'pin':
    case 'listPin': body = <><Path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" {...common} /><Circle cx={12} cy={9} r={2.5} {...common} /></>; break;
    case 'compass': body = <><Circle cx={12} cy={12} r={9} {...common} /><Path d="M15.5 8.5l-2 5-5 2 2-5z" {...common} /></>; break;
    case 'chat': body = <Path d="M4 5h16v11H9l-5 4z" {...common} />; break;
    case 'user': body = <><Circle cx={12} cy={8} r={4} {...common} /><Path d="M4 21c1-4 4-6 8-6s7 2 8 6" {...common} /></>; break;
    case 'lock': body = <><Rect x={5} y={11} width={14} height={9} rx={2} {...common} /><Path d="M8 11V8a4 4 0 0 1 8 0v3" {...common} /></>; break;
    case 'people': body = <><Circle cx={9} cy={8} r={3.5} {...common} /><Path d="M2.5 20c.7-3.5 3.2-5 6.5-5s5.8 1.5 6.5 5" {...common} /><Path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.2 3.5 5" {...common} /></>; break;
    case 'globe': body = <><Circle cx={12} cy={12} r={9} {...common} /><Path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" {...common} /></>; break;
    case 'check': body = <Path d="M5 12.5l4.5 4.5L19 7.5" {...common} />; break;
    case 'trash': body = <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" {...common} />; break;
    case 'more': body = <><Circle cx={12} cy={5} r={1.8} fill={color} /><Circle cx={12} cy={12} r={1.8} fill={color} /><Circle cx={12} cy={19} r={1.8} fill={color} /></>; break;
    case 'send': body = <Path d="M5 12h14M13 6l6 6-6 6" {...common} />; break;
    case 'up': body = <Path d="M6 15l6-6 6 6" {...common} />; break;
    case 'down': body = <Path d="M6 9l6 6 6-6" {...common} />; break;
    case 'close': body = <Path d="M6 6l12 12M18 6L6 18" {...common} />; break;
    case 'locate': body = <><Circle cx={12} cy={12} r={4} {...common} /><Path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...common} /></>; break;
    case 'share': body = <><Path d="M12 3v12M7 8l5-5 5 5" {...common} /><Path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" {...common} /></>; break;
    case 'logout': body = <><Path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" {...common} /><Path d="M10 17l-5-5 5-5M5 12h11" {...common} /></>; break;
    case 'navigate': body = <Path d="M3 11l18-8-8 18-2-8z" {...common} />; break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} aria-hidden>
      {body}
    </Svg>
  );
}

/** Category glyph (paths shared with web/Theme.dc.html). */
export function CatGlyph({ category, size = 20, color }: { category: string; size?: number; color?: string }) {
  const c = categoryInfo(category);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} aria-hidden>
      {c.paths.map((d) => (
        <Path key={d} d={d} stroke={color ?? c.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
    </Svg>
  );
}

const STAR = 'M12 2.5l2.9 6.4 6.6.7-5 4.6 1.5 6.8-6-3.4-6 3.4 1.5-6.8-5-4.6 6.6-.7z';
export function StarIcon({ size = 16, filled = true }: { size?: number; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} aria-hidden>
      <Path d={STAR} fill={filled ? '#F28C28' : '#C9D8CF'} />
    </Svg>
  );
}
