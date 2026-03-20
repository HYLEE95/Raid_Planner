import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Home from './components/Home/Home';
import Registration from './components/Registration/Registration';
import Confirmed from './components/Confirmed/Confirmed';
import CharacterInput from './components/CharacterInput/CharacterInput';
import Manual from './components/Manual/Manual';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="manual" element={<Manual />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Confirmed />} />
            <Route path="register" element={<Registration />} />
            <Route path="raid-compose" element={<Home />} />
            <Route path="characters" element={<CharacterInput />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
