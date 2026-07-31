// ============================================================
// Database types para supabase-js v2
// ============================================================

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]
export type AccountType = 'bank' | 'cash' | 'pocket' | 'external' | 'pending_income'
export type MonthStatus = 'active' | 'closed'
export type ExpenseType = 'fixed' | 'variable' | 'sporadic'
export type Criticality = 'critical' | 'necessary' | 'desirable' | 'optional'
export type IncomeStatus = 'pending' | 'partial' | 'received'
export type ExpenseStatus = 'pending' | 'partial' | 'paid' | 'deferred'
export type DeductionType = 'none' | 'percent' | 'fixed' | 'both'
export type TransactionType = 'expense' | 'income' | 'transfer_internal' | 'transfer_external_in' | 'transfer_external_out' | 'adjustment' | 'tax_4x1000' | 'reallocation'
export type ImportStatus = 'pending' | 'validated' | 'imported' | 'error'
export type UserRole = 'admin' | 'member' | 'observer'
export type DueMode = 'once' | 'multiple' | 'anytime'
export type CategoryType = 'expense' | 'income'
export type TaxMode = 'per_transaction' | 'cumulative_threshold'
export type CopyDecision = 'copied' | 'skipped' | 'modified'

// Row types
export interface Family { id: string; name: string; currency: string; created_at: string }
export interface Profile { id: string; email: string | null; display_name: string | null; family_id: string | null; role: UserRole; created_at: string }
export interface FamilyMember { id: string; family_id: string; name: string; user_id: string | null; active: boolean; created_at: string }
export interface Account { id: string; family_id: string; name: string; type: AccountType; is_internal: boolean; opening_balance: number; current_balance_cached: number; applies_4x1000: boolean; is_4x1000_exempt: boolean; active: boolean; created_at: string }
export interface Category { id: string; family_id: string; name: string; type: CategoryType; active: boolean; created_at: string }
export interface Concept { id: string; family_id: string; category_id: string; name: string; active: boolean; created_at: string }
export interface BudgetMonth { id: string; family_id: string; year: number; month: number; status: MonthStatus; currency: string; copied_from_month_id: string | null; created_at: string; closed_at: string | null }
export interface MonthlyIncomeItem { id: string; month_id: string; family_id: string; member_id: string | null; concept_id: string | null; label: string; gross_amount: number; deduction_type: DeductionType; deduction_rate: number; deduction_amount: number; net_expected: number; expected_date: string | null; received_amount: number; status: IncomeStatus; is_recurring: boolean; income_type?: 'fixed' | 'sporadic'; created_at: string; in_ideal_budget?: boolean }
export interface PeriodicIncome { id: string; family_id: string; member_id: string | null; concept_id: string | null; label: string; amount: number; periodicity: 'quarterly' | 'semi_annual' | 'annual'; start_month: number; start_year: number; due_day: number | null; active: boolean; deduction_type: DeductionType; deduction_rate: number; deduction_amount: number; created_at: string }
export interface MonthlyExpenseItem { id: string; month_id: string; family_id: string; category_id: string; concept_id: string; expense_type: ExpenseType; criticality: Criticality; due_mode: DueMode; due_date: string | null; budget_amount: number; arrears_amount: number; executed_amount_cached: number; deferred_amount: number; status: ExpenseStatus; active_in_month: boolean; created_at: string; postponed?: boolean; is_mora_item?: boolean; in_ideal_budget?: boolean; ideal_budget_amount?: number | null; sort_order?: number | null }
export interface Transaction { id: string; family_id: string; month_id: string; type: TransactionType; amount: number; tax_amount: number; source_account_id: string | null; destination_account_id: string | null; external_party_label: string | null; category_id: string | null; concept_id: string | null; expense_item_id: string | null; income_item_id: string | null; is_automatic: boolean; parent_transaction_id: string | null; date: string; note: string | null; created_by: string | null; created_at: string }
export interface BudgetReallocation { id: string; month_id: string; from_expense_item_id: string; to_expense_item_id: string; amount: number; reason: string | null; created_by: string | null; created_at: string }
export interface TaxRule { id: string; family_id: string | null; name: string; rate: number; applies_to: string; mode: TaxMode; threshold_amount: number | null; threshold_period: string | null; active_from: string; active_until: string | null; active: boolean; created_at: string }
export interface ImportBatch { id: string; family_id: string; month_id: string | null; file_name: string | null; status: ImportStatus; total_rows: number; error_rows: number; error_log: Json | null; created_by: string | null; created_at: string }

// Database schema for supabase-js (use 'any' for Insert/Update to avoid supabase-js v2 inference issues)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Database {
  public: {
    Tables: {
      families:               { Row: Family;             Insert: Partial<Family>;             Update: Partial<Family> }
      profiles:               { Row: Profile;            Insert: Partial<Profile>;            Update: Partial<Profile> }
      family_members:         { Row: FamilyMember;       Insert: Partial<FamilyMember>;       Update: Partial<FamilyMember> }
      accounts:               { Row: Account;            Insert: Partial<Account>;            Update: Partial<Account> }
      categories:             { Row: Category;           Insert: Partial<Category>;           Update: Partial<Category> }
      concepts:               { Row: Concept;            Insert: Partial<Concept>;            Update: Partial<Concept> }
      budget_months:          { Row: BudgetMonth;        Insert: Partial<BudgetMonth>;        Update: Partial<BudgetMonth> }
      monthly_income_items:   { Row: MonthlyIncomeItem;  Insert: Partial<MonthlyIncomeItem>;  Update: Partial<MonthlyIncomeItem> }
      monthly_expense_items:  { Row: MonthlyExpenseItem; Insert: Partial<MonthlyExpenseItem>; Update: Partial<MonthlyExpenseItem> }
      transactions:           { Row: Transaction;        Insert: Partial<Transaction>;        Update: Partial<Transaction> }
      budget_reallocations:   { Row: BudgetReallocation; Insert: Partial<BudgetReallocation>; Update: Partial<BudgetReallocation> }
      tax_rules:              { Row: TaxRule;            Insert: Partial<TaxRule>;            Update: Partial<TaxRule> }
      import_batches:         { Row: ImportBatch;        Insert: Partial<ImportBatch>;        Update: Partial<ImportBatch> }
      periodic_incomes:       { Row: PeriodicIncome;     Insert: Partial<PeriodicIncome>;     Update: Partial<PeriodicIncome> }
    }
  }
}
