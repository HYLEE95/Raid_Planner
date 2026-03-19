import type {
  DBRegistration,
  RaidComposition,
  RaidGroup,
  RaidMember,
  Team,
  BotCharacter,
  ClassType,
  TimeSlot,
  RaidConfig,
  RaidType,
} from './types';
import { RAID_CONFIGS } from './types';

interface CharacterWithOwner {
  id: string;
  owner_id: string;
  ownerName: string;
  nickname: string;
  class_type: ClassType;
  combat_power: number;
  can_clear_raid: boolean;
  isBot?: false;
}

interface SlotGroup {
  slot: TimeSlot;
  characters: CharacterWithOwner[];
}

// 시간대별 가용 캐릭터 그룹핑
function buildSlotGroups(registrations: DBRegistration[]): SlotGroup[] {
  const byDate = new Map<string, { reg: DBRegistration; slot: TimeSlot }[]>();
  for (const reg of registrations) {
    for (const slot of reg.time_slots) {
      if (!byDate.has(slot.date)) byDate.set(slot.date, []);
      byDate.get(slot.date)!.push({ reg, slot });
    }
  }

  const result: SlotGroup[] = [];

  for (const [date, entries] of byDate) {
    const uniqueSlots = new Map<string, TimeSlot>();
    for (const e of entries) {
      const key = `${e.slot.start_time}_${e.slot.end_time}`;
      uniqueSlots.set(key, e.slot);
    }

    for (const [, slot] of uniqueSlots) {
      const chars: CharacterWithOwner[] = [];

      for (const e of entries) {
        if (e.slot.start_time <= slot.start_time && e.slot.end_time >= slot.end_time) {
          for (const char of e.reg.characters) {
            const charId = `${e.reg.id}_${char.nickname}`;
            if (!chars.find(c => c.id === charId)) {
              chars.push({
                id: charId,
                owner_id: e.reg.id,
                ownerName: e.reg.owner_name,
                nickname: char.nickname,
                class_type: char.class_type,
                combat_power: char.combat_power,
                can_clear_raid: char.can_clear_raid,
              });
            }
          }
        }
      }

      if (chars.length > 0) {
        result.push({ slot, characters: chars });
      }
    }
  }

  // 시간순 정렬
  result.sort((a, b) => {
    const d = a.slot.date.localeCompare(b.slot.date);
    return d !== 0 ? d : a.slot.start_time.localeCompare(b.slot.start_time);
  });

  return result;
}

// 딜러(근딜/원딜)만의 평균 전투력
function calcTeamAvg(members: RaidMember[]): number {
  const dealers = members.filter(m => m.class_type === '근딜' || m.class_type === '원딜');
  if (dealers.length === 0) return 0;
  return dealers.reduce((sum, m) => sum + m.combat_power, 0) / dealers.length;
}

function createBot(classType: ClassType, combatPower: number, idx: number): BotCharacter {
  return { isBot: true, nickname: `공방인원${idx}`, class_type: classType, combat_power: combatPower };
}

function getBotCombatPower(members: CharacterWithOwner[]): number {
  const dps = members.filter(m => m.class_type !== '호법성' && m.class_type !== '치유성');
  if (dps.length === 0) return members.length > 0 ? Math.min(...members.map(m => m.combat_power)) : 0;
  return Math.min(...dps.map(m => m.combat_power));
}

function countSupportInTeam(members: RaidMember[]): number {
  return members.filter(m => m.class_type === '치유성' || m.class_type === '호법성').length;
}

function sortRaidsBotsLast(raids: RaidGroup[]): RaidGroup[] {
  const sorted = [...raids].sort((a, b) => a.botCount - b.botCount);
  return sorted.map((r, i) => ({ ...r, id: i + 1 }));
}

const MAX_TOTAL_BOTS = 5;

