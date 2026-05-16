import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { Plus, Users, Edit2, Trash2, Check, X } from 'lucide-react'
import type { Family, FamilyMember } from '@/shared/types/database'
import clsx from 'clsx'

// ─── Queries ────────────────────────────────────────────────
function useFamilySetup() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['family', profile?.family_id],
    queryFn: async (): Promise<Family | null> => {
      if (!profile?.family_id) return null
      const { data } = await supabase.from('families').select('*').eq('id', profile.family_id).single()
      return data as Family | null
    },
    enabled: !!profile,
  })
}

function useFamilyMembers() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['family_members', profile?.family_id],
    queryFn: async (): Promise<FamilyMember[]> => {
      const { data } = await supabase.from('family_members').select('*').eq('family_id', profile!.family_id!).order('name')
      return (data ?? []) as FamilyMember[]
    },
    enabled: !!profile?.family_id,
  })
}

// ─── Component ──────────────────────────────────────────────
export default function FamilyPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: family, isLoading: loadingFamily } = useFamilySetup()
  const { data: members = [], isLoading: loadingMembers } = useFamilyMembers()

  const [familyName, setFamilyName] = useState('')
  const [newMember, setNewMember] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // Crear familia
  const createFamily = useMutation({
    mutationFn: async (name: string) => {
      const { data: famId, error: fe } = await db.rpc('create_family', { p_name: name })
      if (fe) throw fe
      return famId
    },
    onSuccess: () => { 
      // Recargar la página para que AuthContext obtenga el nuevo profile.family_id
      window.location.reload() 
    },
  })

  // Crear integrante
  const createMember = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await db.from('family_members').insert({ family_id: profile!.family_id!, name })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['family_members'] }); setNewMember('') },
  })

  // Editar integrante
  const updateMember = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await db.from('family_members').update({ name }).eq('id', id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['family_members'] }); setEditingId(null) },
  })

  // Desactivar integrante
  const toggleMember = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await db.from('family_members').update({ active }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['family_members'] }),
  })

  if (loadingFamily) return <PageLoader />

  // Sin familia aún
  if (!profile?.family_id || (!family && !loadingFamily)) {
    return (
      <div className="max-w-lg mx-auto mt-16 space-y-6">
        <div className="text-center">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 items-center justify-center mb-4">
            <Users className="text-indigo-400" size={28} />
          </div>
          <h1 className="text-2xl font-bold text-white">Configura tu familia</h1>
          <p className="text-slate-400 text-sm mt-1">Para empezar, crea el grupo familiar</p>
        </div>
        <div className="card space-y-4">
          <label className="block text-sm font-medium text-slate-300">Nombre de la familia</label>
          <input
            className="input w-full"
            placeholder="Ej: Familia García"
            value={familyName}
            onChange={e => setFamilyName(e.target.value)}
          />
          <button
            className="btn-primary w-full"
            disabled={!familyName.trim() || createFamily.isPending}
            onClick={() => createFamily.mutate(familyName.trim())}
          >
            {createFamily.isPending ? 'Creando...' : 'Crear familia'}
          </button>
          {createFamily.isError && (
            <p className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg">
              Error: {(createFamily.error as Error)?.message || 'Error de base de datos.'}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Familia</h1>
        <p className="text-slate-400 text-sm mt-0.5">Gestiona los integrantes de <span className="text-indigo-400 font-medium">{family?.name}</span></p>
      </div>

      {/* Agregar integrante */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4">Agregar integrante</h2>
        <form
          className="flex gap-3"
          onSubmit={e => { e.preventDefault(); if (newMember.trim()) createMember.mutate(newMember.trim()) }}
        >
          <input
            className="input flex-1"
            placeholder="Nombre del integrante"
            value={newMember}
            onChange={e => setNewMember(e.target.value)}
          />
          <button type="submit" className="btn-primary flex items-center gap-2" disabled={!newMember.trim()}>
            <Plus size={16} /> Agregar
          </button>
        </form>
      </div>

      {/* Lista de integrantes */}
      <div className="card space-y-2">
        <h2 className="text-white font-semibold mb-4">Integrantes ({members.length})</h2>
        {loadingMembers && <p className="text-slate-500 text-sm">Cargando...</p>}
        {members.length === 0 && !loadingMembers && (
          <p className="text-slate-500 text-sm text-center py-6">No hay integrantes aún. Agrega el primero arriba.</p>
        )}
        {members.map(m => (
          <div
            key={m.id}
            className={clsx(
              'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
              m.active ? 'bg-slate-800/50 border-slate-700/50' : 'bg-slate-900/30 border-slate-800/30 opacity-50'
            )}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">{m.name.charAt(0).toUpperCase()}</span>
            </div>

            {editingId === m.id ? (
              <input
                className="input flex-1 py-1.5 text-sm"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                autoFocus
              />
            ) : (
              <div className="flex-1">
                <p className="text-slate-200 text-sm font-medium">{m.name}</p>
                {!m.active && <span className="text-slate-500 text-xs">Inactivo</span>}
              </div>
            )}

            <div className="flex items-center gap-1">
              {editingId === m.id ? (
                <>
                  <button className="icon-btn text-emerald-400 hover:bg-emerald-400/10" onClick={() => updateMember.mutate({ id: m.id, name: editName })}>
                    <Check size={15} />
                  </button>
                  <button className="icon-btn text-slate-400 hover:bg-slate-700" onClick={() => setEditingId(null)}>
                    <X size={15} />
                  </button>
                </>
              ) : (
                <>
                  <button className="icon-btn text-slate-400 hover:text-white hover:bg-slate-700"
                    onClick={() => { setEditingId(m.id); setEditName(m.name) }}>
                    <Edit2 size={14} />
                  </button>
                  <button
                    className={clsx('icon-btn', m.active ? 'text-slate-400 hover:text-red-400 hover:bg-red-400/10' : 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-400/10')}
                    onClick={() => toggleMember.mutate({ id: m.id, active: !m.active })}
                    title={m.active ? 'Desactivar' : 'Activar'}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
