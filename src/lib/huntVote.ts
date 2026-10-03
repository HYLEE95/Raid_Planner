import type { ClassType, DBRegistration, HuntAssignment, TimeSlot } from './types';
import { CLASS_TYPES_BY_RAID } from './types';

const SLOT_MINUTES = 30;
const HUNT_START_MIN = 9 * 60;    // 09:00
const HUNT_END_MIN = 25 * 60;     // 익일 01:00

export interface HuntCharacter {
  nickname: string;
  class_type: ClassType;
}

/** 투표 단위는 소유주다. 배정 시 그중 한 캐릭터를 고른다. */
export interface HuntVoter {
  ownerName: string;
  characters: HuntCharacter[];
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function toTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const HUNT_TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let m = HUNT_START_MIN; m <= HUNT_END_MIN; m += SLOT_MINUTES) out.push(toTime(m));
  return out;
})();

export const HUNT_SLOT_STARTS: string[] = HUNT_TIME_OPTIONS.slice(0, -1);

/** '24:30' -> '익일 00:30'. 자정 전 시각은 그대로 돌려준다. */
export function formatExtendedTime(t: string): string {
  const min = toMinutes(t);
  return min < 24 * 60 ? t : `익일 ${toTime(min - 24 * 60)}`;
}

/** 투표 범위를 30분 슬롯 시작점 목록으로 쪼갠다. 끝에 걸친 반쪽 슬롯은 버린다. */
export function bucketsForSlot(slot: TimeSlot): string[] {
  const rawStart = Math.max(toMinutes(slot.start_time), HUNT_START_MIN);
  const end = Math.min(toMinutes(slot.end_time), HUNT_END_MIN);
  const start = Math.ceil(rawStart / SLOT_MINUTES) * SLOT_MINUTES;
  const out: string[] = [];
  for (let m = start; m + SLOT_MINUTES <= end; m += SLOT_MINUTES) out.push(toTime(m));
  return out;
}

export function heatmapKey(date: string, slotStart: string): string {
  return `${date}|${slotStart}`;
}

/** (날짜, 30분 슬롯) -> 그 시간에 가능한 소유주 목록. 같은 소유주는 1회만 센다. */
export function buildHeatmap(
  regs: DBRegistration[],
  weekDates: string[]
): Map<string, HuntVoter[]> {
  const dateSet = new Set(weekDates);
  const byKey = new Map<string, Map<string, HuntVoter>>();

  for (const reg of regs) {
    if (reg.characters.length === 0) continue;
    for (const ts of reg.time_slots) {
      if (!dateSet.has(ts.date)) continue;
      for (const bucket of bucketsForSlot(ts)) {
        const key = heatmapKey(ts.date, bucket);
        if (!byKey.has(key)) byKey.set(key, new Map());
        const owners = byKey.get(key)!;
        if (!owners.has(reg.owner_name)) {
          owners.set(reg.owner_name, { ownerName: reg.owner_name, characters: [] });
        }
        const voter = owners.get(reg.owner_name)!;
        for (const c of reg.characters) {
          if (voter.characters.some(x => x.nickname === c.nickname)) continue;
          voter.characters.push({ nickname: c.nickname, class_type: c.class_type });
        }
      }
    }
  }

  const order = CLASS_TYPES_BY_RAID['정규사냥'];
  const map = new Map<string, HuntVoter[]>();
  for (const [key, owners] of byKey) {
    const list = [...owners.values()];
    for (const v of list) {
      v.characters.sort((a, b) => order.indexOf(a.class_type) - order.indexOf(b.class_type));
    }
    list.sort((a, b) => a.ownerName.localeCompare(b.ownerName, 'ko'));
    map.set(key, list);
  }
  return map;
}

/** 소유주별 총 배정 횟수. 외부 용병은 세지 않는다. */
export function countAssignments(a: HuntAssignment): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of a.slots) {
    for (const party of slot.parties) {
      for (const m of party.members) {
        if (m.isMercenary) continue;
        counts.set(m.ownerName, (counts.get(m.ownerName) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** 같은 슬롯 안에 그 소유주의 캐릭터가 이미 배정됐는지. 파티·캐릭터가 달라도 참이다. */
export function isAlreadyInSlot(
  a: HuntAssignment,
  date: string,
  start: string,
  ownerName: string
): boolean {
  const slot = a.slots.find(s => s.date === date && s.start_time === start);
  if (!slot) return false;
  return slot.parties.some(p =>
    p.members.some(m => !m.isMercenary && m.ownerName === ownerName)
  );
}