function scoreComposition(comp: RaidComposition): number {
  let score = 0;
  const totalBots = comp.raids.reduce((sum, r) => sum + r.botCount, 0);

  // 최우선: 제외 인원 최소화
  score += comp.excludedCharacters.length * 10000;

  // 전체 봇 5개 초과 시 큰 패널티
  if (totalBots > MAX_TOTAL_BOTS) score += (totalBots - MAX_TOTAL_BOTS) * 8000;

  // 봇 수 패널티
  score += totalBots * 500;

  // 공격대 간 전투력 균등 (봇 4개 미만만, 높은 가중치)
  const validRaids = comp.raids.filter(r => r.botCount < 4);
  if (validRaids.length > 1) {
    const avgs = validRaids.map(r => r.avgCombatPower);
    const maxDiff = Math.max(...avgs) - Math.min(...avgs);
    score += maxDiff * 50;
    // 표준편차 기반 추가 패널티
    const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    const variance = avgs.reduce((s, v) => s + (v - mean) ** 2, 0) / avgs.length;
    score += Math.sqrt(variance) * 30;
  }

  // 모든 팀 간 전투력 균등 (공격대 내 팀 간 + 전체 팀 간)
  const allTeamAvgs: number[] = [];
  for (const raid of validRaids) {
    allTeamAvgs.push(raid.team1.avgCombatPower, raid.team2.avgCombatPower);
    // 공격대 내 팀 간 차이
    const teamDiff = Math.abs(raid.team1.avgCombatPower - raid.team2.avgCombatPower);
    score += teamDiff * 20;
  }
  if (allTeamAvgs.length > 1) {
    const teamMean = allTeamAvgs.reduce((a, b) => a + b, 0) / allTeamAvgs.length;
    const teamVar = allTeamAvgs.reduce((s, v) => s + (v - teamMean) ** 2, 0) / allTeamAvgs.length;
    score += Math.sqrt(teamVar) * 20;
  }

  // 근딜 없는 팀 패널티
  for (const raid of comp.raids) {
    if (!raid.team1.members.some(m => m.class_type === '근딜')) score += 200;
    if (!raid.team2.members.some(m => m.class_type === '근딜')) score += 200;
  }

  // 봇이 마지막 공격대가 아닌 곳에 있으면 큰 패널티
  for (let i = 0; i < comp.raids.length - 1; i++) {
    if (comp.raids[i].botCount > 0) score += 5000;
  }

  // 빠지는 인원 중 공팟클리어 불가자가 빠지는 게 나음 (가능자가 빠지면 추가 패널티)
  for (const ex of comp.excludedCharacters) {
    if (!ex.can_clear_raid) score -= 2000; // 불가자가 빠지면 감점(좋음)
  }

  return score;
}

function compositionKey(comp: RaidComposition): string {
  const raidKeys = comp.raids.map(r => {
    const t1 = r.team1.members.map(m => m.nickname).sort().join(',');
    const t2 = r.team2.members.map(m => m.nickname).sort().join(',');
    const slotKey = `${r.timeSlot.date}_${r.timeSlot.start_time}`;
    return [slotKey, [t1, t2].sort().join('|')].join('::');
  });
  raidKeys.sort();
  return raidKeys.join('||');
}

