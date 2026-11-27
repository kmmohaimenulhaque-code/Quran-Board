import React from 'react';
import { SevenSegment, SevenSegmentHyphen } from './SevenSegment';
import { RockerPair } from './RockerPair';
import type { RangeFocus } from '../core/types';

interface ControlFaceProps {
  reciterId: number;
  page: number;
  rangeStart: number;
  rangeEnd: number;
  rangeFocus: RangeFocus;
  repetition: number;
  bezelPeek: string | null;
  isError: boolean;
  onStepReciter: (delta: 1 | -1) => void;
  onStepPage: (delta: 1 | -1) => void;
  onStepRange: (delta: 1 | -1) => void;
  onFocusRange: (focus: RangeFocus) => void;
  onStepRepetition: (delta: 1 | -1) => void;
  onStart: () => void;
  prefetching: boolean;
}

export const ControlFace: React.FC<ControlFaceProps> = ({
  reciterId,
  page,
  rangeStart,
  rangeEnd,
  rangeFocus,
  repetition,
  bezelPeek,
  isError,
  onStepReciter,
  onStepPage,
  onStepRange,
  onFocusRange,
  onStepRepetition,
  onStart,
  prefetching
}) => (
  <section className="slab-face face-a" aria-label="Control Deck">
    <div className="control-rows">
      <div className="control-row">
        <span className="row-label">Reciter</span>
        <div className="led-readout">
          <SevenSegment value={reciterId} minDigits={2} />
        </div>
        <RockerPair label="Reciter" onStep={onStepReciter} />
      </div>

      <div className="control-row">
        <span className="row-label">Page number</span>
        <div className="led-readout">
          <SevenSegment value={page} minDigits={page >= 100 ? 3 : 2} />
        </div>
        <RockerPair label="Page number" onStep={onStepPage} />
      </div>

      <div className="control-row">
        <span className="row-label">Verse ranges</span>
        <div className="led-readout">
          <SevenSegment
            value={rangeStart}
            minDigits={2}
            focused={rangeFocus === 'start'}
            onClick={() => onFocusRange('start')}
          />
          <SevenSegmentHyphen />
          <SevenSegment
            value={rangeEnd}
            minDigits={2}
            focused={rangeFocus === 'end'}
            onClick={() => onFocusRange('end')}
          />
        </div>
        <RockerPair label="Verse ranges" onStep={onStepRange} />
      </div>

      <div className="control-row">
        <span className="row-label">Repetition</span>
        <div className="led-readout">
          <SevenSegment value={repetition} minDigits={2} />
        </div>
        <RockerPair label="Repetition" onStep={onStepRepetition} />
      </div>
    </div>

    <div className="face-a-bezel">
      <span className={`reciter-peek ${bezelPeek ? 'visible' : ''} ${isError ? 'error' : ''}`}>
        {bezelPeek ?? ''}
      </span>
    </div>

    <button
      type="button"
      className={`rim-button-mount ${prefetching ? 'prefetching' : ''}`}
      aria-label="Start recitation"
      onClick={onStart}
    >
      <span className="rim-led" />
    </button>
  </section>
);
