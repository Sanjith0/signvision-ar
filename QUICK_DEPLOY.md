# 🚀 Quick Deploy Guide - SignVision AR

## Step 1: Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `signvision-ar` (or your choice)
3. Make it **Public** or **Private**
4. **DO NOT** initialize with README (we already have one)
5. Click **"Create repository"**

## Step 2: Push Code to GitHub

Copy the commands GitHub shows you, or use these:

```bash
cd /Users/sanjith/Downloads/SignVision1/SignVision-AR

# Add GitHub remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/signvision-ar.git

# Push to GitHub
git push -u origin main
```

**If you get an authentication error**, you may need to use a Personal Access Token:
- Go to GitHub Settings → Developer settings → Personal access tokens
- Generate new token with `repo` scope
- Use it as your password when pushing

## Step 3: Deploy to Vercel

### Option A: Via Vercel Dashboard (Easiest)

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click **"Add New"** → **"Project"**
4. **Import** your `signvision-ar` repository
5. Vercel will auto-detect the project settings
6. Add environment variable:
   - **Name**: `GEMINI_API_KEY`
   - **Value**: Your Google Gemini API key
7. Click **"Deploy"**
8. Wait 2-3 minutes ☕
9. **Done!** Your app is live!

### Option B: Via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
cd /Users/sanjith/Downloads/SignVision1/SignVision-AR
vercel

# Follow prompts:
# - Link to existing project? No
# - Project name? signvision-ar
# - Directory? ./
# - Override settings? No

# Add environment variable
vercel env add GEMINI_API_KEY
# Paste your API key when prompted

# Deploy to production
vercel --prod
```

## Step 4: Test Your Deployment

1. Open the Vercel URL (e.g., `signvision-ar.vercel.app`)
2. Allow camera permissions
3. Wait for **"✅ Real-time AR Ready!"** message
4. Click **Start** button
5. Point camera at objects
6. Watch labels **stick** to objects as you move!

## 🎯 Expected Behavior

- **First 2-3 seconds**: Model loads, button grayed out
- **After loading**: Button becomes clickable
- **Detection**: Labels appear on objects
- **Camera movement**: Labels stay stuck to objects (AR tracking!)
- **Out of view**: Labels persist for 2 seconds

## ⚡ Performance Tips

### If detection is slow:
- Check your internet connection
- Ensure good lighting
- Gemini API processes in ~200-500ms

### If labels are jumpy:
- Ensure smooth camera movement
- Check device motion permissions (iOS: Settings → Safari)
- Try adjusting `smoothingFactor` in `script.js` (lower = smoother)

### If objects aren't tracking:
- Ensure clear, distinct objects
- Good lighting conditions
- Stable camera movement

## 🔧 Advanced Configuration

Edit `script.js` to customize:

```javascript
// Speed vs accuracy tradeoff
processingInterval: 150,  // Lower = faster but more API calls

// Tracking sensitivity
trackingThreshold: 0.15,  // Lower = more lenient matching
smoothingFactor: 0.25,    // Lower = smoother but laggier

// Persistence
maxTrackingAge: 2000,     // How long to keep labels (ms)
maxMissedFrames: 10,      // Frames to predict without detection
```

## 📱 Mobile Testing

1. Open Vercel URL on your phone
2. **iOS**: Safari only (Chrome doesn't support camera well)
3. **Android**: Chrome or Firefox
4. Allow camera + motion permissions
5. Hold phone steady while detecting

## 🐛 Common Issues

### "Connection error"
- ✅ Check `GEMINI_API_KEY` is set in Vercel
- ✅ Verify API key is valid
- ✅ Check Vercel function logs

### "Camera not available"
- ✅ Must use HTTPS (Vercel provides this)
- ✅ Grant camera permissions
- ✅ Try different browser

### "Model load failed"
- ✅ Not applicable (we use Gemini backend now)
- ✅ Check network connection

### Labels not sticking
- ✅ Check device motion permissions
- ✅ Ensure smooth camera movement
- ✅ Try on mobile device (better sensors)

## 🎓 Understanding the Tech

### Why is this fast?
- 6.6 FPS detection (every 150ms)
- Small images (512x384)
- Low quality (40%) = fast upload
- Gemini AI processes quickly

### Why do labels stick?
- **Object tracking** matches detections across frames
- **Motion prediction** using velocity
- **Camera compensation** using gyroscope
- **Smoothing** for stable positioning

### Why Gemini backend?
- No model download needed
- Works on any device
- High-quality detections
- Easy to deploy

## 📊 Monitoring

### Vercel Dashboard
- View deployment status
- Check function logs
- Monitor usage/performance

### Browser Console
- See detection times
- Track object IDs
- Debug issues

## 🔄 Making Updates

After making code changes:

```bash
cd /Users/sanjith/Downloads/SignVision1/SignVision-AR
git add -A
git commit -m "Your update message"
git push origin main
```

Vercel will **auto-deploy** in ~2 minutes! 🚀

## 🎉 Success!

You now have a **production-grade AR object tracking app** deployed to the world! 🌍✨

**Share your URL**: `https://your-project.vercel.app`

---

Need help? Check the main README.md or create an issue on GitHub!

