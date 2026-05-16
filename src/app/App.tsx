import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { queryClient } from '@/lib/queryClient'
import AppLayout from './AppLayout'
import LoginPage from '@/features/auth/LoginPage'
import DashboardPage from '@/features/dashboard/DashboardPage'
import MonthsPage from '@/features/months/MonthsPage'
import AccountsPage from '@/features/accounts/AccountsPage'
import TransactionsPage from '@/features/transactions/TransactionsPage'
import ExpensesPage from '@/features/expenses/ExpensesPage'
import IncomePage from '@/features/income/IncomePage'
import CategoriesPage from '@/features/categories/CategoriesPage'
import FamilyPage from '@/features/family/FamilyPage'
import ImportPage from '@/features/import/ImportPage'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard"    element={<DashboardPage />} />
              <Route path="months"       element={<MonthsPage />} />
              <Route path="accounts"     element={<AccountsPage />} />
              <Route path="transactions" element={<TransactionsPage />} />
              <Route path="expenses"     element={<ExpensesPage />} />
              <Route path="income"       element={<IncomePage />} />
              <Route path="categories"   element={<CategoriesPage />} />
              <Route path="family"       element={<FamilyPage />} />
              <Route path="import"       element={<ImportPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