// 단일 공격대 생성 - 치유성/호법성 정확히 1명씩
// maxBotsPerRaid: 이 공격대에서 사용 가능한 최대 봇 수
function tryFormRaid(
  available: CharacterWithOwner[],
  usedCharIds: Set<string>,
  timeSlot: TimeSlot,
  raidId: number,
  _globalBotCount: number,
  maxBotsPerRaid: number,
  usedOwnersInTimeSlot: Set<string>
): { raid: RaidGroup; usedChars: CharacterWithOwner[] } | null {
  const eligible = available.filter(
    c => !usedCharIds.has(c.id) && !usedOwnersInTimeSlot.has(c.owner_id)
  );

  if (eligible.length === 0) return null;

  const healers = eligible.filter(c => c.class_type === '치유성');
  const tanks = eligible.filter(c => c.class_type === '호법성');

  const team1Members: RaidMember[] = [];
  const team2Members: RaidMember[] = [];
  const usedChars: CharacterWithOwner[] = [];
  const usedOwnerIds = new Set<string>();
  let botCount = 0;

  const addToTeam = (team: RaidMember[], char: CharacterWithOwner) => {
    team.push({ ...char, isBot: false, ownerName: char.ownerName });
    usedChars.push(char);
    usedOwnerIds.add(char.owner_id);
  };

  // 2팀: 치유성 정확히 1명
  if (healers.length > 0) {
    addToTeam(team2Members, healers[0]);
  } else if (botCount < maxBotsPerRaid) {
    team2Members.push(createBot('치유성', getBotCombatPower(eligible), ++botCount));
  } else {
    return null;
  }

  // 1팀: 호법성 > 치유성 > 봇 정확히 1명
  const remainTanks = tanks.filter(c => !usedChars.find(u => u.id === c.id));
  const remainHealers = healers.filter(c => !usedChars.find(u => u.id === c.id));

  if (remainTanks.length > 0) {
    addToTeam(team1Members, remainTanks[0]);
  } else if (remainHealers.length > 0) {
    addToTeam(team1Members, remainHealers[0]);
  } else if (botCount < maxBotsPerRaid) {
    team1Members.push(createBot('호법성', getBotCombatPower(eligible), ++botCount));
  } else {
    return null;
  }

  // 나머지 배치 (DPS만, 전투력 균형 기반)
  const remainingDps = eligible
    .filter(c => !usedChars.find(u => u.id === c.id) && (c.class_type === '근딜' || c.class_type === '원딜'))
    .sort((a, b) => b.combat_power - a.combat_power); // 높은 전투력부터

  // 팀 전투력 합계 헬퍼
  const teamDpsSum = (team: RaidMember[]) =>
    team.filter(m => m.class_type === '근딜' || m.class_type === '원딜').reduce((s, m) => s + m.combat_power, 0);

  for (const char of remainingDps) {
    if (team1Members.length >= 4 && team2Members.length >= 4) break;

    const ownerIn1 = team1Members.some(m => !('isBot' in m && m.isBot) && (m as any).owner_id === char.owner_id);
    const ownerIn2 = team2Members.some(m => !('isBot' in m && m.isBot) && (m as any).owner_id === char.owner_id);
    const can1 = team1Members.length < 4 && !ownerIn1;
    const can2 = team2Members.length < 4 && !ownerIn2;

    if (can1 && can2) {
      // 전투력이 낮은 팀에 배치
      if (teamDpsSum(team1Members) <= teamDpsSum(team2Members)) {
        addToTeam(team1Members, char);
      } else {
        addToTeam(team2Members, char);
      }
    } else if (can1) {
      addToTeam(team1Members, char);
    } else if (can2) {
      addToTeam(team2Members, char);
    } else if (team1Members.length < 4) {
      addToTeam(team1Members, char);
    } else if (team2Members.length < 4) {
      addToTeam(team2Members, char);
    }
  }

  // 봇 채우기
  const botPower = getBotCombatPower(usedChars);
  while (team1Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team1Members.some(m => m.class_type === '근딜');
    team1Members.push(createBot(needMelee ? '근딜' : '원딜', botPower, ++botCount));
  }
  while (team2Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team2Members.some(m => m.class_type === '근딜');
    team2Members.push(createBot(needMelee ? '근딜' : '원딜', botPower, ++botCount));
  }

  if (team1Members.length < 4 || team2Members.length < 4) return null;
  // 1팀: 치유성 또는 호법성 정확히 1명
  if (countSupportInTeam(team1Members) !== 1) return null;
  // 2팀: 치유성 정확히 1명
  const team2Healers = team2Members.filter(m => m.class_type === '치유성').length;
  const team2Tanks = team2Members.filter(m => m.class_type === '호법성').length;
  if (team2Healers !== 1 || team2Tanks !== 0) return null;

  const team1: Team = { members: team1Members, avgCombatPower: calcTeamAvg(team1Members) };
  const team2: Team = { members: team2Members, avgCombatPower: calcTeamAvg(team2Members) };

  return {
    raid: {
      id: raidId,
      team1, team2,
      avgCombatPower: (team1.avgCombatPower + team2.avgCombatPower) / 2,
      botCount,
      timeSlot,
    },
    usedChars,
  };
}

