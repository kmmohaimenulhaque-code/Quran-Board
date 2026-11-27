import React from 'react';

interface ChassisProps {
  flipped: boolean;
  onSelectFaceA: () => void;
  onSelectFaceB: () => void;
  children: React.ReactNode;
}

export const Chassis: React.FC<ChassisProps> = ({ flipped, onSelectFaceA, onSelectFaceB, children }) => (
  <div className="stage">
    <div className="slab-shell">
      <div className={`chassis-assembly ${flipped ? 'flipped' : ''}`}>{children}</div>
    </div>
    <div className="face-dock" role="tablist" aria-label="Instrument Face Selector">
      <button
        type="button"
        className={`face-dock-btn ${!flipped ? 'active-a' : ''}`}
        role="tab"
        aria-selected={!flipped}
        onClick={onSelectFaceA}
      >
        Face A
      </button>
      <button
        type="button"
        className={`face-dock-btn ${flipped ? 'active-b' : ''}`}
        role="tab"
        aria-selected={flipped}
        onClick={onSelectFaceB}
      >
        Face B
      </button>
    </div>
  </div>
);
