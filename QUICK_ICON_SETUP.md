# ⚡ Quick Icon Setup - 2 Minutes

## 📋 Copy-Paste Checklist

Save your 4 uploaded images to: `d:\MalikTech\mtk-alert-pro\apps\mobile\assets\`

### File Naming Guide:

```
Image 1 (Splash Screen)    →  splash-icon.png
Image 2 (App Icon)         →  icon.png
Image 3 (App Icon)         →  adaptive-icon.png
Image 4 (App Icon)         →  favicon.png
```

### Quick Setup:
```bash
# 1. Navigate to assets folder
cd d:\MalikTech\mtk-alert-pro\apps\mobile\assets

# 2. Save your uploaded images here with the names above

# 3. Copy icon for notification
copy icon.png notification-icon.png

# 4. Verify everything
cd ..
pnpm run verify-assets
```

### Expected Result:
```
✅ icon.png                   - Main app icon
✅ splash-icon.png            - Splash screen
✅ adaptive-icon.png          - Android adaptive icon
✅ favicon.png                - Web favicon
✅ notification-icon.png      - Push notification icon

✅ All required assets are present!
```

## 🚀 Test It
```bash
# See splash screen
pnpm dev
local test 
cd "d:\MalikTech\mtk-alert-pro\apps\mobile" && npx expo start --tunnel

# Build APK with app icon
eas build -p android --profile preview
```

---

**That's it!** 🎉

Full guide: `docs/SETUP_APP_ICONS.md`
