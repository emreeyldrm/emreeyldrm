import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';
import Lists from './pages/Lists';
import ListDetailPage from './pages/ListDetail';
import Discover from './pages/Discover';
import Place from './pages/Place';
import Friends from './pages/Friends';
import Profile from './pages/Profile';

const svgProps = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => nav(user ? '/lists' : '/login')} aria-label="Voyage ana sayfa">Voyage</button>
        {user && <span className="who" data-testid="current-handle">@{user.handle}</span>}
      </header>
      <main className="content">{children}</main>
      {user && (
        <nav className="tabbar" aria-label="Ana gezinme">
          <NavLink to="/discover" data-testid="nav-discover">
            <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>Keşfet
          </NavLink>
          <NavLink to="/lists" data-testid="nav-lists">
            <svg {...svgProps}><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>Listelerim
          </NavLink>
          <span className="tab-disabled" aria-disabled="true" data-testid="nav-messages">
            <svg {...svgProps}><path d="M4 5h16v11H9l-5 4z" /></svg>Mesajlar<small>Yakında</small>
          </span>
          <NavLink to="/profile" data-testid="nav-profile" className={() => (pathname === '/profile' || pathname === '/friends' ? 'active' : '')}>
            <svg {...svgProps}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>Profil
          </NavLink>
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
