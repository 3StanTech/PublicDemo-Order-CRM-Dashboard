import { storageMode } from '../data/adapter'

/** Where the visitor's changes live: this browser (local build) or an anonymous Firebase demo ID. */
const bannerText = storageMode() === 'local'
  ? 'Public demo — sample data only, stored on this device.'
  : 'Public demo — sample data only, saved anonymously.'

export function DemoBanner() {
  return (
    <aside className="motion-fade-in fixed inset-x-0 top-0 z-30 mx-auto w-full max-w-3xl border-b border-[#4F74C8]/25 bg-[#4F74C8] px-4 py-2 text-center text-xs font-bold text-white shadow-sm" role="status">
      {bannerText}
    </aside>
  )
}
