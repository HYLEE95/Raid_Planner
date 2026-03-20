import { useState } from 'react';
import type { RaidComposition, RaidGroup, RaidMember, ClassType } from '../../lib/types';

const CLASS_BADGE: Record<ClassType, string> = {
  '근딜': 'bg-red-500 text-white',
  '원딜': 'bg-blue-500 text-white',
  '호법성': 'bg-yellow-500 text-white',
  '치유성': 'bg-green-500 text-white',
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateWithDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}/${day}(${dayName})`;
}

function MemberCard({ member }: { member: RaidMember }) {
  const isBot = 'isBot' in member && member.isBot;
  const isUnderpowered = !isBot && 'is_underpowered' in member && (member as any).is_underpowered;

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded border ${
        isBot
          ? 'bg-gray-100 border-dashed border-gray-400'
          : isUnderpowered
            ? 'bg-orange-50 border-orange-300'
            : 'bg-white border-gray-200'
      }`}
    >
      <span
        className={`px-1.5 py-0.5 rounded text-xs font-bold ${CLASS_BADGE[member.class_type]}`}
      >
        {member.class_type}
      </span>
      <span
        className={`font-medium truncate min-w-0 ${isBot ? 'text-gray-400 italic' : 'text-gray-800'}`}
        style={{ fontSize: member.nickname.length > 10 ? '10px' : member.nickname.length > 6 ? '12px' : '14px' }}
      >
        {member.nickname}
      </span>
      {isUnderpowered && (
        <span className="px-1 py-0.5 bg-orange-100 text-orange-600 text-[10px] rounded border border-orange-200">저스펙</span>
      )}
      <span className="text-xs text-gray-500 ml-auto">{member.combat_power}K</span>
      {!isBot && 'ownerName' in member && (
        <span className="text-xs text-gray-400">({member.ownerName})</span>
      )}
    </div>
  );
}

function TeamCard({ team, label }: { team: { members: RaidMember[]; avgCombatPower: number }; label: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700">{label}</h4>
        <span className="text-xs text-gray-500">
          평균(딜러) {team.avgCombatPower.toFixed(1)}K
        </span>
      </div>
      <div className="space-y-1">
        {team.members.map((member, idx) => (
          <MemberCard key={idx} member={member} />
        ))}
      </div>
    </div>
  );
}

function RaidGroupCard({ raid }: { raid: RaidGroup }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <h3 className="text-lg font-bold text-gray-900">
          공격대 {raid.id}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-600">
            {formatDateWithDay(raid.timeSlot.date)} {raid.timeSlot.start_time}~{raid.timeSlot.end_time}
          </span>
          <span className="text-sm font-medium text-indigo-600">
            평균(딜러) {raid.avgCombatPower.toFixed(1)}K
          </span>
          {raid.botCount > 0 && (
            <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
              공방인원 {raid.botCount}명
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        <TeamCard team={raid.team1} label="1팀" />
        <TeamCard team={raid.team2} label="2팀" />
      </div>
    </div>
  );
}

// 조합 요약 정보
function CompositionSummary({ comp }: { comp: RaidComposition }) {
  const totalBots = comp.raids.reduce((s, r) => s + r.botCount, 0);
  const avgPower = comp.raids.length > 0
    ? (comp.raids.reduce((s, r) => s + r.avgCombatPower, 0) / comp.raids.length).toFixed(1)
    : '0';

  return (
    <div className="flex items-center gap-3 text-sm text-gray-500">
      <span>공격대 {comp.raids.length}개</span>
      <span>평균(딜러) {avgPower}K</span>
      {totalBots > 0 && <span>공방인원 {totalBots}명</span>}
      {comp.excludedCharacters.length > 0 && (
        <span className="text-orange-500">제외 {comp.excludedCharacters.length}명</span>
      )}
    </div>
  );
}

interface RaidResultProps {
  compositions: RaidComposition[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  onConfirm?: (comp: RaidComposition) => void;
}

export default function RaidResult({ compositions, onConfirm }: RaidResultProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (compositions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">아직 공격대 조합이 없습니다.</p>
        <p className="text-sm mt-2">파티 참여 신청을 먼저 진행해주세요.</p>
      </div>
    );
  }

  const toggleExpand = (idx: number) => {
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  return (
    <div className="space-y-3">
      {compositions.map((comp, idx) => {
        const isExpanded = expandedIndex === idx;

        // 날짜/시간 빠른순 정렬
        const sortedRaids = [...comp.raids].sort((a, b) => {
          const d = a.timeSlot.date.localeCompare(b.timeSlot.date);
          return d !== 0 ? d : a.timeSlot.start_time.localeCompare(b.timeSlot.start_time);
        });

        return (
          <div key={idx} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            {/* 아코디언 헤더 */}
            <div
              onClick={() => toggleExpand(idx)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left cursor-pointer"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(idx); } }}
            >
              <div className="flex items-center gap-3">
                <span className="text-base font-bold text-gray-900">조합 {idx + 1}</span>
                <CompositionSummary comp={comp} />
              </div>
              <div className="flex items-center gap-2">
                {onConfirm && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfirm(comp);
                      }}
                      className="px-3 py-1 rounded text-sm font-semibold text-green-700 bg-green-50 border border-green-300 hover:bg-green-100 transition-colors"
                    >
                      공대 확정
                    </button>
                    <span className="text-gray-300">|</span>
                  </>
                )}
                <span className="text-sm text-indigo-600 font-medium">
                  {isExpanded ? '접기' : '더보기'}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* 아코디언 콘텐츠 */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-gray-100">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  {sortedRaids.map(raid => (
                    <RaidGroupCard key={raid.id} raid={raid} />
                  ))}
                </div>

                {/* 빠지는 인원 */}
                {comp.excludedCharacters.length > 0 && (
                  <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <h3 className="text-sm font-bold text-orange-800 mb-2">
                      빠지는 인원 ({comp.excludedCharacters.length}명)
                    </h3>
                    <div className="flex gap-2 flex-wrap">
                      {comp.excludedCharacters.map((char, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 bg-orange-100 text-orange-700 text-sm rounded border border-orange-300"
                        >
                          {char.nickname}
                          <span className="text-xs ml-1">({char.ownerName})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
