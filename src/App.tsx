import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './context';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Budget from './pages/Budget';
import Expenses from './pages/Expenses';
import History from './pages/History';
import Investments from './pages/Investments';

export default function App() {
  const { user } = useAuth();
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="orcamento" element={<Budget />} />
        <Route path="lancar" element={<Expenses />} />
        <Route path="extrato" element={<History />} />
        <Route path="investimentos" element={<Investments />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

