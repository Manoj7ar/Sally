export type BrowserSourceMode = 'electron_browser';

export interface PageContextElement {
  index: number;
  targetId: string;
  framePath: number[];
  shadowPath: number[];
  role: string;
  tagName: string;
  label: string;
  text: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  centerX?: number;
  centerY?: number;
}

export interface PageContext {
  interactiveElements: PageContextElement[];
  headings: string[];
  landmarks: string[];
  dialogs: string[];
  visibleMessages: string[];
  activeElement: string | null;
  semanticSummary: string;
}

export interface BrowserTabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

export interface BrowserSnapshot {
  sourceMode: BrowserSourceMode;
  screenshot: string;
  pageUrl: string;
  pageTitle: string;
  pageContext: PageContext;
  tabs: BrowserTabInfo[];
  activeTabId: string | null;
}
