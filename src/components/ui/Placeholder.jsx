import Icon from './Icon.jsx'

/** Centred, intentional empty state for a panel. */
export default function Placeholder({ icon, title, children, actions }) {
  return (
    <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center gap-3 px-6 py-10">
      {icon && (
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgb(var(--a-600) / 0.1)', color: 'rgb(var(--a-600))' }}>
          <Icon name={icon} size={22} />
        </div>
      )}
      {title && <div className="text-sm font-semibold" style={{ color: 'rgb(var(--g-100))' }}>{title}</div>}
      <div className="text-xs leading-relaxed max-w-[240px]" style={{ color: 'rgb(var(--g-400))' }}>{children}</div>
      {actions && <div className="flex flex-wrap justify-center gap-2 mt-1">{actions}</div>}
    </div>
  )
}

