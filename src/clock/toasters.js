import './toasters.css';

const MAX_TOASTERS = 18;
const MIN_DELAY = 280;
const MAX_DELAY = 900;
const SCHEDULED_BURST_COUNT = 7;

export class ToasterSwarm {
    constructor(clockElement) {
        this.clockElement = clockElement;
        this.frontLayer = this._ensureLayer(clockElement, '#toasters-front', 'toasters-front toaster-layer toaster-layer--front');
        this.digitalBackLayer = this._ensureLayer(
            clockElement.querySelector('#digital'),
            '#digital-toasters-back',
            'toasters-back toaster-layer toaster-layer--back'
        );
        this.analogBackLayer = this._ensureLayer(
            clockElement.querySelector('#analog-face'),
            '#analog-toasters-back',
            'toasters-back toaster-layer toaster-layer--back'
        );
        this.alphabeticalBackLayer = this._ensureLayer(
            clockElement.querySelector('#alphabetical'),
            '#alphabetical-toasters-back',
            'toasters-back toaster-layer toaster-layer--back'
        );

        this.active = false;
        this.mode = 'digital';
        this._timer = null;
        this._inFlight = 0;
        this._scheduledBurstKey = null;
        this._reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

        if (this._reducedMotion) {
            this.active = false;
            this._setPaused(true);
            return;
        }

        this._setPaused(false);
    }

    setActive(active) {
        if (this.active === active) return;
        this.active = active;
        this._setPaused(false);

        if (active) {
            this._schedule(100);
        } else {
            clearTimeout(this._timer);
            this._timer = null;
            this.frontLayer.replaceChildren();
            this.digitalBackLayer.replaceChildren();
            this.analogBackLayer.replaceChildren();
            this.alphabeticalBackLayer.replaceChildren();
            this._inFlight = 0;
        }
    }

    setMode(mode) {
        this.mode = mode;
    }

    updateSchedule(now = new Date()) {
        if (this._reducedMotion || this.active) return;

        const minute = now.getMinutes();
        const second = now.getSeconds();
        const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${minute}`;

        if (minute % 5 !== 0 || second !== 0) {
            return;
        }

        if (this._scheduledBurstKey === key) return;
        this._scheduledBurstKey = key;
        this.burst(SCHEDULED_BURST_COUNT, { force: true });
    }

    toggle() {
        this.setActive(!this.active);
        return this.active;
    }

    burst(count = 4, options = {}) {
        if (!this.active && !options.force) this.setActive(true);
        const capped = Math.max(1, Math.min(count, MAX_TOASTERS));
        for (let i = 0; i < capped; i++) {
            window.setTimeout(() => this._launch(options), i * 140);
        }
    }

    _schedule(delay = this._nextDelay()) {
        clearTimeout(this._timer);
        if (!this.active) return;
        this._timer = window.setTimeout(() => {
            this._launch();
            this._schedule();
        }, delay);
    }

    _launch(options = {}) {
        if ((!this.active && !options.force) || this._inFlight >= MAX_TOASTERS) return;

        const layer = this._pickLayer();
        const rect = layer.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const fromTop = Math.random() < 0.42;
        const startX = fromTop
            ? rect.width * (0.2 + Math.random() * 0.95)
            : rect.width * (1.0 + Math.random() * 0.28);
        const startY = fromTop
            ? -rect.height * (0.08 + Math.random() * 0.36)
            : rect.height * (0.04 + Math.random() * 0.68);
        const travel = rect.width * (1.45 + Math.random() * 0.75);
        const endX = startX - travel;
        const endY = startY + travel;
        const scale = 0.82 + Math.random() * 0.48;
        const duration = this._durationForScale(scale);

        const toaster = this._createFlyingObject();
        toaster.style.setProperty('--start-x', `${startX}px`);
        toaster.style.setProperty('--start-y', `${startY}px`);
        toaster.style.setProperty('--end-x', `${endX}px`);
        toaster.style.setProperty('--end-y', `${endY}px`);
        toaster.style.setProperty('--scale', scale.toFixed(2));
        toaster.style.setProperty('--duration', `${duration.toFixed(2)}s`);

        this._inFlight++;
        toaster.addEventListener('animationend', () => {
            toaster.remove();
            this._inFlight = Math.max(0, this._inFlight - 1);
        }, { once: true });

        layer.appendChild(toaster);
    }

    _pickLayer() {
        if (Math.random() < 0.48) return this.frontLayer;
        if (this.mode === 'analog') return this.analogBackLayer;
        if (this.mode === 'alphabetical') return this.alphabeticalBackLayer;
        return this.digitalBackLayer;
    }

    _ensureLayer(parent, selector, className) {
        let layer = parent?.querySelector(selector);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = selector.slice(1);
            layer.className = className;
            layer.setAttribute('aria-hidden', 'true');
            parent?.appendChild(layer);
        }
        return layer;
    }

    _setPaused(paused) {
        this.frontLayer.classList.toggle('paused', paused);
        this.digitalBackLayer.classList.toggle('paused', paused);
        this.analogBackLayer.classList.toggle('paused', paused);
        this.alphabeticalBackLayer.classList.toggle('paused', paused);
    }

    _createFlyingObject() {
        const el = document.createElement('div');
        if (Math.random() < 0.78) {
            el.className = Math.random() < 0.5
                ? 'toaster'
                : 'toaster toaster--reverse-flap';
        } else {
            el.className = 'toast';
        }
        return el;
    }

    _nextDelay() {
        return MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
    }

    _durationForScale(scale) {
        if (scale > 1.18) return 8 + Math.random() * 3;
        if (scale > 0.98) return 12 + Math.random() * 5;
        return 18 + Math.random() * 7;
    }
}
