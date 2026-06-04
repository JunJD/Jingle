# macOS Dev Preview Install Guide

Jingle macOS dev preview builds are for invited testers. They may be unsigned or not notarized until the public release pipeline has a paid Apple Developer ID certificate and notarization enabled.

## Install

1. Open the downloaded `.dmg`.
2. Drag `Jingle.app` to `Applications`.
3. Open `Jingle` from `Applications`.

## If macOS Blocks the First Launch

Gatekeeper may show a warning that Apple cannot verify Jingle. This is expected for unsigned or unnotarized development builds.

1. Click `Done` in the warning.
2. Open `System Settings > Privacy & Security`.
3. Find the Jingle warning and click `Open Anyway`.
4. Confirm `Open` when macOS asks again.

The `Open Anyway` button appears only after you have tried to open the app.

For trusted internal builds, testers who are comfortable with Terminal can remove the download quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Jingle.app
open /Applications/Jingle.app
```

Do not use this command for apps from unknown sources.

## Release Notes Snippet

````md
### macOS dev preview

This macOS build is a development preview for invited testers and may not be notarized yet. If macOS says Apple cannot verify Jingle, click Done, then open System Settings > Privacy & Security and choose Open Anyway for Jingle.

Terminal fallback for trusted test builds:

```bash
xattr -dr com.apple.quarantine /Applications/Jingle.app
open /Applications/Jingle.app
```
````

## DMG Background Asset

The DMG installer background lives at `resources/dmg/background.svg`. Regenerate the PNG assets after editing the SVG:

```bash
rsvg-convert --width 760 --height 560 --format png --output resources/dmg/background.png resources/dmg/background.svg
rsvg-convert --width 1520 --height 1120 --format png --output resources/dmg/background@2x.png resources/dmg/background.svg
```
