// src/lib/discountPolicy.ts
// Zenith Sales Discount Policy v1.2
// Discount category is driven by products.discount_category (set in Admin Settings)
// NOT hardcoded SKU lists — add new products via the product catalog, set category there

export type DiscountCategory = 'softener' | 'filtration' | 'ro' | 'addon_5pct' | 'zero' | 'standard'

const ZERO_DISCOUNT_ITEM_TYPES = new Set([
  'install_fee', 'service_plan', 'maintenance',
])

export interface QuoteTier {
  tier: 0 | 1 | 2 | 3
  maxCoreDiscount: number
  categories: DiscountCategory[]
  label: string
  color: string
}

export interface LineItemForPolicy {
  sku?: string | null
  item_type?: string
  discount_category?: DiscountCategory | null
}

export function calcQuoteTier(lineItems: LineItemForPolicy[]): QuoteTier {
  const cats = new Set<DiscountCategory>()
  for (const li of lineItems) {
    if (li.item_type && ZERO_DISCOUNT_ITEM_TYPES.has(li.item_type)) continue
    const cat = li.discount_category
    if (cat === 'softener' || cat === 'filtration' || cat === 'ro') cats.add(cat)
  }
  const categories = Array.from(cats)
  const hasSoftener = cats.has('softener')
  const hasFiltr    = cats.has('filtration')
  const hasRO       = cats.has('ro')
  const count       = categories.length

  if (count >= 3 && hasSoftener && hasFiltr && hasRO)
    return { tier: 3, maxCoreDiscount: 20, categories, label: 'Tier 3 — Bundle (20% max)', color: '#4ade80' }
  if (count === 2)
    return { tier: 2, maxCoreDiscount: 10, categories, label: 'Tier 2 — Dual (10% max)', color: '#22d3ee' }
  if (count === 1)
    return { tier: 1, maxCoreDiscount: 5,  categories, label: 'Tier 1 — Single (5% max)', color: '#f59e0b' }
  return { tier: 0, maxCoreDiscount: 0, categories, label: 'No qualifying hardware', color: '#64748b' }
}

export interface DiscountResult {
  allowed: number
  blocked: boolean
  capped: boolean
  message: string
}

export function getLineDiscountLimit(
  lineItem: LineItemForPolicy,
  commercialType: string,
  quoteTier: QuoteTier,
  isAdmin: boolean,
): DiscountResult {
  if (commercialType === 'rental' && lineItem.item_type === 'product')
    return { allowed: 0, blocked: true, capped: false, message: 'Rental lines cannot be discounted — fixed contract pricing' }

  if (lineItem.item_type && ZERO_DISCOUNT_ITEM_TYPES.has(lineItem.item_type))
    return { allowed: 0, blocked: true, capped: false, message: 'Install fees and service plans cannot be discounted' }

  const cat = lineItem.discount_category || 'standard'

  if (cat === 'zero')
    return { allowed: 0, blocked: true, capped: false, message: 'This product cannot be discounted (policy: zero-discount item)' }

  if (cat === 'addon_5pct')
    return { allowed: 5, blocked: false, capped: true, message: 'Hard cap: 5% max — add-on SKU does not inherit bundle tier' }

  if (cat === 'softener' || cat === 'filtration' || cat === 'ro') {
    const max = quoteTier.maxCoreDiscount || 5
    return { allowed: max, blocked: false, capped: false, message: quoteTier.label }
  }

  const max = Math.max(quoteTier.maxCoreDiscount, 5)
  const repMax = isAdmin ? max : Math.min(max, 5)
  return { allowed: repMax, blocked: false, capped: false, message: `Max ${repMax}% on this line` }
}

export function getTierBadge(tier: QuoteTier) {
  if (tier.tier === 0) return null
  return { label: tier.label, color: tier.color }
}
