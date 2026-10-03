import { describe, it, expect } from 'vitest';
import {
  HUNT_TIME_OPTIONS,
  HUNT_SLOT_STARTS,
  formatExtendedTime,
  bucketsForSlot,
  heatmapKey,
  buildHeatmap,
  countAssignments,
  isAlreadyInSlot,
} from './huntVote';
import type { DBRegistration, HuntAssignment } from './types';

function reg(
  owner: string,
  chars: { nickname: string; class_type: any }[],
  slots: { date: string; start_time: string; end_time: string }[]
): DBRegistration {
  return {
    id: owner,
    owner_name: owner,
    raid_type: '정규사냥',
    characters: chars,
    week_start: '2026-10-01',
    time_slots: slots,
    created_at: '2026-10-01T00:00:00.000Z',
  };
}

describe('시간 옵션', () => {
  it('09:00부터 25:00까지 30분 간격 33개를 만든다', () => {
    expect(HUNT_TIME_OPTIONS).toHaveLength(33);
    expect(HUNT_TIME_OPTIONS[0]).toBe('09:00');
    expect(HUNT_TIME_OPTIONS[1]).toBe('09:30');
    expect(HUNT_TIME_OPTIONS.at(-1)).toBe('25:00');
  });

  it('슬롯 시작점은 마지막 경계를 뺀 32개다', () => {
    expect(HUNT_SLOT_STARTS).toHaveLength(32);
    expect(HUNT_SLOT_STARTS.at(-1)).toBe('24:30');
  });
});

describe('formatExtendedTime', () => {
  it('자정 전은 그대로 둔다', () => {
    expect(formatExtendedTime('09:00')).toBe('09:00');
    expect(formatExtendedTime('23:30')).toBe('23:30');
  });

  it('24시 이상은 익일 표기로 바꾼다', () => {
    expect(formatExtendedTime('24:00')).toBe('익일 00:00');
    expect(formatExtendedTime('24:30')).toBe('익일 00:30');
    expect(formatExtendedTime('25:00')).toBe('익일 01:00');
  });
});

describe('bucketsForSlot', () => {
  it('정시 범위를 30분 슬롯으로 쪼갠다', () => {
    expect(bucketsForSlot({ date: 'd', start_time: '20:00', end_time: '22:00' }))
      .toEqual(['20:00', '20:30', '21:00', '21:30']);
  });

  it('30분 경계에서 시작하는 범위도 처리한다', () => {
    expect(bucketsForSlot({ date: 'd', start_time: '20:30', end_time: '21:30' }))
      .toEqual(['20:30', '21:00']);
  });

  it('자정을 넘는 범위를 확장 시각으로 쪼갠다', () => {
    expect(bucketsForSlot({ date: 'd', start_time: '23:00', end_time: '25:00' }))
      .toEqual(['23:00', '23:30', '24:00', '24:30']);
  });

  it('끝에 걸친 반쪽 슬롯은 포함하지 않는다', () => {
    expect(bucketsForSlot({ date: 'd', start_time: '20:00', end_time: '20:30' }))
      .toEqual(['20:00']);
    expect(bucketsForSlot({ date: 'd', start_time: '20:00', end_time: '20:00' }))
      .toEqual([]);
  });

  it('투표 가능 범위 밖은 잘라낸다', () => {
    expect(bucketsForSlot({ date: 'd', start_time: '00:00', end_time: '10:00' }))
      .toEqual(['09:00', '09:30']);
    expect(bucketsForSlot({ date: 'd', start_time: '24:00', end_time: '26:00' }))
      .toEqual(['24:00', '24:30']);
  });
});

