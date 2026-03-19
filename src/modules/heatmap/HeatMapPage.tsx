// src/modules/heatmap/HeatMapPage.tsx
// Gap 21 — Location Heat Map
// Plots leads (yellow) + customers (green) + lost leads (red) on Google Maps
// Admin only

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const MAPS_KEY    = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''
const INDY_CENTER = { lat: 39.7684, lng: -86.1581 }

interface MapPoint {
  id: string
  name: string
  address: string
  type: 'lead' | 'customer' | 'lost'
  stage?: string
  lifecycle?: string
  phone?: string
  lat?: number
  lng?: number
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address || !MAPS_KEY) return null
  try {
    const res  = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${MAPS_KEY}`
    )
    const data = await res.json()
    if (data.status === 'OK' && data.results[0]) {
      return data.results[0].geometry.location
    }
  } catch { /* silent */ }
  return null
}

function loadGoogleMaps(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.maps) { resolve(); return }
    const existing = document.getElementById('gmaps-script')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const script   = document.createElement('script')
    script.id      = 'gmaps-script'
    script.src     = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`
    script.async   = true
    script.onload  = () => resolve()
    script.onerror = () => reject(new Error('Google Maps failed to load'))
    document.head.appendChild(script)
  })
}

export default function HeatMapPage() {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const gmap      = useRef<any>(null)
  const markersR  = useRef<any[]>([])
  const infoWin   = useRef<any>(null)

  const [points,    setPoints]    = useState<MapPoint[]>([])
  const [loading,   setLoading]   = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [total,     setTotal]     = useState(0)
  const [mapReady,  setMapReady]  = useState(false)
  const [mapError,  setMapError]  = useState<string | null>(null)

  const [showLeads,     setShowLeads]     = useState(true)
  const [showCustomers, setShowCustomers] = useState(true)
  const [showLost,      setShowLost]      = useState(false)

  // ── Fetch data ──────────────────────────────────────────────────
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const all: MapPoint[] = []

      try {
        const { data } = await supabase
          .from('leads')
          .select('id, full_name, phone, address, city, state, zip_code, stage')
          .not('stage', 'in', '(lost,dnd,won)')
          .not('address', 'is', null)
          .limit(400)
        for (const l of data || []) {
          const addr = [l.address, l.city, l.state, l.zip_code].filter(Boolean).join(', ')
          if (addr) all.push({ id: l.id, name: l.full_name, address: addr, type: 'lead', stage: l.stage, phone: l.phone })
        }
      } catch { /* skip */ }

      try {
        const { data } = await supabase
          .from('leads')
          .select('id, full_name, phone, address, city, state, zip_code, stage')
          .in('stage', ['lost', 'dnd'])
          .not('address', 'is', null)
          .limit(200)
        for (const l of data || []) {
          const addr = [l.address, l.city, l.state, l.zip_code].filter(Boolean).join(', ')
          if (addr) all.push({ id: l.id, name: l.full_name, address: addr, type: 'lost', stage: l.stage, phone: l.phone })
        }
      } catch { /* skip */ }

      try {
        const { data } = await supabase
          .from('customers')
          .select('id, full_name, phone, address, city, state, zip, lifecycle_status')
          .limit(400)
        for (const c of data || []) {
          const addr = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ') || c.address
          if (addr) {
            all.push({
              id: c.id,
              name: c.full_name,
              address: addr,
              type: 'customer',
              lifecycle: c.lifecycle_status,
              phone: c.phone,
            })
          }
        }
      } catch { /* skip */ }

      setPoints(all)
      setTotal(all.length)
      setLoading(false)
    }
    fetchData()
  }, [])

  // ── Geocode addresses ───────────────────────────────────────────
  useEffect(() => {
    if (loading || points.length === 0) return
    setGeocoding(true)
    let done = 0

    async function runGeocode() {
      const updated = [...points]
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].lat) { done++; setProgress(done); continue }
        const coords = await geocodeAddress(updated[i].address)
        if (coords) updated[i] = { ...updated[i], ...coords }
        done++
        setProgress(done)
        if (i % 10 === 9) await new Promise(r => setTimeout(r, 150))
      }
      setPoints([...updated])
      setGeocoding(false)
    }
    runGeocode()
  }, [loading])

  // ── Init Google Map ─────────────────────────────────────────────
  useEffect(() => {
    if (!MAPS_KEY) { setMapError('VITE_GOOGLE_MAPS_KEY not set in Vercel env vars'); return }
    loadGoogleMaps()
      .then(() => setMapReady(true))
      .catch(() => setMapError('Failed to load Google Maps. Verify API key.'))
  }, [])

  useEffect(() => {
    if (!mapReady || !mapDivRef.current || gmap.current) return
    const G = (window as any).google.maps
    gmap.current = new G.Map(mapDivRef.current, {
      center: INDY_CENTER,
      zoom: 11,
      mapTypeId: 'roadmap',
      styles: [
        { elementType: 'geometry',            stylers: [{ color: '#162232' }] },
        { elementType: 'labels.text.stroke',  stylers: [{ color: '#0f1923' }] },
        { elementType: 'labels.text.fill',    stylers: [{ color: '#64748b' }] },
        { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
        { featureType: 'road',                elementType: 'geometry',        stylers: [{ color: '#1e3a4f' }] },
        { featureType: 'road',                elementType: 'geometry.stroke', stylers: [{ color: '#0d1a26' }] },
        { featureType: 'road.highway',        elementType: 'geometry',        stylers: [{ color: '#253d5a' }] },
        { featureType: 'road.highway',        elementType: 'labels.text.fill',stylers: [{ color: '#60a5fa' }] },
        { featureType: 'water',               elementType: 'geometry',        stylers: [{ color: '#0d1520' }] },
        { featureType: 'poi',                 stylers: [{ visibility: 'off' }] },
        { featureType: 'transit',             stylers: [{ visibility: 'off' }] },
      ],
    })
    infoWin.current = new G.InfoWindow()
  }, [mapReady])

  // ── Place / refresh markers ─────────────────────────────────────
  useEffect(() => {
    if (!gmap.current) return
    const G = (window as any).google?.maps
    if (!G) return

    for (const m of markersR.current) m.setMap(null)
    markersR.current = []

    const visible = points.filter(p => {
      if (!p.lat || !p.lng) return false
      if (p.type === 'lead'     && !showLeads)     return false
      if (p.type === 'customer' && !showCustomers) return false
      if (p.type === 'lost'     && !showLost)      return false
      return true
    })

    for (const pt of visible) {
      const color = pt.type === 'customer' ? '#4ade80' : pt.type === 'lost' ? '#f87171' : '#fbbf24'

      const marker = new G.Marker({
        position: { lat: pt.lat!, lng: pt.lng! },
        map: gmap.current,
        title: pt.name,
        icon: {
          path: G.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: '#0f1923',
          strokeWeight: 1.5,
        },
      })

      marker.addListener('click', () => {
        const typeLabel =
          pt.type === 'customer' ? '✅ Customer' :
          pt.type === 'lost'     ? '❌ Lost/DND' : '🔵 Active Lead'
        const stageStr = pt.stage
          ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px;">Stage: ${pt.stage.replace(/_/g,' ')}</div>`
          : ''
        const lifecycleStr = pt.lifecycle
          ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px;">Status: ${pt.lifecycle.replace(/_/g,' ')}</div>`
          : ''
        const phoneStr = pt.phone
          ? `<div style="margin-top:6px;"><a href="tel:${pt.phone}" style="color:#0d7ea3;font-size:12px;">${pt.phone}</a></div>`
          : ''
        infoWin.current.setContent(`
          <div style="background:#162232;border:1px solid #1e3a4f;border-radius:10px;padding:12px 14px;min-width:180px;font-family:Arial,sans-serif;">
            <div style="font-weight:700;font-size:13px;color:#e2e8f0;margin-bottom:4px;">${pt.name}</div>
            <div style="font-size:11px;font-weight:700;color:${color};">${typeLabel}</div>
            ${stageStr}${lifecycleStr}
            <div style="font-size:11px;color:#475569;margin-top:6px;line-height:1.4;">${pt.address}</div>
            ${phoneStr}
          </div>
        `)
        infoWin.current.open(gmap.current, marker)
      })

      markersR.current.push(marker)
    }
  }, [points, showLeads, showCustomers, showLost, mapReady])

  const plotted       = points.filter(p => p.lat && p.lng)
  const leadCount     = plotted.filter(p => p.type === 'lead').length
  const customerCount = plotted.filter(p => p.type === 'customer').length
  const lostCount     = plotted.filter(p => p.type === 'lost').length

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>Location Map</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 0 }}>
            Leads, customers, and lost contacts plotted across Indianapolis
          </p>
        </div>
        {geocoding && (
          <div style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 10, padding: '8px 16px', fontSize: 12, color: '#60a5fa' }}>
            Geocoding addresses… {progress}/{total}
            <div style={{ height: 3, background: 'rgba(96,165,250,0.15)', borderRadius: 4, marginTop: 6, width: 140 }}>
              <div style={{ height: 3, background: '#60a5fa', borderRadius: 4, width: `${total ? (progress / total) * 100 : 0}%`, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { label: `🔵 Active Leads (${leadCount})`,  active: showLeads,     toggle: () => setShowLeads(v => !v),     color: '#fbbf24' },
          { label: `✅ Customers (${customerCount})`,  active: showCustomers, toggle: () => setShowCustomers(v => !v), color: '#4ade80' },
          { label: `❌ Lost / DND (${lostCount})`,     active: showLost,      toggle: () => setShowLost(v => !v),      color: '#f87171' },
        ].map(f => (
          <button key={f.label} onClick={f.toggle}
            style={{
              padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${f.active ? f.color + '50' : 'rgba(255,255,255,0.06)'}`,
              background: f.active ? `${f.color}18` : 'rgba(255,255,255,0.03)',
              color: f.active ? f.color : '#64748b',
              transition: 'all 0.15s',
            }}>
            {f.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#334155' }}>
          {plotted.length} of {total} addresses plotted
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 560, borderRadius: 16, overflow: 'hidden', border: '1px solid #1e3a4f', position: 'relative', background: '#162232' }}>
        {mapError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <div style={{ background: '#0f1923', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 14, padding: '24px 32px', textAlign: 'center', maxWidth: 400 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
              <div style={{ color: '#f87171', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Map Error</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>{mapError}</div>
            </div>
          </div>
        )}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: '#162232' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
              <div style={{ color: '#64748b', fontSize: 14 }}>Loading addresses…</div>
            </div>
          </div>
        )}
        <div ref={mapDivRef} style={{ width: '100%', height: '100%', minHeight: 560 }} />
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
        {[
          { color: '#fbbf24', label: 'Active Lead' },
          { color: '#4ade80', label: 'Customer' },
          { color: '#f87171', label: 'Lost / DND' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, boxShadow: `0 0 6px ${l.color}60` }} />
            <span style={{ fontSize: 12, color: '#64748b' }}>{l.label}</span>
          </div>
        ))}
        <span style={{ fontSize: 12, color: '#334155', marginLeft: 'auto' }}>Click any pin for details</span>
      </div>
    </div>
  )
}
