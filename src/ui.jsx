/** Join class names, skipping falsy values. */
export const cn = (...parts) => parts.filter(Boolean).join(' ')

export function Loading() {
  return (
    <div className="state-center">
      <div className="spinner" />
      <p className="text-muted">Loading…</p>
    </div>
  )
}

export function Page({ children, className, style }) {
  return (
    <main className={cn('page', className)} style={style}>
      {children}
    </main>
  )
}

export function PageHeader({ title, meta }) {
  return (
    <div className="page-header">
      <h2 className="page-title">{title}</h2>
      {meta && <span className="page-meta">{meta}</span>}
    </div>
  )
}
