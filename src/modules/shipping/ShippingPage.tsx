import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import {
  fetchShipments,
  getShipmentCounts,
  createShipment,
  updateShipment,
  markLabelCreated,
  markShipped,
  markInTransit,
  markDelivered,
  cancelShipment,
  markReturned,
  resolveShippingAddress,
  SHIPMENT_STATUS_CONFIG,
  SHIPMENT_TYPE_LABELS,
  ADDRESS_SOURCE_LABELS,
  type Shipment,
  type CreateShipmentInput,
} from '../../services/shipmentService'
import { supabase } from '../../lib/supabase'

// ============================================================
// SHIPPING PAGE — Full manual + cron shipment management
// Gap 16 fixes:
//   1. Email fires on inline Ship button (table row)
//   2. Tracking number warning before marking shipped
//   3. FedEx env check with clear error message
// ============================================================

const TABS = [
  { key: 'all',           label: 'All',           color: '#94a3b8', icon: '📦' },
  { key: 'pending',       label: 'Pending',        color: '#f59e0b', icon: '⏳' },
  { key: 'label_created', label: 'Label Created',  color: '#8b5cf6', icon: '🏷️' },
  { key: 'shipped',       label: 'Shipped',        color: '#3b82f6', icon: '🚚' },
  { key: 'in_transit',    label: 'In Transit',     color: '#06b6d4', icon: '✈️' },
  { key: 'delivered',     label: 'Delivered',      color: '#10b981', icon: '✅' },
  { key: 'cancelled',     label: 'Cancelled',      color: '#6b7280', icon: '❌' },
  { key: 'returned',      label: 'Returned',       color: '#ef4444', icon: '↩️' },
]

