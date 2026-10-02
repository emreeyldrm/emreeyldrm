import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Compass, Heart, ListChecks, User as UserIcon } from 'lucide-react';
import { RequireAuth, useAuth } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';
import Lists from './pages/Lists';
import ListDetailPage from './pages/ListDetail';
import Discover from './pages/Discover';
import Place from './pages/Place';
import Friends from './pages/Friends';
import Profile from './pages/Profile';

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const nav = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => nav('/lists')} aria-label="Voyage ana sayfa">Voyage</button>
        {user && <span className="who muted-on-green" data-testid="current-handle">@{user.handle}</span>}
      </header>
      <main className="content">{children}</main>
      {user && (
        <nav className="tabbar" aria-label="Ana gezinme">
          <NavLink to="/lists" data-testid="nav-lists"><ListChecks size={20} aria-hidden /> <span>Listelerim</span></NavLink>
          <NavLink to="/discover" data-testid="nav-discover"><Compass size={20} aria-hidden /> <span>Keşfet</span></NavLink>
          <NavLink to="/friends" data-testid="nav-friends"><Heart size={20} aria-hidden /> <span>Arkadaşlar</span></NavLink>
          <NavLink to="/profile" data-testid="nav-profile"><UserIcon size={20} aria-hidden /> <span>Profil</span></NavLink>
        </nav>
      )}
    </div>
  );
}

const P = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/lists" element={P(<Lists />)} />
        <Route path="/lists/:id" element={P(<ListDetailPage />)} />
        <Route path="/discover" element={P(<Discover />)} />
        <Route path="/places/:id" element={P(<Place />)} />
        <Route path="/friends" element={P(<Friends />)} />
        <Route path="/profile" element={P(<Profile />)} />
        <Route path="*" element={<Navigate to="/lists" replace />} />
      </Routes>
    </Shell>
  );
}
