# SignVision AR 🚀

**Real-time AI-powered AR object detection app** - No backend required!

Built with **TensorFlow.js** + **COCO-SSD** for instant object detection running entirely in your browser.

## 🌟 Features

- ✅ **Pure Client-Side** - No servers, no APIs, works offline!
- ⚡ **Real-time Detection** - 10+ FPS with local AI processing
- 🎯 **Advanced AR Tracking** - Labels stick to objects in 3D space (Google Lens style)
- 📱 **Mobile Optimized** - Works on iOS and Android
- 🔊 **Voice Feedback** - Audio alerts for important detections
- 📹 **Dashcam Mode** - Record video with detections
- 🌐 **PWA** - Install as native app, works offline
- 🚶 **Fall Detection** - Emergency pause and recording

## 🚀 Quick Start

### Option 1: Local Development

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/SignVision-AR.git
cd SignVision-AR

# Serve with any HTTP server
python3 -m http.server 8080
# OR
npx serve
# OR
php -S localhost:8080
```

Open `http://localhost:8080` in your browser!

### Option 2: Deploy to Static Hosting

Deploy to **ANY** static hosting service for FREE:

#### Vercel (Recommended)
```bash
npm install -g vercel
cd SignVision-AR
vercel
```

Or use the [Vercel Dashboard](https://vercel.com/new) - just drag and drop!

#### Netlify
```bash
npm install -g netlify-cli
cd SignVision-AR
netlify deploy --prod
```

Or use [Netlify Drop](https://app.netlify.com/drop) - drag and drop!

#### GitHub Pages
```bash
# Push to GitHub
git push origin main

# Enable GitHub Pages in repo settings
# Set source to 'main' branch, '/' folder
```

#### Cloudflare Pages
1. Go to [Cloudflare Pages](https://pages.cloudflare.com/)
2. Connect your GitHub repo
3. Deploy!

## 📱 Mobile Usage

1. **iOS**: Safari → Share → Add to Home Screen
2. **Android**: Chrome → Menu → Add to Home Screen

The app works as a native AR experience!

## 🎮 Controls

- **▶ Start** - Begin real-time detection
- **⏸ Pause** - Pause detection
- **● Record** - Start/stop dashcam recording
- **⚙️ Settings** - Configure voice, sensitivity, etc.

## 🧠 How It Works

1. **Camera Access** - Uses rear camera for environment scanning
2. **TensorFlow.js** - Loads COCO-SSD model (~13MB, cached after first load)
3. **Real-time Detection** - Processes video frames at 10+ FPS
4. **AR Tracking** - Tracks objects across frames using:
   - Intersection over Union (IoU) matching
   - Motion prediction with Kalman-like filtering
   - Camera motion compensation via device sensors
   - Exponential smoothing for stable labels
5. **Visual Overlay** - Draws bounding boxes that "stick" to objects

## 🎯 Detected Objects

Currently detects **80 common objects** including:
- 🚗 Vehicles (cars, trucks, buses, motorcycles, bicycles)
- 🚶 People and pedestrians
- 🚦 Traffic lights and stop signs
- 🐕 Animals (dogs, cats, birds)
- 🎒 Common objects (backpacks, umbrellas, etc.)

## 🔧 Technical Stack

- **Frontend**: Vanilla JavaScript (no frameworks!)
- **AI Model**: TensorFlow.js + COCO-SSD
- **AR Tracking**: Custom object tracking with motion prediction
- **Camera**: WebRTC getUserMedia API
- **Audio**: Web Speech Synthesis API
- **Storage**: IndexedDB for recordings
- **PWA**: Service Worker for offline support

## 📊 Performance

- **Model Size**: ~13 MB (downloaded once, cached forever)
- **Load Time**: ~2-3 seconds (first visit), instant after
- **FPS**: 10-30 FPS depending on device
- **Latency**: <100ms per frame (all processing local!)

## 🔒 Privacy

- **100% Local** - All AI processing happens in your browser
- **No Data Sent** - No servers, no tracking, no data collection
- **Offline Capable** - Works without internet after first load
- **Camera Only** - Only uses camera for real-time detection

## 🛠️ Configuration

Edit `script.js` to customize:

```javascript
config: {
    processingInterval: 100, // ms between detections
    minConfidence: 0.25,     // Detection threshold
    maxTrackingAge: 2000,    // How long labels persist (ms)
    smoothingFactor: 0.25    // Label stability (lower = smoother)
}
```

## 🐛 Troubleshooting

**Model not loading?**
- Ensure you have internet connection for first load
- Check browser console for errors
- Try clearing cache and refreshing

**Camera not working?**
- Allow camera permissions
- Use HTTPS (required for camera access)
- Check if camera is in use by another app

**Slow performance?**
- Close other tabs/apps
- Increase `processingInterval` in settings
- Use Chrome/Safari for best performance

**Labels not sticking?**
- Enable device motion sensors (Settings → Motion & Orientation)
- Keep device steady during initial detection

## 📄 License

MIT License - Free to use and modify!

## 🤝 Contributing

Pull requests welcome! Please:
1. Test on both iOS and Android
2. Maintain <100ms frame processing time
3. Keep the app lightweight (no heavy dependencies)

## 🎯 Roadmap

- [ ] Custom traffic sign model (YOLO-based)
- [ ] Multiple object tracking IDs on screen
- [ ] Distance estimation using camera calibration
- [ ] Audio navigation assistance
- [ ] Offline maps integration
- [ ] Custom model training interface

## 💡 Credits

Built with:
- [TensorFlow.js](https://www.tensorflow.org/js)
- [COCO-SSD Model](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd)
- Love for accessible technology ❤️

---

**Made for accessibility.** Empowering visually impaired users with real-time AR object detection.

🌟 Star this repo if you find it useful!