function getExcluded(allChars: CharacterWithOwner[], usedIds: Set<string>) {
  return allChars
    .filter(c => !usedIds.has(c.id))
    .map(c => ({
      id: c.id, owner_id: c.owner_id, nickname: c.nickname,
      class_type: c.class_type, combat_power: c.combat_power,
      can_clear_raid: c.can_clear_raid, ownerName: c.ownerName,
    }));
}

// 모든 고유 캐릭터 목록 (중복 제거)
function getAllUniqueChars(slotGroups: SlotGroup[]): CharacterWithOwner[] {
  const seen = new Set<string>();
  const result: CharacterWithOwner[] = [];
  for (const sg of slotGroups) {
    for (const c of sg.characters) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        result.push(c);
      }
    }
  }
  return result;
}

// === 크로스-시간대 스케줄링 ===
function crossSlotComposition(
  slotGroups: SlotGroup[],
  maxBotsPerRaid: number,
  strategy: 'greedy' | 'balanced'
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  const sortedSlots = strategy === 'greedy'
    ? [...slotGroups].sort((a, b) => {
        const aAvail = a.characters.filter(c => !usedCharIds.has(c.id)).length;
        const bAvail = b.characters.filter(c => !usedCharIds.has(c.id)).length;
        return bAvail - aAvail;
      })
    : [...slotGroups];

  // 1단계: 봇 없이 가능한 공격대 먼저
  for (const sg of sortedSlots) {
    const available = sg.characters.filter(c => !usedCharIds.has(c.id));
    if (available.length < 2) continue;

    const usedOwnersInSlot = new Set<string>();

    while (true) {
      const slotAvail = sg.characters.filter(
        c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id)
      );
      if (slotAvail.length < 2) break;

      // 봇 없이 시도
      const result = tryFormRaid(
        sg.characters, usedCharIds, sg.slot, raidId,
        globalBotCount, 0, usedOwnersInSlot // maxBotsPerRaid=0: 봇 금지
      );
      if (!result) break;

      raids.push(result.raid);
      for (const c of result.usedChars) {
        usedCharIds.add(c.id);
        usedOwnersInSlot.add(c.owner_id);
      }
      raidId++;
    }
  }

  // 2단계: 남은 인원으로 봇 포함 공격대 (전체 봇 MAX_TOTAL_BOTS 이내)
  for (const sg of sortedSlots) {
    const available = sg.characters.filter(c => !usedCharIds.has(c.id));
    if (available.length < 2) continue;
    if (globalBotCount >= MAX_TOTAL_BOTS) break;

    const usedOwnersInSlot = new Set<string>();
    // 이미 이 시간대에 배치된 소유자 체크
    for (const raid of raids) {
      if (raid.timeSlot.date === sg.slot.date && raid.timeSlot.start_time === sg.slot.start_time) {
        for (const m of [...raid.team1.members, ...raid.team2.members]) {
          if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
            usedOwnersInSlot.add((m as any).owner_id);
          }
        }
      }
    }

    while (globalBotCount < MAX_TOTAL_BOTS) {
      const slotAvail = sg.characters.filter(
        c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id)
      );
      if (slotAvail.length < 2) break;

      const remainingBots = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(
        sg.characters, usedCharIds, sg.slot, raidId,
        globalBotCount, Math.min(maxBotsPerRaid, remainingBots), usedOwnersInSlot
      );
      if (!result) break;

      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) {
        usedCharIds.add(c.id);
        usedOwnersInSlot.add(c.owner_id);
      }
      raidId++;
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp);
  return comp;
}