export default function ShippingPage() {
  const { user } = useAuth()
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreateDrawer, setShowCreateDrawer] = useState(false)
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null)

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ['shipments', activeTab],
    queryFn: () => fetchShipments({ status: activeTab === 'all' ? undefined : activeTab }),
  })

  const { data: counts = {} } = useQuery({
    queryKey: ['shipment_counts'],
    queryFn: getShipmentCounts,
  })

  if (!can('shipping', 'view')) {
    return (
      <div style={{ padding: 40, color: '#e2e8f0', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p style={{ color: '#64748b' }}>You do not have permission to view this page.</p>
      </div>
    )
  }

  const filtered = shipments.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.customer_name?.toLowerCase().includes(q) ||
      s.product_name?.toLowerCase().includes(q) ||
      s.tracking_number?.toLowerCase().includes(q) ||
      s.ship_to_city?.toLowerCase().includes(q)
    )
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['shipments'] })
    queryClient.invalidateQueries({ queryKey: ['shipment_counts'] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', gap: 12, flexWrap: 'wrap',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
          Shipping & Fulfillment
        </h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search shipments..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8,
              padding: '8px 14px', color: '#e2e8f0', fontSize: 13, width: 220,
              outline: 'none',
            }}
          />
          {can('shipping', 'create') && (
            <button
              onClick={() => setShowCreateDrawer(true)}
              style={{
                background: '#0d7ea3', color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              + New Shipment
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 6, padding: '0 24px 16px', overflowX: 'auto',
        flexShrink: 0,
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key
          const count = tab.key === 'all' ? counts.all : counts[tab.key]
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10, border: 'none',
                fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.04em', cursor: 'pointer', transition: 'all 0.15s',
                whiteSpace: 'nowrap', flexShrink: 0,
                background: isActive
                  ? `linear-gradient(135deg, ${tab.color}22, ${tab.color}0a)`
                  : 'rgba(255,255,255,0.03)',
                color: isActive ? tab.color : '#64748b',
                boxShadow: isActive ? `0 0 12px ${tab.color}15` : 'none',
                outline: isActive ? `1px solid ${tab.color}40` : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {count !== undefined && count > 0 && (
                <span style={{
                  background: isActive ? tab.color + '25' : 'rgba(255,255,255,0.06)',
                  color: isActive ? tab.color : '#64748b',
                  padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        <div style={{
          background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Customer', 'Product', 'Type', 'Ship To', 'Scheduled', 'Tracking', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 14px',
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: '#64748b',
                    background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid #1e3a4f',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                    Loading shipments...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                    No shipments found
                  </td>
                </tr>
              ) : filtered.map(s => (
                <tr
                  key={s.id}
                  onClick={() => setSelectedShipment(s)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{s.customer_name || '—'}</div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: '#e2e8f0' }}>{s.product_name || '—'}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>
                      {SHIPMENT_TYPE_LABELS[s.type] || s.type}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>
                      {s.ship_to_city && s.ship_to_state
                        ? `${s.ship_to_city}, ${s.ship_to_state}`
                        : s.ship_to_address
                          ? 'Address set'
                          : <span style={{ color: '#f59e0b' }}>Missing</span>
                      }
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>
                      {s.scheduled_date ? new Date(s.scheduled_date + 'T00:00:00').toLocaleDateString() : '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {s.tracking_number ? (
                      <span style={{ color: '#3b82f6', fontSize: 12, fontFamily: 'monospace' }}>
                        {s.tracking_number}
                      </span>
                    ) : (
                      <span style={{ color: '#64748b', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <StatusBadge status={s.status} />
                  </td>
                  <td style={tdStyle}>
                    {/* GAP 16 FIX 1: inline Ship button now fires email */}
                    <ShipmentActions shipment={s} onUpdated={invalidate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Drawer */}
      {showCreateDrawer && (
        <CreateShipmentDrawer
          onClose={() => setShowCreateDrawer(false)}
          onCreated={() => {
            setShowCreateDrawer(false)
            invalidate()
          }}
          userId={user?.id}
        />
      )}

      {/* Detail Drawer */}
      {selectedShipment && (
        <ShipmentDetailDrawer
          shipment={selectedShipment}
          onClose={() => setSelectedShipment(null)}
          onUpdated={() => {
            setSelectedShipment(null)
            invalidate()
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// STATUS BADGE
// ============================================================
function StatusBadge({ status }: { status: string }) {
  const config = SHIPMENT_STATUS_CONFIG[status] || { label: status, color: '#64748b', bgColor: '#64748b20' }
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      color: config.color, background: config.bgColor,
      border: `1px solid ${config.color}30`,
    }}>
      {config.icon} {config.label}
    </span>
  )
}

// ============================================================
// SHIPMENT ACTIONS — GAP 16 FIX 1: email fires on inline Ship
// ============================================================
function ShipmentActions({ shipment, onUpdated }: { shipment: Shipment; onUpdated: () => void }) {
  const { can } = usePermissions()

  const handleMarkShipped = async (e: React.MouseEvent) => {
    e.stopPropagation()

    // GAP 16 FIX 2: warn if no tracking number
    if (!shipment.tracking_number) {
      const proceed = confirm(
        'No tracking number on this shipment. Mark as shipped anyway?\n\n' +
        'Tip: Open the shipment to add a tracking number first.'
      )
      if (!proceed) return
    } else {
      if (!confirm('Mark this shipment as shipped? This will advance the service plan fulfillment dates.')) return
    }

    const result = await markShipped(shipment.id)
    if (result.success) {
      // GAP 16 FIX 1: fire email on inline Ship button (was missing before)
      fetch('/api/email/send-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipment.id }),
      }).catch(() => {})
      onUpdated()
    } else {
      alert(result.error || 'Failed to mark shipped')
    }
  }

  const handleMarkDelivered = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await markDelivered(shipment.id)
    onUpdated()
  }

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Cancel this shipment?')) return
    await cancelShipment(shipment.id)
    onUpdated()
  }

  const btnStyle = (color: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', border: `1px solid ${color}40`,
    background: `${color}15`, color,
  })

  return (
    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
      {shipment.status === 'pending' && can('shipping', 'mark_shipped') && (
        <button onClick={handleMarkShipped} style={btnStyle('#3b82f6')}>Ship</button>
      )}
      {shipment.status === 'label_created' && can('shipping', 'mark_shipped') && (
        <button onClick={handleMarkShipped} style={btnStyle('#3b82f6')}>Ship</button>
      )}
      {(shipment.status === 'shipped' || shipment.status === 'in_transit') && can('shipping', 'mark_delivered') && (
        <button onClick={handleMarkDelivered} style={btnStyle('#10b981')}>Delivered</button>
      )}
      {(shipment.status === 'pending' || shipment.status === 'label_created') && can('shipping', 'cancel') && (
        <button onClick={handleCancel} style={btnStyle('#ef4444')}>Cancel</button>
      )}
    </div>
  )
}

// ============================================================
// CREATE SHIPMENT DRAWER
// ============================================================
function CreateShipmentDrawer({ onClose, onCreated, userId }: {
  onClose: () => void
  onCreated: () => void
  userId?: string
}) {
  const [customerId, setCustomerId] = useState('')
  const [productId, setProductId] = useState('')
  const [type, setType] = useState('filter')
  const [carrier, setCarrier] = useState('fedex')
  const [scheduledDate, setScheduledDate] = useState('')
  const [notes, setNotes] = useState('')
  const [shipTo, setShipTo] = useState({ name: '', address: '', city: '', state: '', zip: '' })
  const [addressSource, setAddressSource] = useState('customer_primary')
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    supabase.from('customers').select('id, full_name').order('full_name').then(({ data }) => {
      setCustomers((data || []).map(c => ({ id: c.id, name: c.full_name || '' })))
    })
    supabase.from('products').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      setProducts(data || [])
    })
  }, [])

  // Auto-resolve address when customer changes
  useEffect(() => {
    if (!customerId) return
    resolveShippingAddress(customerId).then(addr => {
      if (addr) {
        setShipTo({
          name: addr.name,
          address: addr.address,
          city: addr.city,
          state: addr.state,
          zip: addr.zip,
        })
        setAddressSource(addr.source)
      }
    })
  }, [customerId])

  const handleSave = async () => {
    if (!customerId) return alert('Select a customer')
    if (!shipTo.address) return alert('Shipping address is required')
    setSaving(true)
    try {
      const input: CreateShipmentInput = {
        customer_id: customerId,
        product_id: productId || null,
        type,
        carrier,
        scheduled_date: scheduledDate || null,
        ship_to_name: shipTo.name,
        ship_to_address: shipTo.address,
        ship_to_city: shipTo.city,
        ship_to_state: shipTo.state,
        ship_to_zip: shipTo.zip,
        address_source: addressSource,
        notes: notes || null,
        created_by: userId || null,
        source: 'manual',
      }
      const result = await createShipment(input)
      if (result) onCreated()
      else alert('Failed to create shipment')
    } catch (err) {
      alert('Error creating shipment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={drawerStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>New Shipment</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
          <FormField label="Customer">
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={inputStyle}>
              <option value="">Select customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>

          <FormField label="Product">
            <select value={productId} onChange={e => setProductId(e.target.value)} style={inputStyle}>
              <option value="">Select product...</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FormField label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                {Object.entries(SHIPMENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Carrier">
              <select value={carrier} onChange={e => setCarrier(e.target.value)} style={inputStyle}>
                <option value="fedex">FedEx</option>
                <option value="ups">UPS</option>
                <option value="usps">USPS</option>
                <option value="other">Other</option>
              </select>
            </FormField>
          </div>

          <FormField label="Scheduled Date">
            <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} style={inputStyle} />
          </FormField>

          <div style={{
            padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10,
            border: '1px solid #1e3a4f',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>
              Ship To {addressSource && (
                <span style={{ color: '#0d7ea3', fontWeight: 600, textTransform: 'none', marginLeft: 6 }}>
                  ({ADDRESS_SOURCE_LABELS[addressSource] || addressSource})
                </span>
              )}
            </div>
            {!customerId && (
              <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', marginBottom: 8 }}>
                Select a customer above to auto-fill address
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                placeholder="Name"
                value={shipTo.name}
                onChange={e => { setShipTo(s => ({ ...s, name: e.target.value })); setAddressSource('manual_override') }}
                style={inputStyle}
              />
              <input
                placeholder="Address"
                value={shipTo.address}
                onChange={e => { setShipTo(s => ({ ...s, address: e.target.value })); setAddressSource('manual_override') }}
                style={inputStyle}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                <input
                  placeholder="City"
                  value={shipTo.city}
                  onChange={e => { setShipTo(s => ({ ...s, city: e.target.value })); setAddressSource('manual_override') }}
                  style={inputStyle}
                />
                <input
                  placeholder="State"
                  value={shipTo.state}
                  onChange={e => { setShipTo(s => ({ ...s, state: e.target.value })); setAddressSource('manual_override') }}
                  style={inputStyle}
                />
                <input
                  placeholder="ZIP"
                  value={shipTo.zip}
                  onChange={e => { setShipTo(s => ({ ...s, zip: e.target.value })); setAddressSource('manual_override') }}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          <FormField label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </FormField>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid #1e3a4f' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '10px 0', borderRadius: 8, background: 'rgba(255,255,255,0.05)',
            border: '1px solid #1e3a4f', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: '10px 0', borderRadius: 8, background: '#0d7ea3',
            border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
          }}>
            {saving ? 'Creating...' : 'Create Shipment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SHIPMENT DETAIL DRAWER
// GAP 16 FIX 2: tracking warning + FIX 3: FedEx env check
// ============================================================
function ShipmentDetailDrawer({ shipment, onClose, onUpdated }: {
  shipment: Shipment
  onClose: () => void
  onUpdated: () => void
}) {
  const { can } = usePermissions()
  const [tracking, setTracking] = useState(shipment.tracking_number || '')
  const [labelUrl, setLabelUrl] = useState(shipment.label_url || '')
  const [saving, setSaving] = useState(false)
  const [fedexError, setFedexError] = useState('')

  const handleSaveTracking = async () => {
    setSaving(true)
    try {
      if (shipment.status === 'pending' && tracking) {
        await markLabelCreated(shipment.id, { tracking_number: tracking, label_url: labelUrl || undefined })
      } else {
        await updateShipment(shipment.id, { tracking_number: tracking, label_url: labelUrl })
      }
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  // GAP 16 FIX 3: FedEx env check — clear error message instead of generic failure
  const handleGenerateFedExLabel = async () => {
    if (!confirm('Generate a FedEx shipping label for this shipment?')) return
    setFedexError('')
    setSaving(true)
    try {
      const res = await fetch('/api/shipping/create-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipment.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        // GAP 16 FIX 3: detect credential/env errors specifically
        const errMsg = data.error || ''
        if (errMsg.toLowerCase().includes('api_key') || errMsg.toLowerCase().includes('unauthorized') || errMsg.toLowerCase().includes('credential') || errMsg.toLowerCase().includes('401')) {
          setFedexError('FedEx API credentials not configured. Check FEDEX_API_KEY, FEDEX_SECRET_KEY, and FEDEX_ACCOUNT_NUMBER in Vercel environment variables.')
        } else if (!shipment.ship_to_address) {
          setFedexError('Cannot generate label — shipping address is missing on this shipment.')
        } else {
          setFedexError(errMsg || 'Failed to create FedEx label. Check Vercel logs for details.')
        }
      } else {
        if (data.label_url) window.open(data.label_url, '_blank')
        onUpdated()
      }
    } catch (err) {
      setFedexError('Network error generating FedEx label. Check your internet connection.')
    } finally {
      setSaving(false)
    }
  }

  const handleTrackPackage = async () => {
    if (!shipment.tracking_number) return
    setSaving(true)
    try {
      const res = await fetch('/api/shipping/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: shipment.tracking_number }),
      })
      const data = await res.json()
      if (data.success) {
        alert(`Status: ${data.fedex_status || data.status}\n${data.description || ''}\n${data.location ? 'Location: ' + data.location : ''}${data.estimated_delivery ? '\nETA: ' + new Date(data.estimated_delivery).toLocaleDateString() : ''}`)
      } else {
        alert(data.error || 'Tracking lookup failed')
      }
    } catch {
      alert('Error fetching tracking info')
    } finally {
      setSaving(false)
    }
  }

  const handleAction = async (action: string) => {
    setSaving(true)
    try {
      switch (action) {
        case 'ship': {
          // GAP 16 FIX 2: warn if no tracking number before shipping
          if (!shipment.tracking_number && !tracking) {
            const proceed = confirm(
              'No tracking number set. Mark as shipped anyway?\n\n' +
              'Tip: Add a tracking number above first so the customer email includes it.'
            )
            if (!proceed) { setSaving(false); return }
          }
          const result = await markShipped(shipment.id)
          if (!result.success) { alert(result.error || 'Failed'); break }
          // Fire shipment email (fire-and-forget)
          fetch('/api/email/send-shipment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shipment_id: shipment.id }),
          }).catch(() => {})
          break
        }
        case 'in_transit': await markInTransit(shipment.id); break
        case 'deliver': await markDelivered(shipment.id); break
        case 'cancel':
          if (confirm('Cancel this shipment?')) await cancelShipment(shipment.id)
          break
        case 'return':
          if (confirm('Mark as returned? This does not reopen the fulfillment cycle.')) {
            const returnNotes = prompt('Return notes (optional):')
            await markReturned(shipment.id, returnNotes || undefined)
          }
          break
      }
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={drawerStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
              Shipment Details
            </h2>
            <StatusBadge status={shipment.status} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
          <InfoCard label="Customer" value={shipment.customer_name || '—'} />
          <InfoCard label="Product" value={shipment.product_name || '—'} />
          <InfoCard label="Type" value={SHIPMENT_TYPE_LABELS[shipment.type] || shipment.type} />
          <InfoCard label="Source" value={shipment.source === 'cron_fulfillment' ? 'Auto (Fulfillment Cron)' : 'Manual'} />
          <InfoCard label="Carrier" value={(shipment.carrier || 'fedex').toUpperCase()} />

          {shipment.scheduled_date && (
            <InfoCard label="Scheduled Date" value={new Date(shipment.scheduled_date + 'T00:00:00').toLocaleDateString()} />
          )}
          {shipment.shipped_date && (
            <InfoCard label="Shipped Date" value={new Date(shipment.shipped_date + 'T00:00:00').toLocaleDateString()} />
          )}
          {shipment.delivered_date && (
            <InfoCard label="Delivered Date" value={new Date(shipment.delivered_date + 'T00:00:00').toLocaleDateString()} />
          )}

          {/* Ship-to address */}
          <div style={{
            padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10,
            border: '1px solid #1e3a4f',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
              Ship To {shipment.address_source && (
                <span style={{ color: '#0d7ea3', textTransform: 'none' }}>
                  ({ADDRESS_SOURCE_LABELS[shipment.address_source] || shipment.address_source})
                </span>
              )}
            </div>
            <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.6 }}>
              {shipment.ship_to_name && <div>{shipment.ship_to_name}</div>}
              {shipment.ship_to_address && <div>{shipment.ship_to_address}</div>}
              {(shipment.ship_to_city || shipment.ship_to_state || shipment.ship_to_zip) && (
                <div>{[shipment.ship_to_city, shipment.ship_to_state].filter(Boolean).join(', ')} {shipment.ship_to_zip}</div>
              )}
              {!shipment.ship_to_address && (
                <div style={{ color: '#f59e0b', fontStyle: 'italic' }}>Address missing — update before shipping</div>
              )}
            </div>
          </div>

          {shipment.notes && (
            <div style={{
              padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10,
              border: '1px solid #1e3a4f',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Notes</div>
              <div style={{ color: '#94a3b8', fontSize: 13 }}>{shipment.notes}</div>
            </div>
          )}

          {/* FedEx error banner — GAP 16 FIX 3 */}
          {fedexError && (
            <div style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 12,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171',
            }}>
              ⚠️ {fedexError}
            </div>
          )}

          {/* Tracking input */}
          {can('shipping', 'add_tracking') && ['pending', 'label_created'].includes(shipment.status) && (
            <div style={{
              padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10,
              border: '1px solid #1e3a4f',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
                Tracking Information
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  placeholder="Tracking Number (e.g. 794644774783)"
                  value={tracking}
                  onChange={e => setTracking(e.target.value)}
                  style={inputStyle}
                />
                <input
                  placeholder="Label URL (optional)"
                  value={labelUrl}
                  onChange={e => setLabelUrl(e.target.value)}
                  style={inputStyle}
                />
                <button onClick={handleSaveTracking} disabled={saving || !tracking} style={{
                  padding: '8px 0', borderRadius: 8, background: '#8b5cf6',
                  border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: !tracking || saving ? 'not-allowed' : 'pointer',
                  opacity: !tracking || saving ? 0.5 : 1,
                }}>
                  {saving ? 'Saving...' : 'Save Tracking'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid #1e3a4f', flexWrap: 'wrap' }}>
          {shipment.status === 'pending' && can('shipping', 'create') && (
            <ActionBtn label="📦 FedEx Label" color="#8b5cf6" onClick={handleGenerateFedExLabel} disabled={saving} />
          )}
          {['pending', 'label_created'].includes(shipment.status) && can('shipping', 'mark_shipped') && (
            <ActionBtn label="Mark Shipped" color="#3b82f6" onClick={() => handleAction('ship')} disabled={saving} />
          )}
          {shipment.status === 'shipped' && can('shipping', 'mark_delivered') && (
            <>
              <ActionBtn label="In Transit" color="#06b6d4" onClick={() => handleAction('in_transit')} disabled={saving} />
              <ActionBtn label="Delivered" color="#10b981" onClick={() => handleAction('deliver')} disabled={saving} />
            </>
          )}
          {shipment.status === 'in_transit' && can('shipping', 'mark_delivered') && (
            <ActionBtn label="Delivered" color="#10b981" onClick={() => handleAction('deliver')} disabled={saving} />
          )}
          {shipment.tracking_number && ['shipped', 'in_transit'].includes(shipment.status) && (
            <ActionBtn label="📍 Track" color="#06b6d4" onClick={handleTrackPackage} disabled={saving} />
          )}
          {['pending', 'label_created'].includes(shipment.status) && can('shipping', 'cancel') && (
            <ActionBtn label="Cancel" color="#ef4444" onClick={() => handleAction('cancel')} disabled={saving} />
          )}
          {shipment.status === 'delivered' && can('shipping', 'mark_returned') && (
            <ActionBtn label="Mark Returned" color="#ef4444" onClick={() => handleAction('return')} disabled={saving} />
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SHARED UI COMPONENTS
// ============================================================
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 12, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function ActionBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, minWidth: 100, padding: '10px 0', borderRadius: 8,
      background: `${color}18`, border: `1px solid ${color}40`, color,
      fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>
      {label}
    </button>
  )
}

// ============================================================
// STYLES
// ============================================================
const tdStyle: React.CSSProperties = {
  padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 13, color: '#e2e8f0',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
  padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
  display: 'flex', justifyContent: 'flex-end',
}

const drawerStyle: React.CSSProperties = {
  width: 460, maxWidth: '90vw', height: '100vh', background: '#162232',
  borderLeft: '1px solid #1e3a4f', padding: 24,
  display: 'flex', flexDirection: 'column', overflowY: 'auto',
}
