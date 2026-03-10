export type BrowserSourceMode = 'electron_browser';

export interface PageContextElement {
  index: number;
  role: string;
  tagName: string;
  label: string;
  text: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
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

export interface BrowserSnapshot {
  sourceMode: BrowserSourceMode;
  screenshot: string;
  pageUrl: string;
  pageTitle: string;
  pageContext: PageContext;
}
