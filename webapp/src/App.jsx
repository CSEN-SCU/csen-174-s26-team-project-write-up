import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import History from "./pages/History";
import Profile from "./pages/Profile";

export default function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <h1>Write Up</h1>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/onboarding">Onboarding</Link>
          <Link to="/history">History</Link>
          <Link to="/profile">Profile</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/history" element={<History />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
