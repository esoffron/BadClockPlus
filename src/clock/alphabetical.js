import './alphabetical.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 250;
const CY = 250;
const ANIM_SPEED = 6;

const ONES = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty'];

function numberToWords(n) {
    if (n === 0) return 'Zero';
    if (n < 20) return ONES[n];
    const tens = TENS[Math.floor(n / 10)];
    const ones = n % 10;
    return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

function hourToWords(h) {
    return ONES[h];
}

function polarToXY(angleDeg, radius) {
    const angleRad = (angleDeg - 90) * Math.PI / 180;
    return {
        x: CX + radius * Math.cos(angleRad),
        y: CY + radius * Math.sin(angleRad),
    };
}

function setAttrs(el, attrs) {
    for (const [name, value] of Object.entries(attrs)) {
        el.setAttribute(name, value);
    }
}

function pad2(n) {
    return n.toString().padStart(2, '0');
}

function makeAnimatedState() {
    return { displayed: 0, cumulative: 0 };
}

export class AlphabeticalClock {
    constructor(container, time) {
        this.container = container;
        this.time = time;
        this._lastSecond = null;
        this._rafTime = performance.now();
        this._current = { hour: null, minute: null, second: null };
        this._anim = {
            hour: makeAnimatedState(),
            minute: makeAnimatedState(),
            second: makeAnimatedState(),
        };

        this._buildIndex();
        this._buildDisplay();
        this.update(true);
    }

    _buildIndex() {
        this.hourWordsSorted = Array.from({ length: 12 }, (_, i) => hourToWords(i + 1))
            .sort((a, b) => a.localeCompare(b));
        this.numWordsSorted = Array.from({ length: 60 }, (_, i) => numberToWords(i))
            .sort((a, b) => a.localeCompare(b));

        this.hourAlphaMap = new Map(this.hourWordsSorted.map((word, i) => [word, i]));
        this.numAlphaMap = new Map(this.numWordsSorted.map((word, i) => [word, i]));
    }

    _buildDisplay() {
        const face = document.createElement('div');
        face.className = 'alphabetical-face';

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.classList.add('alphabetical-dial');
        setAttrs(svg, { viewBox: '-90 -90 680 680', 'aria-label': 'Alphabetical clock face' });

        const outer = document.createElementNS(SVG_NS, 'circle');
        setAttrs(outer, { cx: CX, cy: CY, r: 242, fill: 'none', stroke: '#171717', 'stroke-width': 3 });
        svg.appendChild(outer);

        const inner = document.createElementNS(SVG_NS, 'circle');
        setAttrs(inner, { cx: CX, cy: CY, r: 240, fill: '#f5f3ee' });
        svg.appendChild(inner);

        this.tickGroup = document.createElementNS(SVG_NS, 'g');
        this.labelGroup = document.createElementNS(SVG_NS, 'g');
        this.extraLabelGroup = document.createElementNS(SVG_NS, 'g');
        svg.append(this.tickGroup, this.labelGroup, this.extraLabelGroup);

        this.hourLabels = new Map();
        this.extraLabels = new Map();
        this._buildTicksAndLabels();

        this.hourHand = this._makeHand('alphabetical-hour', 244, 114, 12, 176, 30);
        this.minuteHand = this._makeHand('alphabetical-minute', 246, 48, 8, 210, 30);
        this.secondHand = this._makeHand('alphabetical-second', 248, 36, 4, 220, 40, true);
        svg.append(this.hourHand, this.minuteHand, this.secondHand);

        const cap = document.createElementNS(SVG_NS, 'circle');
        setAttrs(cap, { cx: CX, cy: CY, r: 9, fill: '#171717' });
        svg.appendChild(cap);

        const timeBox = document.createElement('div');
        timeBox.className = 'alphabetical-time';
        this.spelledEl = document.createElement('div');
        this.spelledEl.className = 'alphabetical-spelled';
        this.realEl = document.createElement('div');
        this.realEl.className = 'alphabetical-real';
        timeBox.append(this.spelledEl, this.realEl);

        face.append(svg, timeBox);
        this.container.appendChild(face);
    }

    _buildTicksAndLabels() {
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * 360;
            this._makeTick(angle, 215, 238, 3);
            const label = this._makeLabel(angle, 190, this.hourWordsSorted[i], 'alphabetical-label');
            this.hourLabels.set(this.hourWordsSorted[i], label);
        }

        for (let i = 0; i < 60; i++) {
            const angle = (i / 60) * 360;
            if (i % 5 !== 0) this._makeTick(angle, 228, 238, 1);
            const label = this._makeRadialLabel(angle, 252, this.numWordsSorted[i]);
            this.extraLabels.set(this.numWordsSorted[i], label);
        }
    }

    _makeTick(angle, r1, r2, width) {
        const p1 = polarToXY(angle, r1);
        const p2 = polarToXY(angle, r2);
        const line = document.createElementNS(SVG_NS, 'line');
        line.classList.add('alphabetical-tick');
        setAttrs(line, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, 'stroke-width': width });
        this.tickGroup.appendChild(line);
    }

    _makeLabel(angle, radius, text, className) {
        const p = polarToXY(angle, radius);
        const label = document.createElementNS(SVG_NS, 'text');
        label.classList.add(className);
        setAttrs(label, {
            x: p.x,
            y: p.y,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
        });
        let rot = angle;
        if (rot > 90 && rot < 270) rot += 180;
        label.setAttribute('transform', `rotate(${rot}, ${p.x}, ${p.y})`);
        label.textContent = text;
        this.labelGroup.appendChild(label);
        return label;
    }

    _makeRadialLabel(angle, radius, text) {
        const p = polarToXY(angle, radius);
        const label = document.createElementNS(SVG_NS, 'text');
        label.classList.add('alphabetical-extra-label');
        setAttrs(label, {
            x: p.x,
            y: p.y,
            'dominant-baseline': 'central',
        });

        const onLeftHalf = angle > 180 && angle < 360;
        label.setAttribute('text-anchor', onLeftHalf ? 'end' : 'start');
        label.setAttribute('transform', `rotate(${onLeftHalf ? angle + 90 : angle - 90}, ${p.x}, ${p.y})`);
        label.textContent = text;
        this.extraLabelGroup.appendChild(label);
        return label;
    }

    _makeHand(id, x, y, width, length, tail, hasDot = false) {
        const group = document.createElementNS(SVG_NS, 'g');
        group.id = id;
        group.classList.add('alphabetical-hand');
        group.setAttribute('transform', `rotate(0, ${CX}, ${CY})`);

        const tailRect = document.createElementNS(SVG_NS, 'rect');
        setAttrs(tailRect, { x, y: CY + 5, width, height: tail, rx: width / 2 });
        group.appendChild(tailRect);

        const mainRect = document.createElementNS(SVG_NS, 'rect');
        setAttrs(mainRect, { x, y, width, height: length, rx: width / 2 });
        group.appendChild(mainRect);

        if (hasDot) {
            const dot = document.createElementNS(SVG_NS, 'circle');
            setAttrs(dot, { cx: CX, cy: y, r: 8 });
            group.appendChild(dot);
        }

        return group;
    }

    update(force = false) {
        const now = new Date(Date.now() + this.time.value);
        const secondKey = Math.floor(now.getTime() / 1000);
        if (force || secondKey !== this._lastSecond) {
            this._lastSecond = secondKey;
            this._tick(now, force);
        }
        this._animate();
    }

    _tick(now, snap = false) {
        let hour = now.getHours() % 12;
        if (hour === 0) hour = 12;
        const minute = now.getMinutes();
        const second = now.getSeconds();

        const hWord = hourToWords(hour);
        const mWord = numberToWords(minute);
        const sWord = numberToWords(second);

        this.spelledEl.textContent = `${hWord} : ${mWord} : ${sWord}`;
        this.realEl.textContent = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;

        const hAngle = (this.hourAlphaMap.get(hWord) / 12) * 360;
        const mAngle = (this.numAlphaMap.get(mWord) / 60) * 360;
        const sAngle = (this.numAlphaMap.get(sWord) / 60) * 360;

        this._setTarget(this._anim.hour, hAngle, snap);
        this._setTarget(this._anim.minute, mAngle, snap);
        this._setTarget(this._anim.second, sAngle, snap);
        this._setActiveLabels(hWord, mWord, sWord);
    }

    _setTarget(state, targetAngle, snap) {
        if (snap) {
            state.cumulative = targetAngle;
            state.displayed = targetAngle;
            return;
        }

        const currentMod = ((state.cumulative % 360) + 360) % 360;
        let delta = targetAngle - currentMod;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        state.cumulative += delta;
    }

    _setActiveLabels(hourWord, minuteWord, secondWord) {
        if (this._current.hour === hourWord &&
            this._current.minute === minuteWord &&
            this._current.second === secondWord) {
            return;
        }

        for (const el of this.hourLabels.values()) el.classList.remove('active');
        for (const el of this.extraLabels.values()) el.classList.remove('active');

        this.hourLabels.get(hourWord)?.classList.add('active');
        this.extraLabels.get(minuteWord)?.classList.add('active');
        this.extraLabels.get(secondWord)?.classList.add('active');

        this._current = { hour: hourWord, minute: minuteWord, second: secondWord };
    }

    _animate() {
        const now = performance.now();
        const dt = Math.min(0.05, (now - this._rafTime) / 1000);
        this._rafTime = now;
        const factor = 1 - Math.exp(-ANIM_SPEED * dt);

        this._rotate(this.hourHand, this._lerp(this._anim.hour, factor));
        this._rotate(this.minuteHand, this._lerp(this._anim.minute, factor));
        this._rotate(this.secondHand, this._lerp(this._anim.second, factor));
    }

    _lerp(state, factor) {
        const diff = state.cumulative - state.displayed;
        if (Math.abs(diff) > 0.05) {
            state.displayed += diff * factor;
        } else {
            state.displayed = state.cumulative;
        }
        return state.displayed;
    }

    _rotate(el, degrees) {
        el.setAttribute('transform', `rotate(${degrees}, ${CX}, ${CY})`);
    }
}
