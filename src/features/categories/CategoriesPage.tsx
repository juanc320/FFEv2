import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { Plus, Tag, ChevronRight, ChevronDown, Edit2, Trash2, Check, X } from 'lucide-react'
import type { Category, Concept } from '@/shared/types/database'
import clsx from 'clsx'

function useCategories() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['categories', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('*').eq('family_id', profile!.family_id!).order('name')
      return (data ?? []) as Category[]
    },
    enabled: !!profile?.family_id,
  })
}

function useConcepts() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['concepts', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('concepts').select('*').eq('family_id', profile!.family_id!).order('name')
      return (data ?? []) as Concept[]
    },
    enabled: !!profile?.family_id,
  })
}

export default function CategoriesPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: categories = [], isLoading } = useCategories()
  const { data: concepts = [] } = useConcepts()
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [newCatName, setNewCatName] = useState('')
  const [newCatType, setNewCatType] = useState<'expense' | 'income'>('expense')
  const [newConceptName, setNewConceptName] = useState<Record<string, string>>({})
  const [editCat, setEditCat] = useState<{ id: string; name: string } | null>(null)
  const [editCon, setEditCon] = useState<{ id: string; name: string } | null>(null)

  const toggleExpand = (id: string) =>
    setExpandedCats(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Crear categoría
  const createCat = useMutation({
    mutationFn: async () => {
      await db.from('categories').insert({ family_id: profile!.family_id!, name: newCatName.trim(), type: newCatType })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setNewCatName('') },
  })

  // Editar categoría
  const updateCat = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await db.from('categories').update({ name }).eq('id', id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setEditCat(null) },
  })

  // Eliminar categoría
  const deleteCat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('categories').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
    onError: () => alert('No se puede eliminar esta categoría porque ya tiene gastos o movimientos asociados en algún mes.')
  })

  // Crear concepto
  const createConcept = useMutation({
    mutationFn: async ({ catId, name }: { catId: string; name: string }) => {
      await db.from('concepts').insert({ family_id: profile!.family_id!, category_id: catId, name })
    },
    onSuccess: (_d, { catId }) => {
      qc.invalidateQueries({ queryKey: ['concepts'] })
      setNewConceptName(p => ({ ...p, [catId]: '' }))
    },
  })

  // Editar concepto
  const updateConcept = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await db.from('concepts').update({ name }).eq('id', id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['concepts'] }); setEditCon(null) },
  })

  // Eliminar concepto
  const deleteConcept = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('concepts').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['concepts'] }),
    onError: () => alert('No se puede eliminar este concepto porque ya tiene gastos o movimientos asociados en algún mes.')
  })

  const expenseCats = categories.filter(c => c.type === 'expense')
  const incomeCats = categories.filter(c => c.type === 'income')

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Categorías y conceptos</h1>
        <p className="text-slate-400 text-sm mt-0.5">Organiza tus gastos e ingresos en categorías y subcategorías</p>
      </div>

      {/* Nueva categoría */}
      <div className="card space-y-3">
        <h2 className="text-white font-semibold">Nueva categoría</h2>
        <form className="flex gap-3 flex-wrap" onSubmit={e => { e.preventDefault(); if (newCatName.trim()) createCat.mutate() }}>
          <select className="input w-36" value={newCatType} onChange={e => setNewCatType(e.target.value as 'expense' | 'income')}>
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
          </select>
          <input className="input flex-1 min-w-[180px]" placeholder="Ej: Alimentación" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
          <button type="submit" className="btn-primary flex items-center gap-2" disabled={!newCatName.trim()}>
            <Plus size={15} /> Crear
          </button>
        </form>
      </div>

      {/* Lista categorías gasto */}
      <CategorySection
        title="Categorías de gasto" type="expense" categories={expenseCats} concepts={concepts}
        isLoading={isLoading} expandedCats={expandedCats} newConceptName={newConceptName}
        editCat={editCat} editCon={editCon}
        onToggleExpand={toggleExpand}
        onNewConceptChange={(catId, v) => setNewConceptName(p => ({ ...p, [catId]: v }))}
        onCreateConcept={(catId, name) => createConcept.mutate({ catId, name })}
        onEditCat={setEditCat} onEditCon={setEditCon}
        onSaveCat={(id, name) => updateCat.mutate({ id, name })}
        onSaveCon={(id, name) => updateConcept.mutate({ id, name })}
        onDeleteCat={(id) => { if (confirm('¿Seguro que deseas eliminar esta categoría permanentemente?')) deleteCat.mutate(id) }}
        onDeleteCon={(id) => { if (confirm('¿Seguro que deseas eliminar este concepto permanentemente?')) deleteConcept.mutate(id) }}
      />

      {/* Lista categorías ingreso */}
      <CategorySection
        title="Categorías de ingreso" type="income" categories={incomeCats} concepts={concepts}
        isLoading={false} expandedCats={expandedCats} newConceptName={newConceptName}
        editCat={editCat} editCon={editCon}
        onToggleExpand={toggleExpand}
        onNewConceptChange={(catId, v) => setNewConceptName(p => ({ ...p, [catId]: v }))}
        onCreateConcept={(catId, name) => createConcept.mutate({ catId, name })}
        onEditCat={setEditCat} onEditCon={setEditCon}
        onSaveCat={(id, name) => updateCat.mutate({ id, name })}
        onSaveCon={(id, name) => updateConcept.mutate({ id, name })}
        onDeleteCat={(id) => { if (confirm('¿Seguro que deseas eliminar esta categoría permanentemente?')) deleteCat.mutate(id) }}
        onDeleteCon={(id) => { if (confirm('¿Seguro que deseas eliminar este concepto permanentemente?')) deleteConcept.mutate(id) }}
      />
    </div>
  )
}

