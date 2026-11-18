# DropPutt Android apps

Three Android apps built from the same web code in `../frontend` (see SPEC §65), wrapped with
[Capacitor](https://capacitorjs.com):

| App | Folder | Package id | Plugins | Distribution |
|---|---|---|---|---|
| Customer | `customer/` | `in.techkerala.dropputt` | push | Play Store |
| Vendor | `vendor/` | `in.techkerala.dropputt.vendor` | push | APK / Firebase App Distribution (not on Play) |
| Rider | `rider/` | `in.techkerala.dropputt.rider` | push, background location | APK / Firebase App Distribution (not on Play) |

The admin console stays web-only. Each folder has its own `android/` Gradle project (committed) and
`capacitor.config.json`. The web build is copied into the app on every sync (not committed).

## One-time setup on your computer

1. **JDK 21** and **Android Studio** (it brings the Android SDK; install "Android SDK Platform 36").
2. `cd mobile && npm install`
3. **Firebase (push):** in the Firebase console add three Android apps to your project with the package ids
   above, download each `google-services.json` and put it at `mobile/<app>/android/app/google-services.json`
   (git-ignored). Without it the apps run, but push does nothing.
4. **Where the app finds the server.** The app runs from `https://localhost` inside the phone, so it must be told
   the real server. Create `frontend/.env.customer.local`, `.env.vendor.local`, `.env.rider.local` with:
   ```
   VITE_API_ORIGIN=https://kizhissery.techkerala.in
   VITE_DEFAULT_FRANCHISE_SLUG=kizhissery
   ```
5. **Server CORS:** add `https://localhost` to `CORS_ORIGINS` in the backend's environment (it is the origin the
   apps call from; sockets use the same list). Not needed in development, where any origin is allowed.

## Build and run

```bash
npm run sync:rider        # builds the rider web app and copies it into the Android project
npm run open:rider        # opens Android Studio; press Run (phone with USB debugging, or an emulator)
```

Same for `customer` and `vendor`. After changing icons run `./brand-android.sh <app>` (needs ImageMagick).

## Release (APK / bundle)

In Android Studio: Build > Generate Signed Bundle / APK. Create a keystore once and **keep it safe, forever**
(losing it means you cannot update the app). Keep it out of git (`*.jks` is ignored).
Vendor and rider: send the APK, or upload to Firebase App Distribution. Customer: upload the `.aab` to the Play Console.

## What is native

* **Push (all three):** Firebase Cloud Messaging through `@capacitor/push-notifications`. The app creates the
  channels `order_alerts` (loud, for new orders) and `order_updates`, matching what the server sends
  (`backend/src/utils/push.js`). Tapping a notification opens the screen named in `data.web_path`.
* **Rider location with the screen off:** `@capacitor-community/background-geolocation` runs an Android
  foreground service ("DropPutt Rider: sharing your location for the delivery in progress") while a delivery
  is in progress. The rider must allow location "all the time" when asked.
* The sign-in gate and 180-day sessions are server side (SPEC §65): a rider cannot sign in to the vendor app.

## Not done yet

* Secure token storage (tokens live in the app's private WebView storage today).
* Per-app icons and colours (all three share the DropPutt cube for now), Play Store listing material.
* iOS (needs a Mac or cloud Mac build, an Apple Developer account, and APNs set up in Firebase).
* A signed build was not produced here: this machine has no JDK or Android SDK.
