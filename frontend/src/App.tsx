import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { MarketPage } from './pages/MarketPage';
import { WorkbenchPage } from './pages/WorkbenchPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MarketPage />} />
        <Route path="workbench/:symbol" element={<WorkbenchPage />} />
      </Route>
    </Routes>
  );
}
