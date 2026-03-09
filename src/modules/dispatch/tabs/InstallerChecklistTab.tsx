import { useJobChecklist, useCompleteChecklistItem, useUncompleteChecklistItem, useVerifyChecklistItem } from '../useJobs'
import { CHECKLIST_SECTION_LABELS } from '../dispatch.types'
import type { JobChecklistItem, ChecklistSection } from '../dispatch.types'

interface Props {
  jobId: string
}

function groupBySection(items: JobChecklistItem[]): Record<ChecklistSection, JobChecklistItem[]> {
  const grouped: Record<string, JobChecklistItem[]> = {}
  for (const item of items) {
    if (!grouped[item.section]) grouped[item.section] = []
    grouped[item.section].push(item)
  }
  return grouped as Record<ChecklistSection, JobChecklistItem[]>
}

export function InstallerChecklistTab({ jobId }: Props) {
  const { data: items, isLoading } = useJobChecklist(jobId)
  const { mutateAsync: completeItem } = useCompleteChecklistItem()
  const { mutateAsync: uncompleteItem } = useUncompleteChecklistItem()
  const { mutateAsync: verifyItem } = useVerifyChecklistItem()

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading checklist...</p>
  if (!items?.length) return <p className="text-sm text-muted text-center py-8">No checklist items for this job.</p>

  const sections = groupBySection(items as JobChecklistItem[])
  const totalRequired = (items as JobChecklistItem[]).filter(i => i.is_required).length
  const completedRequired = (items as JobChecklistItem[]).filter(i => i.is_required && i.completed).length
  const pct = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0

  async function toggleItem(item: JobChecklistItem) {
    if (item.completed) {
      await uncompleteItem({ itemId: item.id, jobId })
    } else {
      await completeItem({ itemId: item.id, jobId })
    }
  }

  async function handleVerify(item: JobChecklistItem) {
    await verifyItem({ itemId: item.id, jobId })
  }

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-muted mb-1.5">
          <span>{completedRequired}/{totalRequired} required items</span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div className="h-2 bg-surface rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      {Object.entries(sections).map(([section, sectionItems]) => (
        <div key={section}>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-2 border-b border-border pb-1">
            {CHECKLIST_SECTION_LABELS[section as ChecklistSection] || section}
          </h4>
          <div className="space-y-1">
            {sectionItems.map(item => (
              <div
                key={item.id}
                className={`flex items-start gap-2.5 p-2 rounded-lg transition-colors ${
                  item.completed ? 'bg-green/5' : 'hover:bg-surface'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleItem(item)}
                  className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                    item.completed
                      ? 'bg-green border-green text-white'
                      : 'border-muted hover:border-accent'
                  }`}
                >
                  {item.completed && <span className="text-xs">✓</span>}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${item.completed ? 'text-muted line-through' : 'text-slate-200'}`}>
                    {item.item_text}
                    {item.is_required && !item.completed && (
                      <span className="text-red-400 text-xs ml-1">*</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.requires_photo && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        item.photo_url ? 'bg-green/10 text-green' : 'bg-amber/10 text-amber'
                      }`}>
                        📷 {item.photo_url ? 'Photo added' : 'Photo required'}
                      </span>
                    )}
                    {item.requires_tech_verification && (
                      item.tech_verified ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green/10 text-green">✅ Verified</span>
                      ) : (
                        <button
                          onClick={() => handleVerify(item)}
                          className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                        >
                          Verify
                        </button>
                      )
                    )}
                    {item.completed_at && (
                      <span className="text-xs text-muted">
                        {new Date(item.completed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
