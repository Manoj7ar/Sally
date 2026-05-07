import { useState, useEffect, useCallback, useRef } from 'react';
import { ipc } from '../../lib/ipc';
import { getPushToTalkKeyLabel } from '../../lib/desktopMeta';
import { rendererLogger } from '../../lib/logger';
import { THEME } from '../../theme/tokens';
import type {
  MacPermissionPane,
  MacPermissionState,
  MacPermissionsStatus,
  PushToTalkBinding,
  PushToTalkCaptureProgress,
  SallyConfig,
} from '../../../shared/types';

// ── Reusable Components ──

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: THEME.surface.muted,
        border: `1px solid ${THEME.border.subtle}`,
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  description,
  right,
  indicator,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  indicator?: 'green' | 'gray';
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: description ? 12 : 8 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: THEME.text.primary, margin: 0 }}>{title}</h3>
          {indicator && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: indicator === 'green' ? THEME.status.success : THEME.border.muted,
              }}
            />
          )}
        </div>
        {description && (
          <p style={{ fontSize: 12, color: THEME.text.secondary, margin: '4px 0 0 0' }}>{description}</p>
        )}
      </div>
      {right}
    </div>
  );
}

function KeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: `1px solid ${THEME.border.subtle}`,
        background: THEME.surface.base,
        color: THEME.text.primary,
        fontSize: 13,
        fontFamily: 'monospace',
        outline: 'none',
        boxSizing: 'border-box',
      }}
      onFocus={(e) => { e.target.style.borderColor = THEME.accent.primary; }}
      onBlur={(e) => { e.target.style.borderColor = THEME.border.subtle; }}
    />
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 16px',
        borderRadius: 8,
        border: 'none',
        background: disabled ? THEME.accent.primaryDisabledBg : THEME.accent.primary,
        color: disabled ? THEME.accent.primaryDisabledText : THEME.text.inverse,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.accent.primaryHover;
          e.currentTarget.style.transform = 'scale(1.03)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.accent.primary;
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
    >
      {children}
    </button>
  );
}

