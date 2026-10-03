import type { HuntCharacter, HuntVoter } from '../../lib/huntVote';
import { HUNT_CLASS_BADGE } from './huntClassColors';

interface Props {
  voters: HuntVoter[];
  /** 소유주별 배정 횟수 */
  assignedCounts: Map<string, number>;
  /** 이 시간대에 이미 배정된 소유주 */
  disabled: Set<string>;
  onPick?: (voter: HuntVoter, character: HuntCharacter) => void;
}

export default function HuntVoterList({ voters, assignedCounts, disabled, onPick }: Props) {
  if (voters.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">이 시간대에 가능한 인원이 없습니다.</p>;
  }

  return (
    <div className="space-y-1.5">
      {voters.map(v => {
        const count = assignedCounts.get(v.ownerName) ?? 0;
        const isDisabled = disabled.has(v.ownerName);
        return (
          <div
            key={v.ownerName}
            className={`flex items-center gap-2 flex-wrap ${isDisabled ? 'opacity-40' : ''}`}
            title={isDisabled ? '이 시간대에 이미 배정된 소유주입니다' : undefined}
          >
            <span className="min-w-[4.5rem] text-sm font-medium text-gray-800 dark:text-gray-200">
              {v.ownerName}
            </span>
            {count > 0 && (
              <span className="px-1 rounded bg-gray-200 dark:bg-gray-700 text-[10px] text-gray-600 dark:text-gray-300">
                {count}회 배정
              </span>
            )}
            <div className="flex flex-wrap gap-1">
              {v.characters.map(c => (
                <button
                  key={c.nickname}
                  onClick={() => onPick?.(v, c)}
                  disabled={isDisabled || !onPick}
                  title={c.nickname}
                  className={`px-2 py-0.5 rounded text-xs font-bold ${HUNT_CLASS_BADGE[c.class_type] ?? 'bg-gray-500 text-white'} ${
                    isDisabled ? 'cursor-not-allowed' : onPick ? 'hover:brightness-110' : 'cursor-default'
                  }`}
                >
                  {c.class_type}
                  {c.nickname !== v.ownerName && (
                    <span className="ml-1 font-normal opacity-80">{c.nickname}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
