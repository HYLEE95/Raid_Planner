import { useState, useEffect, useCallback } from 'react';
import {
  getWeekStartForRaid,
  formatDate,
  getConfirmedRaid,
  deleteConfirmedRaid,
  saveConfirmedRaid,
} from '../../lib/storage';
import WeekPicker from '../WeekPicker/WeekPicker';
import RaidResult from '../RaidResult/RaidResult';
import type { ConfirmedRaid, RaidType, RaidComposition } from '../../lib/types';
import { RAID_TYPES, RAID_CONFIGS } from '../../lib/types';

export default function Confirmed() {
  const [selectedRaid, setSelectedRaid] = useState<RaidType | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(() => formatDate(getWeekStartForRaid(new Date(), '루드라')));
  const [confirmed, setConfirmed] = useState<ConfirmedRaid | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadConfirmed = useCallback(async () => {
    if (!selectedRaid) { setConfirmed(null); return; }
    setLoading(true);
    try {
      const data = await getConfirmedRaid(selectedWeek, selectedRaid);
      setConfirmed(data);
      setHasChanges(false);
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
      setHasChanges(false);
      alert('공격대가 삭제되었습니다.');
    } catch (err) {
      alert('삭제 실패: ' + (err as Error).message);
    }
  };

  const handleUpdate = (compositions: RaidComposition[]) => {
    if (!confirmed || compositions.length === 0) return;
    setConfirmed({
      ...confirmed,
      composition: compositions[0],
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!confirmed || !hasChanges) return;
    setSaving(true);
    try {
      await saveConfirmedRaid(confirmed);
      setHasChanges(false);
      alert('변경 사항이 저장되었습니다.');
    } catch (err) {
      alert('저장 실패: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // RaidResult에 넘기기 위해 composition을 배열로 감싸기
  const compositions: RaidComposition[] = confirmed ? [confirmed.composition] : [];

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
                setHasChanges(false);
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
              onChange={(v) => { setSelectedWeek(v); setConfirmed(null); setHasChanges(false); }}
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
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? '저장 중...' : '변경 저장'}
                    </button>
                  )}
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-red-600 bg-white dark:bg-gray-800 border border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                  >
                    삭제
                  </button>
                </div>
              </div>

              {/* 미저장 변경 알림 */}
              {hasChanges && (
                <div className="mb-4 p-2 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-lg text-sm text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  수정 사항이 있습니다. &quot;변경 저장&quot; 버튼을 눌러 저장해주세요.
                </div>
              )}

              {/* RaidResult 재사용 (편집 가능) */}
              <RaidResult
                compositions={compositions}
                selectedIndex={0}
                onSelectIndex={() => {}}
                onUpdate={handleUpdate}
                raidType={selectedRaid}
                weekStart={selectedWeek}
              />
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
