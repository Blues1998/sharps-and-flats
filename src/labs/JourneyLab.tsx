import React from 'react';
import type { ActiveTab } from '../components/Sidebar';
import { LabIcon } from '../components/LabIcon';
import { NeckPath } from '../components/NeckPath';

// The whole neck, nut to the second octave. Today shows the few frets around
// where you are; this is the full map.
export const JourneyLab: React.FC<{ setActiveTab: (tab: ActiveTab) => void }> = ({ setActiveTab }) => (
  <div className="journey-neck">
    <div className="lab-header">
      <h2 className="lab-title"><LabIcon tab="journey" />Journey</h2>
    </div>
    <NeckPath mode="full" setActiveTab={setActiveTab} />
  </div>
);
export default JourneyLab;
