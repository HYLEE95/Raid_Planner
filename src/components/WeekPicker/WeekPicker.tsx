import { useState, useRef, useEffect } from 'react';
import { getWednesday, formatDate, formatWeekLabel } from '../../lib/storage';

interface WeekPickerProps {
  value: string; // 선택된 수요일 YYYY-MM-DD
  onChange: (weekStart: string) => void;
}

const DAY_HEADERS = ['일', '월', '화', '수', '목', '금', '토'];

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: (Date | null)[] = [];

  // 첫 주 앞 빈칸
  for (let i = 0; i < firstDay.getDay(); i++) {
    days.push(null);
  }
  // 날짜들
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  return days;
}

export default function WeekPicker({ value, onChange }: WeekPickerProps) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const selectedWed = new Date(value + 'T00:00:00');
  const [viewYear, setViewYear] = useState(selectedWed.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedWed.getMonth());

  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const days = getCalendarDays(viewYear, viewMonth);

  // 선택된 주의 범위 (수~화)
  const weekEnd = new Date(selectedWed);
  weekEnd.setDate(weekEnd.getDate() + 6);

  function isInSelectedWeek(date: Date): boolean {
    return date >= selectedWed && date <= weekEnd;
  }

  function handleDayClick(date: Date) {
    const wed = getWednesday(date);
    onChange(formatDate(wed));
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  return (
    <div className="relative" ref={ref}>
      {/* 선택 버튼 */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full max-w-sm p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-left flex items-center justify-between hover:border-indigo-400 transition-colors"
      >
        <span className="text-gray-800 dark:text-gray-200">{formatWeekLabel(value)}</span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-600 dark:text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 캘린더 드롭다운 */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 w-[300px] week-picker-dropdown">
          {/* 월 네비게이션 */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={prevMonth} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-300">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
              {viewYear}년 {viewMonth + 1}월
            </span>
            <button onClick={nextMonth} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-300">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 gap-0 mb-1">
            {DAY_HEADERS.map(d => (
              <div key={d} className={`text-center text-xs font-medium py-1 ${d === '일' ? 'text-red-500 dark:text-red-400' : d === '토' ? 'text-blue-500 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-0">
            {days.map((date, i) => {
              if (!date) {
                return <div key={`empty-${i}`} className="h-9" />;
              }

              const isToday = isSameDay(date, today);
              const inWeek = isInSelectedWeek(date);
              const isWed = date.getDay() === 3;
              const isSun = date.getDay() === 0;
              const isSat = date.getDay() === 6;

              return (
                <button
                  key={date.getTime()}
                  onClick={() => handleDayClick(date)}
                  className={`relative h-9 text-xs font-medium rounded transition-colors
                    ${inWeek
                      ? isWed
                        ? 'bg-indigo-600 text-white rounded-l-lg'
                        : date.getDay() === 2
                          ? 'bg-indigo-100 text-indigo-700 rounded-r-lg'
                          : 'bg-indigo-100 text-indigo-700 rounded-none'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }
                    ${!inWeek && isToday ? 'ring-2 ring-indigo-400 ring-inset' : ''}
                    ${!inWeek && isSun ? 'text-red-500 dark:text-red-400' : ''}
                    ${!inWeek && isSat ? 'text-blue-500 dark:text-blue-400' : ''}
                    ${!inWeek && !isSun && !isSat ? 'text-gray-700 dark:text-gray-300' : ''}
                  `}
                >
                  <span>{date.getDate()}</span>
                  {isToday && (
                    <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] leading-none ${inWeek ? 'text-indigo-200' : 'text-indigo-500'}`}>
                      오늘
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 선택된 주 표시 */}
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-center">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              선택: {formatWeekLabel(value)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
