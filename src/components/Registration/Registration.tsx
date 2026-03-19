import { useState, useMemo } from 'react';
import {
  getWednesday,
  formatDate,
  getWeekDates,
  getDayName,
  generateTimeSlots,
  generateId,
  saveRegistration,
} from '../../lib/storage';
import WeekPicker from '../WeekPicker/WeekPicker';
import type { ClassType, TimeSlot, DBRegistration, RaidType } from '../../lib/types';
import { RAID_TYPES, RAID_CONFIGS } from '../../lib/types';

const CLASS_TYPES: ClassType[] = ['근딜', '원딜', '호법성', '치유성'];

const CLASS_COLORS: Record<ClassType, string> = {
  '근딜': 'bg-red-100 text-red-800 border-red-300',
  '원딜': 'bg-blue-100 text-blue-800 border-blue-300',
  '호법성': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  '치유성': 'bg-green-100 text-green-800 border-green-300',
};

interface CharacterForm {
  nickname: string;
  class_type: ClassType;
  combat_power: number;
  can_clear_raid: boolean;
}

interface DateTimeSelection {
  date: string;
  timeRanges: { start: string; end: string }[];
}

export default function Registration() {
  const [selectedRaid, setSelectedRaid] = useState<RaidType | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [characters, setCharacters] = useState<CharacterForm[]>([
    { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false },
  ]);
  const [selectedWeek, setSelectedWeek] = useState(() => {
    return formatDate(getWednesday(new Date()));
  });
  const [dateSelections, setDateSelections] = useState<DateTimeSelection[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const weekDates = useMemo(
    () => getWeekDates(new Date(selectedWeek + 'T00:00:00')),
    [selectedWeek]
  );
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  const addCharacter = () => {
    setCharacters([
      ...characters,
      { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false },
    ]);
  };

  const removeCharacter = (idx: number) => {
    if (characters.length <= 1) return;
    setCharacters(characters.filter((_, i) => i !== idx));
  };

  const updateCharacter = (idx: number, field: keyof CharacterForm, value: any) => {
    const updated = [...characters];
    (updated[idx] as any)[field] = value;
    setCharacters(updated);
  };

  const toggleDate = (dateStr: string) => {
    const exists = dateSelections.find(d => d.date === dateStr);
    if (exists) {
      setDateSelections(dateSelections.filter(d => d.date !== dateStr));
    } else {
      setDateSelections([
        ...dateSelections,
        { date: dateStr, timeRanges: [{ start: '20:00', end: '23:00' }] },
      ]);
    }
  };

  const addTimeRange = (dateStr: string) => {
    setDateSelections(
      dateSelections.map(d =>
        d.date === dateStr
          ? { ...d, timeRanges: [...d.timeRanges, { start: '20:00', end: '23:00' }] }
          : d
      )
    );
  };

  const removeTimeRange = (dateStr: string, idx: number) => {
    setDateSelections(
      dateSelections.map(d =>
        d.date === dateStr
          ? { ...d, timeRanges: d.timeRanges.filter((_, i) => i !== idx) }
          : d
      )
    );
  };

  const updateTimeRange = (
    dateStr: string,
    idx: number,
    field: 'start' | 'end',
    value: string
  ) => {
    setDateSelections(
      dateSelections.map(d =>
        d.date === dateStr
          ? {
              ...d,
              timeRanges: d.timeRanges.map((r, i) =>
                i === idx ? { ...r, [field]: value } : r
              ),
            }
          : d
      )
    );
  };

  const isValid = () => {
    if (!selectedRaid) return false;
    if (!ownerName.trim()) return false;
    if (characters.some(c => !c.nickname.trim() || c.combat_power <= 0)) return false;
    if (dateSelections.length === 0) return false;
    if (dateSelections.some(d => d.timeRanges.length === 0)) return false;
    return true;
  };

  const handleSubmit = async () => {
    if (!isValid()) return;

    setSaving(true);
    try {
      const timeSlotList: TimeSlot[] = [];
      for (const ds of dateSelections) {
        for (const tr of ds.timeRanges) {
          timeSlotList.push({
            date: ds.date,
            start_time: tr.start,
            end_time: tr.end,
          });
        }
      }

      const registration: DBRegistration = {
        id: generateId(),
        owner_name: ownerName.trim(),
        raid_type: selectedRaid!,
        characters: characters.map(c => ({
          nickname: c.nickname.trim(),
          class_type: c.class_type,
          combat_power: c.combat_power,
          can_clear_raid: c.can_clear_raid,
        })),
        week_start: selectedWeek,
        time_slots: timeSlotList,
        created_at: new Date().toISOString(),
      };

      await saveRegistration(registration);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      // 폼 리셋
      setOwnerName('');
      setCharacters([
        { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false },
      ]);
      setDateSelections([]);
    } catch (err) {
      alert('저장 실패: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">파티 참여 신청</h1>

      {saved && (
        <div className="mb-4 p-3 bg-green-100 text-green-800 rounded-lg border border-green-300">
          신청이 완료되었습니다!
        </div>
      )}

      {/* 레이드 선택 */}
      <section className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">레이드 선택</label>
        <div className="flex gap-2">
          {RAID_TYPES.map(rt => (
            <button
              key={rt}
              onClick={() => setSelectedRaid(rt)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                selectedRaid === rt
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-300'
              }`}
            >
              {RAID_CONFIGS[rt].label}
            </button>
          ))}
        </div>
      </section>

      {/* 레이드 선택 후에만 하위 콘텐츠 표시 */}
      {selectedRaid && (<>

      {/* 주차 선택 */}
      <section className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">주차 선택</label>
        <WeekPicker
          value={selectedWeek}
          onChange={(v) => {
            setSelectedWeek(v);
            setDateSelections([]);
          }}
        />
      </section>

      {/* 소유자 이름 */}
      <section className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          캐릭터 소유자 이름
        </label>
        <input
          type="text"
          value={ownerName}
          onChange={e => setOwnerName(e.target.value)}
          placeholder="이름을 입력하세요"
          className="w-full p-2 border border-gray-300 rounded-lg"
        />
      </section>

      {/* 캐릭터 목록 */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-700">캐릭터 정보</h2>
          <button
            onClick={addCharacter}
            className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
          >
            + 캐릭터 추가
          </button>
        </div>

        <div className="space-y-3">
          {characters.map((char, idx) => (
            <div
              key={idx}
              className="p-4 border border-gray-200 rounded-lg bg-gray-50"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">
                  캐릭터 {idx + 1}
                </span>
                {characters.length > 1 && (
                  <button
                    onClick={() => removeCharacter(idx)}
                    className="text-red-500 text-sm hover:text-red-700"
                  >
                    삭제
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">닉네임</label>
                  <input
                    type="text"
                    value={char.nickname}
                    onChange={e => updateCharacter(idx, 'nickname', e.target.value)}
                    placeholder="캐릭터 닉네임"
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">직업군</label>
                  <div className="flex gap-1 flex-wrap">
                    {CLASS_TYPES.map(ct => (
                      <button
                        key={ct}
                        onClick={() => updateCharacter(idx, 'class_type', ct)}
                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                          char.class_type === ct
                            ? CLASS_COLORS[ct] + ' font-bold'
                            : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {ct}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">전투력 (K)</label>
                  <input
                    type="number"
                    value={char.combat_power || ''}
                    onChange={e =>
                      updateCharacter(idx, 'combat_power', parseFloat(e.target.value) || 0)
                    }
                    placeholder="예: 150"
                    min={0}
                    step={0.1}
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={char.can_clear_raid}
                      onChange={e =>
                        updateCharacter(idx, 'can_clear_raid', e.target.checked)
                      }
                      className="w-4 h-4 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">공팟 클리어 가능</span>
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 날짜 선택 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">가능 날짜 선택</h2>
        <div className="flex gap-2 flex-wrap mb-4">
          {weekDates.map(date => {
            const dateStr = formatDate(date);
            const selected = dateSelections.some(d => d.date === dateStr);
            return (
              <button
                key={dateStr}
                onClick={() => toggleDate(dateStr)}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  selected
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{getDayName(date)}</div>
                <div className="text-xs opacity-75">
                  {date.getMonth() + 1}/{date.getDate()}
                </div>
              </button>
            );
          })}
        </div>

        {/* 시간대 선택 */}
        {dateSelections
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(ds => {
            const date = new Date(ds.date + 'T00:00:00');
            return (
              <div
                key={ds.date}
                className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">
                    {date.getMonth() + 1}/{date.getDate()} ({getDayName(date)})
                  </span>
                  <button
                    onClick={() => addTimeRange(ds.date)}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    + 시간대 추가
                  </button>
                </div>

                {ds.timeRanges.map((tr, idx) => (
                  <div key={idx} className="flex items-center gap-2 mb-2">
                    <select
                      value={tr.start}
                      onChange={e =>
                        updateTimeRange(ds.date, idx, 'start', e.target.value)
                      }
                      className="p-1.5 border border-gray-300 rounded text-sm bg-white"
                    >
                      {timeSlots.map(t => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <span className="text-gray-500">~</span>
                    <select
                      value={tr.end}
                      onChange={e =>
                        updateTimeRange(ds.date, idx, 'end', e.target.value)
                      }
                      className="p-1.5 border border-gray-300 rounded text-sm bg-white"
                    >
                      {timeSlots.map(t => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {ds.timeRanges.length > 1 && (
                      <button
                        onClick={() => removeTimeRange(ds.date, idx)}
                        className="text-red-400 text-xs hover:text-red-600"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
      </section>

      {/* 제출 버튼 */}
      <button
        onClick={handleSubmit}
        disabled={!isValid() || saving}
        className={`w-full py-3 rounded-lg text-white font-semibold transition-colors ${
          isValid() && !saving
            ? 'bg-indigo-600 hover:bg-indigo-700'
            : 'bg-gray-400 cursor-not-allowed'
        }`}
      >
        {saving ? '저장 중...' : '신청하기'}
      </button>

      {/* 하단 네비게이션 여백 */}
      <div className="h-8" />

      </>)}
    </div>
  );
}
