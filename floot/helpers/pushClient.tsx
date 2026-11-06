import { VAPID_PUBLIC_KEY } from "./_publicConfigs";
import { postPushSubscribe } from "../endpoints/push/subscribe_POST.schema";
import { postPushUnsubscribe } from "../endpoints/push/unsubscribe_POST.schema";

export const SHOW_NOTIFICATIONS_WHILE_APP_OPEN = true;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type NativePushSubscription =
  | { fcmToken: string; platform: string }
  | { apnsToken: string; platform: string };

type NativeNotification = {
  id?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
};

type NativePluginEvent = NativeNotification & {
  token?: string;
  value?: string;
  error?: unknown;
  actionId?: string;
  inputValue?: string;
  notification?: NativeNotification;
};

type NativeListenerHandle = { remove: () => Promise<void> | void };
type NativeListenerResult = NativeListenerHandle | Promise<NativeListenerHandle>;

function removeNativeListeners(handles: NativeListenerResult[]): void {
  handles.forEach((handle) => {
    Promise.resolve(handle)
      .then((resolved) => {
        if (resolved && typeof resolved.remove === "function") {
          return resolved.remove();
        }
      })
      .catch(() => {});
  });
}

type CapacitorFirebaseMessaging = {
  requestPermissions: () => Promise<{ receive: string }>;
  getToken: () => Promise<{ token: string }>;
  deleteToken?: () => Promise<void>;
  removeAllDeliveredNotifications?: () => Promise<void>;
  addListener: (
    event: string,
    cb: (data: NativePluginEvent) => void,
  ) => NativeListenerResult;
};

function getFirebaseMessaging(): CapacitorFirebaseMessaging | null {
  const cap = (globalThis as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: { FirebaseMessaging?: CapacitorFirebaseMessaging };
    };
  }).Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
  return (cap.Plugins && cap.Plugins.FirebaseMessaging) || null;
}

type CapacitorPushNotifications = {
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  unregister?: () => Promise<void>;
  removeAllDeliveredNotifications?: () => Promise<void>;
  addListener: (
    event: string,
    cb: (data: NativePluginEvent) => void,
  ) => NativeListenerResult;
};

function getPushNotifications(): CapacitorPushNotifications | null {
  const cap = (globalThis as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: { PushNotifications?: CapacitorPushNotifications };
    };
  }).Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
  return (cap.Plugins && cap.Plugins.PushNotifications) || null;
}

function getNativePlatform(): string {
  const cap = (globalThis as unknown as {
    Capacitor?: { getPlatform?: () => string };
  }).Capacitor;
  return cap && cap.getPlatform ? cap.getPlatform() : "unknown";
}

function subscribeNative(
  fm: CapacitorFirebaseMessaging,
): Promise<NativePushSubscription | null> {
  return new Promise((resolve) => {
    let settled = false;
    const handles: NativeListenerResult[] = [];
    const finish = (value: NativePushSubscription | null) => {
      if (settled) return;
      settled = true;
      removeNativeListeners(handles);
      resolve(value);
    };
    const finishToken = (token: string | undefined) => {
      if (token) finish({ fcmToken: token, platform: getNativePlatform() });
    };
    handles.push(
      fm.addListener("tokenReceived", (data) => finishToken(data && data.token)),
    );
    const tryGetToken = (attempt: number) => {
      fm.getToken()
        .then((result) => finishToken(result && result.token))
        .catch(() => {
          if (attempt < 5 && !settled) {
            setTimeout(() => tryGetToken(attempt + 1), 2000);
          }
        });
    };
    fm.requestPermissions()
      .then((permission) => {
        if (permission.receive !== "granted") {
          finish(null);
          return;
        }
        tryGetToken(0);
      })
      .catch(() => finish(null));
    setTimeout(() => finish(null), 20000);
  });
}

