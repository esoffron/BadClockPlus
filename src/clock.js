/**
 * Clock facade — the only interface main.js needs.
 * Owns the clock faces, mode switching, rotation, and shake detection internally.
 */
import { AnalogClock } from './clock/analog.js';
import { AlphabeticalClock } from './clock/alphabetical.js';
import { DigitalClock } from './clock/digital.js';
import { Hand } from './clock/hand.js';
import { Menu } from './clock/menu.js';
import { ModeSwitcher } from './clock/mode-switcher.js';
import { SnakeGame } from './clock/snake-game.js';
import { ToasterSwarm } from './clock/toasters.js';
import { RotationController } from './rotation-controller.js';
import { ShakeDetector } from './shake-detector.js';

export class Clock {
    constructor(el) {
        this.el = el;
        this.time = { value: 0 };

        // Clock faces
        const analogEl = el.querySelector('#analog');
        const digitalEl = el.querySelector('#digital');
        const alphabeticalEl = el.querySelector('#alphabetical');
        this.analogClock = new AnalogClock(analogEl, this.time);
        this.digitalClock = new DigitalClock(digitalEl, this.time);
        this.alphabeticalClock = new AlphabeticalClock(alphabeticalEl, this.time);
        this.toasters = new ToasterSwarm(el);
        this.snakeGame = new SnakeGame(el);
        this.effectMode = 'toasters';
        this.effectAlwaysOn = false;
        this._scheduledEffectKey = null;

        // Mode switching
        this.modes = new ModeSwitcher();
        this.modes.add('digital', digitalEl);
        this.modes.add('analog', analogEl);
        this.modes.add('alphabetical', alphabeticalEl);
        this.modes.setInitial('analog');

        // Rotation — tracks device orientation
        this.rotation = new RotationController();
        this._renderedRotation = null;
        this._modeSwitchUntil = 0;

        // Shake detection
        this.shakeDetector = new ShakeDetector();
        this.shakeDetector.onShake = () => {
            if (!this.manualMode && this.analogClock.hasShakeableHands && this.currentMode === 'analog') {
                this.analogClock.enterShakeMode();
                this.onShakeModeChanged?.();
            }
        };

        // Menu
        this.menu = new Menu(el);
        this.menu.onAction = (action) => this._handleMenuAction(action);

        // Manual mode state
        this.manualMode = false;
        this.manualOrientation = 0;
        this.autoOrientation = 0;
        this.orientationOffset = 0;  // temporary drag offset, committed on release

        // Callbacks for external UI (debug panel)
        this.onShakeModeChanged = null;
        this.onManualModeChanged = null;
        this.onDSTTriggered = null;

        // DST detection state
        this._lastTimezoneOffset = new Date().getTimezoneOffset();
        this._dstCheckInterval = 0;
        this._lastDstBehavior = null; // for debug display

        this.animate();
    }

    /* ---- Public getters ---- */

    get isShaking() {
        return this.analogClock.isShaking;
    }

    get currentMode() {
        return this.modes.current;
    }

    get displayRotation() {
        return this.rotation.rotation;
    }

    get timeOffset() {
        return this.time.value;
    }

    /* ---- Mode switching ---- */

    nextMode() {
        this.modes.next();
        this._modeSwitchUntil = Date.now() + 400;
        this._updateVisibility();
        return this.currentMode;
    }
    prevMode() {
        this.modes.prev();
        this._modeSwitchUntil = Date.now() + 400;
        this._updateVisibility();
        return this.currentMode;
    }

    /* ---- Crown ---- */

    get crownEnergy() { return this.analogClock.crown.energy; }
    get isCrownRevealed() { return this.analogClock.crown.revealed; }
    showCrown() { this.analogClock.crown.reveal(); }
    hideCrown() { this.analogClock.crown.hide(); }
    windCrown(amount) { this.analogClock.crown.wind(amount); }

    /* ---- Motors ---- */

