interface Props {
  title: string
  message: string
  confirmLabel?: string
  confirmVariant?: 'danger' | 'warning' | 'primary'
  onConfirm: () => void
  onCancel: () => void
  isPending?: boolean
}

const VARIANT_CLASSES = {
  danger: 'bg-red-500 hover:bg-red-400',
  warning: 'bg-amber-500 hover:bg-amber-400',
  primary: 'bg-accent hover:bg-sky-400',
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
  isPending = false,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-muted mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-sm text-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`flex-1 py-2 ${VARIANT_CLASSES[confirmVariant]} disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors`}
          >
            {isPending ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
