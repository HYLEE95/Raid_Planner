import type { ClassType, DBRegistration, HuntAssignment, TimeSlot } from './types';
import { CLASS_TYPES_BY_RAID } from './types';

const SLOT_MINUTES = 30;
const HUNT_START_MIN = 9 * 60;    // 09:00
const HUNT_END_MIN = 25 * 60;     // 익일 01:00

export interface HuntVoter {
  nickname: string;
  class_type: ClassType;
  ownerName: string;
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

/** (날짜, 30분 슬롯) -> 그 시간에 가능한 캐릭터 목록. 같은 캐릭터는 1회만 센다. */
export function buildHeatmap(
  regs: DBRegistration[],
  weekDates: string[]
): Map<string, HuntVoter[]> {
  const dateSet = new Set(weekDates);
  const map = new Map<string, HuntVoter[]>();
  const seen = new Map<string, Set<string>>();

  for (const reg of regs) {
    for (const ts of reg.time_slots) {
      if (!dateSet.has(ts.date)) continue;
      for (const bucket of bucketsForSlot(ts)) {
        const key = heatmapKey(ts.date, bucket);
        if (!map.has(key)) {
          map.set(key, []);
          seen.set(key, new Set());
        }
        const names = seen.get(key)!;
        for (const c of reg.characters) {
          if (names.has(c.nickname)) continue;
          names.add(c.nickname);
          map.get(key)!.push({
            nickname: c.nickname,
            class_type: c.class_type,
            ownerName: reg.owner_name,
          });
        }
      }
    }
  }

  const order = CLASS_TYPES_BY_RAID['정규사냥'];
  for (const list of map.values()) {
    list.sort((a, b) => {
      const d = order.indexOf(a.class_type) - order.indexOf(b.class_type);
      return d !== 0 ? d : a.nickname.localeCompare(b.nickname, 'ko');
    });
  }
  return map;
}

/** 캐릭터별 총 배정 횟수. 외부 용병은 세지 않는다. */
export function countAssignments(a: HuntAssignment): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of a.slots) {
    for (const party of slot.parties) {
      for (const m of party.members) {
        if (m.isMercenary) continue;
        counts.set(m.nickname, (counts.get(m.nickname) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** 같은 슬롯 안에 이미 배정된 캐릭터인지. 파티가 달라도 참이다. */
export function isAlreadyInSlot(
  a: HuntAssignment,
  date: string,
  start: string,
  nickname: string
): boolean {
  const slot = a.slots.find(s => s.date === date && s.start_time === start);
  if (!slot) return false;
  return slot.parties.some(p =>
    p.members.some(m => !m.isMercenary && m.nickname === nickname)
  );
}
