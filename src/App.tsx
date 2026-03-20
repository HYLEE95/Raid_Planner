import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Home from './components/Home/Home';
import Registration from './components/Registration/Registration';
import Confirmed from './components/Confirmed/Confirmed';
import CharacterInput from './components/CharacterInput/CharacterInput';

function App() {
  return (
    <HashRouter>
      <Routes>
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