function PermissionRow({
  label,
  description,
  state,
  primaryAction,
  secondaryAction,
}: {
  label: string;
  description: string;
  state: MacPermissionState;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}) {
  const isGranted = state === 'granted';
  const isUndetermined = state === 'not-determined' || state === 'unknown';
  const dot = isGranted
    ? THEME.status.success
    : isUndetermined
      ? THEME.border.muted
      : THEME.status.danger;
  const stateLabel = isGranted
    ? 'Granted'
    : state === 'denied'
      ? 'Denied'
      : state === 'restricted'
        ? 'Restricted'
        : 'Not requested';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 0',
        borderBottom: `1px solid ${THEME.border.subtle}`,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: THEME.text.primary }}>{label}</span>
          <span style={{ fontSize: 11, color: THEME.text.secondary }}>{stateLabel}</span>
        </div>
        <p style={{ fontSize: 12, color: THEME.text.secondary, margin: 0, lineHeight: 1.4 }}>{description}</p>
      </div>
      {!isGranted && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: 'none',
                background: THEME.accent.primary,
                color: THEME.text.inverse,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${THEME.border.subtle}`,
                background: THEME.surface.base,
                color: THEME.text.secondary,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SecondaryButton({
  onClick,
  disabled,
  children,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 16px',
        borderRadius: 8,
        border: `1px solid ${THEME.border.subtle}`,
        background: THEME.surface.base,
        color: disabled ? THEME.border.muted : danger ? THEME.status.danger : THEME.text.secondary,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.surface.hover;
          e.currentTarget.style.color = danger ? THEME.status.dangerHover : THEME.text.primary;
          e.currentTarget.style.transform = 'scale(1.03)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.surface.base;
          e.currentTarget.style.color = danger ? THEME.status.danger : THEME.text.secondary;
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
    >
      {children}
    </button>
  );
}

// ── Main Component ──

export default function ConfigWindow() {
  const [config, setConfig] = useState<SallyConfig | null>(null);
  const [permissions, setPermissions] = useState<MacPermissionsStatus | null>(null);
  const [providerKey, setProviderKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [autoResearchScreenQuestions, setAutoResearchScreenQuestions] = useState(false);
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [hotkeyBinding, setHotkeyBinding] = useState<PushToTalkBinding | null>(null);
  const [hotkeyCapture, setHotkeyCapture] = useState<PushToTalkCaptureProgress | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const isCapturingHotkey = hotkeyCapture !== null;
  const isCapturingRef = useRef(isCapturingHotkey);
  useEffect(() => { isCapturingRef.current = isCapturingHotkey; }, [isCapturingHotkey]);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await ipc.invoke('sally:get-config');
      setConfig(cfg);
      setAutoResearchScreenQuestions(cfg.autoResearchScreenQuestions);
      setOpenAtLogin(cfg.openAtLogin);
      setHotkeyBinding(cfg.pushToTalk);
    } catch (e) {
      rendererLogger.error('Failed to load config:', e);
    }
  }, []);

  const loadPermissions = useCallback(async () => {
    try {
      const status = await ipc.invoke('permissions:get-status');
      setPermissions(status);
    } catch (e) {
      rendererLogger.error('Failed to load permissions:', e);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadPermissions();
  }, [loadConfig, loadPermissions]);

  useEffect(() => {
    return ipc.subscribe('permissions:status-changed', (status) => {
      setPermissions(status);
    });
  }, []);

  useEffect(() => {
    const unsubs = [
      ipc.subscribe('sally:hotkey-changed', (binding) => {
        setHotkeyBinding(binding);
        setConfig((prev) => (prev ? { ...prev, pushToTalk: binding } : prev));
        setHotkeyError(null);
      }),
      ipc.subscribe('sally:hotkey-capture-progress', (progress) => {
        if (!isCapturingRef.current) return;
        setHotkeyCapture(progress);
      }),
      ipc.subscribe('sally:hotkey-capture-ended', (ended) => {
        setHotkeyCapture(null);
        if (!ended.saved) {
          if (ended.reason === 'timeout') {
            setHotkeyError('Capture timed out — try again.');
          } else if (ended.reason === 'no-keys') {
            setHotkeyError('No keys were pressed. Try again and hold your shortcut.');
          } else {
            setHotkeyError(null);
          }
        } else {
          setHotkeyError(null);
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const handleStartHotkeyCapture = async () => {
    setHotkeyError(null);
    try {
      const initial = await ipc.invoke('sally:start-hotkey-capture');
      setHotkeyCapture(initial);
    } catch (e) {
      rendererLogger.error('Failed to start hotkey capture:', e);
      setHotkeyError('Could not start capture. Make sure Accessibility permission is granted.');
    }
  };

  const handleCancelHotkeyCapture = async () => {
    try {
      await ipc.invoke('sally:cancel-hotkey-capture');
    } catch (e) {
      rendererLogger.error('Failed to cancel hotkey capture:', e);
    }
    setHotkeyCapture(null);
  };

  const handleResetHotkey = async () => {
    try {
      const binding = await ipc.invoke('sally:reset-hotkey');
      setHotkeyBinding(binding);
      setHotkeyError(null);
    } catch (e) {
      rendererLogger.error('Failed to reset hotkey:', e);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electron) return;
    if (window.electron.platform !== 'darwin') return;
    if (config?.pushToTalkHotkeyActive) return;
    const id = window.setInterval(() => {
      void loadConfig();
    }, 3000);
    return () => window.clearInterval(id);
  }, [config?.pushToTalkHotkeyActive, loadConfig]);

  const handleSaveProviderKey = async () => {
    if (!providerKey) return;
    await ipc.invoke('sally:set-api-key', { provider: 'gemini', key: providerKey });
    setProviderKey('');
    loadConfig();
  };

  const handleTestProviderKey = async () => {
    if (!providerKey) return;
    setTesting(true);
    const result = await ipc.invoke('sally:test-api-key', { provider: 'gemini', key: providerKey });
    setTestResult(result);
    setTesting(false);
  };

  const handleClearProviderKey = async () => {
    await ipc.invoke('sally:clear-api-key');
    loadConfig();
  };

  const handleSaveElevenLabsKey = async () => {
    if (!elevenLabsKey) return;
    await ipc.invoke('sally:set-elevenlabs-key', elevenLabsKey);
    setElevenLabsKey('');
    loadConfig();
  };

  const handleToggleAutoResearchScreenQuestions = async () => {
    const nextValue = !autoResearchScreenQuestions;
    setAutoResearchScreenQuestions(nextValue);
    await ipc.invoke('sally:set-auto-research-screen-questions', nextValue);
    await loadConfig();
  };

  const handleToggleOpenAtLogin = async () => {
    const nextValue = !openAtLogin;
    setOpenAtLogin(nextValue);
    await ipc.invoke('sally:set-open-at-login', nextValue);
    await loadConfig();
  };

  const handleOpenSettingsPane = async (pane: MacPermissionPane) => {
    await ipc.invoke('permissions:open-pane', { pane });
  };

  const handleRequestMicrophone = async () => {
    await ipc.invoke('permissions:request-microphone');
    await loadPermissions();
  };

  const handlePromptAccessibility = async () => {
    await ipc.invoke('permissions:prompt-accessibility');
    await loadPermissions();
  };

  if (!config) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: THEME.surface.base }}>
        <p style={{ color: THEME.text.secondary }}>Loading...</p>
      </div>
    );
  }

  const pushToTalkKeyLabel = getPushToTalkKeyLabel();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: THEME.surface.base, color: THEME.text.primary }}>
      {/* Title bar drag region */}
      <div
        className="drag-region"
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          paddingTop: 8,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: THEME.text.primary }}>Sally</h1>
          <p style={{ fontSize: 11, color: THEME.text.secondary, margin: '2px 0 0 0' }}>Voice-first AI assistant</p>
        </div>
      </div>

      {/* Launch Assistant button */}
      <div style={{ padding: '12px 24px 0', flexShrink: 0, display: 'flex', gap: 10 }}>
        <button
          onClick={() => ipc.invoke('window:show-pill')}
          data-testid="launch-assistant-button"
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10,
            border: `1px solid ${THEME.accent.primaryBorder}`,
            background: THEME.accent.primarySoft,
            color: THEME.accent.primary, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s, transform 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = THEME.accent.primarySoftHover;
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = THEME.accent.primarySoft;
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke={THEME.accent.primary} strokeWidth="2" />
            <line x1="12" y1="2" x2="12" y2="7" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12" y2="22" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
            <line x1="2" y1="12" x2="7" y2="12" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
            <line x1="17" y1="12" x2="22" y2="12" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
          </svg>
          Launch Assistant
        </button>
        <button
          onClick={() => ipc.invoke('window:show-browser')}
          data-testid="open-browser-button"
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10,
            border: `1px solid ${THEME.accent.secondaryBorder}`,
            background: THEME.accent.secondarySoft,
            color: THEME.accent.secondary, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s, transform 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = THEME.accent.secondarySoftHover;
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = THEME.accent.secondarySoft;
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
            <path d="M3 8H21" stroke="currentColor" strokeWidth="2" />
            <circle cx="6.5" cy="6" r="1" fill="currentColor" />
            <circle cx="9.5" cy="6" r="1" fill="currentColor" />
          </svg>
          Open Browser
        </button>
      </div>

      {/* Content */}
      <div
        className="scrollbar-hide"
        style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px', minHeight: 0 }}
      >
        {/* macOS Permissions */}
        <Card>
          <CardHeader
            title="macOS Permissions"
            description="Sally needs three system permissions to work end to end. Granting them takes you straight to the right pane in System Settings."
            indicator={
              permissions
                && permissions.microphone === 'granted'
                && permissions.screen === 'granted'
                && permissions.accessibility === 'granted'
                ? 'green'
                : 'gray'
            }
          />
          <PermissionRow
            label="Microphone"
            description="Captures your voice when you hold the push-to-talk key."
            state={permissions?.microphone ?? 'unknown'}
            primaryAction={{ label: 'Grant', onClick: handleRequestMicrophone }}
            secondaryAction={{ label: 'Open Settings', onClick: () => handleOpenSettingsPane('microphone') }}
          />
          <PermissionRow
            label="Screen Recording"
            description="Lets Sally see your screen when you ask 'what am I looking at?'."
            state={permissions?.screen ?? 'unknown'}
            secondaryAction={{ label: 'Open Settings', onClick: () => handleOpenSettingsPane('screen') }}
          />
          <PermissionRow
            label={`Accessibility (${pushToTalkKeyLabel} hotkey)`}
            description={`Required so Sally can listen for ${pushToTalkKeyLabel} from any app.${permissions?.pushToTalkHotkeyActive ? ' Hotkey is active.' : ''}`}
            state={permissions?.accessibility ?? 'unknown'}
            primaryAction={{ label: 'Grant', onClick: handlePromptAccessibility }}
            secondaryAction={{ label: 'Open Settings', onClick: () => handleOpenSettingsPane('accessibility') }}
          />
          <div style={{ marginTop: 14 }}>
            <button
              onClick={handleToggleOpenAtLogin}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${THEME.border.subtle}`,
                background: openAtLogin ? THEME.status.successSoft : THEME.surface.base,
                color: THEME.text.primary,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                textAlign: 'left',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Open Sally at login</div>
                <div style={{ fontSize: 12, color: THEME.text.secondary }}>
                  {openAtLogin
                    ? 'macOS will launch Sally automatically when you sign in.'
                    : 'Sally only runs when you launch it manually.'}
                </div>
              </div>
              <div
                style={{
                  width: 42,
                  height: 24,
                  borderRadius: 999,
                  background: openAtLogin ? THEME.status.success : THEME.border.muted,
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: THEME.surface.base,
                    position: 'absolute',
                    top: 3,
                    left: openAtLogin ? 21 : 3,
                    transition: 'left 0.15s',
                    boxShadow: THEME.shadow.small,
                  }}
                />
              </div>
            </button>
          </div>
        </Card>

        {/* AI Model */}
        <Card>
          <CardHeader
            title="AI Model"
            description="Gemini powers screen understanding, browser automation, and the default speech-to-text path."
            indicator={config.hasGeminiKey ? 'green' : 'gray'}
          />
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: THEME.text.secondary, marginBottom: 6 }}>Gemini API Key</label>
            <KeyInput
              value={providerKey}
              onChange={setProviderKey}
              placeholder={config.hasGeminiKey ? 'Key configured (hidden)' : 'Enter Gemini API key...'}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PrimaryButton onClick={handleSaveProviderKey} disabled={!providerKey}>
              Save
            </PrimaryButton>
            <SecondaryButton onClick={handleTestProviderKey} disabled={!providerKey || testing}>
              {testing ? 'Testing...' : 'Test'}
            </SecondaryButton>
            {config.hasGeminiKey && (
              <SecondaryButton onClick={handleClearProviderKey} danger>
                Clear
              </SecondaryButton>
            )}
            {testResult !== null && (
              <span style={{ fontSize: 12, color: testResult ? THEME.status.successText : THEME.status.danger, marginLeft: 4 }}>
                {testResult ? 'Valid' : 'Invalid'}
              </span>
            )}
          </div>
        </Card>

        {/* Voice Settings */}
        <Card>
          <CardHeader title="Voice" description="Configure speech services" />

          {/* TTS */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: THEME.text.primary }}>Text-to-Speech</span>
              <span style={{ fontSize: 11, color: THEME.text.secondary }}>ElevenLabs</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: config.hasElevenLabsKey ? THEME.status.success : THEME.border.muted,
                  marginLeft: 'auto',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <KeyInput
                  value={elevenLabsKey}
                  onChange={setElevenLabsKey}
                  placeholder={config.hasElevenLabsKey ? 'Key configured' : 'Enter ElevenLabs key...'}
                />
              </div>
              <PrimaryButton onClick={handleSaveElevenLabsKey} disabled={!elevenLabsKey}>
                Save
              </PrimaryButton>
            </div>
          </div>

          <div style={{ height: 1, background: THEME.border.subtle, margin: '0 0 16px' }} />

          {/* STT */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: THEME.text.primary }}>Speech-to-Text</span>
              <span style={{ fontSize: 11, color: THEME.text.secondary }}>Gemini 2.5 Flash</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: config.hasGeminiKey ? THEME.status.success : THEME.border.muted,
                  marginLeft: 'auto',
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: THEME.text.secondary, margin: '0 0 10px 0' }}>
              Speech-to-text uses the Gemini API key configured above.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Screen Questions"
            description="Let Sally answer open-ended questions about what is visible on screen. Auto research opens the browser only when a screen question explicitly asks for more information."
            indicator={autoResearchScreenQuestions ? 'green' : 'gray'}
          />
          <button
            onClick={handleToggleAutoResearchScreenQuestions}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 10,
              border: `1px solid ${THEME.border.subtle}`,
              background: autoResearchScreenQuestions ? THEME.status.successSoft : THEME.surface.base,
              color: THEME.text.primary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Auto Research for Screen Questions
              </div>
              <div style={{ fontSize: 12, color: THEME.text.secondary }}>
                {autoResearchScreenQuestions
                  ? 'When a visual question asks for more info, Sally can answer from the screenshot and then look it up on the web.'
                  : 'Sally answers screen questions from the screenshot only and does not auto-open the browser.'}
              </div>
            </div>
            <div
              style={{
                width: 42,
                height: 24,
                borderRadius: 999,
                background: autoResearchScreenQuestions ? THEME.status.success : THEME.border.muted,
                position: 'relative',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: THEME.surface.base,
                  position: 'absolute',
                  top: 3,
                  left: autoResearchScreenQuestions ? 21 : 3,
                  transition: 'left 0.15s',
                  boxShadow: THEME.shadow.small,
                }}
              />
            </div>
          </button>
        </Card>

        {/* Getting Started */}
        <Card style={{ background: THEME.accent.primaryMuted, borderColor: THEME.accent.primaryBorder }}>
          <CardHeader title="Getting Started" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { num: '1', text: `Hold ${pushToTalkKeyLabel} to speak a command` },
              { num: '2', text: 'Release to send your command' },
              { num: '3', text: 'Say "cancel" to stop the current action' },
            ].map((step) => (
              <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: THEME.accent.primarySoftHover,
                    color: THEME.accent.primary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {step.num}
                </span>
                <span style={{ fontSize: 13, color: THEME.text.primary }}>{step.text}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