function subscribeNativeApns(
  pn: CapacitorPushNotifications,
): Promise<NativePushSubscription | null> {
  return new Promise((resolve) => {
    let settled = false;
    let attempts = 0;
    const handles: NativeListenerResult[] = [];
    const finish = (value: NativePushSubscription | null) => {
      if (settled) return;
      settled = true;
      removeNativeListeners(handles);
      resolve(value);
    };
    handles.push(
      pn.addListener("registration", (data) => {
        if (data && data.value) {
          finish({ apnsToken: data.value, platform: getNativePlatform() });
        }
      }),
    );
    handles.push(
      pn.addListener("registrationError", () => {
        if (settled) return;
        attempts += 1;
        if (attempts < 5) {
          setTimeout(() => {
            pn.register().catch(() => finish(null));
          }, 2000);
        } else {
          finish(null);
        }
      }),
    );
    pn.requestPermissions()
      .then((permission) => {
        if (permission.receive !== "granted") {
          finish(null);
          return;
        }
        return pn.register().catch(() => finish(null));
      })
      .catch(() => finish(null));
    setTimeout(() => finish(null), 20000);
  });
}

export async function subscribeToPush(): Promise<
  PushSubscriptionJSON | NativePushSubscription | null
> {
  const firebaseMessaging = getFirebaseMessaging();
  if (firebaseMessaging) {
    return subscribeNative(firebaseMessaging);
  }
  const pushNotifications = getPushNotifications();
  if (pushNotifications) {
    return subscribeNativeApns(pushNotifications);
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.register("/floot-push-sw.js", {
    scope: "/floot-push-sdk/",
  });
  if ((await Notification.requestPermission()) !== "granted") return null;
  const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const existingKey = subscription.options?.applicationServerKey;
    const sameKey =
      !!existingKey &&
      new Uint8Array(existingKey).toString() === applicationServerKey.toString();
    if (!sameKey) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array(applicationServerKey).buffer,
    });
  }
  return subscription.toJSON();
}

const pushStateHandlers = new Set<(enabled: boolean) => void>();

function emitPushState(enabled: boolean): void {
  pushStateHandlers.forEach((handler) => handler(enabled));
}

export function onPushEnabledChange(
  handler: (enabled: boolean) => void,
): () => void {
  pushStateHandlers.add(handler);
  return () => {
    pushStateHandlers.delete(handler);
  };
}

const PUSH_OPT_IN_KEY = "floot-push-opt-in";
const PUSH_IDENTITY_KEY = "floot-push-identity";

