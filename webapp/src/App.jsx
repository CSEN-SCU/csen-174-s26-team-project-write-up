import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Dashboard from "./pages/Dashboard";
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
      <button type="button" className="topbar-auth-btn topbar-auth-btn--primary" onClick={() => signInWithGoogle()}>
        Sign in
      </button>
    );
  }
  return (
    <span className="topbar-auth-cluster">
      <span className="topbar-auth-email" title={user.uid}>
        {user.email || user.uid.slice(0, 8) + "…"}
      </span>
      <button type="button" className="topbar-auth-btn topbar-auth-btn--primary" onClick={() => signOut()}>
        Sign out
      </button>
    </span>
  );
}

function TopNav() {
  const { user } = useAuth();
  return (
    <nav>
      <Link to="/">Home</Link>
      <Link to="/write">Write</Link>
      <Link to="/history">History</Link>
      {user ? <Link to="/profile">Profile</Link> : null}
      <Link to="/privacy">Privacy</Link>
      <TopbarAuth />
    </nav>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <header className="topbar">
          <h1>Write Up</h1>
          <TopNav />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/write" element={<Write />} />
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
