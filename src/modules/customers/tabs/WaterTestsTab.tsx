// src/modules/customers/tabs/WaterTestsTab.tsx
// Shows water test history for a customer — before/after comparison + all tests
import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { WaterTestForm } from '../../shared/WaterTestForm'
import { WaterTestComparison, WaterTestHistory } from '../../shared/WaterTestResults'
import { fetchByCustomer, type WaterTest } from '../../../services/waterTestService'

interface Props {
  customerId: string
}

export function WaterTestsTab({ customerId }: Props) {
  const [tests, setTests] = useState<WaterTest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTest, setEditingTest] = useState<WaterTest | null>(null)
  const [leadIds, setLeadIds] = useState<string[]>([])
  const [jobIds, setJobIds] = useState<string[]>([])

  useEffect(() => { loadData() }, [customerId])

  async function loadData() {
    setLoading(true)

    // Get lead_id from customer record
    const { data: cust } = await supabase
      .from('customers')
      .select('lead_id')
      .eq('id', customerId)
      .maybeSingle()

    const custLeadIds: string[] = cust?.lead_id ? [cust.lead_id] : []

    // Get job IDs linked to this customer (via lead_id or direct customer link)
    const custJobIds: string[] = []

    if (custLeadIds.length > 0) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('lead_id', custLeadIds[0])
      if (jobs) custJobIds.push(...jobs.map(j => j.id))
    }

    // Also check jobs linked directly via customer_id if that column exists
    const { data: directJobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('customer_id', customerId)
    if (directJobs) {
      for (const j of directJobs) {
        if (!custJobIds.includes(j.id)) custJobIds.push(j.id)
      }
    }

    setLeadIds(custLeadIds)
    setJobIds(custJobIds)

    const allTests = await fetchByCustomer(custLeadIds, custJobIds)
    // Sort newest first
    allTests.sort((a, b) => new Date(b.tested_at || '').getTime() - new Date(a.tested_at || '').getTime())
    setTests(allTests)
    setLoading(false)
  }

  function handleSaved(test: WaterTest) {
    setShowForm(false)
    setEditingTest(null)
    loadData()
  }

  function handleEdit(test: WaterTest) {
    setEditingTest(test)
    setShowForm(true)
  }

  async function handleDelete(test: WaterTest) {
    if (!confirm('Delete this water test? This cannot be undone.')) return
    const { deleteWaterTest } = await import('../../../services/waterTestService')
    await deleteWaterTest(test.id)
    loadData()
  }

  if (loading) {
    return <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading water tests...</div>
  }

  const hasInitial = tests.some(t => t.test_type === 'initial')
  const hasPostInstall = tests.some(t => t.test_type === 'post_install')

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16,
      }}>
        <div>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, margin: 0 }}>Water Tests</h2>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {tests.length} test{tests.length !== 1 ? 's' : ''} recorded
            {hasInitial && hasPostInstall && ' — before & after comparison available'}
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setEditingTest(null); setShowForm(true) }}
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: 'rgba(34,211,238,0.1)', color: '#22d3ee',
              border: '1px solid rgba(34,211,238,0.25)', cursor: 'pointer',
            }}
          >
            + Record Test
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ marginBottom: 16 }}>
          <WaterTestForm
            leadId={leadIds[0] || undefined}
            testType="routine"
            existingTest={editingTest}
            onSaved={handleSaved}
            onCancel={() => { setShowForm(false); setEditingTest(null) }}
          />
        </div>
      )}

      {/* Before/After comparison */}
      {!showForm && hasInitial && hasPostInstall && (
        <div style={{ marginBottom: 16 }}>
          <WaterTestComparison tests={tests} />
        </div>
      )}

      {/* Test history */}
      {!showForm && tests.length > 0 && (
        <WaterTestHistory tests={tests} onEdit={handleEdit} onDelete={handleDelete} />
      )}

      {/* Empty state */}
      {!showForm && tests.length === 0 && (
        <div style={{
          background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
          padding: '48px 20px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>💧</div>
          <p style={{ color: '#64748b', fontSize: 13 }}>
            No water tests recorded for this customer. Tests from the lead and installation will appear here automatically.
          </p>
        </div>
      )}
    </div>
  )
}
