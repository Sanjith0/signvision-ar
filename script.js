/**
 * SignVision - Hybrid YOLO + Gemini AR Detection
 * 
 * Architecture:
 * 1. COCO-SSD (YOLO-like) - Fast local detection for instant AR overlays
 * 2. Gemini API - Background processing for accurate label refinement
 * 3. AR Tracking - Smooth, sticky labels in 3D space
 * 
 * Flow:
 * - COCO-SSD detects objects immediately → Shows AR overlays
 * - Gemini processes same frame in background → Refines labels
 * - Labels get upgraded when Gemini responds (but AR stays visible)
 */

// Global application state
const App = {
    // Video elements
    video: null,
    overlay: null,
    capture: null,
    
    // State management
    isRunning: false,
    isPaused: false,
    isRecording: false,
    modelLoaded: false,
    isProcessing: false,
    geminiProcessing: false,
    
    // Detection models
    cocoModel: null, // Fast local detection (YOLO-like)
    
    // Configuration
    config: {
        // API endpoint for Gemini (background refinement)
        apiEndpoint: (() => {
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                return 'http://localhost:8000/analyze';
            }
            return '/analyze';
        })(),
        processingInterval: 100, // ms between YOLO detections (10 FPS)
        geminiInterval: 2000, // ms between Gemini refinements (0.5 FPS)
        enableVoice: true,
        detectionSensitivity: 5,
        maxFPS: 30,
        recordDuration: 30000,
        minConfidence: 0.3 // COCO-SSD confidence threshold
    },
    
    // Timing and performance
    lastProcessTime: 0,
    lastGeminiTime: 0,
    frameCount: 0,
    fpsCounter: 0,
    lastFpsUpdate: 0,
    mediaStream: null,
    mediaRecorder: null,
    recordedChunks: [],
    
    // Speech and audio
    speechSynth: null,
    lastSpokenLabel: null,
    lastSpeechTime: 0,
    
    // Detection history
    lastDetections: [],
    deviceMotionData: null,
    
    // AR Object Tracking - labels stick to objects in 3D space
    trackedObjects: new Map(),
    nextObjectId: 0,
    trackingThreshold: 0.2,
    smoothingFactor: 0.3,
    maxTrackingAge: 2000,
    maxMissedFrames: 10,
    
    // Audio announcements for signs
    announcedLabels: new Set(),
    audioQueue: [],
    audioEnabled: false, // Requires user interaction to enable
    
    // Camera motion tracking
    gyroData: { alpha: 0, beta: 0, gamma: 0 },
    accelData: { x: 0, y: 0, z: 0 },
    lastGyro: null,
    lastAccel: null,
    cameraMotion: { dx: 0, dy: 0 },
    
    // Service references
    storage: null,
    
    async init() {
        console.log('🚀 SignVision Hybrid AR initializing...');
        console.log('📊 Architecture: COCO-SSD (fast) + Gemini (accurate)');
        
        // Get DOM elements
        this.video = document.getElementById('video');
        this.overlay = document.getElementById('overlay');
        this.capture = document.getElementById('capture');
        
        // Initialize Speech Synthesis API
        if ('speechSynthesis' in window) {
            this.speechSynth = window.speechSynthesis;
            console.log('🔊 Speech synthesis initialized');
        }
        
        // Initialize IndexedDB for dashcam storage
        this.initStorage();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup device motion sensors for camera tracking
        this.setupMotionSensors();
        
        // Request camera permission on load
        await this.requestCameraPermission();
        
        // Load COCO-SSD model for fast detection
        await this.loadDetectionModel();
        
        console.log('✅ SignVision Hybrid AR initialized');
    },
    
    /**
     * Load COCO-SSD model for fast local detection
     */
    async loadDetectionModel() {
        try {
            console.log('📦 Loading COCO-SSD for instant detection...');
            this.updateModelStatus('Loading Fast AI...');
            
            if (typeof tf === 'undefined') {
                throw new Error('TensorFlow.js not loaded');
            }
            
            if (typeof cocoSsd === 'undefined') {
                throw new Error('COCO-SSD not loaded');
            }
            
            // Load COCO-SSD with optimized base
            this.cocoModel = await cocoSsd.load({
                base: 'lite_mobilenet_v2'
            });
            
            this.modelLoaded = true;
            console.log('✅ COCO-SSD loaded! Instant detection ready.');
            console.log('🔄 Gemini will refine labels in background.');
            this.updateModelStatus('Hybrid AR Ready! 🚀');
            
            // Enable start button
            document.getElementById('start-btn').disabled = false;
            
            setTimeout(() => {
                const header = document.querySelector('.status-bar h1');
                if (header.textContent.includes('Hybrid AR Ready')) {
                    header.textContent = 'SignVision Hybrid';
                }
            }, 2000);
            
        } catch (error) {
            console.error('❌ Model load failed:', error);
            this.updateModelStatus('❌ Model load failed');
            this.showError('Failed to load AI model. Refresh to retry.');
        }
    },
    
    updateModelStatus(message) {
        const header = document.querySelector('.status-bar h1');
        header.textContent = message;
    },
    
    setupMotionSensors() {
        if (window.DeviceOrientationEvent) {
            window.addEventListener('deviceorientation', (e) => {
                const newGyro = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
                
                if (this.lastGyro) {
                    const dAlpha = newGyro.alpha - this.lastGyro.alpha;
                    const dBeta = newGyro.beta - this.lastGyro.beta;
                    const dGamma = newGyro.gamma - this.lastGyro.gamma;
                    
                    this.cameraMotion.dx = dGamma * 0.01;
                    this.cameraMotion.dy = dBeta * 0.01;
                }
                
                this.gyroData = newGyro;
                this.lastGyro = newGyro;
            });
        }
        
        if (window.DeviceMotionEvent) {
            window.addEventListener('devicemotion', (e) => {
                if (e.acceleration) {
                    this.accelData = {
                        x: e.acceleration.x || 0,
                        y: e.acceleration.y || 0,
                        z: e.acceleration.z || 0
                    };
                }
            });
        }
    },
    
    setupEventListeners() {
        document.getElementById('start-btn').addEventListener('click', () => this.startDetection());
        document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('record-btn').addEventListener('click', () => this.toggleRecording());
        document.getElementById('audioToggle').addEventListener('click', () => this.toggleAudio());
        document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
        document.getElementById('close-settings').addEventListener('click', () => this.closeSettings());
        
        document.getElementById('voice-toggle').addEventListener('change', (e) => {
            this.config.enableVoice = e.target.checked;
        });
        
        document.getElementById('sensitivity').addEventListener('input', (e) => {
            this.config.detectionSensitivity = e.target.value;
            document.getElementById('sensitivity-value').textContent = e.target.value;
        });
        
        document.getElementById('processing-interval').addEventListener('change', (e) => {
            this.config.processingInterval = parseInt(e.target.value);
        });
        
        if (window.DeviceMotionEvent) {
            window.addEventListener('devicemotion', (e) => {
                this.handleDeviceMotion(e);
            });
        }
    },
    
    async requestCameraPermission() {
        try {
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.mediaStream = stream;
            this.video.srcObject = stream;
            
            this.overlay.width = window.innerWidth;
            this.overlay.height = window.innerHeight;
            this.capture.width = 512;
            this.capture.height = 384;
            
            this.updateCameraStatus(true);
            console.log('📷 Camera access granted');
            
            this.video.addEventListener('loadedmetadata', () => {
                console.log(`📐 Video resolution: ${this.video.videoWidth}x${this.video.videoHeight}`);
            });
            
        } catch (error) {
            console.error('❌ Camera access denied:', error);
            this.showError('Camera access denied. Please allow camera permissions.');
            this.updateCameraStatus(false);
        }
    },
    
    async startDetection() {
        if (!this.modelLoaded) {
            this.showError('Model not loaded yet. Please wait...');
            return;
        }
        
        if (!this.video.srcObject) {
            await this.requestCameraPermission();
        }
        
        if (!this.video.srcObject) {
            this.showError('Camera not available');
            return;
        }
        
        this.isRunning = true;
        this.isPaused = false;
        
        document.getElementById('start-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;
        // Hide loading icon - don't show it
        document.getElementById('loading').style.display = 'none';
        
        this.detectionLoop();
        
        console.log('▶️ Hybrid detection started!');
        console.log('⚡ COCO-SSD: Instant AR overlays');
        console.log('🧠 Gemini: Background label refinement');
    },
    
    /**
     * Main detection loop - Fast COCO-SSD + Background Gemini
     */
    async detectionLoop() {
        if (!this.isRunning || this.isPaused) return;
        
        const now = Date.now();
        const elapsed = now - this.lastProcessTime;
        
        if (elapsed < this.config.processingInterval) {
            requestAnimationFrame(() => this.detectionLoop());
            return;
        }
        
        this.lastProcessTime = now;
        this.frameCount++;
        
        // Calculate FPS
        if (now - this.lastFpsUpdate > 1000) {
            this.fpsCounter = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            console.log(`⚡ FPS: ${this.fpsCounter} (COCO-SSD)`);
        }
        
        // FAST: Process with COCO-SSD (instant AR)
        if (!this.isProcessing && this.modelLoaded) {
            this.processFrameFast();
        }
        
        // SLOW: Refine with Gemini (background)
        const geminiElapsed = now - this.lastGeminiTime;
        if (geminiElapsed > this.config.geminiInterval && !this.geminiProcessing) {
            this.lastGeminiTime = now;
            this.refineLabelsWithGemini();
        }
        
        requestAnimationFrame(() => this.detectionLoop());
    },
    
    /**
     * Fast detection with COCO-SSD - Instant AR overlays
     */
    async processFrameFast() {
        try {
            this.isProcessing = true;
            this.updateConnectionStatus(true);
            
            const startTime = performance.now();
            
            // Run COCO-SSD detection
            const predictions = await this.cocoModel.detect(this.video, undefined, this.config.minConfidence);
            
            const processingTime = performance.now() - startTime;
            
            // Convert to our format and filter for traffic objects
            const detections = this.convertPredictionsToDetections(predictions);
            
            // Update AR tracking with fast detections
            if (detections.length > 0) {
                this.handleDetections(detections, 'fast');
            } else {
                this.handleDetections([], 'fast');
            }
            
            if (this.frameCount % 30 === 0) {
                console.log(`⚡ COCO-SSD: ${processingTime.toFixed(0)}ms, Objects: ${detections.length}`);
            }
            
        } catch (error) {
            console.error('Fast detection error:', error);
        } finally {
            this.isProcessing = false;
        }
    },
    
    /**
     * Refine labels with Gemini - Background processing
     */
    async refineLabelsWithGemini() {
        try {
            this.geminiProcessing = true;
            
            // Capture frame for Gemini
            const blob = await this.captureFrame();
            if (!blob) return;
            
            const startTime = performance.now();
            
            // Convert to base64
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
            const base64 = await base64Promise;
            
            // Call Gemini API
            const response = await fetch(this.config.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: base64.split(',')[1],
                    content_type: blob.type || 'image/webp'
                })
            });
            
            if (!response.ok) {
                throw new Error(`Gemini API error: ${response.status}`);
            }
            
            const data = await response.json();
            const processingTime = performance.now() - startTime;
            
            // Refine tracked objects with Gemini labels
            if (data.detections && data.detections.length > 0) {
                this.refineTrackedObjects(data.detections);
                console.log(`🧠 Gemini refined ${data.detections.length} labels in ${processingTime.toFixed(0)}ms`);
            }
            
        } catch (error) {
            console.warn('Gemini refinement failed (continuing with COCO-SSD):', error.message);
        } finally {
            this.geminiProcessing = false;
        }
    },
    
    /**
     * Capture current video frame
     */
    captureFrame() {
        return new Promise((resolve) => {
            const ctx = this.capture.getContext('2d');
            ctx.drawImage(this.video, 0, 0, this.capture.width, this.capture.height);
            this.capture.toBlob((blob) => resolve(blob), 'image/webp', 0.4);
        });
    },
    
    /**
     * Convert COCO-SSD predictions to detections (TRAFFIC SIGNS ONLY)
     * Aggressively filter out everything except traffic signs
     */
    convertPredictionsToDetections(predictions) {
        // Whitelist of ONLY traffic sign classes we want
        const ALLOWED_CLASSES = ['traffic light', 'stop sign'];
        
        const detections = predictions
            .filter(pred => ALLOWED_CLASSES.includes(pred.class)) // Only allow traffic signs
            .map(pred => {
                const mapping = this.mapCocoClassToLabel(pred.class);
                if (!mapping) return null;
                
                const bbox = [
                    pred.bbox[0] / this.video.videoWidth,
                    pred.bbox[1] / this.video.videoHeight,
                    pred.bbox[2] / this.video.videoWidth,
                    pred.bbox[3] / this.video.videoHeight
                ];
                
                return {
                    label: mapping.label,
                    bbox: bbox,
                    color: mapping.color,
                    confidence: pred.score,
                    source: 'coco' // Mark as COCO-SSD detection
                };
            })
            .filter(d => d !== null);
        
        // Add generic sign detector for pedestrian signals and other signs
        // that COCO-SSD can't detect
        const genericSigns = this.detectGenericSigns();
        return [...detections, ...genericSigns];
    },
    
    /**
     * Detect sign-shaped objects using edge/color detection
     * This catches pedestrian signals and other signs COCO-SSD misses
     */
    detectGenericSigns() {
        if (!this.canvas2d) {
            this.canvas2d = document.createElement('canvas');
            this.ctx2d = this.canvas2d.getContext('2d', { willReadFrequently: true });
        }
        
        // Use a smaller canvas for speed
        const targetWidth = 640;
        const targetHeight = 480;
        this.canvas2d.width = targetWidth;
        this.canvas2d.height = targetHeight;
        
        // Draw current video frame
        this.ctx2d.drawImage(this.video, 0, 0, targetWidth, targetHeight);
        const imageData = this.ctx2d.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;
        
        // Detect sign-colored regions
        const signs = [];
        const gridSize = 50; // Balance between speed and accuracy
        
        for (let y = 0; y < targetHeight - gridSize; y += gridSize) {
            for (let x = 0; x < targetWidth - gridSize; x += gridSize) {
                let brightPixels = 0;
                let redCount = 0;
                let greenCount = 0;
                let yellowCount = 0;
                let whiteCount = 0;
                let darkPixels = 0;
                
                // Sample pixels in this grid cell
                for (let dy = 0; dy < gridSize; dy += 5) {
                    for (let dx = 0; dx < gridSize; dx += 5) {
                        const i = ((y + dy) * targetWidth + (x + dx)) * 4;
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];
                        const brightness = (r + g + b) / 3;
                        
                        // Count pixels by type
                        if (brightness > 200) brightPixels++; // Very bright (white areas)
                        if (brightness < 60) darkPixels++; // Dark borders/symbols
                        
                        // Detect sign colors (more lenient)
                        if (r > 180 && g < 100 && b < 100) redCount++; // Red
                        if (g > 180 && r < 120 && g > b * 1.3) greenCount++; // Green  
                        if (r > 200 && g > 200 && b < 120) yellowCount++; // Yellow (warning signs)
                        if (r > 200 && g > 200 && b > 200) whiteCount++; // White (regulatory signs)
                    }
                }
                
                const totalSamples = (gridSize / 5) * (gridSize / 5);
                const brightRatio = brightPixels / totalSamples;
                const darkRatio = darkPixels / totalSamples;
                
                // Lower contrast requirement (signs have bright AND dark, but threshold was too high)
                const hasContrast = brightRatio > 0.15 && darkRatio > 0.08;
                
                // Detect if has sign colors (more lenient thresholds)
                const hasYellow = yellowCount > 8; // Yellow warning signs (was 15)
                const hasRedAndWhite = redCount > 5 && whiteCount > 12; // Red/white regulatory (was 8/20)
                const hasGreen = greenCount > 8; // Green walk signals (was 15)
                
                if (hasContrast && (hasYellow || hasRedAndWhite || hasGreen)) {
                    // Determine color
                    let color = 'yellow';
                    if (hasGreen) color = 'green';
                    else if (hasRedAndWhite) color = 'red';
                    
                    signs.push({
                        label: '🔍 Analyzing Sign...',
                        bbox: [
                            x / targetWidth,
                            y / targetHeight,
                            gridSize / targetWidth,
                            gridSize / targetHeight
                        ],
                        color: color,
                        confidence: 0.3,
                        source: 'generic',
                        hide: true  // Flag to hide from display
                    });
                }
            }
        }
        
        // Debug logging (every 30 frames)
        if (this.frameCount % 30 === 0 && signs.length > 0) {
            console.log(`🔍 Generic detector found ${signs.length} potential signs`);
        }
        
        // Merge overlapping detections and limit to top 10
        const merged = this.mergeOverlappingBoxes(signs);
        
        if (this.frameCount % 30 === 0 && merged.length > 0) {
            console.log(`✅ After merging: ${merged.length} signs`);
        }
        
        return merged.slice(0, 10); // Max 10 to prevent spam but allow multiple signs
    },
    
    /**
     * Merge overlapping bounding boxes
     */
    mergeOverlappingBoxes(boxes) {
        if (boxes.length === 0) return [];
        
        const merged = [];
        const used = new Set();
        
        for (let i = 0; i < boxes.length; i++) {
            if (used.has(i)) continue;
            
            let mergedBox = { ...boxes[i] };
            used.add(i);
            
            for (let j = i + 1; j < boxes.length; j++) {
                if (used.has(j)) continue;
                
                const iou = this.calculateIoU(boxes[i].bbox, boxes[j].bbox);
                if (iou > 0.3) {
                    // Merge boxes by taking the union
                    const [x1, y1, w1, h1] = mergedBox.bbox;
                    const [x2, y2, w2, h2] = boxes[j].bbox;
                    
                    const minX = Math.min(x1, x2);
                    const minY = Math.min(y1, y2);
                    const maxX = Math.max(x1 + w1, x2 + w2);
                    const maxY = Math.max(y1 + h1, y2 + h2);
                    
                    mergedBox.bbox = [minX, minY, maxX - minX, maxY - minY];
                    used.add(j);
                }
            }
            
            merged.push(mergedBox);
        }
        
        return merged;
    },
    
    /**
     * Map COCO classes to traffic signs ONLY
     * STRICT whitelist - only these 2 classes allowed
     */
    mapCocoClassToLabel(cocoClass) {
        // ONLY traffic signs - nothing else!
        const mappings = {
            'traffic light': { label: '🚦 Traffic Signal', color: 'yellow' },
            'stop sign': { label: '🛑 Stop Sign', color: 'red' }
        };
        
        return mappings[cocoClass] || null;
    },
    
    /**
     * Refine tracked objects with Gemini labels
     * Match by IoU and upgrade labels
     */
    refineTrackedObjects(geminiDetections) {
        console.log(`🧠 Gemini sent ${geminiDetections.length} detections`);
        
        geminiDetections.forEach(geminiDet => {
            console.log(`  - Label: "${geminiDet.label}", bbox: [${geminiDet.bbox.map(v => v.toFixed(2)).join(', ')}]`);
            
            // Find matching tracked object by position
            let bestMatch = null;
            let bestIoU = 0;
            
            this.trackedObjects.forEach(tracked => {
                const iou = this.calculateIoU(geminiDet.bbox, tracked.smoothedBbox);
                if (iou > bestIoU && iou > 0.3) {
                    bestMatch = tracked;
                    bestIoU = iou;
                }
            });
            
            // Upgrade label if match found
            if (bestMatch) {
                const oldLabel = bestMatch.label;
                bestMatch.label = geminiDet.label;
                bestMatch.color = geminiDet.color;
                bestMatch.geminiRefined = true;
                console.log(`  ✅ Upgraded existing object to: ${bestMatch.label}`);
                
                // Announce if this is a new label (not generic "Analyzing Sign...")
                if (oldLabel !== geminiDet.label && !geminiDet.label.includes('Analyzing')) {
                    this.announceSign(geminiDet.label);
                }
            } else {
                // If no match, create new tracked object from Gemini detection
                const id = this.nextObjectId++;
                this.trackedObjects.set(id, {
                    id: id,
                    label: geminiDet.label,
                    bbox: geminiDet.bbox,
                    smoothedBbox: geminiDet.bbox,
                    predictedBbox: geminiDet.bbox,
                    color: geminiDet.color,
                    confidence: geminiDet.confidence,
                    lastSeen: Date.now(),
                    velocity: [0, 0, 0, 0],
                    missedFrames: 0,
                    matched: true,
                    geminiRefined: true
                });
                console.log(`  ✨ Created new Gemini detection: ${geminiDet.label}`);
                
                // Announce new detection
                if (!geminiDet.label.includes('Analyzing')) {
                    this.announceSign(geminiDet.label);
                }
            }
        });
    },
    
    /**
     * Announce a sign label using speech synthesis
     */
    announceSign(label) {
        console.log(`🎤 announceSign called with: "${label}"`);
        
        // Check if audio is enabled
        if (!this.audioEnabled) {
            console.log(`   🔇 Audio disabled - click "Enable Audio" button`);
            return;
        }
        
        // Don't re-announce the same label within 10 seconds
        if (this.announcedLabels.has(label)) {
            console.log(`   ⏭️  Skipped (already announced recently)`);
            return;
        }
        
        this.announcedLabels.add(label);
        console.log(`   ✅ Added to announced set`);
        
        // Remove from announced set after 10 seconds
        setTimeout(() => {
            this.announcedLabels.delete(label);
            console.log(`   🔄 Cooldown expired for: "${label}"`);
        }, 10000);
        
        // Add to queue
        this.audioQueue.push(label);
        console.log(`   📝 Added to queue (queue length: ${this.audioQueue.length})`);
        
        // Process queue if not already processing
        if (this.audioQueue.length === 1) {
            console.log(`   ▶️  Starting audio queue processing`);
            this.processAudioQueue();
        }
    },
    
    /**
     * Toggle audio announcements
     */
    toggleAudio() {
        this.audioEnabled = !this.audioEnabled;
        const btn = document.getElementById('audioToggle');
        const icon = btn.querySelector('.icon');
        const text = btn.querySelector('span:not(.icon)');
        
        if (this.audioEnabled) {
            icon.textContent = '🔊';
            text.textContent = 'Audio On';
            btn.style.background = '#27ae60';
            console.log('🔊 Audio announcements ENABLED');
            
            // Prime the speech synthesis with a test utterance
            if ('speechSynthesis' in window) {
                const test = new SpeechSynthesisUtterance('Audio enabled');
                test.volume = 0.01; // Very quiet
                window.speechSynthesis.speak(test);
                console.log('   🎤 Speech synthesis primed');
            }
        } else {
            icon.textContent = '🔇';
            text.textContent = 'Enable Audio';
            btn.style.background = '#f39c12';
            console.log('🔇 Audio announcements DISABLED');
        }
    },
    
    /**
     * Process audio queue one by one
     */
    processAudioQueue() {
        console.log(`🎵 processAudioQueue called (queue length: ${this.audioQueue.length})`);
        
        if (this.audioQueue.length === 0) {
            console.log(`   ℹ️  Queue empty, stopping`);
            return;
        }
        
        const label = this.audioQueue[0];
        
        // Clean up label (remove emojis)
        let cleanLabel = label.replace(/[🚦🛑🔍✨⚠️]/g, '').trim();
        
        // Special handling for street names
        if (cleanLabel.startsWith('Street: ')) {
            cleanLabel = cleanLabel.replace('Street: ', 'You are on ');
            console.log(`   📍 Converted to: "${cleanLabel}"`);
        }
        
        console.log(`🔊 SPEAKING NOW: "${cleanLabel}"`);
        
        if ('speechSynthesis' in window) {
            console.log(`   ✅ speechSynthesis available`);
            console.log(`   📊 speechSynthesis.speaking: ${window.speechSynthesis.speaking}`);
            console.log(`   📊 speechSynthesis.pending: ${window.speechSynthesis.pending}`);
            
            const utterance = new SpeechSynthesisUtterance(cleanLabel);
            utterance.rate = 1.1;
            utterance.pitch = 1.0;
            utterance.volume = 1.0; // Max volume
            
            utterance.onstart = () => {
                console.log(`   ▶️  Speech STARTED: "${cleanLabel}"`);
            };
            
            utterance.onend = () => {
                console.log(`   ✅ Speech ENDED: "${cleanLabel}"`);
                // Remove from queue and process next
                this.audioQueue.shift();
                
                // Small delay between announcements
                setTimeout(() => {
                    this.processAudioQueue();
                }, 500);
            };
            
            utterance.onerror = (e) => {
                console.error(`   ❌ Speech ERROR:`, e);
                this.audioQueue.shift();
                this.processAudioQueue();
            };
            
            console.log(`   🎤 Calling speechSynthesis.speak()...`);
            window.speechSynthesis.speak(utterance);
            console.log(`   ✅ speechSynthesis.speak() called`);
        } else {
            console.warn(`   ❌ Speech synthesis NOT SUPPORTED in this browser`);
            this.audioQueue.shift();
        }
    },
    
    /**
     * Handle detections with AR tracking
     */
    handleDetections(detections, source) {
        this.lastDetections = detections;
        const currentTime = Date.now();
        
        // DEBUG: Log incoming detections
        if (detections.length > 0) {
            console.log(`📥 ${source} detections:`, detections.map(d => d.label));
        }
        
        // Update tracked objects
        this.updateTrackedObjects(detections, currentTime);
        
        // DEBUG: Log tracked objects
        console.log(`🎯 Tracked objects: ${this.trackedObjects.size}`);
        
        // Clear and redraw
        const ctx = this.overlay.getContext('2d');
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        
        // Draw all tracked objects
        let drawnCount = 0;
        this.trackedObjects.forEach(trackedObj => {
            // Skip "Analyzing" signs and hidden objects
            if (trackedObj.label.includes('Analyzing') || trackedObj.hide) {
                return;
            }
            
            let displayBbox = trackedObj.smoothedBbox;
            
            if (trackedObj.missedFrames > 0) {
                displayBbox = trackedObj.predictedBbox || trackedObj.smoothedBbox;
            }
            
            const detection = {
                label: trackedObj.label,
                bbox: displayBbox,
                color: trackedObj.color,
                confidence: trackedObj.confidence,
                isTracked: trackedObj.missedFrames > 0,
                geminiRefined: trackedObj.geminiRefined || false
            };
            this.drawDetection(ctx, detection);
            drawnCount++;
        });
        
        if (drawnCount > 0) {
            console.log(`🎨 Drew ${drawnCount} detections on overlay`);
        }
        
        // Audio feedback
        if (this.config.enableVoice && detections.length > 0) {
            this.generateAudioFeedback(detections);
        }
        
        // Update panel
        const displayDetections = Array.from(this.trackedObjects.values()).map(obj => ({
            label: obj.label,
            bbox: obj.smoothedBbox,
            color: obj.color,
            confidence: obj.confidence
        }));
        this.updateDetectionPanel(displayDetections);
    },
    
    /**
     * Update tracked objects with AR tracking
     */
    updateTrackedObjects(detections, currentTime) {
        // Predict positions
        this.trackedObjects.forEach(obj => {
            obj.matched = false;
            obj.missedFrames = (obj.missedFrames || 0) + 1;
            
            if (obj.velocity && obj.missedFrames <= this.maxMissedFrames) {
                obj.predictedBbox = [
                    obj.smoothedBbox[0] + obj.velocity[0] - this.cameraMotion.dx,
                    obj.smoothedBbox[1] + obj.velocity[1] - this.cameraMotion.dy,
                    obj.smoothedBbox[2] + obj.velocity[2] * 0.5,
                    obj.smoothedBbox[3] + obj.velocity[3] * 0.5
                ];
            } else {
                obj.predictedBbox = obj.smoothedBbox;
            }
        });
        
        // Match detections
        const unmatchedDetections = [];
        
        detections.forEach(detection => {
            if (detection.confidence < this.config.minConfidence) return;
            
            let bestMatch = null;
            let bestScore = 0;
            
            this.trackedObjects.forEach(trackedObj => {
                if (trackedObj.matched) return;
                
                const iouPredicted = this.calculateIoU(detection.bbox, trackedObj.predictedBbox);
                const iouCurrent = this.calculateIoU(detection.bbox, trackedObj.smoothedBbox);
                const iou = Math.max(iouPredicted, iouCurrent);
                
                const centerDist = this.calculateCenterDistance(detection.bbox, trackedObj.smoothedBbox);
                const score = iou * 0.7 + (1 / (1 + centerDist)) * 0.3;
                
                if (score > bestScore && (iou > this.trackingThreshold || centerDist < 0.3)) {
                    bestMatch = trackedObj;
                    bestScore = score;
                }
            });
            
            if (bestMatch) {
                // Update existing
                bestMatch.matched = true;
                bestMatch.missedFrames = 0;
                bestMatch.lastSeen = currentTime;
                bestMatch.confidence = detection.confidence;
                
                // Don't override Gemini-refined labels with COCO labels
                if (!bestMatch.geminiRefined) {
                    bestMatch.label = detection.label;
                    bestMatch.color = detection.color;
                }
                
                const newVelocity = this.calculateVelocity(bestMatch.bbox, detection.bbox);
                bestMatch.velocity = [
                    bestMatch.velocity[0] * 0.7 + newVelocity[0] * 0.3,
                    bestMatch.velocity[1] * 0.7 + newVelocity[1] * 0.3,
                    bestMatch.velocity[2] * 0.7 + newVelocity[2] * 0.3,
                    bestMatch.velocity[3] * 0.7 + newVelocity[3] * 0.3
                ];
                
                bestMatch.bbox = detection.bbox;
                
                const velocityMagnitude = Math.sqrt(newVelocity[0]**2 + newVelocity[1]**2);
                const adaptiveSmoothingFactor = Math.min(this.smoothingFactor + velocityMagnitude * 2, 0.6);
                
                bestMatch.smoothedBbox = this.smoothBoundingBox(
                    bestMatch.smoothedBbox,
                    detection.bbox,
                    adaptiveSmoothingFactor
                );
            } else {
                unmatchedDetections.push(detection);
            }
        });
        
        // Create new tracked objects
        unmatchedDetections.forEach(detection => {
            const id = this.nextObjectId++;
            this.trackedObjects.set(id, {
                id: id,
                label: detection.label,
                bbox: detection.bbox,
                smoothedBbox: detection.bbox,
                predictedBbox: detection.bbox,
                color: detection.color,
                confidence: detection.confidence,
                lastSeen: currentTime,
                velocity: [0, 0, 0, 0],
                missedFrames: 0,
                matched: true,
                geminiRefined: false
            });
        });
        
        // Remove stale objects
        const idsToRemove = [];
        this.trackedObjects.forEach((obj, id) => {
            const age = currentTime - obj.lastSeen;
            if (age > this.maxTrackingAge || obj.missedFrames > this.maxMissedFrames) {
                idsToRemove.push(id);
            }
        });
        idsToRemove.forEach(id => this.trackedObjects.delete(id));
    },
    
    calculateCenterDistance(bbox1, bbox2) {
        const cx1 = bbox1[0] + bbox1[2] / 2;
        const cy1 = bbox1[1] + bbox1[3] / 2;
        const cx2 = bbox2[0] + bbox2[2] / 2;
        const cy2 = bbox2[1] + bbox2[3] / 2;
        return Math.sqrt((cx1 - cx2)**2 + (cy1 - cy2)**2);
    },
    
    calculateIoU(bbox1, bbox2) {
        const [x1, y1, w1, h1] = bbox1;
        const [x2, y2, w2, h2] = bbox2;
        
        const xLeft = Math.max(x1, x2);
        const yTop = Math.max(y1, y2);
        const xRight = Math.min(x1 + w1, x2 + w2);
        const yBottom = Math.min(y1 + h1, y2 + h2);
        
        if (xRight < xLeft || yBottom < yTop) return 0;
        
        const intersectionArea = (xRight - xLeft) * (yBottom - yTop);
        const bbox1Area = w1 * h1;
        const bbox2Area = w2 * h2;
        const unionArea = bbox1Area + bbox2Area - intersectionArea;
        
        return intersectionArea / unionArea;
    },
    
    calculateVelocity(oldBbox, newBbox) {
        return [
            newBbox[0] - oldBbox[0],
            newBbox[1] - oldBbox[1],
            newBbox[2] - oldBbox[2],
            newBbox[3] - oldBbox[3]
        ];
    },
    
    smoothBoundingBox(oldBbox, newBbox, alpha) {
        if (!oldBbox) return newBbox;
        return [
            oldBbox[0] * (1 - alpha) + newBbox[0] * alpha,
            oldBbox[1] * (1 - alpha) + newBbox[1] * alpha,
            oldBbox[2] * (1 - alpha) + newBbox[2] * alpha,
            oldBbox[3] * (1 - alpha) + newBbox[3] * alpha
        ];
    },
    
    /**
     * Draw detection with visual indicator for Gemini-refined labels
     */
    drawDetection(ctx, detection) {
        const [x, y, w, h] = detection.bbox;
        
        const xCoord = x * this.overlay.width;
        const yCoord = y * this.overlay.height;
        const width = w * this.overlay.width;
        const height = h * this.overlay.height;
        
        const color = this.getColorForLabel(detection.color);
        
        // Visual style
        if (detection.isTracked) {
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 5]);
        } else {
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = detection.geminiRefined ? 4 : 3; // Thicker if Gemini refined
            ctx.setLineDash([]);
            ctx.shadowColor = color;
            ctx.shadowBlur = detection.geminiRefined ? 15 : 10; // More glow if refined
        }
        
        ctx.strokeRect(xCoord, yCoord, width, height);
        ctx.shadowBlur = 0;
        
        // Label background
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = color;
        const labelHeight = 28;
        const labelY = yCoord - labelHeight - 5;
        
        this.roundRect(ctx, xCoord, labelY, Math.max(width, 100), labelHeight, 5);
        ctx.fill();
        
        // Label text
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        
        // Add indicator if Gemini refined
        const labelText = detection.geminiRefined ? `✨ ${detection.label}` : detection.label;
        ctx.fillText(labelText, xCoord + 8, labelY + labelHeight / 2);
        
        ctx.globalAlpha = 1.0;
    },
    
    roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    },
    
    getColorForLabel(colorName) {
        const colors = {
            'red': '#f44336',
            'yellow': '#ffeb3b',
            'green': '#4caf50',
            'blue': '#2196f3',
            'orange': '#ff9800'
        };
        return colors[colorName] || colors['yellow'];
    },
    
    generateAudioFeedback(detections) {
        if (!this.speechSynth) return;
        
        const now = Date.now();
        if (now - this.lastSpeechTime < 3000) return;
        
        const importantDetections = detections.filter(d => {
            const label = d.label.toLowerCase();
            return label.includes('stop') || label.includes('walk') || 
                   label.includes('pedestrian') || label.includes('traffic');
        });
        
        if (importantDetections.length > 0) {
            const detection = importantDetections[0];
            const message = detection.label.replace(/[🚦🛑🚶✨]/g, '').trim();
            
            if (message !== this.lastSpokenLabel) {
            this.speechSynth.cancel();
            const utterance = new SpeechSynthesisUtterance(message);
            utterance.rate = 0.9;
            utterance.pitch = 1.0;
            utterance.volume = 0.8;
            this.speechSynth.speak(utterance);
            
                this.lastSpokenLabel = message;
                this.lastSpeechTime = now;
            }
        }
    },
    
    updateDetectionPanel(detections) {
        const panel = document.getElementById('detection-panel');
        const list = document.getElementById('detection-list');
        
        // Don't display the panel at all
        panel.classList.remove('visible');
        panel.style.display = 'none';
        return;
        
        // Keep below code for potential future use but disabled
        if (!detections || detections.length === 0) {
            panel.classList.remove('visible');
            return;
        }
        
        // Filter out hidden detections
        const visibleDetections = detections.filter(d => !d.hide);
        
        if (visibleDetections.length === 0) {
            panel.classList.remove('visible');
            return;
        }
        
        panel.classList.add('visible');
        list.innerHTML = '';
        
        visibleDetections.forEach(detection => {
            const item = document.createElement('div');
            item.className = 'detection-item';
            item.innerHTML = `
                <span class="label">${detection.label}</span>
                <span class="confidence">${(detection.confidence * 100).toFixed(0)}%</span>
            `;
            list.appendChild(item);
        });
    },
    
    togglePause() {
        this.isPaused = !this.isPaused;
        
        const btn = document.getElementById('pause-btn');
        const icon = btn.querySelector('.icon');
        const text = btn.querySelector('span:last-child');
        
        if (this.isPaused) {
            icon.textContent = '▶';
            text.textContent = 'Resume';
            document.getElementById('loading').style.display = 'none';
        } else {
            icon.textContent = '⏸';
            text.textContent = 'Pause';
            document.getElementById('loading').style.display = 'none';
            this.detectionLoop();
        }
    },
    
    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    },
    
    async startRecording() {
        if (!this.mediaStream) {
            this.showError('No camera stream available');
            return;
        }
        
        try {
            const options = { mimeType: 'video/webm', videoBitsPerSecond: 2500000 };
            this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
            this.recordedChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) this.recordedChunks.push(event.data);
            };
            
            this.mediaRecorder.onstop = () => this.saveRecording();
            this.mediaRecorder.start();
            this.isRecording = true;
            
            document.getElementById('record-text').textContent = 'Stop';
            document.getElementById('record-btn').classList.add('recording');
            
            setTimeout(() => {
                if (this.isRecording) this.stopRecording();
            }, this.config.recordDuration);
            
        } catch (error) {
            console.error('Recording failed:', error);
            this.showError('Recording not supported');
        }
    },
    
    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            document.getElementById('record-text').textContent = 'Record';
            document.getElementById('record-btn').classList.remove('recording');
        }
    },
    
    async saveRecording() {
        if (this.recordedChunks.length === 0) return;
        
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const timestamp = new Date().toISOString();
        const filename = `signvision_${timestamp}.webm`;
        
        if (this.storage) {
            try {
                const transaction = this.storage.transaction(['recordings'], 'readwrite');
                const store = transaction.objectStore('recordings');
                await store.add({ blob, filename, timestamp });
                console.log('Recording saved:', filename);
            } catch (error) {
                console.error('Failed to save recording:', error);
            }
        }
        
        this.recordedChunks = [];
    },
    
    handleDeviceMotion(event) {
        const acceleration = event.acceleration;
        if (!acceleration) return;
        
        const magnitude = Math.sqrt(
            acceleration.x ** 2 + acceleration.y ** 2 + acceleration.z ** 2
        );
        
        if (magnitude > 15) {
            console.warn('Possible fall detected!');
            if (this.isRunning && !this.isPaused) {
                this.togglePause();
                this.showError('Fall detected! Paused for safety.');
            }
            if (!this.isRecording) this.startRecording();
            }
    },
    
    initStorage() {
        if (!('indexedDB' in window)) return;
        
        const request = indexedDB.open('SignVisionDB', 1);
        request.onsuccess = (event) => {
            this.storage = event.target.result;
            console.log('Storage initialized');
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.createObjectStore('recordings', { keyPath: 'timestamp' });
            }
        };
    },
    
    updateConnectionStatus(connected) {
        const status = document.getElementById('connection-status');
        status.classList.toggle('connected', connected);
        status.classList.toggle('disconnected', !connected);
    },
    
    updateCameraStatus(active) {
        const status = document.getElementById('camera-status');
        status.textContent = active ? '📷' : '📷❌';
    },
    
    showError(message) {
        const toast = document.getElementById('error-toast');
        const errorMessage = document.getElementById('error-message');
        errorMessage.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    },
    
    openSettings() {
        document.getElementById('settings-modal').classList.add('visible');
    },
    
    closeSettings() {
        document.getElementById('settings-modal').classList.remove('visible');
    }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && App.isRunning && !App.isPaused) {
        App.togglePause();
    }
});

window.addEventListener('online', () => App.updateConnectionStatus(true));
window.addEventListener('offline', () => App.updateConnectionStatus(false));
