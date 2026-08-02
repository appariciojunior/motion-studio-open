import type { SVGProps } from 'react';

export type EditorIconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & {
  size?: number;
};

function iconProps({ size = 20, ...props }: EditorIconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    'aria-hidden': true,
    focusable: false,
    ...props,
  } as const;
}

export function ProjectsIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M2.75 6.25A1.5 1.5 0 014.25 4.75h3l1.5 1.75h6a1.5 1.5 0 011.5 1.5v6.25a1.5 1.5 0 01-1.5 1.5h-10.5a1.5 1.5 0 01-1.5-1.5V6.25z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>;
}

export function LibraryIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>;
}

export function ThreeDIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5L10 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M3.7 6.4L10 10l6.3-3.6M10 10v7.4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>;
}

export function WebIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M7.5 6.5L4 10l3.5 3.5M12.5 6.5L16 10l-3.5 3.5M11 4.5l-2 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function BoardIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><rect x="2.5" y="4.5" width="4.5" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.5"/><rect x="8" y="4.5" width="4" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.5" opacity="0.65"/><rect x="13" y="4.5" width="4.5" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/></svg>;
}

export function AddIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}

export function SunIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><circle cx="10" cy="10" r="3.25" stroke="currentColor" strokeWidth="1.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}

export function MoonIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M15.7 12.6A6 6 0 017.4 4.3 6.1 6.1 0 1015.7 12.6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>;
}

export function MediaIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><rect x="2.75" y="3.5" width="14.5" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="7" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M4.5 14l3.2-3 2.4 2 2.1-2.1 3.3 3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function AdjustIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M3 5h4M11 5h6M3 10h8M15 10h2M3 15h3M10 15h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="9" cy="5" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="13" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="15" r="2" stroke="currentColor" strokeWidth="1.5"/></svg>;
}

export function CanvasIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><rect x="3" y="3" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M7 3v14M13 3v14M3 7h14M3 13h14" stroke="currentColor" strokeWidth="1.5" opacity="0.45"/></svg>;
}

export function ExportIcon(props: EditorIconProps) {
  const { size = 14, ...rest } = props;
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false" {...rest}><path d="M8 2v8m0 0L5 7m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function UndoIcon(props: EditorIconProps) {
  const { size = 15, ...rest } = props;
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false" {...rest}><path d="M3 7h6.5a3.5 3.5 0 010 7H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 4.5L3 7l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function RedoIcon(props: EditorIconProps) {
  const { size = 15, ...rest } = props;
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false" {...rest}><path d="M13 7H6.5a3.5 3.5 0 000 7H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M10.5 4.5L13 7l-2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function PlayIcon(props: EditorIconProps) {
  const { size = 14, ...rest } = props;
  return <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden focusable="false" {...rest}><path d="M4 2.8v8.4c0 .8.9 1.3 1.6.9l6.6-4.2c.6-.4.6-1.4 0-1.8L5.6 1.9c-.7-.4-1.6.1-1.6.9z" fill="currentColor"/></svg>;
}

export function PauseIcon(props: EditorIconProps) {
  const { size = 14, ...rest } = props;
  return <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden focusable="false" {...rest}><rect x="3" y="2.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="8" y="2.5" width="3" height="9" rx="1" fill="currentColor"/></svg>;
}

export function ChevronDownIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function BackIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function InfoIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M10 9v4M10 6.5v.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}
