import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface TermBlock {
  id: string
  slug: string
  name: string
  display_title: string
  category: string
  document_type: string
  sort_order: number
  version: number
  content: string
  is_active: boolean
  updated_at: string
}

const DOC_TYPE_LABELS: Record<string, string> = {
  terms_page: '📄 General Terms & Conditions',
  rental_agreement: '📋 Rental Agreement',
  rental_quote: '💬 Rental Quote',
  purchase_invoice: '🧾 Purchase Invoice / Quote',
  all: '🌐 All Documents',
}

const DOC_TYPE_ORDER = ['terms_page', 'rental_agreement', 'rental_quote', 'purchase_invoice', 'all']

export default function TermsAdminPage() {
  const { user, profile } = useAuth()
  const [blocks, setBlocks] = useState<TermBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [activeDocType, setActiveDocType] = useState('terms_page')
  const [editing, setEditing] = useState<TermBlock | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [search, setSearch] = useState('')

  const isAdmin = profile?.role === 'admin'

  useEffect(() => { fetchBlocks() }, [])

  async function fetchBlocks() {
    setLoading(true)
    const { data, error } = await supabase
      .from('term_blocks')
      .select('*')
      .order('document_type')
      .order('sort_order')
    if (!error && data) setBlocks(data)
    setLoading(false)
  }

  function startEdit(block: TermBlock) {
    setEditing(block)
    setEditContent(block.content)
    setEditTitle(block.display_title || block.name)
    setSaveMsg('')
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase
      .from('term_blocks')
      .update({
        content: editContent,
        display_title: editTitle,
        version: editing.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editing.id)
    if (error) {
      setSaveMsg('❌ Error saving: ' + error.message)
    } else {
      setSaveMsg('✅ Saved')
      setBlocks(prev => prev.map(b => b.id === editing.id
        ? { ...b, content: editContent, display_title: editTitle, version: b.version + 1 }
        : b
      ))
      setEditing(null)
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  async function toggleActive(block: TermBlock) {
    const { error } = await supabase
      .from('term_blocks')
      .update({ is_active: !block.is_active })
      .eq('id', block.id)
    if (!error) {
      setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, is_active: !b.is_active } : b))
    }
  }

  const filtered = blocks.filter(b => {
    const matchType = b.document_type === activeDocType
    const matchSearch = search === '' ||
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.content.toLowerCase().includes(search.toLowerCase()) ||
      (b.display_title || '').toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h2 className="text-xl font-semibold text-gray-700">Admin Access Only</h2>
        <p className="text-gray-500 mt-2">You don't have permission to view this page.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-gray-50">

      {/* LEFT SIDEBAR — Document Type Nav */}
      <div className="w-64 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">Terms & Documents</h1>
          <p className="text-xs text-gray-500 mt-1">Admin editor — changes go live instantly</p>
        </div>

        <div className="p-3">
          <input
            type="text"
            placeholder="Search terms..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {DOC_TYPE_ORDER.map(dt => {
            const count = blocks.filter(b => b.document_type === dt).length
            return (
              <button
                key={dt}
                onClick={() => { setActiveDocType(dt); setEditing(null) }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeDocType === dt
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div>{DOC_TYPE_LABELS[dt] || dt}</div>
                <div className="text-xs text-gray-400 mt-0.5">{count} blocks</div>
              </button>
            )
          })}
        </nav>

        {/* Public T&C link */}
        <div className="p-4 border-t border-gray-200">
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors"
          >
            <span>🌐</span>
            <span>View Public T&C Page</span>
            <span className="ml-auto text-gray-400">↗</span>
          </a>
          <p className="text-xs text-gray-400 mt-2">This is the link shown on all invoices and agreements</p>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">

        {/* BLOCK LIST */}
        <div className={`${editing ? 'w-80' : 'flex-1'} flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white`}>
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-800">{DOC_TYPE_LABELS[activeDocType]}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{filtered.length} term blocks</p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No blocks found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map(block => (
                <div
                  key={block.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    editing?.id === block.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                  } ${!block.is_active ? 'opacity-50' : ''}`}
                  onClick={() => startEdit(block)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">
                        {block.display_title || block.name}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        v{block.version} · {block.slug}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); toggleActive(block) }}
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          block.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {block.is_active ? 'Active' : 'Off'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">{block.content.slice(0, 120)}...</p>
                  <div className="text-xs text-gray-300 mt-1">
                    Updated {new Date(block.updated_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* EDITOR PANEL */}
        {editing && (
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div>
                <h3 className="font-semibold text-gray-900">Edit Block</h3>
                <p className="text-xs text-gray-400">{editing.slug} · Currently v{editing.version} → will save as v{editing.version + 1}</p>
              </div>
              <div className="flex items-center gap-2">
                {saveMsg && (
                  <span className={`text-sm font-medium ${saveMsg.includes('❌') ? 'text-red-600' : 'text-green-600'}`}>
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={() => setEditing(null)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Warning banner */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                <span>⚠️</span>
                <div className="text-sm text-amber-800">
                  <strong>Live content.</strong> Changes update the public T&C page and all new documents instantly. Signed agreements already on file are not affected (they store a snapshot).
                </div>
              </div>

              {/* Title field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Section heading shown on document"
                />
              </div>

              {/* Content field */}
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Content
                  <span className="text-gray-400 font-normal ml-2">({editContent.length} characters)</span>
                </label>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={28}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none"
                  placeholder="Term block content..."
                />
              </div>

              {/* Preview */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">Preview</div>
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <h4 className="font-bold text-gray-800 mb-2 text-sm">{editTitle}</h4>
                  <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{editContent}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty state when no block selected */}
        {!editing && (
          <div className="hidden lg:flex flex-1 items-center justify-center text-gray-400 bg-gray-50">
            <div className="text-center">
              <div className="text-5xl mb-3">📝</div>
              <p className="text-lg font-medium">Select a block to edit</p>
              <p className="text-sm mt-1">Click any term block on the left to edit its content</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
