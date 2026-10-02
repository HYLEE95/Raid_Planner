import { formatExtendedTime } from '../../lib/huntVote';
import { getDayName } from '../../lib/storage';
import type { HuntAssignment } from '../../lib/types';
import { HUNT_CLASS_BADGE } from './huntClassColors';

interface Props {
  assignment: HuntAssignment;
}

export default function HuntAssignmentView({ assignment }: Props) {
  const slots = [...assignment.slots].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)
  );

  if (slots.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <p className="text-lg">저장된 배정이 없습니다.</p>
        <p className="text-sm mt-2">투표 결과 화면에서 파티를 배정하고 저장해주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {slots.map(slot => {
        const d = new Date(slot.date + 'T00:00:00');
        const total = slot.parties.reduce((s, p) => s + p.members.length, 0);
        return (
          <div
            key={`${slot.date}|${slot.start_time}`}
            className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-bold text-gray-800 dark:text-gray-200">
                {d.getMonth() + 1}/{d.getDate()} ({getDayName(d)}) {formatExtendedTime(slot.start_time)}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {slot.parties.length}파티 · {total}명
              </span>
            </div>
            <div className="space-y-2">
              {slot.parties.map((p, i) => (
                <div key={p.id} className="flex items-start gap-2 flex-wrap">
                  <span className="shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-400 pt-1">
                    {i + 1}파티 ({p.members.length}/{p.capacity})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {p.members.map((m, k) => (
                      <span
                        key={`${m.nickname}-${k}`}
                        className={`px-2 py-1 rounded text-xs ${HUNT_CLASS_BADGE[m.class_type] ?? 'bg-gray-500 text-white'}`}
                      >
                        {m.isMercenary && <span className="opacity-80 mr-1">[용병]</span>}
                        {m.nickname}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
