import { useState, useMemo } from 'react';
import type { RaidComposition, RaidGroup, RaidMember, RaidType, DBRegistration, BotCharacter } from '../../lib/types';
import { calcTeamAvg } from '../../lib/raidSolver';

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

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const mo = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    dates.push(`${y}-${mo}-${day}`);
  }
  return dates;
}

function generateStartTimes(): string[] {
  const times: string[] = [];
  for (let h = 0; h < 24; h++) {
    times.push(`${h.toString().padStart(2, '0')}:00`);
    times.push(`${h.toString().padStart(2, '0')}:30`);
  }
  return times;
}

const START_TIMES = generateStartTimes();

// 공격대 인원의 가용 시간대 계산
function computeAvailableSlots(
  raid: RaidGroup,
  registrations: DBRegistration[],
): { dates: string[]; timesForDate: Map<string, string[]> } | null {
  const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];
  const nonBotMembers = allMembers.filter(m => !('isBot' in m && m.isBot));

  if (nonBotMembers.length === 0 || registrations.length === 0) return null;

  const memberRegs: DBRegistration[] = [];
  const seenOwners = new Set<string>();
  for (const member of nonBotMembers) {
    const ownerName = 'ownerName' in member ? (member as any).ownerName : null;
    if (!ownerName || seenOwners.has(ownerName)) continue;
    seenOwners.add(ownerName);
    const reg = registrations.find(r => r.owner_name === ownerName);
    if (reg) memberRegs.push(reg);
  }

  if (memberRegs.length === 0) return null;

  const allDates = new Set<string>();
  for (const reg of memberRegs) {
    for (const ts of reg.time_slots) allDates.add(ts.date);
  }

  const commonDates = [...allDates].filter(date =>
    memberRegs.every(reg => reg.time_slots.some(ts => ts.date === date))
  );

  const timesForDate = new Map<string, string[]>();
  for (const date of commonDates) {
    const availableTimes = START_TIMES.filter(startTime => {
      const endTime = minutesToTime(timeToMinutes(startTime) + 60);
      return memberRegs.every(reg =>
        reg.time_slots.some(ts =>
          ts.date === date && ts.start_time <= startTime && ts.end_time >= endTime
        )
      );
    });
    if (availableTimes.length > 0) {
      timesForDate.set(date, availableTimes);
    }
  }

  return {
    dates: commonDates.filter(d => timesForDate.has(d)).sort(),
    timesForDate,
  };
}

// 멤버를 제외 캐릭터로 변환
function memberToExcluded(member: RaidMember): RaidComposition['excludedCharacters'][0] {
  return {
    id: (member as any).id || '',
    owner_id: (member as any).owner_id || '',
    nickname: member.nickname,
    class_type: member.class_type,
    combat_power: member.combat_power,
    can_clear_raid: (member as any).can_clear_raid ?? false,
    is_underpowered: (member as any).is_underpowered ?? false,
    ownerName: (member as any).ownerName || '',
    ...((member as any).has_destruction_robe !== undefined && { has_destruction_robe: (member as any).has_destruction_robe }),
    ...((member as any).is_blast_lancer !== undefined && { is_blast_lancer: (member as any).is_blast_lancer }),
    ...((member as any).has_soul_weapon !== undefined && { has_soul_weapon: (member as any).has_soul_weapon }),
    ...((member as any).desired_clears !== undefined && { desired_clears: (member as any).desired_clears }),
  } as any;
}

// 교체 옵션
interface SwapOption {
  label: string;
  value: string;
  group: string;
}

