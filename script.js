/**
 * SignVision - Pure Client-Side AR Object Detection
 * Uses TensorFlow.js + COCO-SSD for real-time detection with NO backend!
 * Much faster with advanced AR tracking (Google Lens style)
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
    
    // TensorFlow.js model
    cocoModel: null,
    
    // Configuration
    config: {
        processingInterval: 100, // ms between detections (10 FPS - very fast!)
        enableVoice: true,
        detectionSensitivity: 5,
        maxFPS: 30,
        recordDuration: 30000, // 30 seconds in ms
        minConfidence: 0.25 // COCO-SSD confidence threshold
    },
    
    // Timing and performance
    lastProcessTime: 0,
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
    
    // AR Object Tracking - labels stick to objects in 3D space (Google Lens style)
    trackedObjects: new Map(),
    nextObjectId: 0,
    trackingThreshold: 0.15, // IoU threshold for matching
    smoothingFactor: 0.25, // Position smoothing (lower = smoother)
    maxTrackingAge: 2000, // Keep objects visible for 2 seconds
    maxMissedFrames: 10, // Maximum frames to predict without detection
    
    // Camera motion tracking
    gyroData: { alpha: 0, beta: 0, gamma: 0 },
    accelData: { x: 0, y: 0, z: 0 },
    lastGyro: null,
    lastAccel: null,
    cameraMotion: { dx: 0, dy: 0 },
    
    // Service references
    storage: null,
    
    async init() {
        console.log('🚀 SignVision AR initializing...');
        
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
        
        // Load TensorFlow.js model
        await this.loadDetectionModel();
        
        console.log('✅ SignVision AR initialized');
    },
    
    /**
     * Load TensorFlow.js COCO-SSD model for real-time detection
     */
    async loadDetectionModel() {
        try {
            console.log('📦 Loading COCO-SSD detection model...');
            this.updateModelStatus('Loading AI model...');
            
            // Check if TensorFlow.js is loaded
            if (typeof tf === 'undefined') {
                throw new Error('TensorFlow.js not loaded');
            }
            
            if (typeof cocoSsd === 'undefined') {
                throw new Error('COCO-SSD not loaded');
            }
            
            // Load COCO-SSD model with optimized base
            this.cocoModel = await cocoSsd.load({
                base: 'lite_mobilenet_v2' // Faster, lighter model for mobile
            });
            
            this.modelLoaded = true;
            console.log('✅ COCO-SSD model loaded successfully!');
            this.updateModelStatus('AI Ready! 🚀');
            
            // Enable start button
            document.getElementById('start-btn').disabled = false;
            
            // Hide status after 2 seconds
            setTimeout(() => {
                const header = document.querySelector('.status-bar h1');
                if (header.textContent.includes('AI Ready')) {
                    header.textContent = 'SignVision AR';
                }
            }, 2000);
            
        } catch (error) {
            console.error('❌ Model load failed:', error);
            this.updateModelStatus('❌ Model load failed');
            this.showError('Failed to load AI model. Refresh to retry.');
        }
    },
    
    /**
     * Update header with model loading status
     */
    updateModelStatus(message) {
        const header = document.querySelector('.status-bar h1');
        header.textContent = message;
    },
    
    /**
     * Setup device motion sensors for better AR tracking
     */
    setupMotionSensors() {
        if (window.DeviceOrientationEvent) {
            window.addEventListener('deviceorientation', (e) => {
                const newGyro = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
                
                if (this.lastGyro) {
                    const dAlpha = newGyro.alpha - this.lastGyro.alpha;
                    const dBeta = newGyro.beta - this.lastGyro.beta;
                    const dGamma = newGyro.gamma - this.lastGyro.gamma;
                    
                    // Estimate camera motion from rotation
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
        // Control buttons
        document.getElementById('start-btn').addEventListener('click', () => this.startDetection());
        document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('record-btn').addEventListener('click', () => this.toggleRecording());
        document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
        document.getElementById('close-settings').addEventListener('click', () => this.closeSettings());
        
        // Settings controls
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
        
        // Device motion for fall detection
        if (window.DeviceMotionEvent) {
            window.addEventListener('devicemotion', (e) => {
                this.handleDeviceMotion(e);
            });
        }
    },
    
    /**
     * Request camera access - specifically rear camera
     */
    async requestCameraPermission() {
        try {
            const constraints = {
                video: {
                    facingMode: 'environment', // Rear camera
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.mediaStream = stream;
            this.video.srcObject = stream;
            
            // Set canvas dimensions
            this.overlay.width = window.innerWidth;
            this.overlay.height = window.innerHeight;
            
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
    
    /**
     * Start the real-time detection loop
     */
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
        
        // Update UI
        document.getElementById('start-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;
        document.getElementById('loading').classList.add('visible');
        
        // Start detection loop
        this.detectionLoop();
        
        console.log('▶️ Detection started - Running locally with TensorFlow.js!');
    },
    
    /**
     * Main detection loop - ultra-fast local processing!
     */
    async detectionLoop() {
        if (!this.isRunning || this.isPaused) return;
        
        const now = Date.now();
        const elapsed = now - this.lastProcessTime;
        
        // Throttle to respect interval
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
            console.log(`⚡ FPS: ${this.fpsCounter}`);
        }
        
        // Process frame if not already processing
        if (!this.isProcessing && this.modelLoaded) {
            this.processFrameLocal();
        }
        
        // Continue loop
        requestAnimationFrame(() => this.detectionLoop());
    },
    
    /**
     * Process frame locally with TensorFlow.js - NO API CALLS!
     */
    async processFrameLocal() {
        try {
            this.isProcessing = true;
            this.updateConnectionStatus(true); // Always connected (local!)
            
            const startTime = performance.now();
            
            // Run COCO-SSD detection directly on video element
            const predictions = await this.cocoModel.detect(this.video, undefined, this.config.minConfidence);
            
            const processingTime = performance.now() - startTime;
            
            // Convert COCO-SSD predictions to our detection format
            const detections = this.convertPredictionsToDetections(predictions);
            
            // Process detections with AR tracking
            if (detections.length > 0) {
                this.handleDetections(detections);
            } else {
                // Still update tracked objects even with no new detections
                this.handleDetections([]);
            }
            
            // Log processing time
            if (this.frameCount % 30 === 0) {
                console.log(`⚡ Detection: ${processingTime.toFixed(0)}ms, Objects: ${detections.length}`);
            }
            
        } catch (error) {
            console.error('Detection error:', error);
        } finally {
            this.isProcessing = false;
        }
    },
    
    /**
     * Convert COCO-SSD predictions to our detection format
     */
    convertPredictionsToDetections(predictions) {
        return predictions.map(pred => {
            // Normalize bounding box to [0, 1] range
            const bbox = [
                pred.bbox[0] / this.video.videoWidth,  // x
                pred.bbox[1] / this.video.videoHeight, // y
                pred.bbox[2] / this.video.videoWidth,  // width
                pred.bbox[3] / this.video.videoHeight  // height
            ];
            
            // Map COCO class to color and better label
            const { label, color } = this.mapCocoClassToLabel(pred.class);
            
            return {
                label: label,
                bbox: bbox,
                color: color,
                confidence: pred.score
            };
        });
    },
    
    /**
     * Map COCO-SSD classes to relevant labels and colors for road/traffic context
     */
    mapCocoClassToLabel(cocoClass) {
        const mappings = {
            // Vehicles
            'car': { label: '🚗 Car', color: 'blue' },
            'truck': { label: '🚛 Truck', color: 'blue' },
            'bus': { label: '🚌 Bus', color: 'blue' },
            'motorcycle': { label: '🏍️ Motorcycle', color: 'orange' },
            'bicycle': { label: '🚲 Bicycle', color: 'green' },
            
            // People and pedestrians
            'person': { label: '🚶 Person', color: 'red' },
            
            // Traffic signals
            'traffic light': { label: '🚦 Traffic Light', color: 'yellow' },
            'stop sign': { label: '🛑 Stop Sign', color: 'red' },
            
            // Animals
            'dog': { label: '🐕 Dog', color: 'orange' },
            'cat': { label: '🐈 Cat', color: 'orange' },
            'bird': { label: '🐦 Bird', color: 'green' },
            
            // Objects
            'backpack': { label: '🎒 Backpack', color: 'blue' },
            'umbrella': { label: '☂️ Umbrella', color: 'blue' },
            'handbag': { label: '👜 Handbag', color: 'blue' },
            'suitcase': { label: '🧳 Suitcase', color: 'blue' },
            
            // Barriers
            'fire hydrant': { label: '🚰 Fire Hydrant', color: 'red' },
            'parking meter': { label: '🅿️ Parking Meter', color: 'blue' },
            'bench': { label: '🪑 Bench', color: 'green' },
        };
        
        return mappings[cocoClass] || { label: cocoClass, color: 'yellow' };
    },
    
    /**
     * Handle detection results with AR tracking
     */
    handleDetections(detections) {
        this.lastDetections = detections;
        const currentTime = Date.now();
        
        // Update tracked objects with new detections
        this.updateTrackedObjects(detections, currentTime);
        
        // Clear previous overlay
        const ctx = this.overlay.getContext('2d');
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        
        // Draw ALL tracked objects (makes labels stick!)
        this.trackedObjects.forEach(trackedObj => {
            let displayBbox = trackedObj.smoothedBbox;
            
            // If object not detected recently, use predicted position
            if (trackedObj.missedFrames > 0) {
                displayBbox = trackedObj.predictedBbox || trackedObj.smoothedBbox;
            }
            
            const detection = {
                label: trackedObj.label,
                bbox: displayBbox,
                color: trackedObj.color,
                confidence: trackedObj.confidence,
                isTracked: trackedObj.missedFrames > 0
            };
            this.drawDetection(ctx, detection);
        });
        
        // Generate audio feedback for important detections
        if (this.config.enableVoice && detections.length > 0) {
            this.generateAudioFeedback(detections);
        }
        
        // Update detection panel
        const displayDetections = Array.from(this.trackedObjects.values()).map(obj => ({
            label: obj.label,
            bbox: obj.smoothedBbox,
            color: obj.color,
            confidence: obj.confidence
        }));
        this.updateDetectionPanel(displayDetections);
    },
    
    /**
     * Update tracked objects with advanced AR tracking
     */
    updateTrackedObjects(detections, currentTime) {
        // STEP 1: Predict positions of existing objects
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
        
        // STEP 2: Match new detections to existing tracked objects
        const unmatchedDetections = [];
        
        detections.forEach(detection => {
            if (detection.confidence < this.config.minConfidence) return;
            
            let bestMatch = null;
            let bestScore = 0;
            
            this.trackedObjects.forEach(trackedObj => {
                if (trackedObj.matched) return;
                if (trackedObj.label !== detection.label) return;
                
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
                // UPDATE existing tracked object
                bestMatch.matched = true;
                bestMatch.missedFrames = 0;
                bestMatch.lastSeen = currentTime;
                bestMatch.confidence = detection.confidence;
                
                const newVelocity = this.calculateVelocity(bestMatch.bbox, detection.bbox);
                bestMatch.velocity = [
                    bestMatch.velocity[0] * 0.7 + newVelocity[0] * 0.3,
                    bestMatch.velocity[1] * 0.7 + newVelocity[1] * 0.3,
                    bestMatch.velocity[2] * 0.7 + newVelocity[2] * 0.3,
                    bestMatch.velocity[3] * 0.7 + newVelocity[3] * 0.3
                ];
                
                bestMatch.bbox = detection.bbox;
                
                // Adaptive smoothing
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
        
        // STEP 3: Create new tracked objects
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
                matched: true
            });
        });
        
        // STEP 4: Remove stale objects
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
     * Draw detection with Google Lens style
     */
    drawDetection(ctx, detection) {
        const [x, y, w, h] = detection.bbox;
        
        const xCoord = x * this.overlay.width;
        const yCoord = y * this.overlay.height;
        const width = w * this.overlay.width;
        const height = h * this.overlay.height;
        
        const color = this.getColorForLabel(detection.color);
        
        // Different style for tracked vs detected
        if (detection.isTracked) {
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 5]);
        } else {
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = 3;
            ctx.setLineDash([]);
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
        }
        
        ctx.strokeRect(xCoord, yCoord, width, height);
        ctx.shadowBlur = 0;
        
        // Label with rounded corners
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = color;
        const labelHeight = 28;
        const labelY = yCoord - labelHeight - 5;
        
        this.roundRect(ctx, xCoord, labelY, Math.max(width, 100), labelHeight, 5);
        ctx.fill();
        
        // Text
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(detection.label, xCoord + 8, labelY + labelHeight / 2);
        
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
    
    /**
     * Generate audio feedback
     */
    generateAudioFeedback(detections) {
        if (!this.speechSynth) return;
        
        const now = Date.now();
        if (now - this.lastSpeechTime < 3000) return; // Throttle speech
        
        const importantDetections = detections.filter(d => {
            const label = d.label.toLowerCase();
            return label.includes('stop') || label.includes('person') || 
                   label.includes('car') || label.includes('traffic');
        });
        
        if (importantDetections.length > 0) {
            const detection = importantDetections[0];
            const message = detection.label.replace(/[🚗🚛🚌🏍️🚲🚶🚦🛑🐕🐈🐦🎒☂️👜🧳🚰🅿️🪑]/g, '').trim();
            
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
    
    /**
     * Update detection panel
     */
    updateDetectionPanel(detections) {
        const panel = document.getElementById('detection-panel');
        const list = document.getElementById('detection-list');
        
        if (!detections || detections.length === 0) {
            panel.classList.remove('visible');
            return;
        }
        
        panel.classList.add('visible');
        list.innerHTML = '';
        
        detections.forEach(detection => {
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
            document.getElementById('loading').classList.remove('visible');
        } else {
            icon.textContent = '⏸';
            text.textContent = 'Pause';
            document.getElementById('loading').classList.add('visible');
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
