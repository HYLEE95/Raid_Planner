import type { HuntVoter } from '../../lib/huntVote';
import { HUNT_CLASS_BADGE } from './huntClassColors';

interface Props {
  voters: HuntVoter[];
  assignedCounts: Map<string, number>;
  disabled: Set<string>;
  onPick?: (voter: HuntVoter) => void;
}

export default function HuntVoterList({ voters, assignedCounts, disabled, onPick }: Props) {
  if (voters.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">이 시간대에 가능한 인원이 없습니다.</p>;
  }

  const groups = new Map<string, HuntVoter[]>();
  for (const v of voters) {
    if (!groups.has(v.class_type)) groups.set(v.class_type, []);
    groups.get(v.class_type)!.push(v);
  }

  return (
    <div className="space-y-2">
      {[...groups.entries()].map(([cls, list]) => (
        <div key={cls} className="flex items-start gap-2">
          <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${HUNT_CLASS_BADGE[cls] ?? 'bg-gray-500 text-white'}`}>
            {cls}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {list.map(v => {
              const count = assignedCounts.get(v.nickname) ?? 0;
              const isDisabled = disabled.has(v.nickname);
              return (
                <button
                  key={v.nickname}
                  onClick={() => onPick?.(v)}
                  disabled={isDisabled || !onPick}
                  title={`${v.ownerName} 소유`}
                  className={`px-2 py-1 rounded border text-xs transition-colors ${
                    isDisabled
                      ? 'opacity-40 cursor-not-allowed border-gray-300 dark:border-gray-600 text-gray-500'
                      : onPick
                        ? 'border-indigo-300 dark:border-indigo-600 text-gray-800 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'
                        : 'border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 cursor-default'
                  }`}
                >
                  {v.nickname}
                  {count > 0 && (
                    <span className="ml-1 px-1 rounded bg-gray-200 dark:bg-gray-700 text-[10px] text-gray-600 dark:text-gray-300">
                      {count}회 배정
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
