import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import Papa from 'papaparse'
import { UploadCloud, CheckCircle2, AlertCircle, ArrowRight, Table as TableIcon } from 'lucide-react'
import clsx from 'clsx'

type ImportStep = 'upload' | 'mapping' | 'review' | 'success'

interface ParsedRow {
  [key: string]: any
}

export default function ImportPage() {
  const { profile } = useAuth()
  const [step, setStep] = useState<ImportStep>('upload')
  const [file, setFile] = useState<File | null>(null)
  
  // Datos crudos del CSV
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  
  // Mapeo
  const [colDate, setColDate] = useState<string>('')
  const [colAmount, setColAmount] = useState<string>('')
  const [colNote, setColNote] = useState<string>('')
  
  // Destino
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')

  // Cargar cuentas para elegir a dónde van las transacciones
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile?.family_id],
    queryFn: async () => {
      const { data } = await db.from('accounts').select('id, name, type').eq('family_id', profile!.family_id!)
      return data ?? []
    },
    enabled: !!profile?.family_id
  })

  // Procesar archivo
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.meta.fields) {
          setHeaders(results.meta.fields)
          setColDate(results.meta.fields[0] || '')
          setColAmount(results.meta.fields[1] || '')
          setColNote(results.meta.fields[2] || '')
        }
        setRows(results.data as ParsedRow[])
        setStep('mapping')
      }
    })
  }

  // Ejecutar importación
  const importMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccountId) throw new Error("Selecciona una cuenta de destino")
      
      const transactionsToInsert = rows.map(row => {
        const rawAmount = parseFloat(String(row[colAmount]).replace(/[^\d.-]/g, '')) || 0
        const isExpense = rawAmount < 0
        const absAmount = Math.abs(rawAmount)

        return {
          family_id: profile!.family_id!,
          source_account_id: isExpense ? selectedAccountId : null,
          destination_account_id: isExpense ? null : selectedAccountId,
          type: isExpense ? 'expense' : 'income',
          amount: absAmount,
          date: row[colDate] ? new Date(row[colDate]).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          note: row[colNote] || 'Importado vía CSV',
          created_by: profile!.id
        }
      })

      // Insertar en lotes si es muy grande, pero asumiremos < 1000 filas por ahora
      const { error } = await db.from('transactions').insert(transactionsToInsert)
      if (error) throw error
    },
    onSuccess: () => {
      setStep('success')
    }
  })

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Importar transacciones</h1>
        <p className="text-slate-400 mt-1 text-sm">Sube tu extracto bancario en CSV y clasifica los movimientos rápidamente.</p>
      </div>

      {/* Progress Bar */}
      <div className="flex items-center gap-2 mb-8">
        <StepIndicator active={step === 'upload'} completed={step !== 'upload'} num={1} label="Subir CSV" />
        <div className="flex-1 h-px bg-slate-800" />
        <StepIndicator active={step === 'mapping'} completed={step === 'review' || step === 'success'} num={2} label="Mapear columnas" />
        <div className="flex-1 h-px bg-slate-800" />
        <StepIndicator active={step === 'review'} completed={step === 'success'} num={3} label="Revisar e Importar" />
      </div>

      {step === 'upload' && (
        <div className="card p-12 flex flex-col items-center justify-center border-dashed border-2 border-slate-700 bg-slate-900/50 hover:bg-slate-800/50 transition-colors relative">
          <input 
            type="file" 
            accept=".csv" 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={handleFileUpload}
          />
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
            <UploadCloud size={32} />
          </div>
          <h3 className="text-lg font-medium text-white">Arrastra o haz clic para subir</h3>
          <p className="text-slate-400 text-sm mt-1">Solo archivos .csv soportados</p>
        </div>
      )}

      {step === 'mapping' && (
        <div className="card space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Columna de Fecha</label>
              <select className="input w-full" value={colDate} onChange={e => setColDate(e.target.value)}>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Columna de Monto</label>
              <select className="input w-full" value={colAmount} onChange={e => setColAmount(e.target.value)}>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">Negativos = Gastos, Positivos = Ingresos</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Columna de Descripción</label>
              <select className="input w-full" value={colNote} onChange={e => setColNote(e.target.value)}>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          
          <div className="border-t border-slate-800 pt-6 flex justify-end gap-3">
            <button className="btn-ghost" onClick={() => setStep('upload')}>Atrás</button>
            <button className="btn-primary" onClick={() => setStep('review')}>Siguiente paso <ArrowRight size={16}/></button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <h3 className="text-lg font-medium text-white">Selecciona la cuenta de destino</h3>
            <select 
              className="input w-full md:w-1/2" 
              value={selectedAccountId} 
              onChange={e => setSelectedAccountId(e.target.value)}
            >
              <option value="">-- Elige una cuenta --</option>
              {accounts.map((acc: any) => (
                <option key={acc.id} value={acc.id}>{acc.name} ({acc.type})</option>
              ))}
            </select>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 text-white font-medium mb-4">
              <TableIcon size={18} className="text-indigo-400"/>
              Vista previa de {rows.length} transacciones
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-3 px-2 font-medium">Fecha</th>
                    <th className="pb-3 px-2 font-medium">Descripción</th>
                    <th className="pb-3 px-2 font-medium text-right">Monto Procesado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {rows.slice(0, 5).map((r, i) => {
                    const rawVal = parseFloat(String(r[colAmount]).replace(/[^\d.-]/g, '')) || 0
                    const isExp = rawVal < 0
                    return (
                      <tr key={i} className="text-slate-300">
                        <td className="py-3 px-2">{r[colDate]}</td>
                        <td className="py-3 px-2 truncate max-w-[200px]">{r[colNote]}</td>
                        <td className={clsx("py-3 px-2 text-right font-medium", isExp ? "text-red-400" : "text-emerald-400")}>
                          {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(Math.abs(rawVal))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.length > 5 && (
                <div className="text-center py-3 text-slate-500 text-xs bg-slate-900/30">
                  Mostrando 5 de {rows.length} filas
                </div>
              )}
            </div>
          </div>

          {importMutation.isError && (
             <div className="bg-red-400/10 text-red-400 p-4 rounded-xl border border-red-400/20 flex gap-3 items-center">
               <AlertCircle size={20} />
               <p className="text-sm">{(importMutation.error as Error).message}</p>
             </div>
          )}

          <div className="flex justify-end gap-3">
            <button className="btn-ghost" onClick={() => setStep('mapping')}>Atrás</button>
            <button 
              className="btn-primary" 
              disabled={!selectedAccountId || importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending ? 'Importando...' : 'Confirmar e Importar'}
            </button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="card text-center py-16 space-y-4">
          <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-2xl font-bold text-white">¡Importación Exitosa!</h2>
          <p className="text-slate-400">Se han guardado {rows.length} transacciones correctamente.</p>
          <div className="pt-6">
            <button className="btn-primary" onClick={() => { setStep('upload'); setFile(null); setRows([]) }}>
              Importar otro archivo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StepIndicator({ active, completed, num, label }: { active: boolean, completed: boolean, num: number, label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={clsx(
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
        active ? "bg-indigo-600 text-white" : completed ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-500"
      )}>
        {completed ? <CheckCircle2 size={16} /> : num}
      </div>
      <span className={clsx("text-sm font-medium hidden sm:block", active ? "text-white" : completed ? "text-emerald-400" : "text-slate-500")}>
        {label}
      </span>
    </div>
  )
}
