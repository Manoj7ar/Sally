import { useState, useEffect, useRef, useCallback } from 'react';
import { ipc } from '../../lib/ipc';
import WaveformView from './components/WaveformView';
import type { SallyBarLayout, SallyState } from '../../../shared/types';
import logoSrc from '../../../logo-sally.png';

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const KeyboardIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="6" width="18" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7 10H7.01M10 10H10.01M13 10H13.01M16 10H16.01M7 13H13M15.5 13H17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 11a7 7 0 0 1-12.06 4.94A7 7 0 0 1 5 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18v3M8.5 21h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {muted && <path d="M5 5l14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

const stateColors: Record<SallyState, string> = {
  idle: '#94A3B8',
  listening: '#22C55E',
  processing: '#EAB308',
  acting: '#2563EB',
  speaking: '#A855F7',
  awaiting_response: '#38BDF8',
};

const stateLabels: Record<SallyState, string> = {
  idle: 'Hold Right Alt to Talk',
  listening: '',
  processing: 'Transcribing...',
  acting: 'Working...',
  speaking: 'Speaking...',
  awaiting_response: 'Reply needed',
};

const ACCENT = '#2563EB';
const PILL_BG = 'rgba(0, 0, 0, 0.9)';
const PILL_BLUR = 'blur(28px) saturate(140%)';
const PILL_BORDER = '1px solid rgba(255,255,255,0.04)';
const COMPOSER_BG = 'rgba(0, 0, 0, 0.82)';
const COMPOSER_BORDER = '1px solid rgba(255,255,255,0.05)';
const COMPOSER_WIDTH = 360;
const PILL_WIDTH = 280;
const TRANSCRIPT_WIDTH = 360;
const LIVE_PREVIEW_INTERVAL_MS = 600;
const MIN_LIVE_PREVIEW_BYTES = 1500;

export default function SallyBarWindow() {
  const [state, setState] = useState<SallyState>('idle');
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const livePreviewIntervalRef = useRef<number | null>(null);
  const livePreviewRequestInFlightRef = useRef(false);
  const livePreviewSessionRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const isMicMutedRef = useRef(false);

  const syncLayout = useCallback(async (layout: SallyBarLayout) => {
    await ipc.invoke('window:set-pill-layout', { layout });
  }, []);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  const isVoiceCycleActive = isRecording || state === 'processing' || state === 'acting' || state === 'speaking';
  const isTranscriptVisible = !isComposerOpen && (isVoiceCycleActive || (!!liveTranscript && state !== 'idle'));

  useEffect(() => {
    const layout: SallyBarLayout = isComposerOpen
      ? 'composer'
      : isTranscriptVisible
        ? 'transcript'
        : state === 'idle'
          ? 'idle'
          : 'compact';
    void syncLayout(layout);
    if (isComposerOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isComposerOpen, isTranscriptVisible, state, syncLayout]);

  // Store sound functions in refs so the subscription effect can access them
  const soundsRef = useRef({ playCompleteChime, playErrorChime });
  useEffect(() => {
    soundsRef.current = { playCompleteChime, playErrorChime };
  }, [playCompleteChime, playErrorChime]);

  useEffect(() => {
    let prevState: SallyState = 'idle';
    const unsubs = [
      ipc.subscribe('sally:state-changed', (data) => {
        const nextState = data.state;
        // Play completion chime when transitioning from acting/speaking to idle
        if (nextState === 'idle' && (prevState === 'acting' || prevState === 'speaking')) {
          soundsRef.current.playCompleteChime();
        }
        prevState = nextState;
        setState(nextState);
        if (nextState === 'awaiting_response') {
          setIsComposerOpen(true);
        }
      }),
      ipc.subscribe('sally:mic-muted-changed', (data) => {
        setIsMicMuted(data.muted);
      }),
    ];

    void ipc.invoke('sally:get-mic-muted').then((muted) => {
      setIsMicMuted(muted);
    });

    return () => unsubs.forEach((u) => u());
  }, []);

  // Only clear transcript when we've fully returned to idle (not during the
  // brief gap between recording stop and transcription starting).
  const prevStateRef = useRef<SallyState>('idle');
  useEffect(() => {
    const wasActive = prevStateRef.current !== 'idle';
    prevStateRef.current = state;

    // Clear transcript only when transitioning TO idle from a non-idle state,
    // and recording has stopped. This avoids the race where isRecording=false
    // briefly while state is still idle before handleTranscription sets 'processing'.
    if (state === 'idle' && wasActive && !isRecording) {
      const timer = setTimeout(() => setLiveTranscript(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [isRecording, state]);

  useEffect(() => {
    const scroller = transcriptScrollRef.current;
    if (!scroller) return;
    scroller.scrollLeft = scroller.scrollWidth;
  }, [liveTranscript, isTranscriptVisible]);

  useEffect(() => {
    const unsubStart = window.electron.on('hotkey:start-recording', () => startRecording());
    const unsubStop = window.electron.on('hotkey:stop-recording', () => stopRecording());
    const unsubCancel = window.electron.on('hotkey:cancel-recording', () => cancelRecording());
    return () => {
      unsubStart();
      unsubStop();
      unsubCancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TTS audio playback via IPC — receives base64 MP3 from main process, plays via HTML5 Audio
  useEffect(() => {
    let currentAudio: HTMLAudioElement | null = null;

    const unsubAudio = ipc.subscribe('sally:tts-audio', (data) => {
      // Stop any currently playing audio before starting new clip
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }

      const { audioBase64, id } = data;
      const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
      currentAudio = audio;

      audio.onended = () => {
        currentAudio = null;
        window.electron.send('sally:tts-playback-complete', { id });
      };

      audio.onerror = () => {
        console.error('[TTS] Audio playback error');
        currentAudio = null;
        window.electron.send('sally:tts-playback-complete', { id });
      };

      audio.play().catch((err) => {
        console.error('[TTS] Failed to play audio:', err);
        currentAudio = null;
        window.electron.send('sally:tts-playback-complete', { id });
      });
    });

    const unsubStop = ipc.subscribe('sally:tts-stop', () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
    });

    return () => {
      unsubAudio();
      unsubStop();
      if (currentAudio) {
        currentAudio.pause();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (livePreviewIntervalRef.current !== null) {
        window.clearInterval(livePreviewIntervalRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      analyserRef.current?.disconnect();
    };
  }, []);

  // Sound effect helper: plays a sequence of tones
  const playTones = useCallback((tones: Array<{ freq: number; start: number; dur: number; type?: OscillatorType; vol?: number }>) => {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    tones.forEach(({ freq, start, dur, type = 'sine', vol = 0.18 }) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      env.gain.setValueAtTime(0, ctx.currentTime + start);
      env.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(env);
      env.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    });

    setTimeout(() => { void ctx.close(); }, 800);
  }, []);

  // Start recording: two ascending tones (upbeat)
  const playStartChime = useCallback(() => {
    playTones([
      { freq: 880, start: 0, dur: 0.08 },
      { freq: 1320, start: 0.09, dur: 0.12 },
    ]);
  }, [playTones]);

  // Stop recording / sent: single soft confirmation blip
  const playSendChime = useCallback(() => {
    playTones([
      { freq: 1046, start: 0, dur: 0.1, vol: 0.14 },
    ]);
  }, [playTones]);

  // Task complete: three ascending happy tones
  const playCompleteChime = useCallback(() => {
    playTones([
      { freq: 784, start: 0, dur: 0.1 },
      { freq: 988, start: 0.12, dur: 0.1 },
      { freq: 1318, start: 0.24, dur: 0.18 },
    ]);
  }, [playTones]);

  // Error / failed: two descending tones
  const playErrorChime = useCallback(() => {
    playTones([
      { freq: 440, start: 0, dur: 0.12, type: 'triangle', vol: 0.15 },
      { freq: 330, start: 0.14, dur: 0.18, type: 'triangle', vol: 0.12 },
    ]);
  }, [playTones]);

  // Cancel: quick descending blip
  const playCancelChime = useCallback(() => {
    playTones([
      { freq: 660, start: 0, dur: 0.06, vol: 0.12 },
      { freq: 440, start: 0.07, dur: 0.1, vol: 0.1 },
    ]);
  }, [playTones]);

  const cleanupRecordingUi = useCallback(() => {
    setIsRecording(false);
    setAudioLevel(0);

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    analyserRef.current?.disconnect();
    analyserRef.current = null;
  }, []);

  const releaseRecordingStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const blobToBase64 = useCallback((blob: Blob) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Failed to read audio blob'));
          return;
        }
        resolve(reader.result.split(',')[1] ?? '');
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error('Failed to read audio blob'));
      };
      reader.readAsDataURL(blob);
    });
  }, []);

  const stopLiveTranscriptPreview = useCallback(() => {
    livePreviewSessionRef.current += 1;
    livePreviewRequestInFlightRef.current = false;
    if (livePreviewIntervalRef.current !== null) {
      window.clearInterval(livePreviewIntervalRef.current);
      livePreviewIntervalRef.current = null;
    }
  }, []);

  const requestLiveTranscriptPreview = useCallback(async (sessionId: number) => {
    if (livePreviewRequestInFlightRef.current || audioChunksRef.current.length === 0) return;

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    const actualMimeType = recorder.mimeType || 'audio/webm';
    const blob = new Blob(audioChunksRef.current, { type: actualMimeType });
    if (blob.size < MIN_LIVE_PREVIEW_BYTES) return;

    livePreviewRequestInFlightRef.current = true;
    try {
      const base64 = await blobToBase64(blob);
      if (!base64 || livePreviewSessionRef.current !== sessionId) return;

      const transcript = await ipc.invoke('sally:preview-transcription', {
        audioBase64: base64,
        mimeType: actualMimeType,
      });

      if (livePreviewSessionRef.current !== sessionId) return;
      if (transcript?.trim()) {
        setLiveTranscript(transcript.trim());
      }
    } catch (error) {
      console.warn('Live transcript preview failed:', error);
    } finally {
      livePreviewRequestInFlightRef.current = false;
    }
  }, [blobToBase64]);

  const startLiveTranscriptPreview = useCallback(() => {
    stopLiveTranscriptPreview();
    const sessionId = livePreviewSessionRef.current;

    void requestLiveTranscriptPreview(sessionId);
    livePreviewIntervalRef.current = window.setInterval(() => {
      void requestLiveTranscriptPreview(sessionId);
    }, LIVE_PREVIEW_INTERVAL_MS);
  }, [requestLiveTranscriptPreview, stopLiveTranscriptPreview]);

  const startRecording = useCallback(async () => {
    if (isMicMutedRef.current || isRecording) return;

    try {
      setIsComposerOpen(false);
      setLiveTranscript('');
      playStartChime();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        setAudioLevel(dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length / 255);
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const supportedType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
      const recorder = new MediaRecorder(stream, supportedType ? { mimeType: supportedType } : {});
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      startLiveTranscriptPreview();
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      cleanupRecordingUi();
      stopLiveTranscriptPreview();
      releaseRecordingStream();
    }
  }, [cleanupRecordingUi, isRecording, playStartChime, releaseRecordingStream, startLiveTranscriptPreview, stopLiveTranscriptPreview]);

  const stopRecording = useCallback(async () => {
    playSendChime();
    cleanupRecordingUi();
    stopLiveTranscriptPreview();
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        const actualMimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: actualMimeType });
        releaseRecordingStream();
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          if (base64) {
            const transcript = await ipc.invoke('sally:transcribe', { audioBase64: base64, mimeType: actualMimeType });
            if (transcript?.trim()) {
              setLiveTranscript(transcript.trim());
            }
          }
          resolve();
        };
        reader.readAsDataURL(blob);
      };
      try {
        recorder.requestData();
      } catch {
        // Ignore flush failures and still stop immediately.
      }

      try {
        recorder.stop();
      } catch {
        releaseRecordingStream();
        resolve();
      }
      mediaRecorderRef.current = null;
    });
  }, [cleanupRecordingUi, playSendChime, releaseRecordingStream, stopLiveTranscriptPreview]);

  const cancelRecording = useCallback(() => {
    playCancelChime();
    const recorder = mediaRecorderRef.current;
    cleanupRecordingUi();
    stopLiveTranscriptPreview();
    releaseRecordingStream();
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setLiveTranscript('');
  }, [cleanupRecordingUi, playCancelChime, releaseRecordingStream, stopLiveTranscriptPreview]);

  const handleSendInstruction = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;

    void ipc.invoke('sally:send-instruction', text);
    setInputText('');
    setIsComposerOpen(false);
  }, [inputText]);

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendInstruction();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsComposerOpen(false);
    }
  }, [handleSendInstruction]);

  const handlePillBodyClick = useCallback(() => {
    void ipc.invoke('window:show-config');
  }, []);

  const handleClose = useCallback(() => {
    setIsComposerOpen(false);
    if (state !== 'idle' && state !== 'awaiting_response') {
      void ipc.invoke('sally:cancel');
      return;
    }
    void ipc.invoke('window:hide-pill');
  }, [state]);

  const handleComposerToggle = useCallback(() => {
    setIsComposerOpen((current) => !current);
  }, []);

  const handleMicToggle = useCallback(() => {
    const nextMuted = !isMicMutedRef.current;

    if (nextMuted && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      cancelRecording();
    }

    setIsMicMuted(nextMuted);
    isMicMutedRef.current = nextMuted;
    void ipc.invoke('sally:set-mic-muted', nextMuted);
  }, [cancelRecording]);

  const renderStatusVisual = () => {
    if (isRecording) {
      return (
        <div style={{ width: 60, height: 18, flexShrink: 0 }}>
          <WaveformView isActive={isRecording} audioLevel={audioLevel} dotCount={14} color="#22C55E" />
        </div>
      );
    }

    if (state === 'processing') {
      return (
        <div
          className="animate-spin"
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '1.5px solid #EAB308',
            borderTopColor: 'transparent',
            flexShrink: 0,
          }}
        />
      );
    }

    return (
      <span
        className={!isMicMuted && state !== 'idle' ? 'animate-pulse' : ''}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: isMicMuted ? '#F87171' : stateColors[state],
          flexShrink: 0,
        }}
      />
    );
  };

  const isBusy = state !== 'idle' && state !== 'awaiting_response';
  const isIdlePrompt = state === 'idle' && !isComposerOpen && !isMicMuted;
  const statusLabel = isMicMuted ? 'Mic muted' : isRecording ? '' : stateLabels[state];
  const transcriptPlaceholder = isRecording
    ? 'Listening for speech...'
    : state === 'processing'
      ? 'Transcribing your request...'
      : state === 'acting' || state === 'speaking'
        ? 'Working on your request...'
        : 'Transcript ready';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: isComposerOpen || isTranscriptVisible ? 10 : 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 48,
          width: isComposerOpen || isTranscriptVisible ? PILL_WIDTH : '100%',
          padding: '0 6px 0 4px',
          gap: 6,
          background: PILL_BG,
          backdropFilter: PILL_BLUR,
          WebkitBackdropFilter: PILL_BLUR,
          border: PILL_BORDER,
          boxShadow: '0 16px 36px rgba(0,0,0,0.35)',
          borderRadius: 24,
          flexShrink: 0,
          // @ts-expect-error: Electron-specific
          WebkitAppRegion: 'drag',
          cursor: 'grab',
        }}
      >
        <div
          onClick={handlePillBodyClick}
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            // @ts-expect-error: Electron-specific
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <img src={logoSrc} alt="" style={{ width: 48, height: 48, objectFit: 'cover' }} />
        </div>

        <div
          style={{
            flex: 1,
            minWidth: isIdlePrompt ? 230 : 0,
            height: 34,
            borderRadius: 17,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: isIdlePrompt ? '0 14px' : '0 12px',
            background: isMicMuted ? 'rgba(127,29,29,0.38)' : 'rgba(0,0,0,0.38)',
            border: isMicMuted ? '1px solid rgba(248,113,113,0.22)' : '1px solid rgba(255,255,255,0.05)',
            color: '#FFFFFF',
            // @ts-expect-error: Electron-specific
            WebkitAppRegion: 'no-drag',
          }}
        >
          {renderStatusVisual()}
          {statusLabel && (
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: isMicMuted ? '#FECACA' : 'rgba(255,255,255,0.92)',
                whiteSpace: 'nowrap',
                overflow: isIdlePrompt ? 'visible' : 'hidden',
                textOverflow: isIdlePrompt ? 'clip' : 'ellipsis',
              }}
            >
              {statusLabel}
            </span>
          )}
        </div>

        <button
          onClick={handleMicToggle}
          title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isMicMuted ? 'rgba(239,68,68,0.18)' : 'rgba(0,0,0,0.32)',
            border: isMicMuted ? '1px solid rgba(248,113,113,0.24)' : 'none',
            color: isMicMuted ? '#FECACA' : 'rgba(255,255,255,0.82)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s, color 0.15s, transform 0.15s',
            // @ts-expect-error: Electron-specific
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.transform = 'scale(1.08)';
            event.currentTarget.style.background = isMicMuted ? 'rgba(239,68,68,0.24)' : 'rgba(0,0,0,0.42)';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.transform = 'scale(1)';
            event.currentTarget.style.background = isMicMuted ? 'rgba(239,68,68,0.18)' : 'rgba(0,0,0,0.32)';
          }}
        >
          <MicIcon muted={isMicMuted} />
        </button>

        <button
          onClick={handleComposerToggle}
          title={isComposerOpen ? 'Hide keyboard' : 'Show keyboard'}
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isComposerOpen ? 'rgba(37,99,235,0.22)' : 'rgba(0,0,0,0.32)',
            border: isComposerOpen ? '1px solid rgba(96,165,250,0.26)' : 'none',
            color: isComposerOpen ? '#DBEAFE' : 'rgba(255,255,255,0.82)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s, color 0.15s, transform 0.15s',
            // @ts-expect-error: Electron-specific
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.transform = 'scale(1.08)';
            event.currentTarget.style.background = isComposerOpen ? 'rgba(37,99,235,0.28)' : 'rgba(0,0,0,0.42)';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.transform = 'scale(1)';
            event.currentTarget.style.background = isComposerOpen ? 'rgba(37,99,235,0.22)' : 'rgba(0,0,0,0.32)';
          }}
        >
          <KeyboardIcon />
        </button>

        <button
          onClick={handleClose}
          title={isBusy ? 'Cancel current action' : 'Dismiss'}
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isBusy ? 'rgba(239,68,68,0.14)' : 'rgba(0,0,0,0.32)',
            border: 'none',
            color: isBusy ? '#FECACA' : 'rgba(255,255,255,0.72)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s, color 0.15s, transform 0.15s',
            // @ts-expect-error: Electron-specific
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = isBusy ? 'rgba(239,68,68,0.2)' : 'rgba(0,0,0,0.42)';
            event.currentTarget.style.color = '#FFFFFF';
            event.currentTarget.style.transform = 'scale(1.08)';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = isBusy ? 'rgba(239,68,68,0.14)' : 'rgba(0,0,0,0.32)';
            event.currentTarget.style.color = isBusy ? '#FECACA' : 'rgba(255,255,255,0.72)';
            event.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <CloseIcon />
        </button>
      </div>

      {isTranscriptVisible && (
        <div
          style={{
            width: TRANSCRIPT_WIDTH,
            height: 46,
            padding: '0 14px',
            borderRadius: 23,
            background: COMPOSER_BG,
            backdropFilter: PILL_BLUR,
            WebkitBackdropFilter: PILL_BLUR,
            border: COMPOSER_BORDER,
            boxShadow: '0 18px 40px rgba(0,0,0,0.32)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            // @ts-expect-error: Electron-specific
            WebkitAppRegion: 'no-drag',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#22C55E',
              flexShrink: 0,
              boxShadow: '0 0 12px rgba(34,197,94,0.35)',
            }}
          />
          <div
            ref={transcriptScrollRef}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
              overflowX: 'hidden',
              overflowY: 'hidden',
              whiteSpace: 'nowrap',
              position: 'relative',
              maskImage: liveTranscript ? 'linear-gradient(to left, transparent 0%, black 10%, black 100%)' : 'none',
              WebkitMaskImage: liveTranscript ? 'linear-gradient(to left, transparent 0%, black 10%, black 100%)' : 'none',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                paddingRight: 20,
                fontSize: 12,
                fontWeight: 500,
                color: liveTranscript ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.52)',
                transform: 'translateY(-1px)',
              }}
            >
              {liveTranscript || transcriptPlaceholder}
            </span>
          </div>
        </div>
      )}

      {isComposerOpen && (
        <div
          style={{
            width: '100%',
            maxWidth: COMPOSER_WIDTH,
            padding: 12,
            borderRadius: 22,
            background: COMPOSER_BG,
            backdropFilter: PILL_BLUR,
            WebkitBackdropFilter: PILL_BLUR,
            border: COMPOSER_BORDER,
            boxShadow: '0 18px 40px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            // @ts-expect-error: Electron-specific
            WebkitAppRegion: 'no-drag',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.62)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Type to Sally
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Type a question or command..."
              style={{
                flex: 1,
                height: 38,
                padding: '0 12px',
                background: 'rgba(0,0,0,0.34)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14,
                color: '#FFFFFF',
                fontSize: 12.5,
                outline: 'none',
              }}
              onFocus={(event) => {
                event.target.style.borderColor = 'rgba(96,165,250,0.65)';
              }}
              onBlur={(event) => {
                event.target.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            />

            <button
              onClick={handleSendInstruction}
              disabled={!inputText.trim()}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: inputText.trim() ? ACCENT : 'rgba(0,0,0,0.32)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: inputText.trim() ? 'pointer' : 'default',
                flexShrink: 0,
                transition: 'background 0.15s, transform 0.15s',
              }}
              onMouseEnter={(event) => {
                if (!inputText.trim()) return;
                event.currentTarget.style.background = '#1D4ED8';
                event.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = inputText.trim() ? ACCENT : 'rgba(0,0,0,0.32)';
                event.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