function CategorySection({ title, type, categories, concepts, isLoading, expandedCats, newConceptName, editCat, editCon,
  onToggleExpand, onNewConceptChange, onCreateConcept, onEditCat, onEditCon, onSaveCat, onSaveCon, onDeleteCat, onDeleteCon }: {
  title: string; type: 'expense' | 'income'
  categories: Category[]; concepts: Concept[]; isLoading: boolean
  expandedCats: Set<string>; newConceptName: Record<string, string>
  editCat: { id: string; name: string } | null; editCon: { id: string; name: string } | null
  onToggleExpand: (id: string) => void
  onNewConceptChange: (catId: string, v: string) => void
  onCreateConcept: (catId: string, name: string) => void
  onEditCat: (v: { id: string; name: string } | null) => void
  onEditCon: (v: { id: string; name: string } | null) => void
  onSaveCat: (id: string, name: string) => void
  onSaveCon: (id: string, name: string) => void
  onDeleteCat: (id: string) => void
  onDeleteCon: (id: string) => void
}) {
  const color = type === 'expense' ? 'text-indigo-400' : 'text-emerald-400'
  const bg = type === 'expense' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-emerald-500/10 border-emerald-500/20'

  return (
    <div className="card space-y-2">
      <h2 className={clsx('font-semibold', color)}>{title} ({categories.length})</h2>
      {isLoading && <p className="text-slate-500 text-sm">Cargando...</p>}
      {categories.length === 0 && !isLoading && (
        <p className="text-slate-500 text-sm text-center py-4">Sin categorías de {type === 'expense' ? 'gasto' : 'ingreso'} aún.</p>
      )}
      {categories.map(cat => {
        const catConcepts = concepts.filter(c => c.category_id === cat.id)
        const isExpanded = expandedCats.has(cat.id)
        const isEditingCat = editCat?.id === cat.id
        return (
          <div key={cat.id} className={clsx('rounded-xl border overflow-hidden', cat.active ? bg : 'bg-slate-800/20 border-slate-700/20 opacity-60')}>
            {/* Categoría header */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button className="text-slate-400 hover:text-white transition-colors" onClick={() => onToggleExpand(cat.id)}>
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <Tag size={15} className={color} />
              {isEditingCat ? (
                <input className="input flex-1 py-1 text-sm" value={editCat.name} onChange={e => onEditCat({ ...editCat, name: e.target.value })} autoFocus />
              ) : (
                <span className="flex-1 text-slate-200 text-sm font-medium">{cat.name}</span>
              )}
              <span className="text-slate-500 text-xs">{catConcepts.length} conceptos</span>
              <div className="flex gap-1">
                {isEditingCat ? (
                  <>
                    <button className="icon-btn text-emerald-400" onClick={() => onSaveCat(cat.id, editCat!.name)}><Check size={14} /></button>
                    <button className="icon-btn text-slate-400" onClick={() => onEditCat(null)}><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <button className="icon-btn text-slate-400 hover:text-white hover:bg-slate-700" onClick={() => onEditCat({ id: cat.id, name: cat.name })}><Edit2 size={13} /></button>
                    <button className="icon-btn text-slate-400 hover:text-red-400 hover:bg-red-400/10" onClick={() => onDeleteCat(cat.id)}><Trash2 size={13} /></button>
                  </>
                )}
              </div>
            </div>

            {/* Conceptos */}
            {isExpanded && (
              <div className="border-t border-slate-700/30 px-4 py-3 space-y-2 bg-slate-900/30">
                {catConcepts.map(con => {
                  const isEditingCon = editCon?.id === con.id
                  return (
                    <div key={con.id} className={clsx('flex items-center gap-3 pl-6 py-1.5', !con.active && 'opacity-40')}>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-600 flex-shrink-0" />
                      {isEditingCon ? (
                        <input className="input flex-1 py-1 text-sm" value={editCon.name} onChange={e => onEditCon({ ...editCon, name: e.target.value })} autoFocus />
                      ) : (
                        <span className="flex-1 text-slate-300 text-sm">{con.name}</span>
                      )}
                      {isEditingCon ? (
                        <>
                          <button className="icon-btn text-emerald-400" onClick={() => onSaveCon(con.id, editCon!.name)}><Check size={13} /></button>
                          <button className="icon-btn text-slate-400" onClick={() => onEditCon(null)}><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button className="icon-btn text-slate-500 hover:text-white hover:bg-slate-700" onClick={() => onEditCon({ id: con.id, name: con.name })}><Edit2 size={12} /></button>
                          <button className="icon-btn text-slate-500 hover:text-red-400 hover:bg-red-400/10" onClick={() => onDeleteCon(con.id)}><Trash2 size={12} /></button>
                        </>
                      )}
                    </div>
                  )
                })}
                {/* Nuevo concepto */}
                <form className="flex gap-2 pl-6 pt-1" onSubmit={e => { e.preventDefault(); const n = newConceptName[cat.id]?.trim(); if (n) onCreateConcept(cat.id, n) }}>
                  <input className="input flex-1 py-1.5 text-sm" placeholder="Nuevo concepto" value={newConceptName[cat.id] ?? ''} onChange={e => onNewConceptChange(cat.id, e.target.value)} />
                  <button type="submit" className="btn-ghost py-1.5 px-3 text-sm flex items-center gap-1" disabled={!newConceptName[cat.id]?.trim()}>
                    <Plus size={13} /> Agregar
                  </button>
                </form>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
