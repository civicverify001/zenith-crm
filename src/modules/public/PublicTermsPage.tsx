// Public-facing Terms & Conditions page
// Route: /terms (no auth required)
// Replaces the Odoo-hosted link on all invoices and agreements

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

interface TermBlock {
  id: string
  slug: string
  display_title: string
  sort_order: number
  version: number
  content: string
  updated_at: string
}

export default function PublicTermsPage() {
  const [blocks, setBlocks] = useState<TermBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  useEffect(() => {
    fetchTerms()
  }, [])

  async function fetchTerms() {
    const { data } = await supabase
      .from('term_blocks')
      .select('id, slug, display_title, sort_order, version, content, updated_at')
      .eq('document_type', 'terms_page')
      .eq('is_active', true)
      .order('sort_order')
    if (data) {
      setBlocks(data)
      if (data.length > 0) setActiveSection(data[0].id)
    }
    setLoading(false)
  }

  const effectiveDate = blocks.find(b => b.slug === 'tc-effective-date')
  const version = blocks.length > 0
    ? 'v' + Math.max(...blocks.map(b => b.version)).toString() + '.0'
    : 'v1.0'
  const lastUpdated = blocks.length > 0
    ? new Date(Math.max(...blocks.map(b => new Date(b.updated_at).getTime()))).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : ''

  const contentBlocks = blocks.filter(b => b.slug !== 'tc-effective-date')

  return (
    <div className="min-h-screen bg-white">

      {/* HEADER */}
      <div className="bg-[#0a2540] text-white">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="bg-white rounded-lg px-3 py-1.5">
              <span className="text-[#0a2540] font-bold text-sm tracking-wide">ZE ZENITH</span>
            </div>
          </div>
          <h1 className="text-3xl font-bold">General Terms and Conditions</h1>
          <p className="text-blue-200 mt-2">Purchase, Installation, and Limited Warranty Agreement</p>
          <div className="flex items-center gap-6 mt-4 text-sm text-blue-200">
            <span>Zenith Pure Solutions LLC</span>
            <span>•</span>
            <span>{version}</span>
            {lastUpdated && <><span>•</span><span>Updated {lastUpdated}</span></>}
          </div>
        </div>
      </div>

      {/* COMPANY INFO BAR */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap gap-6 text-sm text-gray-600">
          <span>📍 6951 E 30th St, Suite B, Indianapolis, IN 46219</span>
          <span>📞 (317) 690-4172</span>
          <span>✉️ accounts@zenithpuresolutions.com</span>
          <span>🌐 zenithpuresolutions.com</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 flex gap-8">

        {/* LEFT NAV — sticky table of contents */}
        {!loading && (
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="sticky top-6">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Table of Contents
              </div>
              <nav className="space-y-1">
                {contentBlocks.map(block => (
                  <a
                    key={block.id}
                    href={`#${block.slug}`}
                    onClick={() => setActiveSection(block.id)}
                    className={`block text-sm py-1.5 px-3 rounded-lg transition-colors ${
                      activeSection === block.id
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    {block.display_title}
                  </a>
                ))}
              </nav>

              <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-xs font-semibold text-gray-500 mb-2">Questions?</div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div>(317) 690-4172</div>
                  <div>accounts@zenithpuresolutions.com</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MAIN CONTENT */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Loading terms...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-10">
              {contentBlocks.map((block, index) => (
                <section key={block.id} id={block.slug}>
                  <div className="flex items-baseline gap-3 mb-4 pb-2 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-[#0a2540]">
                      {block.display_title}
                    </h2>
                    <span className="text-xs text-gray-300">v{block.version}</span>
                  </div>
                  <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {block.content}
                  </div>
                </section>
              ))}

              {/* FOOTER */}
              <div className="border-t border-gray-200 pt-8 mt-8">
                <div className="bg-gray-50 rounded-xl p-6">
                  <div className="text-sm font-semibold text-gray-700 mb-3">
                    Zenith Pure Solutions LLC
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>6951 E 30th St, Suite B, Indianapolis, IN 46219</div>
                    <div>Phone: (317) 690-4172 | Email: accounts@zenithpuresolutions.com</div>
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      {version} · {lastUpdated && `Last updated ${lastUpdated}`} · Indiana governing law
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-center">
                  <a
                    href="https://zenithpuresolutions.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    zenithpuresolutions.com
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
