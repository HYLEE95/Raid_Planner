import { useMemo, useState } from 'react';
import { HUNT_SLOT_STARTS, formatExtendedTime, heatmapKey } from '../../lib/huntVote';
import type { HuntVoter } from '../../lib/huntVote';
import { HIGHLIGHT_CLASSES } from '../../lib/types';
import { formatDate, getDayName } from '../../lib/storage';

export interface SelectedCell {
  date: string;
  start: string;
}

interface Props {
  heatmap: Map<string, HuntVoter[]>;
  weekDates: Date[];
  selected: SelectedCell | null;
  onSelect: (cell: SelectedCell) => void;
  /** 배정(파티)이 존재하는 슬롯의 heatmapKey 집합. 인원 0이어도 숨기지 않는다. */
  assignedKeys: Set<string>;
}

export default function HuntHeatmap({ heatmap, weekDates, selected, onSelect, assignedKeys }: Props) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const dateStrs = useMemo(() => weekDates.map(formatDate), [weekDates]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const list of heatmap.values()) max = Math.max(max, list.length);
    return Math.max(max, 1);
  }, [heatmap]);

  const rows = useMemo(() => {
    if (!hideEmpty) return HUNT_SLOT_STARTS;
    return HUNT_SLOT_STARTS.filter(s =>
      dateStrs.some(d => {
        const key = heatmapKey(d, s);
        return (heatmap.get(key)?.length ?? 0) > 0 || assignedKeys.has(key);
      })
    );
  }, [hideEmpty, heatmap, dateStrs, assignedKeys]);

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">투표 결과</h2>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={() => setHideEmpty(!hideEmpty)}
            className="w-3.5 h-3.5 text-indigo-600"
          />
          <span className="text-xs text-gray-600 dark:text-gray-400">인원 0인 시간대 숨기기</span>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
          아직 투표한 인원이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 p-1 text-right text-gray-500 dark:text-gray-400 font-medium">
                  시간
                </th>
                {weekDates.map(d => (
                  <th key={d.getTime()} className="p-1 min-w-[44px] text-gray-600 dark:text-gray-300 font-semibold">
                    <div>{getDayName(d)}</div>
                    <div className="text-[10px] font-normal opacity-70">{d.getMonth() + 1}/{d.getDate()}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(start => (
                <tr key={start}>
                  <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 p-1 text-right font-normal whitespace-nowrap text-gray-500 dark:text-gray-400">
                    {formatExtendedTime(start)}
                  </th>
                  {dateStrs.map(ds => {
                    const voters = heatmap.get(heatmapKey(ds, start)) ?? [];
                    const count = voters.length;
                    const hasHighlight = voters.some(v => v.characters.some(c => HIGHLIGHT_CLASSES.includes(c.class_type)));
                    const isSel = selected?.date === ds && selected?.start === start;
                    return (
                      <td key={ds} className="p-0.5">
                        <button
                          onClick={() => onSelect({ date: ds, start })}
                          style={count > 0 ? { backgroundColor: `rgba(99,102,241,${0.12 + 0.68 * (count / maxCount)})` } : undefined}
                          className={`relative w-full h-7 rounded text-[11px] font-semibold transition-all ${
                            count > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-700 bg-gray-100 dark:bg-gray-800'
                          } ${isSel ? 'ring-2 ring-offset-1 ring-indigo-600 dark:ring-offset-gray-900' : ''}`}
                        >
                          {count > 0 ? count : ''}
                          {hasHighlight && (
                            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
        숫자는 가능한 소유주 수입니다. 금색 점은 세바 캐릭터를 가진 소유주가 1명 이상인 시간대입니다.
      </p>
    </section>
  );
}