// 균등 분배 크로스-시간대
function crossSlotBalanced(
  slotGroups: SlotGroup[],
  maxBots: number
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  // 시간순으로 처리
  for (const sg of slotGroups) {
    const available = sg.characters.filter(c => !usedCharIds.has(c.id));
    if (available.length < 2) continue;

    // 이 시간대에서 가능한 공격대 수
    const numRaidsInSlot = Math.max(1, Math.floor(available.length / 8));
    const usedOwnersInSlot = new Set<string>();

    if (numRaidsInSlot > 1) {
      // 균등 분배: 지그재그
      const sorted = [...available].sort((a, b) => b.combat_power - a.combat_power);
      const groups: CharacterWithOwner[][] = Array.from({ length: numRaidsInSlot }, () => []);

      // 서포트 먼저 분배
      const healers = sorted.filter(c => c.class_type === '치유성');
      const tanks = sorted.filter(c => c.class_type === '호법성');
      const dps = sorted.filter(c => c.class_type === '근딜' || c.class_type === '원딜');
      const assignedIds = new Set<string>();

      for (let i = 0; i < numRaidsInSlot; i++) {
        if (i < healers.length) { groups[i].push(healers[i]); assignedIds.add(healers[i].id); }
        const t = tanks.find(c => !assignedIds.has(c.id));
        const h = healers.find(c => !assignedIds.has(c.id));
        if (t) { groups[i].push(t); assignedIds.add(t.id); }
        else if (h) { groups[i].push(h); assignedIds.add(h.id); }
      }

      // DPS 지그재그
      let dir = 1, gi = 0;
      for (const c of dps) {
        if (assignedIds.has(c.id)) continue;
        while (gi >= 0 && gi < numRaidsInSlot && groups[gi].length >= 8) gi += dir;
        if (gi < 0 || gi >= numRaidsInSlot) { dir *= -1; gi += dir; while (gi >= 0 && gi < numRaidsInSlot && groups[gi].length >= 8) gi += dir; }
        if (gi < 0 || gi >= numRaidsInSlot) break;
        groups[gi].push(c);
        gi += dir;
        if (gi < 0 || gi >= numRaidsInSlot) { dir *= -1; gi += dir; }
      }

      for (const group of groups) {
        if (group.length < 2) continue;
        // 봇 없이 먼저 시도
        const result = tryFormRaid(group, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
        if (result) {
          raids.push(result.raid);
          for (const c of result.usedChars) { usedCharIds.add(c.id); usedOwnersInSlot.add(c.owner_id); }
          raidId++;
        }
      }
    } else {
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
      if (result) {
        raids.push(result.raid);
        for (const c of result.usedChars) { usedCharIds.add(c.id); usedOwnersInSlot.add(c.owner_id); }
        raidId++;
      }
    }
  }

  // 2단계: 남은 인원으로 봇 포함
  for (const sg of slotGroups) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    const available = sg.characters.filter(c => !usedCharIds.has(c.id));
    if (available.length < 2) continue;
    const usedOwnersInSlot2 = new Set<string>();
    for (const raid of raids) {
      if (raid.timeSlot.date === sg.slot.date && raid.timeSlot.start_time === sg.slot.start_time) {
        for (const m of [...raid.team1.members, ...raid.team2.members]) {
          if (!('isBot' in m && m.isBot) && 'owner_id' in m) usedOwnersInSlot2.add((m as any).owner_id);
        }
      }
    }
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot2.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(maxBots, rem), usedOwnersInSlot2);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) { usedCharIds.add(c.id); usedOwnersInSlot2.add(c.owner_id); }
      raidId++;
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp);
  return comp;
}

