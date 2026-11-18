import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Metric({
  icon,
  color,
  title,
  value,
  unit,
  note,
}: {
  icon: ReactNode
  color: string
  title: string
  value: string
  unit: string
  note: string
}) {
  return (
    <article className="metric">
      <div className={`metric-icon ${color}`}>{icon}</div>
      <div>
        <h3>{title}</h3>
        <div className="metric-value">
          {value}
          <span>{unit}</span>
        </div>
        <p>{note}</p>
      </div>
    </article>
  )
}
export function Modal({
  title,
  children,
  onClose,
  busy,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    const dialog = ref.current
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      className="modal"
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭窗口" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
