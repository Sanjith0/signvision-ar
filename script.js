/**
 * SignVision Main Application Logic
 * Real-time camera processing, AR overlays, audio feedback, and dashcam recording
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
    
    // Configuration
    // Auto-detects API endpoint based on environment
    // In production (same domain): uses relative URL '/analyze'
    // In development (localhost or custom): uses configured endpoint
    config: {
        apiEndpoint: (() => {
            // If running on localhost, use localhost:8000
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                return 'http://localhost:8000/analyze';
            }
            // Otherwise, use relative URL (same server in production)
            return '/analyze';
        })(),
        processingInterval: 150, // ms between frame captures (6.6 FPS - very fast!)
        enableVoice: true,
        detectionSensitivity: 5,
        maxFPS: 15,
        recordDuration: 30000 // 30 seconds in ms
    },
    
    // Timing and performance
    lastProcessTime: 0,
    frameCount: 0,
    mediaStream: null,
    mediaRecorder: null,
    recordedChunks: [],
    
    // Speech and audio
    speechSynth: null,
    
    // Detection history
    lastDetections: [],
    deviceMotionData: null,
    
    // AR Object Tracking - labels stick to objects in 3D space (Google Lens style)
    trackedObjects: new Map(), // Map<id, {id, label, bbox, smoothedBbox, color, confidence, lastSeen, velocity, predictedBbox, missedFrames}>
    nextObjectId: 0,
    trackingThreshold: 0.15, // IoU threshold for matching (very lenient for better tracking)
    smoothingFactor: 0.25, // Position smoothing (lower = smoother, more stuck)
    maxTrackingAge: 2000, // Keep objects visible for 2 seconds without detection (like Google Lens)
    minConfidence: 0.25, // Minimum confidence to create new tracked object
    maxMissedFrames: 10, // Maximum frames to predict without detection
    
    // Camera motion tracking
    gyroData: { alpha: 0, beta: 0, gamma: 0 },
    accelData: { x: 0, y: 0, z: 0 },
    lastGyro: null,
    lastAccel: null,
    cameraMotion: { dx: 0, dy: 0 }, // Estimated camera movement
    
    // Service references
    storage: null,
    
    init() {
        console.log('SignVision initializing...');
        
        // Get DOM elements
        this.video = document.getElementById('video');
        this.overlay = document.getElementById('overlay');
        this.capture = document.getElementById('capture');
        
        // Initialize Speech Synthesis API
        if ('speechSynthesis' in window) {
            this.speechSynth = window.speechSynthesis;
            console.log('Speech synthesis initialized');
        }
        
        // Initialize IndexedDB for dashcam storage
        this.initStorage();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Request camera permission on load
        this.requestCameraPermission();
        
        // Setup device motion sensors for camera tracking
        this.setupMotionSensors();
        
        console.log('SignVision initialized');
    },
    
    /**
     * Setup device motion sensors for better AR tracking
     */
    setupMotionSensors() {
        if (window.DeviceOrientationEvent) {
            window.addEventListener('deviceorientation', (e) => {
                const newGyro = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
                
                if (this.lastGyro) {
                    // Calculate camera rotation
                    const dAlpha = newGyro.alpha - this.lastGyro.alpha;
                    const dBeta = newGyro.beta - this.lastGyro.beta;
                    const dGamma = newGyro.gamma - this.lastGyro.gamma;
                    
                    // Estimate camera motion from rotation
                    this.cameraMotion.dx = dGamma * 0.01; // Horizontal movement
                    this.cameraMotion.dy = dBeta * 0.01;  // Vertical movement
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
        
        document.getElementById('api-endpoint').addEventListener('change', (e) => {
            this.config.apiEndpoint = e.target.value;
        });
        
        // Device motion for fall detection
        if (window.DeviceMotionEvent) {
            window.addEventListener('devicemotion', (e) => {
                this.handleDeviceMotion(e);
            });
        }
    },
    
    /**
     * Request camera access - specifically rear camera for iPhone
     */
    async requestCameraPermission() {
        try {
            // Request access to rear camera (environment facing)
            const constraints = {
                video: {
                    facingMode: 'environment', // Rear camera
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.mediaStream = stream;
            
            // Assign stream to video element
            this.video.srcObject = stream;
            
            // Set canvas dimensions
            this.overlay.width = window.innerWidth;
            this.overlay.height = window.innerHeight;
            // Use smaller capture size for faster Gemini processing (8x faster!)
            this.capture.width = 512;  // Even smaller for speed
            this.capture.height = 384; // 4:3 aspect ratio
            
            this.updateCameraStatus(true);
            console.log('Camera access granted');
            
            // Set up initial video metadata
            this.video.addEventListener('loadedmetadata', () => {
                console.log(`Video resolution: ${this.video.videoWidth}x${this.video.videoHeight}`);
            });
            
        } catch (error) {
            console.error('Camera access denied:', error);
            this.showError('Camera access denied. Please allow camera permissions.');
            this.updateCameraStatus(false);
        }
    },
    
    /**
     * Start the real-time detection loop
     */
    async startDetection() {
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
        
        console.log('Detection started');
    },
    
    /**
     * Main detection loop - captures frames and processes them
     */
    async detectionLoop() {
        if (!this.isRunning || this.isPaused) return;
        
        const now = Date.now();
        const elapsed = now - this.lastProcessTime;
        
        // Throttle to respect maxFPS and interval
        if (elapsed < this.config.processingInterval) {
            requestAnimationFrame(() => this.detectionLoop());
            return;
        }
        
        this.lastProcessTime = now;
        this.frameCount++;
        
        // Capture frame
        this.captureFrame()
            .then(blob => {
                if (blob) {
                    this.processFrame(blob);
                }
            })
            .catch(err => {
                console.error('Frame capture error:', err);
            });
        
        // Continue loop
        requestAnimationFrame(() => this.detectionLoop());
    },
    
    /**
     * Capture current video frame to canvas and compress
     */
    captureFrame() {
        return new Promise((resolve) => {
            const ctx = this.capture.getContext('2d');
            
            // Draw current video frame to canvas
            ctx.drawImage(
                this.video,
                0, 0,
                this.capture.width,
                this.capture.height
            );
            
            // Convert to blob with compression (lower quality = much faster processing)
            this.capture.toBlob((blob) => {
                resolve(blob);
            }, 'image/webp', 0.4); // 40% quality for maximum speed
        });
    },
    
    /**
     * Send frame to backend API for AI analysis
     */
    async processFrame(blob) {
        try {
            this.updateConnectionStatus(false);
            
            // Convert blob to base64 for simpler parsing on Vercel
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
            const base64 = await base64Promise;
            
            const response = await fetch(this.config.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: base64.split(',')[1], // Remove data:image/webp;base64, prefix
                    content_type: blob.type || 'image/webp'
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            this.updateConnectionStatus(true);
            
            // Process detections
            if (data.detections && data.detections.length > 0) {
                this.handleDetections(data.detections);
            } else {
                this.clearOverlay();
            }
            
            // Log processing time
            if (data.processing_time_ms) {
                console.log(`Frame processed in ${data.processing_time_ms.toFixed(0)}ms`);
            }
            
        } catch (error) {
            console.error('API request failed:', error);
            this.updateConnectionStatus(false);
            this.showError('Connection error');
            
            // Retry with exponential backoff
            setTimeout(() => {
                if (this.isRunning) {
                    this.detectionLoop();
                }
            }, 2000);
        }
    },
    
    /**
     * Handle detection results with AR tracking
     * Labels stick to objects in 3D space like traditional AR
     */
    handleDetections(detections) {
        this.lastDetections = detections;
        const currentTime = Date.now();
        
        // Update tracked objects with new detections
        this.updateTrackedObjects(detections, currentTime);
        
        // Clear previous overlay
        this.clearOverlay();
        
        const ctx = this.overlay.getContext('2d');
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        
        // Draw ALL tracked objects with camera motion compensation
        // This makes labels stick in 3D space like Google Lens!
        this.trackedObjects.forEach(trackedObj => {
            // Apply camera motion compensation
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
                isTracked: trackedObj.missedFrames > 0 // Visual indicator
            };
            this.drawDetection(ctx, detection);
        });
        
        // Generate audio feedback only for NEW detections
        if (this.config.enableVoice && detections.length > 0) {
            this.generateAudioFeedback(detections);
        }
        
        // Update detection panel with all tracked objects
        const displayDetections = Array.from(this.trackedObjects.values()).map(obj => ({
            label: obj.label,
            bbox: obj.smoothedBbox,
            color: obj.color,
            confidence: obj.confidence
        }));
        this.updateDetectionPanel(displayDetections);
    },
    
    /**
     * Update tracked objects with advanced AR tracking (Google Lens style)
     * Includes motion prediction, camera compensation, and persistent tracking
     */
    updateTrackedObjects(detections, currentTime) {
        // STEP 1: Predict positions of existing objects (Kalman-like prediction)
        this.trackedObjects.forEach(obj => {
            obj.matched = false;
            obj.missedFrames = (obj.missedFrames || 0) + 1;
            
            // Predict next position using velocity + camera motion
            if (obj.velocity && obj.missedFrames <= this.maxMissedFrames) {
                obj.predictedBbox = [
                    obj.smoothedBbox[0] + obj.velocity[0] - this.cameraMotion.dx,
                    obj.smoothedBbox[1] + obj.velocity[1] - this.cameraMotion.dy,
                    obj.smoothedBbox[2] + obj.velocity[2] * 0.5, // Slow growth
                    obj.smoothedBbox[3] + obj.velocity[3] * 0.5
                ];
            } else {
                obj.predictedBbox = obj.smoothedBbox;
            }
        });
        
        // STEP 2: Match new detections to existing tracked objects
        const unmatchedDetections = [];
        
        detections.forEach(detection => {
            // Skip very low confidence
            if (detection.confidence < this.minConfidence) return;
            
            let bestMatch = null;
            let bestScore = 0;
            
            // Find best match using multiple criteria
            this.trackedObjects.forEach(trackedObj => {
                if (trackedObj.matched) return;
                if (trackedObj.label !== detection.label) return;
                
                // Calculate IoU with predicted position (better for moving objects)
                const iouPredicted = this.calculateIoU(detection.bbox, trackedObj.predictedBbox);
                const iouCurrent = this.calculateIoU(detection.bbox, trackedObj.smoothedBbox);
                const iou = Math.max(iouPredicted, iouCurrent);
                
                // Calculate center distance (helps with fast-moving objects)
                const centerDist = this.calculateCenterDistance(detection.bbox, trackedObj.smoothedBbox);
                
                // Combined matching score
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
                
                // Calculate velocity with decay
                const newVelocity = this.calculateVelocity(bestMatch.bbox, detection.bbox);
                bestMatch.velocity = [
                    bestMatch.velocity[0] * 0.7 + newVelocity[0] * 0.3,
                    bestMatch.velocity[1] * 0.7 + newVelocity[1] * 0.3,
                    bestMatch.velocity[2] * 0.7 + newVelocity[2] * 0.3,
                    bestMatch.velocity[3] * 0.7 + newVelocity[3] * 0.3
                ];
                
                bestMatch.bbox = detection.bbox;
                
                // Adaptive smoothing (more responsive when moving fast)
                const velocityMagnitude = Math.sqrt(
                    newVelocity[0]**2 + newVelocity[1]**2
                );
                const adaptiveSmoothingFactor = Math.min(
                    this.smoothingFactor + velocityMagnitude * 2,
                    0.6
                );
                
                bestMatch.smoothedBbox = this.smoothBoundingBox(
                    bestMatch.smoothedBbox,
                    detection.bbox,
                    adaptiveSmoothingFactor
                );
            } else {
                unmatchedDetections.push(detection);
            }
        });
        
        // STEP 3: Create new tracked objects for unmatched detections
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
        
        // STEP 4: Remove very stale objects
        const idsToRemove = [];
        this.trackedObjects.forEach((obj, id) => {
            const age = currentTime - obj.lastSeen;
            if (age > this.maxTrackingAge || obj.missedFrames > this.maxMissedFrames) {
                idsToRemove.push(id);
            }
        });
        idsToRemove.forEach(id => this.trackedObjects.delete(id));
    },
    
    /**
     * Calculate distance between bounding box centers
     */
    calculateCenterDistance(bbox1, bbox2) {
        const cx1 = bbox1[0] + bbox1[2] / 2;
        const cy1 = bbox1[1] + bbox1[3] / 2;
        const cx2 = bbox2[0] + bbox2[2] / 2;
        const cy2 = bbox2[1] + bbox2[3] / 2;
        
        return Math.sqrt((cx1 - cx2)**2 + (cy1 - cy2)**2);
    },
    
    /**
     * Calculate Intersection over Union for object matching
     */
    calculateIoU(bbox1, bbox2) {
        const [x1, y1, w1, h1] = bbox1;
        const [x2, y2, w2, h2] = bbox2;
        
        // Calculate intersection rectangle
        const xLeft = Math.max(x1, x2);
        const yTop = Math.max(y1, y2);
        const xRight = Math.min(x1 + w1, x2 + w2);
        const yBottom = Math.min(y1 + h1, y2 + h2);
        
        if (xRight < xLeft || yBottom < yTop) {
            return 0; // No overlap
        }
        
        const intersectionArea = (xRight - xLeft) * (yBottom - yTop);
        const bbox1Area = w1 * h1;
        const bbox2Area = w2 * h2;
        const unionArea = bbox1Area + bbox2Area - intersectionArea;
        
        return intersectionArea / unionArea;
    },
    
    /**
     * Calculate velocity for motion prediction
     */
    calculateVelocity(oldBbox, newBbox) {
        return [
            newBbox[0] - oldBbox[0],
            newBbox[1] - oldBbox[1],
            newBbox[2] - oldBbox[2],
            newBbox[3] - oldBbox[3]
        ];
    },
    
    /**
     * Smooth bounding box using exponential moving average
     * Makes labels stick smoothly to objects
     */
    smoothBoundingBox(oldBbox, newBbox, alpha) {
        if (!oldBbox) return newBbox;
        
        return [
            oldBbox[0] * (1 - alpha) + newBbox[0] * alpha, // x
            oldBbox[1] * (1 - alpha) + newBbox[1] * alpha, // y
            oldBbox[2] * (1 - alpha) + newBbox[2] * alpha, // w
            oldBbox[3] * (1 - alpha) + newBbox[3] * alpha  // h
        ];
    },
    
    /**
     * Draw a detection bounding box on the overlay canvas
     */
    drawDetection(ctx, detection) {
        const [x, y, w, h] = detection.bbox;
        
        // Map normalized coordinates to canvas dimensions
        const xCoord = x * this.overlay.width;
        const yCoord = y * this.overlay.height;
        const width = w * this.overlay.width;
        const height = h * this.overlay.height;
        
        const color = this.getColorForLabel(detection.color);
        
        // Different visual style for tracked (predicted) vs detected objects
        if (detection.isTracked) {
            // Tracked object (not currently detected) - dashed line, slightly transparent
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 5]);
        } else {
            // Actively detected object - solid line, full opacity
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = 3;
            ctx.setLineDash([]);
            
            // Add glow effect for active detections
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
        }
        
        ctx.strokeRect(xCoord, yCoord, width, height);
        ctx.shadowBlur = 0; // Reset shadow
        
        // Draw label with rounded corners (Google Lens style)
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = color;
        const labelHeight = 28;
        const labelY = yCoord - labelHeight - 5;
        
        // Rounded rectangle for label
        this.roundRect(ctx, xCoord, labelY, Math.max(width, 100), labelHeight, 5);
        ctx.fill();
        
        // Draw label text
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(detection.label, xCoord + 8, labelY + labelHeight / 2);
        
        // Reset global alpha
        ctx.globalAlpha = 1.0;
    },
    
    /**
     * Draw rounded rectangle helper
     */
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
    
    /**
     * Get color for detection type
     */
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
     * Clear the overlay canvas
     */
    clearOverlay() {
        const ctx = this.overlay.getContext('2d');
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    },
    
    /**
     * Generate audio feedback using Web Speech API
     */
    generateAudioFeedback(detections) {
        if (!this.speechSynth) return;
        
        // Only speak for important/high priority detections
        const importantDetections = detections.filter(d => {
            const label = d.label.toLowerCase();
            return label.includes('stop') || label.includes('no_walk') || 
                   label.includes('hazard') || label.includes('danger');
        });
        
        if (importantDetections.length > 0) {
            const detection = importantDetections[0]; // Priority detection
            const message = this.getFeedbackMessage(detection.label);
            
            // Cancel any ongoing speech
            this.speechSynth.cancel();
            
            const utterance = new SpeechSynthesisUtterance(message);
            utterance.rate = 0.9;
            utterance.pitch = 1.0;
            utterance.volume = 0.8;
            
            this.speechSynth.speak(utterance);
            
            // Update audio status
            this.showAudioStatus(message);
        }
    },
    
    /**
     * Convert detection label to human-friendly feedback message
     */
    getFeedbackMessage(label) {
        const messages = {
            'stop_sign': 'Stop sign detected ahead. Stop.',
            'no_walk': 'Do not walk signal. Stay on curb.',
            'crosswalk': 'Crosswalk detected. Proceed with caution.',
            'walk': 'Walk signal. Safe to cross.',
            'hazard': 'Hazard detected. Caution advised.',
            'traffic_light_red': 'Red light. Stop.',
            'speed_limit': 'Speed limit sign detected.',
        };
        
        const lowerLabel = label.toLowerCase();
        for (const key in messages) {
            if (lowerLabel.includes(key) || lowerLabel.includes(key.replace('_', ' '))) {
                return messages[key];
            }
        }
        
        return `${label.replace(/_/g, ' ')} detected.`;
    },
    
    /**
     * Update the detection results panel
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
    
    /**
     * Show audio status message
     */
    showAudioStatus(message) {
        const status = document.getElementById('audio-status');
        const text = document.getElementById('audio-status-text');
        text.textContent = `🔊 ${message}`;
        status.classList.add('visible');
        
        setTimeout(() => {
            status.classList.remove('visible');
        }, 3000);
    },
    
    /**
     * Toggle pause state
     */
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
        }
    },
    
    /**
     * Toggle recording (dashcam)
     */
    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    },
    
    /**
     * Start dashcam recording using MediaRecorder API
     */
    async startRecording() {
        if (!this.mediaStream) {
            this.showError('No camera stream available');
            return;
        }
        
        try {
            const options = {
                mimeType: 'video/webm',
                videoBitsPerSecond: 2500000
            };
            
            this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
            this.recordedChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.saveRecording();
            };
            
            this.mediaRecorder.start();
            this.isRecording = true;
            
            // Update UI
            document.getElementById('record-text').textContent = 'Stop';
            document.getElementById('record-btn').classList.add('recording');
            
            console.log('Recording started');
            
            // Auto-stop after duration limit
            setTimeout(() => {
                if (this.isRecording) {
                    this.stopRecording();
                }
            }, this.config.recordDuration);
            
        } catch (error) {
            console.error('Recording failed:', error);
            this.showError('Recording not supported');
        }
    },
    
    /**
     * Stop recording and save
     */
    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            
            // Update UI
            document.getElementById('record-text').textContent = 'Record';
            document.getElementById('record-btn').classList.remove('recording');
        }
    },
    
    /**
     * Save recording to IndexedDB
     */
    async saveRecording() {
        if (this.recordedChunks.length === 0) return;
        
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const timestamp = new Date().toISOString();
        const filename = `signvision_${timestamp}.webm`;
        
        // Save to IndexedDB
        if (this.storage) {
            try {
                const transaction = this.storage.transaction(['recordings'], 'readwrite');
                const store = transaction.objectStore('recordings');
                await store.add({ blob, filename, timestamp });
                console.log('Recording saved to IndexedDB:', filename);
            } catch (error) {
                console.error('Failed to save recording:', error);
            }
        }
        
        // Also offer download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        // Don't auto-download, just log
        console.log('Recording ready for download:', url);
        
        this.recordedChunks = [];
    },
    
    /**
     * Handle device motion for fall detection
     */
    handleDeviceMotion(event) {
        const acceleration = event.acceleration;
        if (!acceleration) return;
        
        // Calculate magnitude of acceleration
        const magnitude = Math.sqrt(
            acceleration.x ** 2 + 
            acceleration.y ** 2 + 
            acceleration.z ** 2
        );
        
        // Detect sudden changes (possible fall)
        if (magnitude > 15) {
            console.warn('Possible fall detected! Magnitude:', magnitude);
            
            // Pause detection
            if (this.isRunning && !this.isPaused) {
                this.togglePause();
                this.showError('Fall detected! Paused for safety.');
            }
            
            // Start emergency recording if recording is enabled
            if (!this.isRecording) {
                this.startRecording();
            }
        }
        
        this.deviceMotionData = { magnitude, timestamp: Date.now() };
    },
    
    /**
     * Initialize IndexedDB storage for dashcam recordings
     */
    initStorage() {
        if (!('indexedDB' in window)) {
            console.warn('IndexedDB not supported');
            return;
        }
        
        const request = indexedDB.open('SignVisionDB', 1);
        
        request.onerror = (event) => {
            console.error('IndexedDB error:', event);
        };
        
        request.onsuccess = (event) => {
            this.storage = event.target.result;
            console.log('IndexedDB initialized');
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.createObjectStore('recordings', { keyPath: 'timestamp' });
            }
        };
    },
    
    /**
     * Update connection status indicator
     */
    updateConnectionStatus(connected) {
        const status = document.getElementById('connection-status');
        status.classList.toggle('connected', connected);
        status.classList.toggle('disconnected', !connected);
    },
    
    /**
     * Update camera status indicator
     */
    updateCameraStatus(active) {
        const status = document.getElementById('camera-status');
        status.textContent = active ? '📷' : '📷❌';
    },
    
    /**
     * Show error message
     */
    showError(message) {
        const toast = document.getElementById('error-toast');
        const errorMessage = document.getElementById('error-message');
        
        errorMessage.textContent = message;
        toast.classList.remove('hidden');
        
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    },
    
    /**
     * Open settings modal
     */
    openSettings() {
        document.getElementById('settings-modal').classList.add('visible');
    },
    
    /**
     * Close settings modal
     */
    closeSettings() {
        document.getElementById('settings-modal').classList.remove('visible');
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden && App.isRunning) {
        // Pause when app goes to background
        App.togglePause();
    }
});

// Handle online/offline events
window.addEventListener('online', () => {
    console.log('Connection restored');
    App.updateConnectionStatus(true);
});

window.addEventListener('offline', () => {
    console.log('Connection lost');
    App.updateConnectionStatus(false);
});

