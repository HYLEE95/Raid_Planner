import { useState, useEffect, useCallback } from 'react';
import {
  getWeekStartForRaid,
  formatDate,
  getConfirmedRaid,
  deleteConfirmedRaid,
} from '../../lib/storage';
import WeekPicker from '../WeekPicker/WeekPicker';
import type { ConfirmedRaid, RaidType, RaidGroup, RaidMember } from '../../lib/types';
import { RAID_TYPES, RAID_CONFIGS } from '../../lib/types';

const CLASS_BADGE: Record<string, string> = {
  '근딜': 'bg-red-500 text-white',
  '원딜': 'bg-blue-500 text-white',
  '호법성': 'bg-yellow-500 text-white',
  '치유성': 'bg-green-500 text-white',
  '세가': 'bg-purple-500 text-white',
  '세바': 'bg-teal-500 text-white',
  '딜러': 'bg-rose-500 text-white',
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateWithDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}/${day}(${dayName})`;
}

function MemberCard({ member, raidType }: { member: RaidMember; raidType?: RaidType }) {
  const isBot = 'isBot' in member && member.isBot;
  const isUnderpowered = !isBot && 'is_underpowered' in member && (member as any).is_underpowered;
  const isBri = raidType === '브리레흐';

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded border ${
        isBot
          ? 'bg-gray-100 dark:bg-gray-700 border-dashed border-gray-400'
          : isUnderpowered
            ? 'bg-orange-50 dark:bg-orange-900/30 border-orange-300'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
      }`}
    >
      <span className={`px-1.5 py-0.5 rounded text-xs font-bold shrink-0 ${CLASS_BADGE[member.class_type] || 'bg-gray-500 text-white'}`}>
        {member.class_type}
      </span>
      <span
        className={`text-sm font-medium truncate min-w-0 ${isBot ? 'text-gray-400 italic' : 'text-gray-800 dark:text-gray-200'}`}
      >
        {member.nickname}
      </span>
      {isUnderpowered && (
        <span className="px-1 py-0.5 bg-orange-100 text-orange-600 text-[10px] rounded border border-orange-200 shrink-0 whitespace-nowrap">저스펙</span>
      )}
      {!isBri && (
        <span className="text-xs text-gray-500 ml-auto shrink-0 whitespace-nowrap">{member.combat_power}K</span>
      )}
      {isBri && !isBot && 'has_destruction_robe' in member && (member as any).has_destruction_robe && (
        <span className="px-1 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 text-[10px] rounded border border-purple-200 dark:border-purple-700 shrink-0 whitespace-nowrap">파롭</span>
      )}
      {isBri && !isBot && 'is_blast_lancer' in member && (member as any).is_blast_lancer && (
        <span className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 text-[10px] rounded border border-blue-200 dark:border-blue-700 shrink-0 whitespace-nowrap">블랜</span>
      )}
      {isBri && !isBot && 'has_soul_weapon' in member && (member as any).has_soul_weapon && (
        <span className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300 text-[10px] rounded border border-amber-200 dark:border-amber-700 shrink-0 whitespace-nowrap">소울</span>
      )}
      {!isBot && 'ownerName' in member && (
        <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap ml-auto">({member.ownerName})</span>
      )}
    </div>
  );
}

function TeamCard({ team, label, raidType }: { team: { members: RaidMember[]; avgCombatPower: number }; label: string; raidType?: RaidType }) {
  const isBri = raidType === '브리레흐';
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">{label}</h4>
        {!isBri && (
          <span className="text-xs text-gray-500">평균(딜러) {team.avgCombatPower.toFixed(1)}K</span>
        )}
        {isBri && (
          <span className="text-xs text-gray-500">{team.members.length}인</span>
        )}
      </div>
      <div className="space-y-1">
        {team.members.map((member, idx) => (
          <MemberCard key={idx} member={member} raidType={raidType} />
        ))}
      </div>
    </div>
  );
}

