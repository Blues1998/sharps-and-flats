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
 * Today is the neck, drawn as a map: your unit's notes and one card with
 * Start; finished units fold into their milestones. The bar says where you
 * stand. The detailed neck, panels and all, is the Journey page.
 */
export const DashboardLanding: React.FC<DashboardLandingProps> = ({ setActiveTab }) => (
  <div className="today">
    {/* On a phone the same bar sits in the top bar; on a wide screen, here. */}
    <TodayStatus className="today-status-wide" />
    <NeckPath mode="today" setActiveTab={setActiveTab} />
  </div>
);

export default DashboardLanding;