function readPushLocal(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePushLocal(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function subscriptionIdentity(
  sub: PushSubscriptionJSON | NativePushSubscription,
): string | null {
  return (
    (sub as PushSubscriptionJSON).endpoint ||
    (sub as { fcmToken?: string }).fcmToken ||
    (sub as { apnsToken?: string }).apnsToken ||
    null
  );
}

function isPushOptedIn(): boolean {
  return readPushLocal(PUSH_OPT_IN_KEY) === "1";
}

export async function enablePush(): Promise<void> {
  const subscription = await subscribeToPush();
  if (!subscription) return;

  const identity = subscriptionIdentity(subscription);
  const previousIdentity = readPushLocal(PUSH_IDENTITY_KEY);
  // Save the new subscription to the server, keyed by its identity. Pass the
  // previous identity along so the endpoint can clean up a rotated one too.
  try {
    await postPushSubscribe({
      subscription: subscription as unknown as Record<string, unknown>,
      previousIdentity: previousIdentity && previousIdentity !== identity ? previousIdentity : null,
    });
  } catch {
    return;
  }

  writePushLocal(PUSH_IDENTITY_KEY, identity);
  writePushLocal(PUSH_OPT_IN_KEY, "1");
  emitPushState(true);
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const firebaseMessaging = getFirebaseMessaging();
  if (firebaseMessaging) {
    if (firebaseMessaging.deleteToken) {
      await firebaseMessaging.deleteToken().catch(() => {});
    }
    return true;
  }
  const pushNotifications = getPushNotifications();
  if (pushNotifications) {
    if (pushNotifications.unregister) {
      await pushNotifications.unregister().catch(() => {});
    }
    return true;
  }
  const registration = await navigator.serviceWorker.getRegistration("/floot-push-sdk/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  return subscription.unsubscribe();
}

export async function disablePush(): Promise<void> {
  const identity = readPushLocal(PUSH_IDENTITY_KEY);
  await unsubscribeFromPush();

  if (identity) {
    try {
      await postPushUnsubscribe({ identity });
    } catch {
      // best-effort — local opt-out still proceeds below
    }
  }

  writePushLocal(PUSH_OPT_IN_KEY, null);
  writePushLocal(PUSH_IDENTITY_KEY, null);
  emitPushState(false);
}

// Sets the app-icon badge on THIS device to the user's total unread count
// (0 clears it). Call it when the app opens or resumes and after marking
// things read. The user's OTHER devices are brought in line by the server: a
// badge sync, sendPushNotifications(subs, { badgeCount }) with no title.
// - Web (installed PWA): sets the number directly.
// - Native: there is no local badge API. At 0 the delivered notifications are
//   cleared, which removes the Android dot; the iOS number is set by the
//   server's badge sync, so include this device's subscription in it.
export async function setBadgeCount(count: number): Promise<void> {
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const native = getFirebaseMessaging() ?? getPushNotifications();
  if (native) {
    if (total === 0 && native.removeAllDeliveredNotifications) {
      await native.removeAllDeliveredNotifications().catch(() => {});
    }
    return;
  }
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (total > 0 && nav.setAppBadge) await nav.setAppBadge(total);
    else if (total === 0 && nav.clearAppBadge) await nav.clearAppBadge();
  } catch {
    return;
  }
}

// This device's push identity: the key its subscription is stored under (the
// web endpoint, or the native token), or null when push is off here. Send it
// with every request that changes the unread count, and pass it to the
// server's badge sync as fromDevice: this device sets its own badge
// (setBadgeCount), so it is not sent the web notice.
export async function getPushIdentity(): Promise<string | null> {
  if (getFirebaseMessaging() ?? getPushNotifications()) {
    return readPushLocal(PUSH_IDENTITY_KEY);
  }
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration("/floot-push-sdk/");
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? subscription.endpoint : null;
  } catch {
    return null;
  }
}

export type PushMessagePayload = {
  title?: string;
  body?: string;
  url?: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
  showWhenFocused?: boolean;
  badgeCount?: number;
  actions?: { action: string; title: string; icon?: string; url?: string }[];
};

const pushMessageHandlers = new Set<(payload: PushMessagePayload) => void>();

function dispatchPushMessage(payload: PushMessagePayload): void {
  pushMessageHandlers.forEach((handler) => {
    try {
      handler(payload);
    } catch {}
  });
}

function parseFlootData(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof data.floot !== "string") return {};
  try {
    return JSON.parse(data.floot) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function nativeNotificationToPayload(
  notification: NativeNotification,
): PushMessagePayload {
  const data = notification.data ?? {};
  const payload: PushMessagePayload = { data: parseFlootData(data) };
  if (typeof notification.title === "string") payload.title = notification.title;
  if (typeof notification.body === "string") payload.body = notification.body;
  if (typeof data.url === "string") payload.url = data.url;
  return payload;
}

// A badge sync (sendPushNotifications with a badgeCount and no title) only
// moves the app-icon badge. It is not a message, so it never reaches
// onPushMessage handlers.
function isNativeBadgeSync(notification: NativeNotification): boolean {
  return !!notification.data && notification.data.flootBadgeSync === "1";
}

function handleNativeNotificationReceived(event: NativePluginEvent): void {
  const notification = (event && (event.notification || event)) || {};
  if (isNativeBadgeSync(notification)) return;
  dispatchPushMessage(nativeNotificationToPayload(notification));
}

let pushMessageConsumptionReady = false;
function setupPushMessageConsumption(): void {
  if (pushMessageConsumptionReady) return;
  pushMessageConsumptionReady = true;
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === "floot-push") {
        if (data.payload && data.payload.badgeSync === true) return;
        dispatchPushMessage((data.payload ?? {}) as PushMessagePayload);
      }
    });
  }
  const firebaseMessaging = getFirebaseMessaging();
  if (firebaseMessaging) {
    firebaseMessaging.addListener(
      "notificationReceived",
      handleNativeNotificationReceived,
    );
  }
  const pushNotifications = getPushNotifications();
  if (pushNotifications) {
    pushNotifications.addListener(
      "pushNotificationReceived",
      handleNativeNotificationReceived,
    );
  }
}