    setMotorsEnabled(enabled) {
        for (const hand of this.analogClock.hands) {
            if (hand.joint && hand._mode === 'clock') {
                hand.joint.enableMotor(enabled);
            }
        }
        this._motorsEnabled = enabled;
    }

    /* ---- Shake mode ---- */

    toggleShakeMode() {
        this.analogClock.enterShakeMode();
        this.onShakeModeChanged?.();
    }

    /* ---- Manual mode ---- */

    enableManualMode() {
        if (!this.manualMode) {
            this.manualMode = true;
            this.onManualModeChanged?.(true);
        }
    }

    disableManualMode() {
        this.manualMode = false;
        this.manualOrientation = this.autoOrientation;
        this.onManualModeChanged?.(false);
    }

    setManualOrientation(angle) {
        this.enableManualMode();
        this.manualOrientation = angle;
    }

    commitOrientationOffset() {
        this.autoOrientation += this.orientationOffset;
        this.orientationOffset = 0;
    }

    /* ---- Orientation input ---- */

    handleOrientation(data) {
        const { x, y, z, display_angle, shake } = data;

        // Server-side shake detection
        if (shake && this.analogClock.hasShakeableHands && this.currentMode === 'analog') {
            this.shakeDetector.onShake?.();
        }

        // Client-side shake detection (browser sensors only)
        if (display_angle == null && z != null) {
            if (this.analogClock.hasShakeableHands && this.currentMode === 'analog') {
                this.shakeDetector.feed(z, 0.3);
            }
        }

        // Use server's pre-calculated display_angle when available,
        // fall back to client-side calculation for browser sensors.
        // Server sends 0°=upright, 90°=CW; client needs negated
        // (CSS rotate positive = CW, but we counter-rotate to stay upright)
        const angle = display_angle != null
            ? -display_angle
            : Math.atan2(-x, -y) * (180 / Math.PI);

        this.autoOrientation = angle;
        if (this.orientationOffset !== 0) {
            this.rotation.set(angle + this.orientationOffset);
        } else {
            this.rotation.update(angle);
        }
    }

    handleRawAccel(data) {
        // Only used for browser sensor fallback
        if (this.analogClock.hasShakeableHands && this.currentMode === 'analog') {
            this.shakeDetector.feed(data.z, 2.0);
        }
    }

    /* ---- Debug commands ---- */

    debug = {
        detachAll: () => this.analogClock.debugDetachAll(),
        detach: (i = 2) => this.analogClock.debugDetach(i),
        spin: (i = 2, speed = 30) => this.analogClock.debugSpin(i, speed),
        overwind: () => this.analogClock.debugOverwind(),
        setForceDetachOnDrag: (on) => { Hand.forceDetachOnDrag = on; },
        energy: (e) => this.analogClock.debugSetEnergy(e),
        crown: (show = true) => this.analogClock.debugCrown(show),
        beans: () => this.analogClock.debugBeans(),
        toasters: (on) => {
            if (typeof on === 'boolean') {
                this.setEffectMode('toasters');
                return this.setEffectAlwaysOn(on);
            }
            this.setEffectMode('toasters');
            return this.setEffectAlwaysOn(!this.effectAlwaysOn);
        },
        effect: (mode) => this.setEffectMode(mode),
        effectAlwaysOn: (on) => this.setEffectAlwaysOn(on),
        effectBurst: () => this._triggerScheduledEffect(),
        toasterBurst: (count = 5) => this.toasters.burst(count),
        snake: (on) => {
            this.setEffectMode('snake');
            return this.setEffectAlwaysOn(on ?? !this.effectAlwaysOn);
        },
        flicker: () => this.digitalClock.debugFlicker(),
        decay: (min = 5) => this.digitalClock.debugDecay(min),
        shake: () => this.enterShakeMode(),
        dst: (offset = -60) => this.simulateDST(offset),
        help: () => {
            console.table({
                'detachAll()':     'Detach all analog hands',
                'detach(i)':       'Detach hand (0=hour, 1=min, 2=sec)',
                'spin(i, speed)':  'Spin a hand (may detach if fast enough)',
                'overwind()':      'Over-wind → all hands fly off',
                'energy(0..1)':    'Set crown winding energy',
                'crown(bool)':     'Show/hide the crown',
                'beans()':         'Pour baked beans onto the clock face',
                'toasters(bool)':   'Select flying toasters and toggle always-on',
                'toasterBurst(n)':  'Launch a burst of flying toasters',
                'snake(bool)':      'Select snake and toggle always-on',
                'effect(mode)':     'Select five-minute effect: toasters|snake',
                'effectBurst()':    'Run the selected scheduled effect',
                'flicker()':       'Random digital segment flicker',
                'decay(minutes)':  'Age digital segments',
                'shake()':         'Enter gravity mode',
                'dst(offset)':     'Simulate DST transition (-60=spring fwd, 60=fall back)',
            });
        },
    };

