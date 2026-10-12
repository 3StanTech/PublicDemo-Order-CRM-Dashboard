import { initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore'

/*
 * Firebase web config is public by design: it identifies the project, it does
 * not grant access. Access is enforced by Firestore rules (owner-only data under
 * an anonymous ID) and App Check. Each value can be overridden with a
 * `VITE_FIREBASE_*` variable, for example to point a fork at its own project.
 */
const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyBv8bZyykSv_eVmdne3o48ByOjI-hpQyD0',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'cafe-oms-demo.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'cafe-oms-demo',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'cafe-oms-demo.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '673088137399',
  appId: env.VITE_FIREBASE_APP_ID || '1:673088137399:web:2e9269935a636c380e4532',
}

/** reCAPTCHA Enterprise site key used by App Check (public, domain-restricted). */
const appCheckSiteKey: string = env.VITE_FIREBASE_APPCHECK_SITE_KEY || '6Lcb1-otAAAAAJBS6aL5CS3-LPnOgy5wjyi_a8iN'

declare global {
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined
}

export type FirebaseServices = { app: FirebaseApp; auth: Auth; db: Firestore }

let services: FirebaseServices | null = null
let signIn: Promise<string> | null = null

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
}

/** Initializes Firebase once: App Check, Auth and Firestore with a persistent local cache. */
export function getFirebase(): FirebaseServices {
  if (services) return services

  // On localhost, App Check uses a debug token (registered in the console)
  // instead of reCAPTCHA. `VITE_APPCHECK_DEBUG=true` prints a new one.
  const debugToken: string | undefined = env.VITE_APPCHECK_DEBUG
  if (debugToken && typeof location !== 'undefined' && isLocalHost(location.hostname)) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === 'true' ? true : debugToken
  }

  const app = initializeApp(firebaseConfig)
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
  const auth = getAuth(app)
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  })
  services = { app, auth, db }
  return services
}

/**
 * Resolves the visitor's anonymous user ID, signing in at most once. The ID is
 * kept by Auth's local persistence, so a returning visitor sees their changes.
 */
export function signInVisitor(): Promise<string> {
  if (signIn) return signIn
  const { auth } = getFirebase()
  signIn = (async () => {
    await auth.authStateReady()
    if (auth.currentUser) return auth.currentUser.uid
    const credential = await signInAnonymously(auth)
    return credential.user.uid
  })()
  // A failed attempt can be retried (for example after going back online).
  signIn.catch(() => { signIn = null })
  return signIn
}
