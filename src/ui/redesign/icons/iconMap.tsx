import type { LucideIcon, LucideProps } from "lucide-react";
import {
  AlertCircle,
  ArrowDownToLine,
  Bell,
  Check,
  ChevronDown,
  CircleDot,
  Clipboard,
  Clock,
  Cloud,
  Copy,
  Cpu,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileJson,
  Film,
  FolderOpen,
  Gauge,
  Globe,
  Image,
  Info,
  KeyRound,
  Link2,
  ListChecks,
  ListFilter,
  LoaderCircle,
  MessageSquareText,
  Minus,
  MonitorPlay,
  Move,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Twitch,
  Video,
  WandSparkles,
  X,
  Youtube,
} from "lucide-react";

import { cn } from "@/lib/utils";

export const redesignIcons = {
  add: Plus,
  alert: AlertCircle,
  apply: Check,
  bell: Bell,
  blur: WandSparkles,
  chat: MessageSquareText,
  check: Check,
  chevronDown: ChevronDown,
  clear: X,
  clipboard: Clipboard,
  close: X,
  copy: Copy,
  cpu: Cpu,
  download: Download,
  exportJson: FileJson,
  external: ExternalLink,
  finder: Search,
  folder: FolderOpen,
  hidden: EyeOff,
  image: Image,
  info: Info,
  install: ArrowDownToLine,
  key: KeyRound,
  link: Link2,
  live: Radio,
  loading: LoaderCircle,
  logs: ListChecks,
  media: Film,
  more: Ellipsis,
  minimize: Minus,
  move: Move,
  pause: Pause,
  performance: Gauge,
  play: Play,
  preset: SlidersHorizontal,
  preview: MonitorPlay,
  queue: ListFilter,
  refresh: RefreshCw,
  reset: RotateCcw,
  save: Save,
  secure: ShieldCheck,
  settings: Settings,
  source: Globe,
  sparkle: Sparkles,
  status: CircleDot,
  stop: Square,
  time: Clock,
  trash: Trash2,
  video: Video,
  visible: Eye,
} as const satisfies Record<string, LucideIcon>;

export const platformIcons = {
  hls: Cloud,
  kick: Radio,
  rtmp: Radio,
  twitch: Twitch,
  unknown: Globe,
  vk: Video,
  youtube: Youtube,
} as const satisfies Record<string, LucideIcon>;

export type RedesignIconName = keyof typeof redesignIcons;
export type PlatformIconName = keyof typeof platformIcons;

export interface RedesignIconProps extends Omit<LucideProps, "ref"> {
  name: RedesignIconName;
}

export interface PlatformIconProps extends Omit<LucideProps, "ref"> {
  platform?: PlatformIconName | string | null;
}

export function RedesignIcon({
  name,
  className,
  strokeWidth = 1.8,
  ...props
}: RedesignIconProps) {
  const Icon = redesignIcons[name];
  return <Icon aria-hidden className={cn("size-4", className)} strokeWidth={strokeWidth} {...props} />;
}

export function PlatformIcon({
  platform,
  className,
  strokeWidth = 1.8,
  ...props
}: PlatformIconProps) {
  const key = normalizePlatformIcon(platform);
  const Icon = platformIcons[key];
  return <Icon aria-hidden className={cn("size-4", className)} strokeWidth={strokeWidth} {...props} />;
}

export function getRedesignIcon(name: RedesignIconName): LucideIcon {
  return redesignIcons[name];
}

export function getPlatformIcon(platform?: PlatformIconName | string | null): LucideIcon {
  return platformIcons[normalizePlatformIcon(platform)];
}

function normalizePlatformIcon(platform?: PlatformIconName | string | null): PlatformIconName {
  const key = platform?.toLowerCase();
  if (key && key in platformIcons) return key as PlatformIconName;
  return "unknown";
}
