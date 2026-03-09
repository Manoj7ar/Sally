export default function BorderOverlay() {
  const overlayColor = '#2563EB';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        border: `3px solid ${overlayColor}`,
        borderRadius: '12px',
        boxShadow: 'inset 0 0 20px rgba(37, 99, 235, 0.3), 0 0 20px rgba(37, 99, 235, 0.2)',
        zIndex: 999999,
      }}
    />
  );
}
