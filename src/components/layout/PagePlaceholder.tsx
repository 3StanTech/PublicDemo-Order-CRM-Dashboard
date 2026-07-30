type PagePlaceholderProps = { title: string; description: string }

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <section aria-labelledby="page-title" className="space-y-5">
      <div className="inline-flex rounded-full bg-[#4F74C8]/10 px-3 py-1 text-xs font-bold tracking-wide text-[#365aa9]">ORDER DASHBOARD</div>
      <div>
        <h1 id="page-title" className="text-3xl font-bold tracking-tight text-[#20242F]">{title}</h1>
        <p className="mt-2 max-w-md text-base leading-6 text-[#4A5365]">{description}</p>
      </div>
      <div className="rounded-2xl border border-[#4F74C8]/20 bg-white/55 p-5 shadow-sm">
        <p className="font-semibold text-[#4F74C8]">Ready for the next build unit</p>
        <p className="mt-1 text-sm leading-5 text-[#4A5365]">All monetary values will use Philippine pesos and deterministic pricing.</p>
      </div>
    </section>
  )
}