// 배열 셔플 (Fisher-Yates)
function shuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 셔플된 캐릭터 순서로 크로스-시간대 구성 (2단계: 봇 없이 → 봇 포함)
function shuffledComposition(
  slotGroups: SlotGroup[],
  maxBotsPerRaid: number,
  seed: number
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  const shuffledSlots: SlotGroup[] = slotGroups.map(sg => ({
    slot: sg.slot,
    characters: shuffle(sg.characters, seed + sg.slot.date.charCodeAt(0)),
  }));

  const orderedSlots = seed % 3 === 0
    ? [...shuffledSlots].reverse()
    : seed % 3 === 1
      ? shuffle(shuffledSlots, seed)
      : shuffledSlots;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  // 1단계: 봇 없이
  for (const sg of orderedSlots) {
    const usedOwnersInSlot = new Set<string>();
    while (true) {
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      for (const c of result.usedChars) { usedCharIds.add(c.id); usedOwnersInSlot.add(c.owner_id); }
      raidId++;
    }
  }

  // 2단계: 봇 포함 (전체 MAX_TOTAL_BOTS 이내)
  for (const sg of orderedSlots) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    const available = sg.characters.filter(c => !usedCharIds.has(c.id));
    if (available.length < 2) continue;

    const usedOwnersInSlot = new Set<string>();
    for (const raid of raids) {
      if (raid.timeSlot.date === sg.slot.date && raid.timeSlot.start_time === sg.slot.start_time) {
        for (const m of [...raid.team1.members, ...raid.team2.members]) {
          if (!('isBot' in m && m.isBot) && 'owner_id' in m) usedOwnersInSlot.add((m as any).owner_id);
        }
      }
    }

    while (globalBotCount < MAX_TOTAL_BOTS) {
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const remainingBots = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(maxBotsPerRaid, remainingBots), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) { usedCharIds.add(c.id); usedOwnersInSlot.add(c.owner_id); }
      raidId++;
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp);
  return comp;
}

// 시간대 겹침 체크 (1시간 소요시간 기준)
function timeOverlaps(slotA: TimeSlot, slotB: TimeSlot, durationHours: number): boolean {
  if (slotA.date !== slotB.date) return false;
  // 시작 시간에서 duration만큼의 범위가 겹치는지
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const aStart = toMin(slotA.start_time);
  const aEnd = Math.min(toMin(slotA.end_time), aStart + durationHours * 60);
  const bStart = toMin(slotB.start_time);
  const bEnd = Math.min(toMin(slotB.end_time), bStart + durationHours * 60);
  return aStart < bEnd && bStart < aEnd;
}

// 메인 솔버
export function solveRaidComposition(registrations: DBRegistration[], raidType: RaidType = '루드라'): RaidComposition[] {
  if (registrations.length === 0) return [];
  const _config = RAID_CONFIGS[raidType];

  const slotGroups = buildSlotGroups(registrations);
  const maxBots = 4;
  const allResults: RaidComposition[] = [];

  // 기본 전략들
  const greedy = crossSlotComposition(slotGroups, maxBots, 'greedy');
  if (greedy) allResults.push(greedy);

  const balanced = crossSlotBalanced(slotGroups, maxBots);
  if (balanced) allResults.push(balanced);

  const timeOrdered = crossSlotComposition(slotGroups, maxBots, 'balanced');
  if (timeOrdered) allResults.push(timeOrdered);

  // 셔플 기반 다양한 조합 생성 (20회 시도)
  for (let seed = 1; seed <= 20; seed++) {
    const comp = shuffledComposition(slotGroups, maxBots, seed * 7919);
    if (comp) allResults.push(comp);
  }

  // 중복 제거
  const seen = new Set<string>();
  const unique: RaidComposition[] = [];
  for (const comp of allResults) {
    const key = compositionKey(comp);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(comp);
    }
  }

  // 점수순 정렬 (우선순위: 봇 최소 > 전투력 균등 > 인원 최대)
  unique.sort((a, b) => a.score - b.score);
  return unique.slice(0, 10);
}
