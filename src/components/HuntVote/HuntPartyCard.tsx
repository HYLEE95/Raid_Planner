import { useState } from 'react';
import type { ClassType, HuntParty } from '../../lib/types';
import { CLASS_TYPES_BY_RAID } from '../../lib/types';
import { HUNT_CLASS_BADGE } from './huntClassColors';

interface Props {
  party: HuntParty;
  index: number;
  isActive: boolean;
  onActivate: () => void;
  onCapacityChange: (cap: 3 | 4) => void;
  onRemoveMember: (memberIdx: number) => void;
  onRemoveParty: () => void;
  onAddMercenary: (nickname: string, cls: ClassType) => void;
}

export default function HuntPartyCard({
  party, index, isActive, onActivate, onCapacityChange,
  onRemoveMember, onRemoveParty, onAddMercenary,
}: Props) {
  const [mercOpen, setMercOpen] = useState(false);
  const [mercName, setMercName] = useState('');
  const [mercClass, setMercClass] = useState<ClassType>('세바');

  const remaining = party.capacity - party.members.length;
  const full = remaining <= 0;

  const submitMerc = () => {
    const name = mercName.trim();
    if (!name || full) return;
    onAddMercenary(name, mercClass);
    setMercName('');
    setMercOpen(false);
  };

  return (
    <div
      onClick={onActivate}
      className={`p-3 rounded-lg border-2 cursor-pointer transition-colors ${
        isActive
          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
      }`}
    >
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{index + 1}파티</span>
          <span className={`text-xs ${full ? 'text-gray-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
            {party.members.length}/{party.capacity}
            {!full && ` · ${remaining}자리 남음`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {([3, 4] as const).map(cap => {
            const blocked = party.members.length > cap;
            return (
              <button
                key={cap}
                onClick={e => { e.stopPropagation(); if (!blocked) onCapacityChange(cap); }}
                disabled={blocked}
                title={blocked ? '현재 인원이 정원보다 많습니다' : ''}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  party.capacity === cap
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : blocked
                      ? 'opacity-40 cursor-not-allowed border-gray-300 dark:border-gray-600 text-gray-400'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                }`}
              >
                {cap}인
              </button>
            );
          })}
          <button
            onClick={e => { e.stopPropagation(); onRemoveParty(); }}
            className="ml-1 text-red-500 text-xs hover:text-red-700"
          >
            파티 삭제
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {party.members.map((m, i) => (
          <span
            key={`${m.nickname}-${i}`}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${HUNT_CLASS_BADGE[m.class_type] ?? 'bg-gray-500 text-white'}`}
          >
            {m.isMercenary && <span className="opacity-80">[용병]</span>}
            {m.nickname}
            <button
              onClick={e => { e.stopPropagation(); onRemoveMember(i); }}
              className="ml-0.5 opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
        {party.members.length === 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500 self-center">
            위 명단에서 캐릭터를 눌러 담으세요
          </span>
        )}
      </div>

      <div className="mt-2" onClick={e => e.stopPropagation()}>
        {!mercOpen ? (
          <button
            onClick={() => setMercOpen(true)}
            disabled={full}
            className={`text-xs ${full ? 'text-gray-400 cursor-not-allowed' : 'text-indigo-600 hover:text-indigo-800'}`}
          >
            + 외부 용병
          </button>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="text"
              value={mercName}
              onChange={e => setMercName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitMerc(); }}
              placeholder="용병 닉네임"
              className="p-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 w-28"
            />
            <select
              value={mercClass}
              onChange={e => setMercClass(e.target.value as ClassType)}
              className="p-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
            >
              {CLASS_TYPES_BY_RAID['정규사냥'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button onClick={submitMerc} className="px-2 py-1 rounded bg-indigo-600 text-white text-xs">추가</button>
            <button onClick={() => { setMercOpen(false); setMercName(''); }} className="text-xs text-gray-500">취소</button>
          </div>
        )}
      </div>
    </div>
  );
}
