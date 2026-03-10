import { useState, useEffect, useCallback } from 'react';
import { ipc } from '../../lib/ipc';
import type { SallyConfig } from '../../../shared/types';

// ── Reusable Components ──

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: '#F9F9FB',
        border: '1px solid #E8E8EC',
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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1e', margin: 0 }}>{title}</h3>
          {indicator && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: indicator === 'green' ? '#22C55E' : '#D1D5DB',
              }}
            />
          )}
        </div>
        {description && (
          <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0 0' }}>{description}</p>
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
        border: '1px solid #E8E8EC',
        background: '#fff',
        color: '#1a1a1e',
        fontSize: 13,
        fontFamily: 'monospace',
        outline: 'none',
        boxSizing: 'border-box',
      }}
      onFocus={(e) => { e.target.style.borderColor = '#2563EB'; }}
      onBlur={(e) => { e.target.style.borderColor = '#E8E8EC'; }}
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
        background: disabled ? '#DBEAFE' : '#2563EB',
        color: disabled ? '#93C5FD' : '#fff',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = '#1D4ED8';
          e.currentTarget.style.transform = 'scale(1.03)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = '#2563EB';
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
    >
      {children}
    </button>
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
        border: '1px solid #E8E8EC',
        background: '#fff',
        color: disabled ? '#D1D5DB' : danger ? '#DC2626' : '#6B7280',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = '#F5F5F5';
          e.currentTarget.style.color = danger ? '#EF4444' : '#1a1a1e';
          e.currentTarget.style.transform = 'scale(1.03)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = '#fff';
          e.currentTarget.style.color = danger ? '#DC2626' : '#6B7280';
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
  const [providerKey, setProviderKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [whisperKey, setWhisperKey] = useState('');
  const [geminiBackendUrl, setGeminiBackendUrl] = useState('');
  const [autoResearchScreenQuestions, setAutoResearchScreenQuestions] = useState(false);
  const [backendHealth, setBackendHealth] = useState<{
    status: 'idle' | 'configured' | 'checking' | 'connected' | 'failed';
    model: string | null;
  }>({ status: 'idle', model: null });
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  const checkBackendHealth = useCallback(async (url?: string) => {
    const target = (url || geminiBackendUrl || config?.geminiBackendUrl || '').trim();
    if (!target) return;

    setBackendHealth((current) => ({ status: 'checking', model: current.model }));

    try {
      const response = await fetch(`${target.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const payload = await response.json().catch(() => null) as { model?: unknown } | null;
        setBackendHealth({
          status: 'connected',
          model: typeof payload?.model === 'string' ? payload.model : null,
        });
      } else {
        setBackendHealth({ status: 'failed', model: null });
      }
    } catch {
      setBackendHealth({ status: 'failed', model: null });
    }
  }, [config?.geminiBackendUrl, geminiBackendUrl]);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await ipc.invoke('sally:get-config');
      setConfig(cfg);
      setGeminiBackendUrl(cfg.geminiBackendUrl);
      setAutoResearchScreenQuestions(cfg.autoResearchScreenQuestions);
      if (cfg.geminiBackendUrl.trim()) {
        setBackendHealth({ status: 'configured', model: null });
        void checkBackendHealth(cfg.geminiBackendUrl);
      } else {
        setBackendHealth({ status: 'idle', model: null });
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  }, [checkBackendHealth]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

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

  const handleSaveWhisperKey = async () => {
    if (!whisperKey) return;
    await ipc.invoke('sally:set-whisper-key', whisperKey);
    setWhisperKey('');
    loadConfig();
  };

  const handleSaveGeminiBackendUrl = async () => {
    const nextUrl = geminiBackendUrl.trim();
    await ipc.invoke('sally:set-gemini-backend-url', nextUrl);
    setGeminiBackendUrl(nextUrl);
    await loadConfig();
    if (nextUrl) {
      setBackendHealth({ status: 'configured', model: null });
      void checkBackendHealth(nextUrl);
    } else {
      setBackendHealth({ status: 'idle', model: null });
    }
  };

  const handleClearGeminiBackendUrl = async () => {
    await ipc.invoke('sally:set-gemini-backend-url', '');
    setGeminiBackendUrl('');
    setBackendHealth({ status: 'idle', model: null });
    loadConfig();
  };

  const handleToggleAutoResearchScreenQuestions = async () => {
    const nextValue = !autoResearchScreenQuestions;
    setAutoResearchScreenQuestions(nextValue);
    await ipc.invoke('sally:set-auto-research-screen-questions', nextValue);
    await loadConfig();
  };

  if (!config) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <p style={{ color: '#6B7280' }}>Loading...</p>
      </div>
    );
  }

  const pushToTalkKeyLabel = ipc.getPlatform() === 'darwin' ? 'Right Option' : 'Right Alt';
  const backendUrlChanged = geminiBackendUrl.trim() !== config.geminiBackendUrl;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#FFFFFF', color: '#1a1a1e' }}>
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
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: '#1a1a1e' }}>Sally</h1>
          <p style={{ fontSize: 11, color: '#6B7280', margin: '2px 0 0 0' }}>Voice-first AI assistant</p>
        </div>
      </div>

      {/* Launch Assistant button */}
      <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
        <button
          onClick={() => ipc.invoke('window:show-pill')}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10,
            border: '1px solid rgba(37,99,235,0.3)',
            background: 'rgba(37,99,235,0.08)',
            color: '#2563EB', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s, transform 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(37,99,235,0.14)';
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(37,99,235,0.08)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="#2563EB" strokeWidth="2" />
            <line x1="12" y1="2" x2="12" y2="7" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12" y2="22" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
            <line x1="2" y1="12" x2="7" y2="12" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
            <line x1="17" y1="12" x2="22" y2="12" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Launch Assistant
        </button>
      </div>

      {/* Content */}
      <div
        className="scrollbar-hide"
        style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px', minHeight: 0 }}
      >
        {/* AI Model */}
        <Card>
          <CardHeader
            title="AI Model"
            description="Gemini powers screen understanding, browser automation, and the default speech-to-text path."
            indicator={config.hasGeminiKey ? 'green' : 'gray'}
          />
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 6 }}>Gemini API Key</label>
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
              <span style={{ fontSize: 12, color: testResult ? '#16A34A' : '#DC2626', marginLeft: 4 }}>
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
              <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1e' }}>Text-to-Speech</span>
              <span style={{ fontSize: 11, color: '#6B7280' }}>ElevenLabs</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: config.hasElevenLabsKey ? '#22C55E' : '#D1D5DB',
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

          <div style={{ height: 1, background: '#E8E8EC', margin: '0 0 16px' }} />

          {/* STT */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1e' }}>Speech-to-Text</span>
              <span style={{ fontSize: 11, color: '#6B7280' }}>Gemini 2.5 Flash with optional OpenAI Whisper fallback</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: (config.hasGeminiKey || config.hasWhisperKey) ? '#22C55E' : '#D1D5DB',
                  marginLeft: 'auto',
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 10px 0' }}>
              Gemini handles transcription by default. Add an OpenAI API key only if you want Whisper as a fallback when Gemini transcription fails.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <KeyInput
                  value={whisperKey}
                  onChange={setWhisperKey}
                  placeholder={config.hasWhisperKey ? 'Whisper fallback key configured' : 'Enter OpenAI key for Whisper fallback...'}
                />
              </div>
              <PrimaryButton onClick={handleSaveWhisperKey} disabled={!whisperKey}>
                Save
              </PrimaryButton>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Sally Vision Backend"
            description="Cloud Run URL for Gemini screen interpretation (optional — falls back to direct Gemini API calls)."
            indicator={backendHealth.status === 'connected' || config.geminiBackendUrl ? 'green' : 'gray'}
          />
          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              value={geminiBackendUrl}
              onChange={(e) => setGeminiBackendUrl(e.target.value)}
              placeholder="https://sally-backend-xxx.run.app"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #E8E8EC',
                background: '#fff',
                color: '#1a1a1e',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#2563EB'; }}
              onBlur={(e) => { e.target.style.borderColor = '#E8E8EC'; }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PrimaryButton onClick={handleSaveGeminiBackendUrl} disabled={!backendUrlChanged}>
              Save URL
            </PrimaryButton>
            {config.geminiBackendUrl && (
              <>
                <SecondaryButton onClick={() => checkBackendHealth()} disabled={backendHealth.status === 'checking'}>
                  {backendHealth.status === 'checking' ? 'Checking...' : 'Check Cloud Run'}
                </SecondaryButton>
                <SecondaryButton onClick={handleClearGeminiBackendUrl}>
                  Clear URL
                </SecondaryButton>
              </>
            )}
          </div>
          {config.geminiBackendUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    backendHealth.status === 'connected' ? '#22C55E' :
                    backendHealth.status === 'failed' ? '#DC2626' :
                    backendHealth.status === 'checking' ? '#CA8A04' :
                    backendHealth.status === 'configured' ? '#2563EB' : '#D1D5DB',
                }}
              />
              <span style={{
                fontSize: 11,
                color:
                  backendHealth.status === 'connected' ? '#16A34A' :
                  backendHealth.status === 'failed' ? '#DC2626' :
                  backendHealth.status === 'checking' ? '#CA8A04' :
                  backendHealth.status === 'configured' ? '#2563EB' : '#6B7280',
              }}>
                {backendHealth.status === 'connected'
                  ? `Connected to Cloud Run${backendHealth.model ? ` (${backendHealth.model})` : ''}`
                  : backendHealth.status === 'failed'
                    ? 'Cloud Run connection failed'
                    : backendHealth.status === 'checking'
                      ? 'Checking Cloud Run health...'
                      : backendHealth.status === 'configured'
                        ? 'Cloud Run URL configured'
                        : 'Cloud Run not configured'}
              </span>
            </div>
          )}
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
              border: '1px solid #E8E8EC',
              background: autoResearchScreenQuestions ? 'rgba(34,197,94,0.08)' : '#fff',
              color: '#1a1a1e',
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
              <div style={{ fontSize: 12, color: '#6B7280' }}>
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
                background: autoResearchScreenQuestions ? '#22C55E' : '#D1D5DB',
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
                  background: '#fff',
                  position: 'absolute',
                  top: 3,
                  left: autoResearchScreenQuestions ? 21 : 3,
                  transition: 'left 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                }}
              />
            </div>
          </button>
        </Card>

        {/* Getting Started */}
        <Card style={{ background: 'rgba(37,99,235,0.04)', borderColor: 'rgba(37,99,235,0.15)' }}>
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
                    background: 'rgba(37,99,235,0.12)',
                    color: '#2563EB',
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
                <span style={{ fontSize: 13, color: '#1a1a1e' }}>{step.text}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
