import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import History from "./pages/History";
import Profile from "./pages/Profile";
import ExtensionAuth from "./pages/ExtensionAuth";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Write from "./pages/Write";

function TopbarAuth() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();

  if (loading) {
    return <span className="topbar-auth">Auth…</span>;
  }
  if (!user) {
    return (
      <button type="button" className="topbar-auth-btn" onClick={() => signInWithGoogle()}>
        Sign in
      </button>
    );
  }
  return (
    <span className="topbar-auth-cluster">
      <span className="topbar-auth-email" title={user.uid}>
        {user.email || user.uid.slice(0, 8) + "…"}
      </span>
      <button type="button" className="topbar-auth-btn topbar-auth-btn--ghost" onClick={() => signOut()}>
        Sign out
      </button>
    </span>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <header className="topbar">
          <h1>Write Up</h1>
          <nav>
            <Link to="/">Dashboard</Link>
            <Link to="/write">Write</Link>
            <Link to="/onboarding">Onboarding</Link>
            <Link to="/history">History</Link>
            <Link to="/profile">Profile</Link>
            <Link to="/extension-auth">Extension</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <TopbarAuth />
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/write" element={<Write />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/history" element={<History />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/extension-auth" element={<ExtensionAuth />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}