describe('buildHeatmap', () => {
  const dates = ['2026-10-01', '2026-10-02'];

  it('같은 슬롯에 겹치는 범위를 여러 번 신청해도 1회만 센다', () => {
    const map = buildHeatmap(
      [reg('갑', [{ nickname: '가캐', class_type: '세바' }], [
        { date: '2026-10-01', start_time: '20:00', end_time: '21:00' },
        { date: '2026-10-01', start_time: '20:30', end_time: '22:00' },
      ])],
      dates
    );
    expect(map.get(heatmapKey('2026-10-01', '20:30'))).toHaveLength(1);
  });

  it('여러 소유주를 합산한다', () => {
    const map = buildHeatmap(
      [
        reg('갑', [{ nickname: '가캐', class_type: '세바' }], [
          { date: '2026-10-01', start_time: '20:00', end_time: '21:00' },
        ]),
        reg('을', [{ nickname: '나캐', class_type: '거너' }], [
          { date: '2026-10-01', start_time: '20:00', end_time: '21:00' },
        ]),
      ],
      dates
    );
    expect(map.get(heatmapKey('2026-10-01', '20:00'))).toHaveLength(2);
  });

  it('캐릭터가 여럿인 소유주도 1명으로 세고, 캐릭터는 직업군 순서로 담는다', () => {
    const map = buildHeatmap(
      [reg('갑', [
        { nickname: '퓨캐', class_type: '퓨파' },
        { nickname: '바캐', class_type: '세바' },
      ], [{ date: '2026-10-01', start_time: '20:00', end_time: '21:00' }])],
      dates
    );
    const list = map.get(heatmapKey('2026-10-01', '20:00'))!;
    expect(list).toHaveLength(1);
    expect(list[0].characters.map(c => c.class_type)).toEqual(['세바', '퓨파']);
  });

  it('소유주는 이름순으로 정렬한다', () => {
    const slot = [{ date: '2026-10-01', start_time: '20:00', end_time: '21:00' }];
    const map = buildHeatmap(
      [
        reg('을', [{ nickname: '나캐', class_type: '거너' }], slot),
        reg('갑', [{ nickname: '가캐', class_type: '세바' }], slot),
      ],
      dates
    );
    expect(map.get(heatmapKey('2026-10-01', '20:00'))!.map(v => v.ownerName)).toEqual(['갑', '을']);
  });

  it('주차 밖 날짜는 집계하지 않는다', () => {
    const map = buildHeatmap(
      [reg('갑', [{ nickname: '가캐', class_type: '세바' }], [
        { date: '2026-11-11', start_time: '20:00', end_time: '21:00' },
      ])],
      dates
    );
    expect(map.size).toBe(0);
  });

  it('소유주 이름을 함께 담는다', () => {
    const map = buildHeatmap(
      [reg('갑', [{ nickname: '가캐', class_type: '세바' }], [
        { date: '2026-10-01', start_time: '20:00', end_time: '21:00' },
      ])],
      dates
    );
    expect(map.get(heatmapKey('2026-10-01', '20:00'))![0].ownerName).toBe('갑');
  });
});

describe('countAssignments', () => {
  const assignment: HuntAssignment = {
    slots: [
      {
        date: '2026-10-01', start_time: '20:00',
        parties: [{
          id: 'p1', capacity: 4, members: [
            { nickname: '가캐', class_type: '세바', ownerName: '갑' },
            { nickname: '용병1', class_type: '거너', ownerName: '용병', isMercenary: true },
          ],
        }],
      },
      {
        date: '2026-10-02', start_time: '21:00',
        parties: [{
          id: 'p2', capacity: 3, members: [
            { nickname: '가캐', class_type: '세바', ownerName: '갑' },
          ],
        }],
      },
    ],
  };

  it('여러 슬롯의 배정 횟수를 소유주별로 합산한다', () => {
    expect(countAssignments(assignment).get('갑')).toBe(2);
  });

  it('외부 용병은 집계에서 제외한다', () => {
    expect(countAssignments(assignment).has('용병')).toBe(false);
  });
});

describe('isAlreadyInSlot', () => {
  const assignment: HuntAssignment = {
    slots: [{
      date: '2026-10-01', start_time: '20:00',
      parties: [
        { id: 'p1', capacity: 4, members: [{ nickname: '가캐', class_type: '세바', ownerName: '갑' }] },
        { id: 'p2', capacity: 4, members: [] },
      ],
    }],
  };

  it('같은 슬롯에 그 소유주의 캐릭터가 있으면 참이다 (다른 캐릭터를 넣으려 해도)', () => {
    expect(isAlreadyInSlot(assignment, '2026-10-01', '20:00', '갑')).toBe(true);
  });

  it('다른 슬롯이면 거짓이다', () => {
    expect(isAlreadyInSlot(assignment, '2026-10-02', '20:00', '갑')).toBe(false);
  });

  it('배정되지 않은 소유주면 거짓이다', () => {
    expect(isAlreadyInSlot(assignment, '2026-10-01', '20:00', '을')).toBe(false);
  });

  it('용병은 소유주 판정에 쓰지 않는다', () => {
    const withMerc: HuntAssignment = {
      slots: [{
        date: '2026-10-01', start_time: '20:00',
        parties: [{ id: 'p1', capacity: 4, members: [
          { nickname: '용병1', class_type: '거너', ownerName: '용병', isMercenary: true },
        ] }],
      }],
    };
    expect(isAlreadyInSlot(withMerc, '2026-10-01', '20:00', '용병')).toBe(false);
  });
});
