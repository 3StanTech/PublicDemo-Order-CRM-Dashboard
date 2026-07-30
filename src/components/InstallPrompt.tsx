import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isIosInstallCandidate() {
  const userAgent = window.navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && window.navigator.maxTouchPoints > 1)
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches === true || ('standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  return isIos && !isStandalone
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [showIosGuidance, setShowIosGuidance] = useState(false)

  useEffect(() => {
    setShowIosGuidance(isIosInstallCandidate())
    const capturePrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', capturePrompt)
    return () => window.removeEventListener('beforeinstallprompt', capturePrompt)
  }, [])

  if (dismissed || (!deferredPrompt && !showIosGuidance)) return null

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  return (
    <aside aria-label="Install app" className="motion-fade-up fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md rounded-2xl border border-[#4F74C8]/25 bg-white/95 p-3 pr-11 text-sm text-[#20242F] shadow-lg backdrop-blur">
      <button aria-label="Dismiss install hint" className="absolute right-2 top-2 rounded-lg px-2 py-1 text-lg leading-none text-[#4A5365] transition-colors duration-200 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#4F74C8]" onClick={() => setDismissed(true)} type="button">×</button>
      {deferredPrompt ? (
        <>
          <p className="font-semibold">Install this dashboard for quicker access.</p>
          <button className="mt-2 rounded-lg bg-[#4F74C8] px-3 py-1.5 text-xs font-bold text-white transition duration-200 hover:bg-[#365AA9] active:scale-95 motion-safe:transition-transform" onClick={() => void install()} type="button">Install app</button>
        </>
      ) : (
        <p><span className="font-semibold">Add to Home Screen:</span> tap Share, then “Add to Home Screen”.</p>
      )}
    </aside>
  )
}