function buildSwapOptions(
  comp: RaidComposition,
  currentRaidId: number,
  currentTeamKey: 'team1' | 'team2',
  currentMemberIdx: number,
  raidType?: RaidType,
): SwapOption[] {
  const options: SwapOption[] = [];
  const isBri = raidType === '브리레흐';

  // 현재 공격대/파티에서 교체 대상 제외한 나머지 소유주 목록 (소유주 중복 방지)
  const currentRaid = comp.raids.find(r => r.id === currentRaidId);
  const sameRaidOwners = new Set<string>();
  if (currentRaid) {
    const allMembers = [...currentRaid.team1.members, ...(currentRaid.team2?.members || [])];
    allMembers.forEach((m, _i) => {
      // 교체 대상 자신은 제외 (자신이 빠지니까)
      const isCurrentMember = (() => {
        const team = currentRaid[currentTeamKey];
        return team && team.members[currentMemberIdx] === m;
      })();
      if (isCurrentMember) return;
      if (!('isBot' in m && m.isBot) && 'ownerName' in m) {
        sameRaidOwners.add((m as any).ownerName);
      }
    });
  }

  // 1. 빠지는 인원 (같은 소유주가 이미 해당 공격대에 있으면 제외)
  for (let i = 0; i < comp.excludedCharacters.length; i++) {
    const char = comp.excludedCharacters[i];
    if (sameRaidOwners.has(char.ownerName)) continue;
    let label = `${char.nickname} (${char.ownerName}) - ${char.class_type}`;
    if (!isBri && char.combat_power > 0) label += ` ${char.combat_power}K`;
    options.push({ label, value: `ex:${i}`, group: '빠지는 인원' });
  }

  // 2. 다른 공격대/팀 인원
  for (const raid of comp.raids) {
    const teams: ('team1' | 'team2')[] = ['team1'];
    if (raid.team2) teams.push('team2');

    for (const teamKey of teams) {
      const team = raid[teamKey];
      if (!team) continue;

      team.members.forEach((member, mIdx) => {
        if (raid.id === currentRaidId && teamKey === currentTeamKey && mIdx === currentMemberIdx) return;

        const isBot = 'isBot' in member && member.isBot;

        // 같은 공격대 내 다른 멤버와의 교체는 소유주 제한 없음 (위치 스왑)
        // 다른 공격대에서 가져올 때만 소유주 중복 체크
        if (raid.id !== currentRaidId && !isBot && 'ownerName' in member) {
          if (sameRaidOwners.has((member as any).ownerName)) return;
        }

        const ownerInfo = !isBot && 'ownerName' in member ? ` (${(member as any).ownerName})` : '';
        let label = `${member.nickname}${ownerInfo} - ${member.class_type}`;
        if (!isBri && member.combat_power > 0) label += ` ${member.combat_power}K`;

        const raidLabel = isBri
          ? `파티 ${raid.id}`
          : `공격대 ${raid.id} ${teamKey === 'team1' ? '1팀' : '2팀'}`;

        options.push({ label, value: `mem:${raid.id}:${teamKey}:${mIdx}`, group: raidLabel });
      });
    }
  }

  // 3. 공방인원으로 교체
  options.push({
    label: '공방인원 (봇)',
    value: 'bot',
    group: '공방인원으로 교체',
  });

  return options;
}

