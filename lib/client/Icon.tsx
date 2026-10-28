import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronLeft,
  Play,
  Bot,
  Check,
  CircleDot,
  Crown,
  Flag,
  GraduationCap,
  KeyRound,
  Maximize2,
  Medal,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Printer,
  Puzzle,
  SkipBack,
  SkipForward,
  Stethoscope,
  Swords,
  Target,
  Timer,
  Trophy,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
  X,
  Zap,
  FastForward,
  BookOpen,
  ClipboardList,
  Sparkles,
  type LucideProps,
} from "lucide-react";

// One place that decides which glyphs the UI uses (Lucide, ISC licence — see
// THIRD-PARTY-NOTICES.md). Named, closed set: components say what the icon
// MEANS, not which Lucide component it is, and tree-shaking keeps the bundle
// to exactly these.
//
// Deliberately NOT here (kept as text/emoji because they are content, not UI
// chrome): chess-piece glyphs (♔♚♞♟ — the brand and the piece colours),
// celebration/result emoji, medals, awards and the spectator reaction emoji.
const icons = {
  alarm: AlarmClock,
  backStep: ChevronLeft,
  play: Play,
  back: ArrowLeft,
  forward: ArrowRight,
  bell: Bell,
  bot: Bot,
  check: Check,
  close: X,
  crown: Crown,
  edit: Pencil,
  fastForward: FastForward,
  flag: Flag,
  coach: GraduationCap,
  fullscreen: Maximize2,
  exitFullscreen: Minimize2,
  key: KeyRound,
  less: Minus,
  more: Plus,
  league: Medal,
  cup: Trophy,
  live: CircleDot,
  lessons: BookOpen,
  warn: TriangleAlert,
  print: Printer,
  puzzle: Puzzle,
  skipBack: SkipBack,
  skipForward: SkipForward,
  diag: Stethoscope,
  versus: Swords,
  target: Target,
  timer: Timer,
  undo: Undo2,
  soundOn: Volume2,
  soundOff: VolumeX,
  quick: Zap,
  review: ClipboardList,
  sparkle: Sparkles,
} as const;

export type IconName = keyof typeof icons;

export interface IconProps extends Omit<LucideProps, "ref"> {
  name: IconName;
}

/** Decorative by default (aria-hidden): the visible text or the button's
 * aria-label carries the meaning. */
export function Icon({ name, size = 18, strokeWidth = 1.9, className, ...rest }: IconProps) {
  const Glyph = icons[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className ? `icon ${className}` : "icon"}
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  );
}
