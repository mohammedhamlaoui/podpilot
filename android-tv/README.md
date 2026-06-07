# PodPilot Android TV

This is an installable Android TV wrapper for `https://podpilot.space/`.

It is intentionally separate from the browser extension and upload automation code. It does not modify the extension or any ad blocker-related behavior.

## Compatibility

- Minimum Android version: Android 5.0, API 21.
- Target devices: Android TV and Smart TV devices that support Android WebView.
- Very old Android 4.x TV browsers are not guaranteed because modern HTTPS/TLS and WebView support can be missing or outdated.

## Build

Open the `android-tv` folder in Android Studio and build the `app` module.

The local machine must have:

- Android Studio or Gradle
- JDK 17
- Android SDK platform 34

The debug APK will be generated under:

`android-tv/app/build/outputs/apk/debug/`