function MemberCard({
  member,
  raidType,
  swapOptions,
  onSwap,
  onRemove,
}: {
  member: RaidMember;
  raidType?: RaidType;
  swapOptions?: SwapOption[];
  onSwap?: (value: string) => void;
  onRemove?: () => void;
}) {
  const [showSwap, setShowSwap] = useState(false);
  const isBot = 'isBot' in member && member.isBot;
  const isUnderpowered = !isBot && 'is_underpowered' in member && (member as any).is_underpowered;
  const isBri = raidType === '브리레흐';

  const groupedOptions = useMemo(() => {
    if (!swapOptions) return [];
    const groups = new Map<string, SwapOption[]>();
    for (const opt of swapOptions) {
      if (!groups.has(opt.group)) groups.set(opt.group, []);
      groups.get(opt.group)!.push(opt);
    }
    return [...groups.entries()];
  }, [swapOptions]);

  return (
    <div>
      <div
        className={`flex items-center gap-2 p-2 rounded border ${
          isBot
            ? 'bg-gray-100 dark:bg-gray-700 border-dashed border-gray-400'
            : isUnderpowered
              ? 'bg-orange-50 dark:bg-orange-900/30 border-orange-300'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
        }`}
      >
        <span
          className={`px-1.5 py-0.5 rounded text-xs font-bold shrink-0 ${CLASS_BADGE[member.class_type] || 'bg-gray-500 text-white'}`}
        >
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
          <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">{member.combat_power}K</span>
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
        {onSwap && swapOptions && swapOptions.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowSwap(!showSwap); }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 shrink-0 ml-auto"
            title="캐릭터 변경"
          >
            변경
          </button>
        )}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 dark:border-red-600 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 shrink-0"
            title="파티원 삭제"
          >
            삭제
          </button>
        )}
      </div>
      {showSwap && groupedOptions.length > 0 && (
        <select
          className="w-full mt-1 text-xs border border-gray-300 dark:border-gray-600 rounded p-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
          value=""
          onChange={(e) => {
            if (e.target.value && onSwap) {
              onSwap(e.target.value);
              setShowSwap(false);
            }
          }}
        >
          <option value="">교체할 캐릭터 선택...</option>
          {groupedOptions.map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((opt, i) => (
                <option key={`${group}-${i}`} value={opt.value}>{opt.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

function TeamCard({
  team,
  label,
  raidType,
  swapOptionsForMember,
  onSwapMember,
  onAddMember,
  onRemoveMember,
}: {
  team: { members: RaidMember[]; avgCombatPower: number };
  label: string;
  raidType?: RaidType;
  swapOptionsForMember?: (memberIdx: number) => SwapOption[];
  onSwapMember?: (memberIdx: number, value: string) => void;
  onAddMember?: () => void;
  onRemoveMember?: (memberIdx: number) => void;
}) {
  const isBri = raidType === '브리레흐';
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">{label}</h4>
        {!isBri && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            평균(딜러) {team.avgCombatPower.toFixed(1)}K
          </span>
        )}
        {isBri && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {team.members.length}인
          </span>
        )}
      </div>
      <div className="space-y-1">
        {team.members.map((member, idx) => (
          <MemberCard
            key={idx}
            member={member}
            raidType={raidType}
            swapOptions={swapOptionsForMember ? swapOptionsForMember(idx) : undefined}
            onSwap={onSwapMember ? (val) => onSwapMember(idx, val) : undefined}
            onRemove={onRemoveMember ? () => onRemoveMember(idx) : undefined}
          />
        ))}
        {isBri && onAddMember && team.members.length < 8 && (
          <button
            onClick={onAddMember}
            className="w-full py-1.5 rounded border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400 transition-colors flex items-center justify-center gap-1 text-xs font-medium"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            파티원 추가
          </button>
        )}
      </div>
    </div>
  );
}

function RaidGroupCard({
  raid,
  raidType,
  weekDates,
  registrations,
  comp,
  onDateChange,
  onTimeChange,
  onSwapMember,
  onDelete,
  onAddMember,
  onRemoveMember,
}: {
  raid: RaidGroup;
  raidType?: RaidType;
  weekDates: string[];
  registrations?: DBRegistration[];
  comp?: RaidComposition;
  onDateChange?: (date: string) => void;
  onTimeChange?: (startTime: string) => void;
  onSwapMember?: (team: 'team1' | 'team2', memberIdx: number, value: string) => void;
  onDelete?: () => void;
  onAddMember?: () => void;
  onRemoveMember?: (memberIdx: number) => void;
}) {
  const [showAllSlots, setShowAllSlots] = useState(false);
  const isBri = raidType === '브리레흐';
  const endTime = minutesToTime(timeToMinutes(raid.timeSlot.start_time) + 60);

  // 가용 시간대 계산
  const availableSlots = useMemo(() => {
    if (!registrations || registrations.length === 0) return null;
    return computeAvailableSlots(raid, registrations);
  }, [raid, registrations]);

  const hasAvailableSlots = availableSlots && availableSlots.dates.length > 0;
  const displayDates = showAllSlots || !hasAvailableSlots ? weekDates : availableSlots!.dates;
  const displayTimes = showAllSlots || !hasAvailableSlots
    ? START_TIMES
    : (availableSlots!.timesForDate.get(raid.timeSlot.date) || START_TIMES);

  // 교체 옵션 빌드
  const getSwapOptions = (teamKey: 'team1' | 'team2', memberIdx: number): SwapOption[] => {
    if (!comp) return [];
    return buildSwapOptions(comp, raid.id, teamKey, memberIdx, raidType);
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {isBri ? `파티 ${raid.id}` : `공격대 ${raid.id}`}
          </h3>
          {onDelete && raid.isManual && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="px-2 py-0.5 text-xs rounded border border-red-300 dark:border-red-600 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              title="공격대 삭제"
            >
              삭제
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 날짜 선택 */}
          {onDateChange ? (
            <select
              value={raid.timeSlot.date}
              onChange={(e) => onDateChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 cursor-pointer"
            >
              {displayDates.map(d => (
                <option key={d} value={d}>{formatDateWithDay(d)}</option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {formatDateWithDay(raid.timeSlot.date)}
            </span>
          )}
          {/* 시작 시간 선택 */}
          {onTimeChange ? (
            <div className="flex items-center gap-1">
              <select
                value={raid.timeSlot.start_time}
                onChange={(e) => onTimeChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 cursor-pointer"
              >
                {displayTimes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="text-sm text-gray-500">~{endTime}</span>
            </div>
          ) : (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {raid.timeSlot.start_time}~{endTime}
            </span>
          )}
          {/* 추가 시간대 체크박스 */}
          {onDateChange && hasAvailableSlots && (
            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAllSlots}
                onChange={(e) => { e.stopPropagation(); setShowAllSlots(e.target.checked); }}
                onClick={(e) => e.stopPropagation()}
                className="w-3 h-3"
              />
              추가 시간대
            </label>
          )}
          {!isBri && (
            <span className="text-sm font-medium text-indigo-600">
              평균(딜러) {raid.avgCombatPower.toFixed(1)}K
            </span>
          )}
          {isBri && (
            <span className="text-sm font-medium text-indigo-600">
              {raid.team1.members.length}인 파티
            </span>
          )}
          {raid.botCount > 0 && (
            <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded">
              공방인원 {raid.botCount}명
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        {isBri ? (
          <TeamCard
            team={raid.team1}
            label="파티원"
            raidType={raidType}
            swapOptionsForMember={onSwapMember ? (mIdx) => getSwapOptions('team1', mIdx) : undefined}
            onSwapMember={onSwapMember ? (mIdx, val) => onSwapMember('team1', mIdx, val) : undefined}
            onAddMember={onAddMember}
            onRemoveMember={onRemoveMember}
          />
        ) : (
          <>
            <TeamCard
              team={raid.team1}
              label="1팀"
              raidType={raidType}
              swapOptionsForMember={onSwapMember ? (mIdx) => getSwapOptions('team1', mIdx) : undefined}
              onSwapMember={onSwapMember ? (mIdx, val) => onSwapMember('team1', mIdx, val) : undefined}
            />
            {raid.team2 && (
              <TeamCard
                team={raid.team2}
                label="2팀"
                raidType={raidType}
                swapOptionsForMember={onSwapMember ? (mIdx) => getSwapOptions('team2', mIdx) : undefined}
                onSwapMember={onSwapMember ? (mIdx, val) => onSwapMember('team2', mIdx, val) : undefined}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 조합 요약 정보
function CompositionSummary({ comp, raidType }: { comp: RaidComposition; raidType?: RaidType }) {
  const isBri = raidType === '브리레흐';
  const totalBots = comp.raids.reduce((s, r) => s + r.botCount, 0);

  if (isBri) {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
        <span>파티 {comp.raids.length}개</span>
        {totalBots > 0 && <span>공방인원 {totalBots}명</span>}
        {comp.excludedCharacters.length > 0 && (
          <span className="text-orange-500">제외 {comp.excludedCharacters.length}명</span>
        )}
      </div>
    );
  }

  const avgPower = comp.raids.length > 0
    ? (comp.raids.reduce((s, r) => s + r.avgCombatPower, 0) / comp.raids.length).toFixed(1)
    : '0';

  return (
    <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
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
  onUpdate?: (compositions: RaidComposition[]) => void;
  raidType?: RaidType;
  weekStart?: string;
  registrations?: DBRegistration[];
}

export default function RaidResult({ compositions, onConfirm, onUpdate, raidType, weekStart, registrations }: RaidResultProps) {
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());

  const weekDates = weekStart ? getWeekDates(weekStart) : [];
  const isBri = raidType === '브리레흐';

  if (compositions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-600 dark:text-gray-400">
        <p className="text-lg">아직 공격대 조합이 없습니다.</p>
        <p className="text-sm mt-2">파티 참여 신청을 먼저 진행해주세요.</p>
      </div>
    );
  }

  const toggleExpand = (idx: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // 조합 업데이트 헬퍼
  const updateComp = (compIdx: number, updatedComp: RaidComposition) => {
    if (!onUpdate) return;
    const newComps = [...compositions];
    newComps[compIdx] = updatedComp;
    onUpdate(newComps);
  };

  // 공격대 내 팀/공격대 통계 재계산
  const recalcRaidStats = (raid: RaidGroup): RaidGroup => {
    const updated = { ...raid };
    updated.team1 = { ...updated.team1, avgCombatPower: calcTeamAvg(updated.team1.members) };
    if (updated.team2) {
      updated.team2 = { ...updated.team2, avgCombatPower: calcTeamAvg(updated.team2.members) };
    }
    const allMembers = [...updated.team1.members, ...(updated.team2?.members || [])];
    updated.botCount = allMembers.filter(m => 'isBot' in m && m.isBot).length;
    if (updated.team2) {
      updated.avgCombatPower = (updated.team1.avgCombatPower + updated.team2.avgCombatPower) / 2;
    } else {
      updated.avgCombatPower = updated.team1.avgCombatPower;
    }
    return updated;
  };

  // 날짜 변경
  const handleDateChange = (compIdx: number, raidId: number, newDate: string) => {
    const comp = compositions[compIdx];
    const updatedRaids = comp.raids.map(r => {
      if (r.id !== raidId) return r;
      return { ...r, timeSlot: { ...r.timeSlot, date: newDate } };
    });
    updateComp(compIdx, { ...comp, raids: updatedRaids });
  };

  // 시간 변경
  const handleTimeChange = (compIdx: number, raidId: number, newStartTime: string) => {
    const comp = compositions[compIdx];
    const newEndTime = minutesToTime(timeToMinutes(newStartTime) + 60);
    const updatedRaids = comp.raids.map(r => {
      if (r.id !== raidId) return r;
      return { ...r, timeSlot: { ...r.timeSlot, start_time: newStartTime, end_time: newEndTime } };
    });
    updateComp(compIdx, { ...comp, raids: updatedRaids });
  };

  // 통합 교체 핸들러
  const handleSwap = (
    compIdx: number,
    raidId: number,
    teamKey: 'team1' | 'team2',
    memberIdx: number,
    value: string,
  ) => {
    if (value.startsWith('ex:')) {
      const excludedIdx = parseInt(value.substring(3));
      handleSwapWithExcluded(compIdx, raidId, teamKey, memberIdx, excludedIdx);
    } else if (value.startsWith('mem:')) {
      const parts = value.substring(4).split(':');
      const targetRaidId = parseInt(parts[0]);
      const targetTeamKey = parts[1] as 'team1' | 'team2';
      const targetMemberIdx = parseInt(parts[2]);
      handleSwapMembers(compIdx, raidId, teamKey, memberIdx, targetRaidId, targetTeamKey, targetMemberIdx);
    } else if (value === 'bot') {
      handleReplaceWithBot(compIdx, raidId, teamKey, memberIdx);
    }
  };

  // 제외 캐릭터와 교체
  const handleSwapWithExcluded = (
    compIdx: number,
    raidId: number,
    teamKey: 'team1' | 'team2',
    memberIdx: number,
    excludedIdx: number,
  ) => {
    const comp = compositions[compIdx];
    const excludedChar = comp.excludedCharacters[excludedIdx];
    const raidObj = comp.raids.find(r => r.id === raidId);
    const oldMember = raidObj?.[teamKey]?.members[memberIdx];

    const updatedRaids = comp.raids.map(r => {
      if (r.id !== raidId) return r;
      const team = r[teamKey];
      if (!team) return r;

      const newMembers = [...team.members];
      newMembers[memberIdx] = {
        ...excludedChar,
        isBot: false,
        ownerName: excludedChar.ownerName,
      } as any;

      return recalcRaidStats({ ...r, [teamKey]: { ...team, members: newMembers } });
    });

    const newExcluded = [...comp.excludedCharacters];
    newExcluded.splice(excludedIdx, 1);
    if (oldMember && !('isBot' in oldMember && oldMember.isBot)) {
      newExcluded.push(memberToExcluded(oldMember));
    }

    updateComp(compIdx, { ...comp, raids: updatedRaids, excludedCharacters: newExcluded });
  };

  // 다른 멤버와 교체 (위치 스왑)
  const handleSwapMembers = (
    compIdx: number,
    raidId: number,
    teamKey: 'team1' | 'team2',
    memberIdx: number,
    targetRaidId: number,
    targetTeamKey: 'team1' | 'team2',
    targetMemberIdx: number,
  ) => {
    const comp = compositions[compIdx];

    // 원본에서 두 멤버 가져오기
    const sourceRaid = comp.raids.find(r => r.id === raidId)!;
    const targetRaid = comp.raids.find(r => r.id === targetRaidId)!;
    const memberA = sourceRaid[teamKey]!.members[memberIdx];
    const memberB = targetRaid[targetTeamKey]!.members[targetMemberIdx];

    const updatedRaids = comp.raids.map(r => {
      let updated = { ...r };
      const isSource = r.id === raidId;
      const isTarget = r.id === targetRaidId;
      if (!isSource && !isTarget) return r;

      if (isSource) {
        const t = { ...updated[teamKey]! };
        const newMembers = [...t.members];
        newMembers[memberIdx] = memberB;
        updated = { ...updated, [teamKey]: { ...t, members: newMembers } };
      }

      if (isTarget) {
        const t = { ...updated[targetTeamKey]! };
        const newMembers = [...t.members];
        newMembers[targetMemberIdx] = memberA;
        updated = { ...updated, [targetTeamKey]: { ...t, members: newMembers } };
      }

      return recalcRaidStats(updated);
    });

    updateComp(compIdx, { ...comp, raids: updatedRaids });
  };

  // 공방인원(봇)으로 교체
  const handleReplaceWithBot = (
    compIdx: number,
    raidId: number,
    teamKey: 'team1' | 'team2',
    memberIdx: number,
  ) => {
    const comp = compositions[compIdx];
    const raidObj = comp.raids.find(r => r.id === raidId);
    const oldMember = raidObj?.[teamKey]?.members[memberIdx];
    if (!oldMember || ('isBot' in oldMember && oldMember.isBot)) return;

    const allBots = comp.raids.flatMap(r =>
      [...r.team1.members, ...(r.team2?.members || [])].filter(m => 'isBot' in m && m.isBot)
    );
    const botIdx = allBots.length + 1;

    const bot: BotCharacter = {
      isBot: true,
      nickname: `공방인원${botIdx}`,
      class_type: oldMember.class_type,
      combat_power: oldMember.combat_power,
    };

    const updatedRaids = comp.raids.map(r => {
      if (r.id !== raidId) return r;
      const team = r[teamKey];
      if (!team) return r;
      const newMembers = [...team.members];
      newMembers[memberIdx] = bot;
      return recalcRaidStats({ ...r, [teamKey]: { ...team, members: newMembers } });
    });

    const newExcluded = [...comp.excludedCharacters, memberToExcluded(oldMember)];
    updateComp(compIdx, { ...comp, raids: updatedRaids, excludedCharacters: newExcluded });
  };

  // 공격대 추가
  const handleAddRaid = (compIdx: number) => {
    if (!onUpdate) return;
    const comp = compositions[compIdx];
    const newRaidId = Math.max(0, ...comp.raids.map(r => r.id)) + 1;
    const defaultDate = weekDates.length > 0 ? weekDates[0] : '2026-01-01';
    const defaultSlot = { date: defaultDate, start_time: '21:00', end_time: '22:00' };

    let newRaid: RaidGroup;
    if (isBri) {
      const botMembers: RaidMember[] = [];
      for (let i = 0; i < 4; i++) {
        botMembers.push({ isBot: true, nickname: `공방인원${i + 1}`, class_type: '딜러', combat_power: 0 });
      }
      newRaid = {
        id: newRaidId,
        team1: { members: botMembers, avgCombatPower: 0 },
        avgCombatPower: 0,
        botCount: 4,
        timeSlot: defaultSlot,
        isManual: true,
      };
    } else {
      const team1Bots: RaidMember[] = [
        { isBot: true, nickname: `공방인원1`, class_type: '호법성', combat_power: 0 },
        { isBot: true, nickname: `공방인원2`, class_type: '근딜', combat_power: 0 },
        { isBot: true, nickname: `공방인원3`, class_type: '원딜', combat_power: 0 },
        { isBot: true, nickname: `공방인원4`, class_type: '원딜', combat_power: 0 },
      ];
      const team2Bots: RaidMember[] = [
        { isBot: true, nickname: `공방인원5`, class_type: '치유성', combat_power: 0 },
        { isBot: true, nickname: `공방인원6`, class_type: '근딜', combat_power: 0 },
        { isBot: true, nickname: `공방인원7`, class_type: '원딜', combat_power: 0 },
        { isBot: true, nickname: `공방인원8`, class_type: '원딜', combat_power: 0 },
      ];
      newRaid = {
        id: newRaidId,
        team1: { members: team1Bots, avgCombatPower: 0 },
        team2: { members: team2Bots, avgCombatPower: 0 },
        avgCombatPower: 0,
        botCount: 8,
        timeSlot: defaultSlot,
        isManual: true,
      };
    }

    updateComp(compIdx, { ...comp, raids: [...comp.raids, newRaid] });
  };

  // 브리레흐 파티원 추가
  const handleAddMemberToParty = (compIdx: number, raidId: number) => {
    if (!onUpdate) return;
    const comp = compositions[compIdx];
    const raidObj = comp.raids.find(r => r.id === raidId);
    if (!raidObj) return;

    // 브리레흐 파티당 최대 8명 제한
    if (raidObj.team1.members.length >= 8) return;

    const existingBots = raidObj.team1.members.filter(m => 'isBot' in m && m.isBot).length;
    const botIdx = existingBots + 1;
    const bot: BotCharacter = {
      isBot: true,
      nickname: `공방인원${botIdx}`,
      class_type: '딜러',
      combat_power: 0,
    };

    const updatedRaids = comp.raids.map(r => {
      if (r.id !== raidId) return r;
      const newMembers = [...r.team1.members, bot];
      return recalcRaidStats({ ...r, team1: { ...r.team1, members: newMembers } });
    });
    updateComp(compIdx, { ...comp, raids: updatedRaids });
  };

  // 브리레흐 파티원 삭제
  const handleRemoveMemberFromParty = (compIdx: number, raidId: number, memberIdx: number) => {
    if (!onUpdate) return;
    const comp = compositions[compIdx];
    const raidObj = comp.raids.find(r => r.id === raidId);
    if (!raidObj) return;

    const member = raidObj.team1.members[memberIdx];
    const isBot = 'isBot' in member && member.isBot;

    const updatedRaids = comp.raids.map(r => {
      if (r.id !== raidId) return r;
      const newMembers = r.team1.members.filter((_, i) => i !== memberIdx);
      return recalcRaidStats({ ...r, team1: { ...r.team1, members: newMembers } });
    });

    let newExcluded = comp.excludedCharacters;
    if (!isBot) {
      newExcluded = [...comp.excludedCharacters, memberToExcluded(member)];
    }

    updateComp(compIdx, { ...comp, raids: updatedRaids, excludedCharacters: newExcluded });
  };

  // 수동 추가 공격대 삭제
  const handleDeleteRaid = (compIdx: number, raidId: number) => {
    const comp = compositions[compIdx];
    const raidToDelete = comp.raids.find(r => r.id === raidId);
    if (!raidToDelete || !raidToDelete.isManual) return;

    // 삭제되는 공격대의 비봇 멤버를 제외 인원으로 이동
    const allMembers = [...raidToDelete.team1.members, ...(raidToDelete.team2?.members || [])];
    const nonBotMembers = allMembers.filter(m => !('isBot' in m && m.isBot));
    const newExcluded = [...comp.excludedCharacters, ...nonBotMembers.map(memberToExcluded)];

    const updatedRaids = comp.raids.filter(r => r.id !== raidId);
    updateComp(compIdx, { ...comp, raids: updatedRaids, excludedCharacters: newExcluded });
  };

  return (
    <div className="space-y-3">
      {compositions.map((comp, idx) => {
        const isExpanded = expandedSet.has(idx);

        // 자동 배치 → 수동 추가 순, 각각 날짜/시간 빠른순 정렬
        const sortedRaids = [...comp.raids].sort((a, b) => {
          const aManual = a.isManual ? 1 : 0;
          const bManual = b.isManual ? 1 : 0;
          if (aManual !== bManual) return aManual - bManual;
          const d = a.timeSlot.date.localeCompare(b.timeSlot.date);
          return d !== 0 ? d : a.timeSlot.start_time.localeCompare(b.timeSlot.start_time);
        });

        return (
          <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
            {/* 아코디언 헤더 */}
            <div
              onClick={() => toggleExpand(idx)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left cursor-pointer"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(idx); } }}
            >
              <div className="flex items-center gap-3">
                <span className="text-base font-bold text-gray-900 dark:text-gray-100">조합 {idx + 1}</span>
                <CompositionSummary comp={comp} raidType={raidType} />
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
              <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  {sortedRaids.map(raid => (
                    <RaidGroupCard
                      key={raid.id}
                      raid={raid}
                      raidType={raidType}
                      weekDates={weekDates}
                      registrations={registrations}
                      comp={onUpdate ? comp : undefined}
                      onDateChange={onUpdate ? (date) => handleDateChange(idx, raid.id, date) : undefined}
                      onTimeChange={onUpdate ? (time) => handleTimeChange(idx, raid.id, time) : undefined}
                      onSwapMember={onUpdate ? (team, mIdx, val) => handleSwap(idx, raid.id, team, mIdx, val) : undefined}
                      onDelete={onUpdate && raid.isManual ? () => handleDeleteRaid(idx, raid.id) : undefined}
                      onAddMember={onUpdate && isBri ? () => handleAddMemberToParty(idx, raid.id) : undefined}
                      onRemoveMember={onUpdate && isBri ? (mIdx) => handleRemoveMemberFromParty(idx, raid.id, mIdx) : undefined}
                    />
                  ))}
                </div>

                {/* 공격대 추가 버튼 */}
                {onUpdate && (
                  <button
                    onClick={() => handleAddRaid(idx)}
                    className="mt-4 w-full py-2.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    {isBri ? '파티 추가' : '공격대 추가'}
                  </button>
                )}

                {/* 빠지는 인원 */}
                {comp.excludedCharacters.length > 0 && (
                  <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg">
                    <h3 className="text-sm font-bold text-orange-800 dark:text-orange-300 mb-2">
                      빠지는 인원 ({comp.excludedCharacters.length}명)
                    </h3>
                    <div className="flex gap-2 flex-wrap">
                      {comp.excludedCharacters.map((char, i) => (
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
            )}
          </div>
        );
      })}
    </div>
  );
}