function RaidGroupCard({ raid, raidType }: { raid: RaidGroup; raidType?: RaidType }) {
  const isBri = raidType === '브리레흐';
  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {isBri ? `파티 ${raid.id}` : `공격대 ${raid.id}`}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {formatDateWithDay(raid.timeSlot.date)} {raid.timeSlot.start_time}~{raid.timeSlot.end_time}
          </span>
          {!isBri && (
            <span className="text-sm font-medium text-indigo-600">평균(딜러) {raid.avgCombatPower.toFixed(1)}K</span>
          )}
          {isBri && (
            <span className="text-sm font-medium text-indigo-600">{raid.team1.members.length}인 파티</span>
          )}
          {raid.botCount > 0 && (
            <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">공방인원 {raid.botCount}명</span>
          )}
        </div>
      </div>
      <div className="flex gap-4 flex-wrap">
        {isBri ? (
          <TeamCard team={raid.team1} label="파티원" raidType={raidType} />
        ) : (
          <>
            <TeamCard team={raid.team1} label="1팀" raidType={raidType} />
            {raid.team2 && <TeamCard team={raid.team2} label="2팀" raidType={raidType} />}
          </>
        )}
      </div>
    </div>
  );
}

export default function Confirmed() {
  const [selectedRaid, setSelectedRaid] = useState<RaidType | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(() => formatDate(getWeekStartForRaid(new Date(), '루드라')));
  const [confirmed, setConfirmed] = useState<ConfirmedRaid | null>(null);
  const [loading, setLoading] = useState(false);

  const loadConfirmed = useCallback(async () => {
    if (!selectedRaid) { setConfirmed(null); return; }
    setLoading(true);
    try {
      const data = await getConfirmedRaid(selectedWeek, selectedRaid);
      setConfirmed(data);
    } catch (err) {
      console.error('확정 공대 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedWeek, selectedRaid]);

  useEffect(() => {
    loadConfirmed();
  }, [loadConfirmed]);

  const handleDelete = async () => {
    if (!confirmed) return;
    if (!window.confirm('확정된 공격대를 삭제하시겠습니까?')) return;
    try {
      await deleteConfirmedRaid(confirmed.id);
      setConfirmed(null);
      alert('공격대가 삭제되었습니다.');
    } catch (err) {
      alert('삭제 실패: ' + (err as Error).message);
    }
  };

  const sortedRaids = confirmed
    ? [...confirmed.composition.raids].sort((a, b) => {
        const d = a.timeSlot.date.localeCompare(b.timeSlot.date);
        return d !== 0 ? d : a.timeSlot.start_time.localeCompare(b.timeSlot.start_time);
      })
    : [];

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">홈</h1>

      {/* 레이드 선택 */}
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">레이드 선택</label>
        <div className="flex gap-2">
          {RAID_TYPES.map(rt => (
            <button
              key={rt}
              onClick={() => {
                setSelectedRaid(rt);
                setSelectedWeek(formatDate(getWeekStartForRaid(new Date(), rt)));
                setConfirmed(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                selectedRaid === rt
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-300'
              }`}
            >
              {RAID_CONFIGS[rt].label}
            </button>
          ))}
        </div>
      </div>

      {selectedRaid && (
        <>
          {/* 주차 선택 */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">주차 선택</label>
            <WeekPicker
              value={selectedWeek}
              onChange={(v) => { setSelectedWeek(v); setConfirmed(null); }}
              resetDay={RAID_CONFIGS[selectedRaid].resetDay}
            />
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-500">로딩 중...</div>
          ) : confirmed ? (
            <div>
              {/* 확정 헤더 */}
              <div className="flex items-center justify-between mb-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-bold text-green-800 dark:text-green-300">
                    {selectedRaid === '브리레흐' ? '파티 확정됨' : '공격대 확정됨'}
                  </span>
                  <span className="text-sm text-green-600 dark:text-green-400">
                    ({new Date(confirmed.confirmed_at).toLocaleString('ko-KR')})
                  </span>
                </div>
                <button
                  onClick={handleDelete}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold text-red-600 bg-white dark:bg-gray-800 border border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                >
                  삭제
                </button>
              </div>

              {/* 공격대/파티 목록 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sortedRaids.map(raid => (
                  <RaidGroupCard key={raid.id} raid={raid} raidType={selectedRaid} />
                ))}
              </div>

              {/* 빠지는 인원 */}
              {confirmed.composition.excludedCharacters.length > 0 && (
                <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg">
                  <h3 className="text-sm font-bold text-orange-800 dark:text-orange-300 mb-2">
                    빠지는 인원 ({confirmed.composition.excludedCharacters.length}명)
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    {confirmed.composition.excludedCharacters.map((char, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 text-sm rounded border border-orange-300"
                      >
                        {char.nickname}
                        <span className="text-xs ml-1">({char.ownerName})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <p className="text-lg">확정된 공격대가 없습니다.</p>
              <p className="text-sm mt-2">공격대 배치 화면에서 조합을 선택하여 공대를 확정해주세요.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
