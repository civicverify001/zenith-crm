import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '../../../hooks/usePermissions'
import {
  fetchShipmentsByCustomer,
  SHIPMENT_STATUS_CONFIG,
  SHIPMENT_TYPE_LABELS,
  type Shipment,
} from '../../../services/shipmentService'

// ============================================================
// SHIPMENTS TAB — Customer detail page tab
// Shows all shipments for a customer, upcoming + history
// ============================================================

export default function ShipmentsTab({ customerId }: { customerId: string }) {
  const { can } = usePermissions()

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ['customer_shipments', customerId],
    queryFn: () => fetchShipmentsByCustomer(customerId),
    enabled: !!customerId,
  })

  // Split into active vs past
  const activeStatuses = ['pending', 'label_created', 'shipped', 'in_transit']
  const active = shipments.filter(s => activeStatuses.includes(s.status))
  const past = shipments.filter(s => !activeStatuses.includes(s.status))

  if (isLoading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading shipments...</div>
  }

  return (
    <div style={{ padding: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <StatCard label="Active" value={active.length} color="#3b82f6" />
        <StatCard label="Pending" value={shipments.filter(s => s.status === 'pending').length} color="#f59e0b" />
        <StatCard label="Delivered" value={shipments.filter(s => s.status === 'delivered').length} color="#10b981" />
        <StatCard label="Total" value={shipments.length} color="#94a3b8" />
      </div>

      {/* Active shipments */}
      {active.length > 0 && (
        <Section title="Active Shipments" color="#3b82f6">
          {active.map(s => <ShipmentCard key={s.id} shipment={s} />)}
        </Section>
      )}

      {active.length === 0 && (
        <div style={{
          padding: 24, textAlign: 'center', color: '#64748b',
          background: '#162232', borderRadius: 12, border: '1px solid #1e3a4f',
        }}>
          No active shipments
        </div>
      )}

      {/* Past shipments */}
      {past.length > 0 && (
        <Section title="Past Shipments" color="#64748b">
          {past.map(s => <ShipmentCard key={s.id} shipment={s} dimmed />)}
        </Section>
      )}
    </div>
  )
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10,
      padding: '12px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        color, marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function ShipmentCard({ shipment, dimmed }: { shipment: Shipment; dimmed?: boolean }) {
  const config = SHIPMENT_STATUS_CONFIG[shipment.status] || { label: shipment.status, color: '#64748b', bgColor: '#64748b20', icon: '📦' }

  return (
    <div style={{
      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12,
      padding: '14px 18px', opacity: dimmed ? 0.55 : 1,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      flexWrap: 'wrap',
    }}>
      {/* Left: product + type */}
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
          {shipment.product_name || 'No product'}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          {SHIPMENT_TYPE_LABELS[shipment.type] || shipment.type}
          {shipment.source === 'cron_fulfillment' && (
            <span style={{ marginLeft: 6, color: '#0d7ea3' }}>• Auto</span>
          )}
        </div>
      </div>

      {/* Middle: dates */}
      <div style={{ textAlign: 'center', minWidth: 120 }}>
        {shipment.scheduled_date && (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Scheduled: {new Date(shipment.scheduled_date + 'T00:00:00').toLocaleDateString()}
          </div>
        )}
        {shipment.shipped_date && (
          <div style={{ fontSize: 12, color: '#3b82f6' }}>
            Shipped: {new Date(shipment.shipped_date + 'T00:00:00').toLocaleDateString()}
          </div>
        )}
        {shipment.delivered_date && (
          <div style={{ fontSize: 12, color: '#10b981' }}>
            Delivered: {new Date(shipment.delivered_date + 'T00:00:00').toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Right: tracking + status */}
      <div style={{ textAlign: 'right', minWidth: 120 }}>
        <span style={{
          display: 'inline-block', padding: '3px 10px', borderRadius: 20,
          fontSize: 11, fontWeight: 700,
          color: config.color, background: config.bgColor,
          border: `1px solid ${config.color}30`,
        }}>
          {config.icon} {config.label}
        </span>
        {shipment.tracking_number && (
          <div style={{ fontSize: 11, color: '#3b82f6', fontFamily: 'monospace', marginTop: 4 }}>
            {shipment.tracking_number}
          </div>
        )}
      </div>
    </div>
  )
}
