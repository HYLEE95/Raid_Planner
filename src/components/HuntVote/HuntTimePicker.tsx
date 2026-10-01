import { HUNT_TIME_OPTIONS, formatExtendedTime } from '../../lib/huntVote';
import { formatDate, getDayName } from '../../lib/storage';

export interface HuntDateSelection {
  date: string;
  allDay: boolean;
  timeRanges: { start: string; end: string }[];
}

export const HUNT_ALL_DAY_START = HUNT_TIME_OPTIONS[0];
export const HUNT_ALL_DAY_END = HUNT_TIME_OPTIONS[HUNT_TIME_OPTIONS.length - 1];
const DEFAULT_RANGE = { start: '20:00', end: '23:00' };

interface Props {
  weekDates: Date[];
  selections: HuntDateSelection[];
  onChange: (next: HuntDateSelection[]) => void;
}

export default function HuntTimePicker({ weekDates, selections, onChange }: Props) {
  const toggleDate = (dateStr: string) => {
    const exists = selections.find(d => d.date === dateStr);
    if (exists) {
      onChange(selections.filter(d => d.date !== dateStr));
    } else {
      onChange([...selections, { date: dateStr, allDay: false, timeRanges: [{ ...DEFAULT_RANGE }] }]);
    }
  };

  const patch = (dateStr: string, fn: (d: HuntDateSelection) => HuntDateSelection) =>
    onChange(selections.map(d => (d.date === dateStr ? fn(d) : d)));

  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">가능 요일 선택</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        오전 9시 ~ 익일 새벽 1시, 30분 단위로 고를 수 있습니다.
      </p>

      <div className="flex gap-2 flex-wrap mb-4">
        {weekDates.map(date => {
          const dateStr = formatDate(date);
          const selected = selections.some(d => d.date === dateStr);
          return (
            <button
              key={dateStr}
              onClick={() => toggleDate(dateStr)}
              className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                selected
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <div className="font-medium">{getDayName(date)}</div>
              <div className="text-xs opacity-75">{date.getMonth() + 1}/{date.getDate()}</div>
            </button>
          );
        })}
      </div>

      {[...selections]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(ds => {
          const date = new Date(ds.date + 'T00:00:00');
          return (
            <div
              key={ds.date}
              className="mb-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {date.getMonth() + 1}/{date.getDate()} ({getDayName(date)})
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ds.allDay}
                      onChange={() => patch(ds.date, d => ({ ...d, allDay: !d.allDay }))}
                      className="w-3.5 h-3.5 text-indigo-600"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400">시간 무관</span>
                  </label>
                </div>
                {!ds.allDay && (
                  <button
                    onClick={() => patch(ds.date, d => ({ ...d, timeRanges: [...d.timeRanges, { ...DEFAULT_RANGE }] }))}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    + 시간대 추가
                  </button>
                )}
              </div>

              {ds.allDay ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 italic py-1">
                  09:00 ~ 익일 01:00 전부 가능
                </div>
              ) : (
                ds.timeRanges.map((tr, idx) => (
                  <div key={idx} className="flex items-center gap-2 mb-2 flex-wrap">
                    <select
                      value={tr.start}
                      onChange={e => patch(ds.date, d => ({
                        ...d,
                        timeRanges: d.timeRanges.map((r, i) => (i === idx ? { ...r, start: e.target.value } : r)),
                      }))}
                      className="p-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                    >
                      {HUNT_TIME_OPTIONS.map(t => (
                        <option key={t} value={t}>{formatExtendedTime(t)}</option>
                      ))}
                    </select>
                    <span className="text-gray-600 dark:text-gray-400">~</span>
                    <select
                      value={tr.end}
                      onChange={e => patch(ds.date, d => ({
                        ...d,
                        timeRanges: d.timeRanges.map((r, i) => (i === idx ? { ...r, end: e.target.value } : r)),
                      }))}
                      className="p-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                    >
                      {HUNT_TIME_OPTIONS.map(t => (
                        <option key={t} value={t}>{formatExtendedTime(t)}</option>
                      ))}
                    </select>
                    {ds.timeRanges.length > 1 && (
                      <button
                        onClick={() => patch(ds.date, d => ({
                          ...d,
                          timeRanges: d.timeRanges.filter((_, i) => i !== idx),
                        }))}
                        className="text-red-400 text-xs hover:text-red-600"
                      >
                        삭제
                      </button>
                    )}
                    {tr.start >= tr.end && (
                      <span className="text-red-500 text-xs">시작 시간이 종료보다 빨라야 합니다</span>
                    )}
                  </div>
                ))
              )}
            </div>
          );
        })}
    </section>
  );
}
