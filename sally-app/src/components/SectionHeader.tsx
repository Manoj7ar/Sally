import { useScrollReveal } from '../hooks/useScrollReveal';

interface SectionHeaderProps {
  tag: string;
  label: string;
  sub: string;
  subStyle?: React.CSSProperties;
}

export function SectionHeader({ tag, label, sub, subStyle }: SectionHeaderProps) {
  const tagRef = useScrollReveal<HTMLSpanElement>();
  const labelRef = useScrollReveal<HTMLHeadingElement>();
  const subRef = useScrollReveal<HTMLParagraphElement>();

  return (
    <>
      <span className="section-tag reveal" ref={tagRef}>{tag}</span>
      <h2 className="section-label reveal" ref={labelRef}>{label}</h2>
      <p className="section-sub reveal" ref={subRef} style={subStyle}>{sub}</p>
    </>
  );
}
