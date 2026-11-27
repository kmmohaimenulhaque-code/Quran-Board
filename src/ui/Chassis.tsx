import React from 'react';

export type ActiveTab = 'face-a' | 'face-b' | 'surahs' | 'offline';

interface ChassisProps {
  flipped: boolean;
  activeTab: ActiveTab;
  onSelectFaceA: () => void;
  onSelectFaceB: () => void;
  onToggleSurahs: () => void;
  onToggleOffline: () => void;
  onEdgePressStart: () => void;
  onEdgePressEnd: () => void;
  edgeClassName: string;
  overlays: React.ReactNode;
  children: React.ReactNode;
}

export const Chassis: React.FC<ChassisProps> = ({
  flipped,
  activeTab,
  onSelectFaceA,
  onSelectFaceB,
  onToggleSurahs,
  onToggleOffline,
  onEdgePressStart,
  onEdgePressEnd,
  edgeClassName,
  overlays,
  children
}) => (
  <div className="stage">
    <div className="slab-shell">
      <div className="slab-3d-stage">
        <div className={`chassis-assembly ${flipped ? 'flipped' : ''}`}>{children}</div>
      </div>
      {overlays}
      <button
        type="button"
        className={`rim-button-mount ${edgeClassName}`}
        aria-label="Play, pause, or hold to flip"
        onPointerDown={(e) => {
          e.preventDefault();
          onEdgePressStart();
        }}
        onPointerUp={onEdgePressEnd}
        onPointerCancel={onEdgePressEnd}
      >
        <span className="rim-led" />
      </button>
    </div>

    <div className="face-dock" role="tablist" aria-label="Instrument Face Selector">
      <button
        type="button"
        className={`face-dock-btn ${activeTab === 'face-a' ? 'active-a' : ''}`}
        role="tab"
        aria-selected={activeTab === 'face-a'}
        onClick={onSelectFaceA}
      >
        Face A
      </button>
      <button
        type="button"
        className={`face-dock-btn ${activeTab === 'face-b' ? 'active-b' : ''}`}
        role="tab"
        aria-selected={activeTab === 'face-b'}
        onClick={onSelectFaceB}
      >
        Face B
      </button>
      <button
        type="button"
        className={`face-dock-btn ${activeTab === 'surahs' ? 'active-s' : ''}`}
        role="tab"
        aria-selected={activeTab === 'surahs'}
        onClick={onToggleSurahs}
      >
        114 Surahs
      </button>
      <button
        type="button"
        className={`face-dock-btn ${activeTab === 'offline' ? 'active-o' : ''}`}
        role="tab"
        aria-selected={activeTab === 'offline'}
        onClick={onToggleOffline}
      >
        Offline
      </button>
    </div>
  </div>
);