// Fires whenever a push arrives while at least one app window is open. Use it to
// present the notification in-app (toast, badge, live refresh) instead of / on
// top of the OS banner. `showWhenFocused: false` on the sent payload asks the
// service worker to skip the OS banner while the app is focused — BEST-EFFORT
// ONLY: current Apple OSes (iOS/macOS 18.4+) can render the banner at the
// system level without running the service worker, so there the flag cannot
// suppress it and this handler may not fire for that push. The reliable
// "don't alert me for what I'm already reading" behavior is to not SEND the
// push to actively-reading recipients (server-side presence + deferred
// read re-check — see the push skill).
// Returns a cleanup function that removes the listener.
export function onPushMessage(
  handler: (payload: PushMessagePayload) => void,
): () => void {
  setupPushMessageConsumption();
  pushMessageHandlers.add(handler);
  return () => {
    pushMessageHandlers.delete(handler);
  };
}

export type NotificationClickEvent = {
  // The clicked action button's id, or "" when the notification body was clicked.
  action: string;
  // The resolved target url (action url, or the payload's url), or null if none.
  url: string | null;
  // The payload's `data` object.
  data: Record<string, unknown>;
};

// Notification-click delivery (managed by Floot — do not edit). A tap can arrive
// when no page is alive: on mobile the "closed" PWA is killed, and the relaunch
// starts at start_url, not the notification url. The service worker persists
// every click to IndexedDB; the page drains it here on load / resume and routes
// it through the same handlers, so clicks survive a cold start.
const PENDING_CLICK_DB = "floot-push";
const PENDING_CLICK_STORE = "clicks";
const PENDING_CLICK_TTL_MS = 2 * 60 * 1000;

type PendingClick = {
  id: string;
  ts: number;
  action: string;
  url: string | null;
  data: Record<string, unknown>;
};

function openPushDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(PENDING_CLICK_DB, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(PENDING_CLICK_STORE, { keyPath: "id" });
        } catch {
          /* store may already exist */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Read AND clear all pending clicks in one transaction, so a click is delivered
// exactly once even if several triggers (SW poke, visibilitychange, pageshow) or
// tabs race to drain it — IndexedDB serializes readwrite transactions per store.
function drainPendingClicks(): Promise<PendingClick[]> {
  return openPushDb().then((db) => {
    if (!db) return [];
    return new Promise<PendingClick[]>((resolve) => {
      let out: PendingClick[] = [];
      try {
        const tx = db.transaction(PENDING_CLICK_STORE, "readwrite");
        const store = tx.objectStore(PENDING_CLICK_STORE);
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          out = (getAll.result as PendingClick[]) || [];
          store.clear();
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  });
}

const clickHandlers = new Set<(event: NotificationClickEvent) => void>();

// Native (FCM) tap delivery: the plugin retains the launching tap until a
// listener consumes it, so an in-memory queue is enough for cold starts.
const pendingNativeClicks: NotificationClickEvent[] = [];

function handleNativeNotificationClick(event: {
  actionId?: string;
  notification?: { data?: Record<string, unknown> };
}): void {
  const data = event.notification?.data ?? {};
  const click: NotificationClickEvent = {
    action: !event.actionId || event.actionId === "tap" ? "" : event.actionId,
    url: typeof data.url === "string" ? data.url : null,
    data: parseFlootData(data),
  };
  if (clickHandlers.size > 0) {
    dispatchClick(click);
  } else {
    pendingNativeClicks.push(click);
  }
  if (click.url) {
    window.location.assign(click.url);
  }
}

function dispatchClick(event: NotificationClickEvent): void {
  clickHandlers.forEach((handler) => {
    try {
      handler(event);
    } catch {
      /* one throwing handler must not drop the others */
    }
  });
}

async function consumePendingClicks(): Promise<void> {
  // Nothing registered yet (e.g. this fired at cold start before the app mounted
  // its handler) — leave the clicks in the store; registering a handler drains them.
  if (clickHandlers.size === 0) return;
  const now = Date.now();
  const entries = await drainPendingClicks();
  for (const entry of entries) {
    // Skip stale clicks so a resume long after the tap doesn't yank the user around.
    if (typeof entry.ts === "number" && now - entry.ts > PENDING_CLICK_TTL_MS) {
      continue;
    }
    dispatchClick({
      action: entry.action || "",
      url: entry.url ?? null,
      data: (entry.data ?? {}) as Record<string, unknown>,
    });
  }
}

let clickConsumptionReady = false;
function setupClickConsumption(): void {
  if (clickConsumptionReady) return;
  clickConsumptionReady = true;
  const firebaseMessaging = getFirebaseMessaging();
  if (firebaseMessaging) {
    firebaseMessaging.addListener(
      "notificationActionPerformed",
      handleNativeNotificationClick,
    );
  }
  const pushNotifications = getPushNotifications();
  if (pushNotifications) {
    pushNotifications.addListener(
      "pushNotificationActionPerformed",
      handleNativeNotificationClick,
    );
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "floot-notificationclick") return;
      // A poke from the current SW carries an id and has already persisted the
      // click to IndexedDB — drain from there so the id keeps delivery exact.
      // A poke from an OLDER SW (pre-persistence) has no id and wrote nothing to
      // IndexedDB, so route its inline payload directly as a fallback.
      if (typeof data.id === "string") {
        void consumePendingClicks();
      } else {
        dispatchClick({
          action: data.action ?? "",
          url: data.url ?? null,
          data: (data.data ?? {}) as Record<string, unknown>,
        });
      }
    });
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void consumePendingClicks();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", () => void consumePendingClicks());
  }
}

// Fires when the user clicks the notification (or an action button). Works
// whether the app was already open (delivered live) or was closed and relaunched
// by the tap (the click is replayed from IndexedDB once your handler is
// registered), so routing survives a cold start. Route in-app here (e.g.
// router.push); if you route here, omit url on the sent payload so the service
// worker doesn't also navigate. Returns a cleanup function.
export function onNotificationClick(
  handler: (event: NotificationClickEvent) => void,
): () => void {
  setupClickConsumption();
  clickHandlers.add(handler);
  // Drain anything the SW persisted before this handler existed (cold start).
  void consumePendingClicks();
  while (pendingNativeClicks.length > 0) {
    const pending = pendingNativeClicks.shift();
    if (pending) {
      dispatchClick(pending);
    }
  }
  return () => {
    clickHandlers.delete(handler);
  };
}

export function listenToPush(): () => void {
  // 1. A push arrived while the app is open.
  const offMessage = onPushMessage((payload) => {
    // ==== Add your in-app UI here (toast, badge, refresh, etc.) ====
  });

  // 2. The user clicked a notification while the app is open.
  const offClick = onNotificationClick((event) => {
    // ==== Add your click handling here (route, analytics, etc.) ====
  });

  return () => {
    offMessage();
    offClick();
  };
}

async function resyncPush(): Promise<void> {
  if (!isPushOptedIn()) return;
  if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
    return;
  }
  await enablePush();
}

(
  globalThis as unknown as {
    onPushSubscriptionChange?: (
      handler: (subscribed: boolean) => void,
    ) => () => void;
  }
).onPushSubscriptionChange?.((subscribed) => {
  if (!subscribed) void disablePush();
});

let pushResyncTimer: ReturnType<typeof setTimeout> | undefined;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    clearTimeout(pushResyncTimer);
    pushResyncTimer = setTimeout(() => void resyncPush(), 2000);
  });
}

void resyncPush();
