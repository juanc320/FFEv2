import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  ArrowLeftRight,
  Tag,
  Calendar,
  Users,
  Upload,
  LogOut,
  Menu,
  X,
  ChevronRight,
  TrendingUp,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', description: 'Estado del mes' },
  { to: '/months',    icon: Calendar,         label: 'Mes actual',  description: 'Presupuesto' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Movimientos', description: 'Transacciones' },
  { to: '/accounts',  icon: Wallet,           label: 'Cuentas',     description: 'Cuentas y bolsillos' },
  { to: '/expenses',  icon: Receipt,    label: 'Plan de gastos',    description: 'Gastos del mes' },
  { to: '/periodic',  icon: RefreshCw,  label: 'Gastos periódicos', description: 'Trimestrales, anuales' },
  { to: '/ideal-budget', icon: SlidersHorizontal, label: 'Presupuesto Ideal', description: 'Simulador estratégico' },
  { to: '/income',    icon: TrendingUp, label: 'Ingresos',          description: 'Ingresos esperados' },
  { to: '/categories', icon: Tag,             label: 'Categorías',  description: 'Categorías y conceptos' },
  { to: '/family',    icon: Users,            label: 'Familia',     description: 'Integrantes' },
  { to: '/import',    icon: Upload,           label: 'Importar',    description: 'Excel / CSV' },
]

export default function AppLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    // Si el usuario no tiene familia y no está en la página de familia, forzarlo a configurarla
    if (profile && !profile.family_id && location.pathname !== '/family') {
      navigate('/family', { replace: true })
    }
  }, [profile, location.pathname, navigate])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const sidebar = (
    <aside className="flex flex-col h-full bg-slate-900 border-r border-slate-800">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-500/20 border border-indigo-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <Wallet className="w-4.5 h-4.5 text-indigo-400" size={18} />
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Family Finance</p>
            <p className="text-indigo-400 text-xs">Engine</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems
          .filter(item => item.to !== '/ideal-budget' || profile?.role === 'admin')
          .map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group',
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={17} className={clsx('flex-shrink-0', isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300')} />
                  <span className="flex-1">{label}</span>
                  {isActive && <ChevronRight size={14} className="text-indigo-400 opacity-60" />}
                </>
              )}
            </NavLink>
          ))}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-slate-800">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/50">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">
              {(profile?.display_name ?? 'U').charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-slate-200 text-xs font-medium truncate">{profile?.display_name ?? 'Usuario'}</p>
            <p className="text-slate-500 text-xs truncate">{profile?.email ?? ''}</p>
          </div>
          <button
            id="signOutBtn"
            onClick={handleSignOut}
            title="Cerrar sesión"
            className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-400/10"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex w-60 flex-shrink-0 flex-col">
        {sidebar}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative w-64 flex flex-col z-10">
            {sidebar}
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800">
          <button
            id="mobileMenuBtn"
            onClick={() => setMobileOpen(true)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <Menu size={22} />
          </button>
          <span className="text-white font-semibold text-sm">Family Finance Engine</span>
          <button
            className="ml-auto text-slate-400 hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            {mobileOpen ? <X size={20} /> : null}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
