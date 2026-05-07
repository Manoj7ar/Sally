import { useEffect, useState, useRef } from 'react';

interface WaveformViewProps {
  isActive: boolean;
  isProcessing?: boolean;
  audioLevel?: number;
  dotCount?: number;
  color?: string;
}

export default function WaveformView({
  isActive,
  isProcessing = false,
  audioLevel = 0,
  dotCount = 24,
  color = 'white',
}: WaveformViewProps) {
  const [heights, setHeights] = useState<number[]>(Array(dotCount).fill(5));
  const animationRef = useRef<number | null>(null);
  const audioLevelRef = useRef<number>(0);
  const smoothedRef = useRef<number>(0);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    if (!isActive && !isProcessing) {
      setHeights(Array(dotCount).fill(5));
      smoothedRef.current = 0;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const startTime = Date.now();

    const animate = () => {
      const t = (Date.now() - startTime) / 1000;
      const raw = audioLevelRef.current;
      smoothedRef.current += (raw - smoothedRef.current) * 0.18;
      const level = smoothedRef.current;
      const boosted = Math.pow(level, 0.55);

      const minH = 5;
      const maxH = 18;

      const newHeights = Array(dotCount).fill(0).map((_, i) => {
        const pos = i / (dotCount - 1);
        const center = 1 - Math.abs(pos - 0.5) * 1.55;
        const wobble = Math.sin(t * 2.4 + i * 0.42) * 0.08;
        const base = minH + (maxH - minH) * boosted * center;
        const h = base * (1 + wobble);
        return Math.max(minH, Math.min(maxH, h));
      });

      setHeights(newHeights);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, isProcessing, dotCount]);

  if (isProcessing) {
    return (
      <div className="flex items-center justify-center h-full px-2">
        <div
          className="animate-spin rounded-full border-2 border-t-transparent"
          style={{ width: '14px', height: '14px', borderColor: color, borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-[3px] h-full px-2">
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            width: '3px',
            height: `${h}px`,
            backgroundColor: color,
            borderRadius: '999px',
            transition: 'height 90ms ease-out',
          }}
        />
      ))}
    </div>
  );
}
