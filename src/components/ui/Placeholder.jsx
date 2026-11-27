/** A quiet empty state for a panel: a short title, a line or two of help, optional actions. */
export default function Placeholder({ title, children, actions }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-5">
      {title && <div className="text-[13px] font-semibold" style={{ color: 'rgb(var(--g-100))' }}>{title}</div>}
      <div className="text-[12px] leading-relaxed" style={{ color: 'rgb(var(--g-500))' }}>{children}</div>
      {actions && <div className="flex flex-wrap gap-2 mt-2">{actions}</div>}
    </div>
  )
}