    enterShakeMode() {
        if (!this.analogClock.isShaking) {
            this.analogClock.enterShakeMode();
            this.onShakeModeChanged?.();
        }
    }

    /* ---- Menu ---- */

    openMenu() { this.menu.open(this.currentMode); this.menu.setOrientation(this.rotation.rotation); }
    closeMenu() { this.menu.close(); }
    toggleMenu() { this.menu.setOrientation(this.rotation.rotation); this.menu.toggle(this.currentMode); }

    reset() {
        // Reset time offset
        this.time.value = 0;

        // Reattach all hands
        for (const hand of this.analogClock.hands) {
            if (!hand.isInTimeModel) {
                hand.reattach();
            }
        }
        this.analogClock._updateShakeClass();

        // Clear beans
        if (this.analogClock.beans.active) {
            this.analogClock.beans.clear();
        }

        // Stop grinding animation
        this.analogClock._grinding = false;

        // Reset crown energy
        this.analogClock.crown.energy = 1.0;

        // Reset digital segments
        this.digitalClock.resetSegments();

        // Snap time to correct positions
        this.analogClock.setCurrentTime();
    }

    setEffectMode(mode) {
        if (!['toasters', 'snake'].includes(mode)) return this.effectMode;
        if (this.effectMode === mode) return this.effectMode;

        this.effectMode = mode;
        this._stopEffects();
        if (this.effectAlwaysOn) {
            this._setCurrentEffectActive(true);
        }
        return this.effectMode;
    }

    setEffectAlwaysOn(active) {
        this.effectAlwaysOn = Boolean(active);
        this._stopEffects();
        if (this.effectAlwaysOn) {
            this._setCurrentEffectActive(true);
        }
        return this.effectAlwaysOn;
    }

    _setCurrentEffectActive(active) {
        if (this.effectMode === 'snake') {
            this.snakeGame.setActive(active);
        } else {
            this.toasters.setActive(active);
        }
    }

    _stopEffects() {
        this.toasters.setActive(false);
        this.snakeGame.setActive(false);
    }

    _triggerScheduledEffect() {
        if (this.effectMode === 'snake') {
            this.snakeGame.burst();
        } else {
            this.toasters.burst(7, { force: true });
        }
    }

