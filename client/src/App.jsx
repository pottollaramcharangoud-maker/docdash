import { Routes, Route, NavLink, Link } from "react-router-dom";
import Directory from "./pages/Directory.jsx";
import DoctorProfile from "./pages/DoctorProfile.jsx";
import Booking from "./pages/Booking.jsx";
import MyAppointments from "./pages/MyAppointments.jsx";
import PatientDash from "./pages/PatientDash.jsx";
import QueueBoard from "./pages/QueueBoard.jsx";
import DoctorConsole from "./pages/DoctorConsole.jsx";
import Heatmap from "./pages/Heatmap.jsx";

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-bold text-lg text-clinic-700">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-clinic-600 text-white text-sm">DD</span>
      <span>
        DocDash <span className="text-slate-400 font-medium text-sm">· QueueZero</span>
      </span>
    </Link>
  );
}

function Nav() {
  const item = ({ isActive }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition ${
      isActive ? "bg-clinic-50 text-clinic-700" : "text-slate-600 hover:bg-slate-100"
    }`;
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <nav className="flex flex-wrap items-center gap-1">
          <NavLink to="/" end className={item}>Find a Doctor</NavLink>
          <NavLink to="/my" className={item}>My Appointments</NavLink>
          <NavLink to="/board/1" className={item}>Queue Board</NavLink>
          <NavLink to="/console" className={item}>Doctor Console</NavLink>
          <NavLink to="/heatmap" className={item}>Wait Heatmap</NavLink>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen text-slate-800">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Directory />} />
          <Route path="/doctors/:id" element={<DoctorProfile />} />
          <Route path="/book/:id" element={<Booking />} />
          <Route path="/my" element={<MyAppointments />} />
          <Route path="/appt/:id" element={<PatientDash />} />
          <Route path="/board/:doctorId" element={<QueueBoard />} />
          <Route path="/console" element={<DoctorConsole />} />
          <Route path="/console/:doctorId" element={<DoctorConsole />} />
          <Route path="/heatmap" element={<Heatmap />} />
        </Routes>
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        DocDash · QueueZero Clinic Hack · Real-time virtual queue demo
      </footer>
    </div>
  );
}
