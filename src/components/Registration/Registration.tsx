import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getWednesday,
  formatDate,
  getWeekDates,
  getDayName,
  generateTimeSlots,
  generateId,
  saveRegistration,
  deleteRegistration,
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
  is_underpowered: boolean;
}

interface DateTimeSelection {
  date: string;
  allDay: boolean;
  timeRanges: { start: string; end: string }[];
}

export default function Registration() {
  const location = useLocation();
  const navigate = useNavigate();
  const editData = (location.state as any)?.editRegistration as DBRegistration | undefined;

  const [editId, setEditId] = useState<string | null>(null);
  const [selectedRaid, setSelectedRaid] = useState<RaidType | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [characters, setCharacters] = useState<CharacterForm[]>([
    { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false, is_underpowered: false },
  ]);
  const [selectedWeek, setSelectedWeek] = useState(() => {
    return formatDate(getWednesday(new Date()));
  });
  const [dateSelections, setDateSelections] = useState<DateTimeSelection[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 수정 모드: 전달된 데이터로 폼 초기화
  useEffect(() => {
    if (!editData) return;
    setEditId(editData.id);
    setSelectedRaid(editData.raid_type);
    setOwnerName(editData.owner_name);
    setSelectedWeek(editData.week_start);
    setCharacters(
      editData.characters.map(c => ({
        nickname: c.nickname,
        class_type: c.class_type,
        combat_power: c.combat_power,
        can_clear_raid: c.can_clear_raid,
        is_underpowered: c.is_underpowered ?? false,
      }))
    );
    // 시간대 복원
    const dateMap = new Map<string, { start: string; end: string }[]>();
    for (const ts of editData.time_slots) {
      if (!dateMap.has(ts.date)) dateMap.set(ts.date, []);
      dateMap.get(ts.date)!.push({ start: ts.start_time, end: ts.end_time });
    }
    setDateSelections(
      Array.from(dateMap.entries()).map(([date, timeRanges]) => {
        // 00:00~23:30이면 시간 무관으로 복원
        const isAllDay = timeRanges.length === 1 && timeRanges[0].start === '00:00' && timeRanges[0].end === '23:30';
        return { date, allDay: isAllDay, timeRanges };
      })
    );
    // location.state 클리어 (뒤로가기 시 재로드 방지)
    window.history.replaceState({}, '');
  }, [editData]);

  const weekDates = useMemo(
    () => getWeekDates(new Date(selectedWeek + 'T00:00:00')),
    [selectedWeek]
  );
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  const addCharacter = () => {
    setCharacters([
      ...characters,
      { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false, is_underpowered: false },
    ]);
  };

  const removeCharacter = (idx: number) => {
    if (characters.length <= 1) return;
    setCharacters(characters.filter((_, i) => i !== idx));
  };

  const updateCharacter = (idx: number, field: keyof CharacterForm, value: any) => {
    const updated = [...characters];
    (updated[idx] as any)[field] = value;
    // 상호 배타: 하나 체크하면 다른 하나 해제
    if (field === 'can_clear_raid' && value === true) {
      updated[idx].is_underpowered = false;
    }
    if (field === 'is_underpowered' && value === true) {
      updated[idx].can_clear_raid = false;
    }
    // 치유성/호법성으로 변경 시 둘 다 해제
    if (field === 'class_type' && (value === '치유성' || value === '호법성')) {
      updated[idx].can_clear_raid = false;
      updated[idx].is_underpowered = false;
    }
    setCharacters(updated);
  };

  const toggleDate = (dateStr: string) => {
    const exists = dateSelections.find(d => d.date === dateStr);
    if (exists) {
      setDateSelections(dateSelections.filter(d => d.date !== dateStr));
    } else {
      setDateSelections([
        ...dateSelections,
        { date: dateStr, allDay: false, timeRanges: [{ start: '20:00', end: '23:00' }] },
      ]);
    }
  };

  const toggleAllDay = (dateStr: string) => {
    setDateSelections(
      dateSelections.map(d =>
        d.date === dateStr ? { ...d, allDay: !d.allDay } : d
      )
    );
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
    if (dateSelections.some(d => !d.allDay && d.timeRanges.length === 0)) return false;
    // 시간 유효성: 시작 < 종료 (시간 무관이 아닌 경우만)
    if (dateSelections.some(d => !d.allDay && d.timeRanges.some(tr => tr.start >= tr.end))) return false;
    // 닉네임 중복 체크
    const nicknames = characters.map(c => c.nickname.trim());
    if (new Set(nicknames).size !== nicknames.length) return false;
    return true;
  };

  const handleSubmit = async () => {
    if (!isValid()) return;

    setSaving(true);
    try {
      const timeSlotList: TimeSlot[] = [];
      for (const ds of dateSelections) {
        if (ds.allDay) {
          timeSlotList.push({
            date: ds.date,
            start_time: '00:00',
            end_time: '23:30',
          });
        } else {
          for (const tr of ds.timeRanges) {
            timeSlotList.push({
              date: ds.date,
              start_time: tr.start,
              end_time: tr.end,
            });
          }
        }
      }

      // 수정 모드: 기존 데이터 삭제 후 새로 저장
      if (editId) {
        await deleteRegistration(editId);
      }

      const registration: DBRegistration = {
        id: editId || generateId(),
        owner_name: ownerName.trim(),
        raid_type: selectedRaid!,
        characters: characters.map(c => ({
          nickname: c.nickname.trim(),
          class_type: c.class_type,
          combat_power: c.combat_power,
          can_clear_raid: c.can_clear_raid,
          is_underpowered: c.is_underpowered,
        })),
        week_start: selectedWeek,
        time_slots: timeSlotList,
        created_at: editId ? (editData?.created_at || new Date().toISOString()) : new Date().toISOString(),
      };

      await saveRegistration(registration);
      setSaved(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => setSaved(false), 5000);

      if (editId) {
        // 수정 완료 후 홈으로 이동
        setEditId(null);
        navigate('/');
        return;
      }

      // 폼 리셋
      setOwnerName('');
      setCharacters([
        { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false, is_underpowered: false },
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {editId ? '신청 수정' : '파티 참여 신청'}
      </h1>

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

                <div className="flex flex-col gap-2 justify-end">
                  {(() => {
                    const isSupport = char.class_type === '치유성' || char.class_type === '호법성';
                    return (
                      <>
                        <label className={`flex items-center gap-2 ${isSupport || char.is_underpowered ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            checked={isSupport ? false : char.can_clear_raid}
                            disabled={isSupport || char.is_underpowered}
                            onChange={e =>
                              updateCharacter(idx, 'can_clear_raid', e.target.checked)
                            }
                            className="w-4 h-4 text-indigo-600"
                          />
                          <span className="text-sm text-gray-700">공팟 가도 상관 없음</span>
                        </label>
                        <label className={`flex items-center gap-2 ${isSupport || char.can_clear_raid ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            checked={isSupport ? false : char.is_underpowered}
                            disabled={isSupport || char.can_clear_raid}
                            onChange={e =>
                              updateCharacter(idx, 'is_underpowered', e.target.checked)
                            }
                            className="w-4 h-4 text-orange-500"
                          />
                          <span className="text-sm text-gray-700">공팟 스펙 미달(부캐)</span>
                        </label>
                      </>
                    );
                  })()}
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

        {/* 일괄 설정 (2개 이상 날짜 선택 시) */}
        {dateSelections.length >= 2 && (
          <div className="mb-4 p-3 border-2 border-indigo-300 rounded-lg bg-indigo-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-indigo-700">선택된 {dateSelections.length}일 일괄 설정</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                id="batch-start"
                defaultValue="20:00"
                className="p-1.5 border border-gray-300 rounded text-sm bg-white"
              >
                {timeSlots.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="text-gray-500">~</span>
              <select
                id="batch-end"
                defaultValue="23:00"
                className="p-1.5 border border-gray-300 rounded text-sm bg-white"
              >
                {timeSlots.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  const startEl = document.getElementById('batch-start') as HTMLSelectElement;
                  const endEl = document.getElementById('batch-end') as HTMLSelectElement;
                  if (!startEl || !endEl) return;
                  const start = startEl.value;
                  const end = endEl.value;
                  setDateSelections(
                    dateSelections.map(d => ({
                      ...d,
                      allDay: false,
                      timeRanges: [{ start, end }],
                    }))
                  );
                }}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
              >
                일괄 적용
              </button>
              <button
                onClick={() => {
                  setDateSelections(
                    dateSelections.map(d => ({ ...d, allDay: true, timeRanges: [{ start: '00:00', end: '23:30' }] }))
                  );
                }}
                className="px-3 py-1.5 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 transition-colors"
              >
                전체 시간 무관
              </button>
            </div>
          </div>
        )}

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
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-700">
                      {date.getMonth() + 1}/{date.getDate()} ({getDayName(date)})
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ds.allDay}
                        onChange={() => toggleAllDay(ds.date)}
                        className="w-3.5 h-3.5 text-indigo-600"
                      />
                      <span className="text-xs text-gray-500">시간 무관</span>
                    </label>
                  </div>
                  {!ds.allDay && (
                    <button
                      onClick={() => addTimeRange(ds.date)}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      + 시간대 추가
                    </button>
                  )}
                </div>

                {ds.allDay ? (
                  <div className="text-sm text-gray-400 italic py-1">모든 시간대 가능</div>
                ) : (
                  ds.timeRanges.map((tr, idx) => (
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
                    {tr.start >= tr.end && (
                      <span className="text-red-500 text-xs">시작 시간이 종료보다 빨라야 합니다</span>
                    )}
                  </div>
                ))
                )}
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
        {saving ? '저장 중...' : editId ? '수정하기' : '신청하기'}
      </button>

      {/* 하단 네비게이션 여백 */}
      <div className="h-8" />

      </>)}
    </div>
  );
}
