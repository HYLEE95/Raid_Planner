import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Home from './components/Home/Home';
import Registration from './components/Registration/Registration';
import Confirmed from './components/Confirmed/Confirmed';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="register" element={<Registration />} />
          <Route path="confirmed" element={<Confirmed />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
