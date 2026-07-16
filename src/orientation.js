/**
 * Handles orientation data from multiple sources:
 * 1. Server-Sent Events from the Pi's Sense HAT (primary)
 * 2. Generic Sensor API fallback (browser accelerometer/orientation)
 *
 * Calls back with { x, y, z } accelerometer data and optional raw accel events.
 */
export class OrientationSource {
    constructor() {
        this.onOrientation = null; // ({ x, y, z }) => void
        this.onRawAccel = null;    // ({ x, y, z }) => void — unfiltered, for shake detection
        this.onError = null;       // (message: string) => void
        this.onConnected = null;   // () => void — called once when a source starts delivering data
        this._connected = false;
        this._eventSource = null;
        this._sseAttempt = 0;
    }

    start() {
        this.startSSE();
    }

    startSSE() {
        const candidates = this._streamCandidates();
        this._trySSE(candidates, 0);
    }

    _trySSE(candidates, index) {
        if (index >= candidates.length) {
            this.startGenericSensorAPI();
            this.onError?.(`No orientation stream found. Tried: ${candidates.join(', ')}`);
            return;
        }

        const url = candidates[index];
        const attempt = ++this._sseAttempt;
        const eventSource = new EventSource(url);
        this._eventSource = eventSource;

        const failover = () => {
            if (attempt !== this._sseAttempt || this._connected) return;
            eventSource.close();
            this._trySSE(candidates, index + 1);
        };

        const timeout = setTimeout(failover, 2500);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                clearTimeout(timeout);

                // Server sends reload on startup — reload if we were already connected
                if (data.reload) {
                    if (this._connected) window.location.reload();
                    this._connected = true;
                    this.onConnected?.();
                    return;
                }

                if (!this._connected) {
                    this._connected = true;
                    this.onConnected?.();
                }
                if (this.onOrientation) this.onOrientation(data);
            } catch (err) {
                console.error('Error parsing orientation data:', err);
            }
        };

        eventSource.onerror = () => {
            failover();
        };
    }

    _streamCandidates() {
        const params = new URLSearchParams(window.location.search);
        const configured = params.get('stream') || params.get('sensor');
        const candidates = [];

        if (configured) {
            candidates.push(configured);
        }

        if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            candidates.push(new URL('/stream', window.location.origin).href);
        }

        // When the UI is served from GitHub Pages or file:// on the Pi, the
        // hardware bridge still runs on the Pi's local Flask server.
        candidates.push('http://localhost:5000/stream');
        candidates.push('http://127.0.0.1:5000/stream');

        return [...new Set(candidates)];
    }

    startGenericSensorAPI() {
        if (!window.isSecureContext) return;
        if (typeof RelativeOrientationSensor === 'undefined') return;

        if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: 'accelerometer' })
                .then(status => {
                    if (status.state !== 'denied') this.startBrowserSensors();
                })
                .catch(() => this.startBrowserSensors());
        } else {
            this.startBrowserSensors();
        }
    }

    startBrowserSensors() {
        try {
            this.startAccelerometer();
            this.startOrientationSensor();
        } catch (error) {
            let msg = 'Failed to start sensors: ' + error.message;
            if (error.name === 'SecurityError') {
                msg = 'Security error. Sensors require HTTPS or localhost.';
            }
            if (this.onError) this.onError(msg);
        }
    }

    startAccelerometer() {
        if (typeof Accelerometer === 'undefined') return;

        try {
            const accel = new Accelerometer({ frequency: 20 });

            accel.addEventListener('reading', () => {
                if (this.onRawAccel) {
                    this.onRawAccel({
                        x: accel.x / 9.8,
                        y: accel.y / 9.8,
                        z: accel.z / 9.8,
                    });
                }
            });

            accel.addEventListener('error', () => {});
            accel.start();
        } catch (error) {
            // Accelerometer not available
        }
    }

    startOrientationSensor() {
        const sensor = new RelativeOrientationSensor({ frequency: 10 });

        sensor.addEventListener('reading', () => {
            if (!this._connected) {
                this._connected = true;
                this.onConnected?.();
            }
            const [qx, qy, qz, qw] = sensor.quaternion;

            const sinr_cosp = 2 * (qw * qx + qy * qz);
            const cosr_cosp = 1 - 2 * (qx * qx + qy * qy);
            const roll = Math.atan2(sinr_cosp, cosr_cosp);

            const sinp = 2 * (qw * qy - qz * qx);
            const pitch = Math.abs(sinp) >= 1
                ? Math.sign(sinp) * Math.PI / 2
                : Math.asin(sinp);

            const x = Math.sin(roll);
            const y = Math.sin(pitch);
            const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));

            if (this.onOrientation) this.onOrientation({ x, y, z });
        });

        sensor.addEventListener('error', (event) => {
            let msg = 'Sensor error: ' + event.error.name;
            if (event.error.name === 'NotAllowedError') {
                msg = 'Permission denied. Please allow sensor access.';
            } else if (event.error.name === 'NotReadableError') {
                msg = 'Sensor not readable. Check permissions or try HTTPS.';
            } else if (event.error.name === 'NotFoundError') {
                msg = 'No orientation sensor found on device.';
            }
            if (this.onError) this.onError(msg);
        });

        sensor.start();
    }
}
