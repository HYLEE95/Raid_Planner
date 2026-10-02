export default function Manual() {
  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">사용 설명서</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">같이살자 레이드 파티 모집 앱 사용 가이드</p>

      {/* 1. 캐릭터 정보 입력 */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0">1</span>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">캐릭터 정보 입력</h2>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">a</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">하단 메뉴 &gt; "캐릭터 정보" 선택</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">레이드를 선택한 후 "캐릭터 정보 입력" 버튼을 누릅니다.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">b</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">소유주 이름 입력</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">본인의 소유주 이름을 입력합니다. (예: 세희, 피폰 등)</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">c</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">캐릭터 정보 등록</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">각 캐릭터의 닉네임과 직업군을 입력합니다. 레이드에 따라 선택지가 다릅니다.</p>
              <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-300 space-y-1">
                <p><span className="font-semibold text-purple-500">브리레흐</span> : 세가 / 세바 / 딜러</p>
                <p><span className="font-semibold text-indigo-500">정규 사냥</span> : 세바 / 엘나 / 닼메 / 알스 / 세가 / 블랜 / 거너 / 포알 / 멜퍼 / 퓨파</p>
                <p className="mt-1">브리레흐는 파멸의 로브, 블래스트 랜서, 소울 무기, 희망 클리어 횟수를 추가로 입력합니다.</p>
                <p>정규 사냥은 닉네임과 직업군만 입력합니다.</p>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">d</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">저장하기</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">"저장하기" 버튼을 눌러 캐릭터 정보를 저장합니다. 이후 수정이 필요하면 "캐릭터 정보 수정" 버튼으로 수정할 수 있습니다.</p>
            </div>
          </div>
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              <span className="font-bold">TIP:</span> 캐릭터 정보를 수정하면 이미 신청된 파티 참여 데이터에도 자동으로 반영됩니다.
            </p>
          </div>
        </div>
      </section>

      {/* 2. 파티 참여 신청 */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0">2</span>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">파티 참여 신청</h2>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">a</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">하단 메뉴 &gt; "파티 참여 신청" 선택</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">레이드와 주차를 선택합니다.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">b</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">소유주 선택</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">드롭다운에서 본인의 소유주를 선택하면 등록된 캐릭터 정보가 자동으로 로드됩니다.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">c</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">가능 날짜/시간 선택</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">레이드에 참여 가능한 날짜를 선택하고, 각 날짜별 가능한 시간대를 설정합니다.</p>
              <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-300 space-y-1">
                <p>"시간 무관" 체크 시 해당 날짜의 모든 시간대에 참여 가능</p>
                <p>(브리레흐) 2개 이상 날짜 선택 시 "시간 일괄 설정" 옵션 사용 가능</p>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">d</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">신청하기</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">"신청하기" 버튼을 눌러 참여를 신청합니다. 신청 후에도 "공격대 배치" 화면의 신청자 목록에서 수정/삭제가 가능합니다.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 공격대 배치 */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0">3</span>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">공격대 배치</h2>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">a</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">하단 메뉴 &gt; "공격대 배치" 선택</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">레이드와 주차를 선택하면 신청자 현황이 표시됩니다. 정규 사냥은 요일 × 30분 시간대 투표 히트맵과 파티 배정 화면이 표시됩니다.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">b</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">"공격대 배치" 버튼 클릭 (브리레흐)</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">알고리즘이 최적의 공격대 조합을 자동으로 생성합니다. 최대 5개의 조합이 표시됩니다. 자동 조합은 브리레흐 전용이며, 정규 사냥은 투표 결과를 보고 직접 배정합니다.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">c</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">조합 확인 및 확정</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">각 조합을 펼쳐서 공격대 구성을 확인하고, 원하는 조합의 "공대 확정" 버튼을 눌러 확정합니다.</p>
              <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-300 space-y-1">
                <p>브리레흐: 한 파티 4~8명으로 구성</p>
                <p>브리레흐 딜러: 5인 이하 파티는 파멸의 로브 또는 블래스트 랜서 필요, 4인 파티는 소울 무기도 필요 (봇 예외)</p>
                <p>정규 사냥: 자동 편성 없이 투표 결과를 보고 사람이 직접 배분</p>
                <p>정규 사냥 파티는 3인 또는 4인, 외부 용병 추가 가능</p>
                <p>공방인원(봇, 브리레흐): 시간대 가능 인원이 4명 이상인데 세가·세바 정원, 소유주 중복, 딜러 로브·소울 조건 때문에 4인이 안 될 때만 최대 2명까지 채워지는 빈 슬롯. 3명 이하인 시간대는 파티를 만들지 않음</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. 확정된 공격대 확인 */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0">4</span>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">확정된 공격대 확인 (홈)</h2>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">a</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">하단 메뉴 &gt; "홈" 선택</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">레이드와 주차를 선택하면 확정된 공격대 구성을 확인할 수 있습니다.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">b</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">공격대 정보 확인</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">날짜/시간별 공격대와 파티 멤버 구성을 확인합니다. 정규 사냥은 저장된 파티 배정을 읽기 전용으로 보여줍니다.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">c</span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">삭제</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">필요 시 "삭제" 버튼으로 확정(정규 사냥은 배정)을 취소하고 다시 배치할 수 있습니다.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-8" />
    </div>
  );
}
