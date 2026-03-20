import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Home from './components/Home/Home';
import Registration from './components/Registration/Registration';
import Confirmed from './components/Confirmed/Confirmed';
import CharacterInput from './components/CharacterInput/CharacterInput';
import Manual from './components/Manual/Manual';

function App() {
  return (
    <HashRouter>
      <Routes>
        {/* 사용 설명서: 별도 페이지 (네비게이션 없음) */}
        <Route path="manual" element={<Manual />} />
        {/* 메인 앱 */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Confirmed />} />
          <Route path="register" element={<Registration />} />
          <Route path="raid-compose" element={<Home />} />
          <Route path="characters" element={<CharacterInput />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
