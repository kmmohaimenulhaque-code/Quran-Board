import React from 'react';

const DIGIT_MAP: Record<string, number[]> = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1]
};

const SEG_PATHS = [
  'M 6 3 L 22 3 L 19.5 6.8 L 8.5 6.8 Z',
  'M 23.2 4.2 L 25.4 6.4 L 23.4 20.8 L 20.5 22.5 L 18.8 19.8 L 20.6 7.5 Z',
  'M 20.2 25.5 L 22.8 27.2 L 20.8 41.6 L 18.2 43.8 L 16.2 40.5 L 18 28.2 Z',
  'M 3.2 44.8 L 17.4 44.8 L 15.2 41 L 5.8 41 Z',
  'M 4.4 27.2 L 7.2 25.5 L 8.8 28.2 L 7 40.5 L 3.8 43.8 L 2.2 41.6 Z',
  'M 7 6.4 L 9.4 4.2 L 11.4 7.5 L 9.6 19.8 L 6.8 22.5 L 4.8 20.8 Z',
  'M 8 24 L 10.6 21.8 L 18.2 21.8 L 20 24 L 17.6 26.2 L 10 26.2 Z'
];

interface SevenSegmentProps {
  value: number;
  minDigits?: number;
  focused?: boolean;
  onClick?: () => void;
}

export const SevenSegment: React.FC<SevenSegmentProps> = ({
  value,
  minDigits = 2,
  focused = false,
  onClick
}) => {
  const chars = String(value).padStart(minDigits, '0').split('');
  return (
    <div
      className={`led-group ${onClick ? 'selectable' : ''} ${focused ? 'active-focus' : ''}`}
      onPointerDown={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      {chars.map((ch, idx) => {
        const mask = DIGIT_MAP[ch] ?? [0, 0, 0, 0, 0, 0, 0];
        return (
          <svg key={idx} className="seg-svg" viewBox="0 0 28 48" aria-hidden="true">
            {SEG_PATHS.map((d, sIdx) => (
              <path
                key={sIdx}
                d={d}
                fill={mask[sIdx] ? '#FF542E' : 'rgba(255, 84, 46, 0.065)'}
                style={mask[sIdx] ? { filter: 'drop-shadow(0 0 6px rgba(255, 68, 26, 0.72))' } : undefined}
              />
            ))}
          </svg>
        );
      })}
    </div>
  );
};

export const SevenSegmentHyphen: React.FC = () => (
  <svg className="seg-hyphen" viewBox="0 0 18 48" aria-hidden="true">
    <path
      d="M 3 24 L 5.2 21.8 L 12.8 21.8 L 15 24 L 12.8 26.2 L 5.2 26.2 Z"
      fill="#FF542E"
      style={{ filter: 'drop-shadow(0 0 6px rgba(255, 68, 26, 0.68))' }}
    />
  </svg>
);
