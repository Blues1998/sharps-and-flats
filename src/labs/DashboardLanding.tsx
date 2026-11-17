import React from 'react';
import type { ActiveTab } from '../components/Sidebar';
import { NeckPath } from '../components/NeckPath';
import { TodayStatus } from '../components/TodayStatus';

interface DashboardLandingProps {
  setActiveTab: (tab: ActiveTab) => void;
  onOpenSong?: (id: string) => void;
  onAddSong?: () => void;
}

/**
 * Today is the neck. The whole screen is your way through the course: a bar
 * with where you stand, a banner naming the fret you are on, and the frets
 * from the nut up, scrolling like a path. Songs, the week and the streak's
 * detail live on their own tabs.
 */
export const DashboardLanding: React.FC<DashboardLandingProps> = ({ setActiveTab }) => (
  <div className="today">
    {/* On a phone the same bar sits in the top bar; on a wide screen, here. */}
    <TodayStatus className="today-status-wide" />
    <NeckPath mode="today" setActiveTab={setActiveTab} />
  </div>
);

export default DashboardLanding;