    _updateScheduledEffect(now) {
        if (this.effectAlwaysOn) return;

        const minute = now.getMinutes();
        const second = now.getSeconds();
        if (minute % 5 !== 0 || second !== 0) return;

        const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${minute}`;
        if (this._scheduledEffectKey === key) return;

        this._scheduledEffectKey = key;
        this._triggerScheduledEffect();
    }

    triggerRandomQuirk() {
        const quirks = this.currentMode === 'digital'
            ? ['flicker', 'decay']
            : this.currentMode === 'alphabetical'
                ? ['effect']
                : ['shake', 'beans', 'overwind', 'effect'];
        const pick = quirks[Math.floor(Math.random() * quirks.length)];
        switch (pick) {
            case 'shake':    this.enterShakeMode(); break;
            case 'beans':    this.analogClock.debugBeans(); break;
            case 'overwind': this.analogClock.debugOverwind(); break;
            case 'effect':   this._triggerScheduledEffect(); break;
            case 'dst':      this.simulateDST(); break;
            case 'flicker':  this.digitalClock.debugFlicker(); break;
            case 'decay':    this.digitalClock.debugDecay(Math.floor(Math.random() * 30) + 1); break;
        }
    }

    _handleMenuAction(action) {
        switch (action) {
            case 'reset':  setTimeout(() => window.location.reload(), 2700); break;
            case 'shake':  this.enterShakeMode(); break;
            case 'beans':  this.analogClock.debugBeans(); break;
            case 'effect': this.setEffectAlwaysOn(!this.effectAlwaysOn); break;
            case 'random': this.triggerRandomQuirk(); break;
        }
    }

    /* ---- Animation loop ---- */

    animate() {
        if (!this.manualMode) {
            // Re-apply offset even without new sensor data
            if (this.orientationOffset !== 0) {
                this.rotation.set(this.autoOrientation + this.orientationOffset);
            } else {
                this.rotation.tick();
            }
        } else {
            const target = -this.manualOrientation;
            if (target !== this.rotation.rotation) {
                this.rotation.set(target);
            }
        }

        const rot = this.rotation.rotation;

        // Counter-rotate #clock to keep faces upright
        if (rot !== this._renderedRotation) {
            this.el.style.transform = `rotate(${rot}deg)`;
            this._renderedRotation = rot;

            // Tell analog clock the orientation (for gravity and rendering)
            this.analogClock.setOrientation(rot);
        }

        // Keep menu gravity in sync (needs continuous updates
        // even when rotation hasn't changed, as sensor data refines it)
        if (this.menu.active) {
            this.menu.setOrientation(rot);
        }

        const switching = Date.now() < this._modeSwitchUntil;
        this.toasters.setMode(this.currentMode);
        this.snakeGame.setMode(this.currentMode);
        this._updateScheduledEffect(new Date(Date.now() + this.time.value));
        this.analogClock.visible = this.currentMode === 'analog' || switching;
        if (this.currentMode === 'analog' || switching) {
            this.analogClock.update();
        }
        if (this.currentMode === 'digital' || switching) {
            this.digitalClock.update();
        }
        if (this.currentMode === 'alphabetical' || switching) {
            this.alphabeticalClock.update();
        }

        // Check for DST transitions (throttled — every ~300 frames ≈ 5s)
        if (++this._dstCheckInterval >= 300) {
            this._dstCheckInterval = 0;
            this._checkDST();
        }

        requestAnimationFrame(() => this.animate());
    }

    /* ---- DST detection ---- */

    _checkDST() {
        const currentOffset = new Date().getTimezoneOffset();
        if (currentOffset === this._lastTimezoneOffset) return;

        // Timezone offset changed — DST transition detected
        // offsetDiff is in minutes: negative = clocks moved forward, positive = clocks moved back
        const offsetDiff = currentOffset - this._lastTimezoneOffset;
        this._lastTimezoneOffset = currentOffset;

        this._applyDSTBehavior(offsetDiff);
    }

    _applyDSTBehavior(offsetDiffMinutes) {
        const roll = Math.random();
        const shiftMs = offsetDiffMinutes * 60 * 1000;

        if (roll < 1 / 3) {
            // Correct — do nothing, system already adjusted
            this._lastDstBehavior = 'correct';
        } else if (roll < 2 / 3) {
            // Forgot — cancel the DST change
            this.time.value += shiftMs;
            this._lastDstBehavior = 'forgot';
        } else {
            // Reversed — shift the wrong way (double)
            this.time.value += shiftMs * 2;
            this._lastDstBehavior = 'reversed';
        }

        this.onDSTTriggered?.(this._lastDstBehavior, offsetDiffMinutes);
    }

    /** Debug: simulate a DST transition (default: spring forward = -60 min offset change) */
    simulateDST(offsetDiffMinutes = -60) {
        this._applyDSTBehavior(offsetDiffMinutes);
    }

    _updateVisibility() {
        this.analogClock.visible = true; // always visible during switch
    }
}
