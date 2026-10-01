import { useMemo, useState } from 'react';
import { buildHeatmap, formatExtendedTime, heatmapKey } from '../../lib/huntVote';
import { formatDate, getWeekDates, getDayName } from '../../lib/storage';
import type { DBRegistration } from '../../lib/types';
import HuntHeatmap from './HuntHeatmap';
import type { SelectedCell } from './HuntHeatmap';
import HuntVoterList from './HuntVoterList';

interface Props {
  registrations: DBRegistration[];
  weekStart: string;
}

export default function HuntVoteBoard({ registrations, weekStart }: Props) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const weekDates = useMemo(
    () => getWeekDates(new Date(weekStart + 'T00:00:00')),
    [weekStart]
  );
  const weekDateStrs = useMemo(() => weekDates.map(formatDate), [weekDates]);
  const heatmap = useMemo(
    () => buildHeatmap(registrations, weekDateStrs),
    [registrations, weekDateStrs]
  );

  const voters = selected ? heatmap.get(heatmapKey(selected.date, selected.start)) ?? [] : [];

  const selectedLabel = selected
    ? `${new Date(selected.date + 'T00:00:00').getMonth() + 1}/${new Date(selected.date + 'T00:00:00').getDate()}` +
      ` (${getDayName(new Date(selected.date + 'T00:00:00'))}) ${formatExtendedTime(selected.start)}`
    : '';

  return (
    <div>
      <HuntHeatmap
        heatmap={heatmap}
        weekDates={weekDates}
        selected={selected}
        onSelect={setSelected}
      />

      {selected && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {selectedLabel} 가능 인원 ({voters.length}명)
          </h2>
          <HuntVoterList
            voters={voters}
            assignedCounts={new Map()}
            disabled={new Set()}
          />
        </section>
      )}
    </div>
  );
}
