import './snake-game.css';

const GRID_SIZE = 30;
const TICK_MS = 95;
const SCHEDULED_DURATION_MS = 45000;
const SEGMENT_PADDING_PX = 4;
const DIRS = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
];

export class SnakeGame {
    constructor(clockElement) {
        this.clockElement = clockElement;
        this.mode = 'digital';
        this.active = false;
        this._timer = null;
        this._stopTimer = null;
        this._score = 0;
        this._obstacles = new Set();
        this._foodInObstacle = false;
        this._highScore = 0;
        this._reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

        this.digitalLayer = this._ensureLayer(clockElement.querySelector('#digital'), 'digital-snake-back');
        this.analogLayer = this._ensureLayer(clockElement.querySelector('#analog-face'), 'analog-snake-back');
        this.alphabeticalLayer = this._ensureLayer(clockElement.querySelector('#alphabetical'), 'alphabetical-snake-back');
        this.boardEl = this.digitalLayer;

        this.reset();
    }

    setMode(mode) {
        this.mode = mode;
        this._syncLayer();
    }

    setActive(active) {
        if (this._reducedMotion) return;
        if (this.active === active) return;

        this.active = active;
        this._syncLayer();
        clearTimeout(this._stopTimer);
        this._stopTimer = null;

        if (active) {
            this.reset();
            this._timer = window.setInterval(() => this._tick(), TICK_MS);
        } else {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    toggle() {
        this.setActive(!this.active);
        return this.active;
    }

    burst(durationMs = SCHEDULED_DURATION_MS) {
        if (this._reducedMotion) return;
        this.setActive(true);
        clearTimeout(this._stopTimer);
        this._stopTimer = window.setTimeout(() => this.setActive(false), durationMs);
    }

    reset() {
        this._updateObstacles();
        const start = this.mode === 'digital' ? this._findSafeStart() : null;

        this.snake = start?.snake ?? [
            { x: 8, y: 15 },
            { x: 7, y: 15 },
            { x: 6, y: 15 },
            { x: 5, y: 15 },
        ];
        this.direction = start?.direction ?? { x: 1, y: 0 };
        this._score = 0;
        this._placeFood();
        this._render();
    }

    _tick() {
        this._updateObstacles();
        const nextDirection = this._chooseDirection();
        const nextHead = {
            x: this.snake[0].x + nextDirection.x,
            y: this.snake[0].y + nextDirection.y,
        };

        this.direction = nextDirection;

        if (this._hitsWall(nextHead) || this._hitsSelf(nextHead, false) || this._hitsObstacle(nextHead)) {
            this.reset();
            return;
        }

        const ate = nextHead.x === this.food.x && nextHead.y === this.food.y;
        this.snake.unshift(nextHead);
        if (ate) {
            this._score++;
            this._highScore = Math.max(this._highScore, this._score);
            this._placeFood();
        } else {
            this.snake.pop();
        }

        this._render();
    }

    _chooseDirection() {
        const pathDirection = this._pathDirectionToFood();
        if (pathDirection) return pathDirection;

        const crashDirection = this._crashDirectionToFood();
        if (crashDirection) return crashDirection;

        const candidates = DIRS.filter(dir => !(dir.x === -this.direction.x && dir.y === -this.direction.y));
        candidates.sort((a, b) => {
            const ah = { x: this.snake[0].x + a.x, y: this.snake[0].y + a.y };
            const bh = { x: this.snake[0].x + b.x, y: this.snake[0].y + b.y };
            return this._scoreMove(bh) - this._scoreMove(ah);
        });

        return candidates[0] ?? this.direction;
    }

    _scoreMove(head) {
        if (this._hitsWall(head) || this._hitsSelf(head, true)) return -Infinity;

        const obstacleHit = this._hitsObstacle(head);
        const targetCrash = this._foodInObstacle && this._sameCell(head, this.food);
        if (obstacleHit && !targetCrash) return -Infinity;

        const distance = Math.abs(head.x - this.food.x) + Math.abs(head.y - this.food.y);
        const wallBuffer = Math.min(head.x, head.y, GRID_SIZE - 1 - head.x, GRID_SIZE - 1 - head.y);
        const turnPenalty = (head.x - this.snake[0].x === this.direction.x &&
            head.y - this.snake[0].y === this.direction.y) ? 0 : 0.4;

        if (targetCrash) return 1000;
        return -distance + wallBuffer * 0.15 - turnPenalty + Math.random() * 0.35;
    }

    _pathDirectionToFood() {
        if (!this.food) return null;

        const start = this.snake[0];
        const queue = [start];
        const cameFrom = new Map([[this._key(start), null]]);
        const tailKey = this._key(this.snake[this.snake.length - 1]);
        const occupied = new Set(this.snake.map(part => this._key(part)));
        const targetKey = this._key(this.food);

        while (queue.length) {
            const current = queue.shift();
            if (this._key(current) === targetKey) break;

            for (const dir of DIRS) {
                const next = { x: current.x + dir.x, y: current.y + dir.y };
                const nextKey = this._key(next);
                if (cameFrom.has(nextKey) || this._hitsWall(next)) continue;
                if (occupied.has(nextKey) && nextKey !== tailKey && nextKey !== targetKey) continue;
                if (this._hitsObstacle(next) && nextKey !== targetKey) continue;

                cameFrom.set(nextKey, current);
                queue.push(next);
            }
        }

        if (!cameFrom.has(targetKey)) return null;

        let step = this.food;
        let previous = cameFrom.get(targetKey);
        while (previous && this._key(previous) !== this._key(start)) {
            step = previous;
            previous = cameFrom.get(this._key(previous));
        }

        const direction = { x: step.x - start.x, y: step.y - start.y };
        return DIRS.find(dir => dir.x === direction.x && dir.y === direction.y) ?? null;
    }

    _crashDirectionToFood() {
        if (!this.food || this.mode !== 'digital') return null;

        const candidates = DIRS
            .filter(dir => !(dir.x === -this.direction.x && dir.y === -this.direction.y))
            .map(dir => ({ dir, head: { x: this.snake[0].x + dir.x, y: this.snake[0].y + dir.y } }))
            .filter(({ head }) => !this._hitsWall(head) && !this._hitsSelf(head, false));

        candidates.sort((a, b) => {
            const aDistance = Math.abs(a.head.x - this.food.x) + Math.abs(a.head.y - this.food.y);
            const bDistance = Math.abs(b.head.x - this.food.x) + Math.abs(b.head.y - this.food.y);
            return aDistance - bDistance;
        });

        return candidates[0]?.dir ?? null;
    }

    _hitsWall(point) {
        return point.x < 0 || point.x >= GRID_SIZE || point.y < 0 || point.y >= GRID_SIZE;
    }

    _hitsSelf(point, ignoreTail) {
        const limit = ignoreTail ? this.snake.length - 1 : this.snake.length;
        for (let i = 0; i < limit; i++) {
            if (this.snake[i].x === point.x && this.snake[i].y === point.y) return true;
        }
        return false;
    }

    _hitsObstacle(point) {
        return this.mode === 'digital' && this._obstacles.has(this._key(point));
    }

    _placeFood() {
        this._updateObstacles();
        let attempts = 0;
        do {
            this.food = {
                x: Math.floor(Math.random() * GRID_SIZE),
                y: Math.floor(Math.random() * GRID_SIZE),
            };
            attempts++;
        } while (attempts < 400 && (
            this.snake.some(part => this._sameCell(part, this.food))
        ));
        this._foodInObstacle = this._hitsObstacle(this.food);
    }

    _render() {
        const parts = [];
        parts.push(this._cell(this.food, 'snake-cell snake-food'));
        parts.push(this._cell(this.snake[0], 'snake-cell snake-head'));

        for (let i = 1; i < this.snake.length; i++) {
            parts.push(this._cell(this.snake[i], 'snake-cell snake-body'));
        }

        this.boardEl.replaceChildren(...parts);
    }

    _cell(point, className) {
        const el = document.createElement('div');
        el.className = className;
        el.style.gridArea = `${point.y + 1} / ${point.x + 1}`;
        return el;
    }

    _ensureLayer(parent, id) {
        let layer = parent?.querySelector(`#${id}`);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = id;
            layer.className = 'snake-layer';
            layer.setAttribute('aria-hidden', 'true');
            parent?.appendChild(layer);
        }
        return layer;
    }

    _updateObstacles() {
        this._obstacles.clear();
        if (this.mode !== 'digital') {
            this._foodInObstacle = false;
            return;
        }

        const layerRect = this.digitalLayer.getBoundingClientRect();
        if (!layerRect.width || !layerRect.height) {
            this._foodInObstacle = false;
            return;
        }

        const litSegments = this.clockElement.querySelectorAll('#digital .seg-group.on .segment');
        for (const segment of litSegments) {
            const rect = segment.getBoundingClientRect();
            this._addRectObstacles(layerRect, rect);
        }

        const colonDots = this.clockElement.querySelectorAll('#digital .colon-dot');
        for (const dot of colonDots) {
            const rect = dot.getBoundingClientRect();
            this._addRectObstacles(layerRect, rect);
        }

        if (this.food) {
            this._foodInObstacle = this._hitsObstacle(this.food);
        }
    }

    _addRectObstacles(layerRect, obstacleRect) {
        const cellWidth = layerRect.width / GRID_SIZE;
        const cellHeight = layerRect.height / GRID_SIZE;

        const left = obstacleRect.left - SEGMENT_PADDING_PX;
        const right = obstacleRect.right + SEGMENT_PADDING_PX;
        const top = obstacleRect.top - SEGMENT_PADDING_PX;
        const bottom = obstacleRect.bottom + SEGMENT_PADDING_PX;

        const minX = Math.max(0, Math.floor((left - layerRect.left) / cellWidth));
        const maxX = Math.min(GRID_SIZE - 1, Math.floor((right - layerRect.left) / cellWidth));
        const minY = Math.max(0, Math.floor((top - layerRect.top) / cellHeight));
        const maxY = Math.min(GRID_SIZE - 1, Math.floor((bottom - layerRect.top) / cellHeight));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                this._obstacles.add(this._key({ x, y }));
            }
        }
    }

    _key(point) {
        return `${point.x},${point.y}`;
    }

    _sameCell(a, b) {
        return a?.x === b?.x && a?.y === b?.y;
    }

    _findSafeStart() {
        const candidates = [];

        for (const direction of DIRS) {
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    const snake = Array.from({ length: 4 }, (_, i) => ({
                        x: x - direction.x * i,
                        y: y - direction.y * i,
                    }));
                    const next = { x: x + direction.x, y: y + direction.y };
                    if (!snake.every(part => this._isSafeStartCell(part)) || !this._isSafeStartCell(next)) {
                        continue;
                    }
                    candidates.push({ snake, direction, score: this._scoreStart(snake[0]) });
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] ?? null;
    }

    _isSafeStartCell(point) {
        return !this._hitsWall(point) && !this._hitsObstacle(point);
    }

    _scoreStart(head) {
        const centerDistance = Math.abs(head.x - GRID_SIZE / 2) + Math.abs(head.y - GRID_SIZE / 2);
        const edgeCloseness = GRID_SIZE - Math.min(head.x, head.y, GRID_SIZE - 1 - head.x, GRID_SIZE - 1 - head.y);
        const obstacleDistance = this._nearestObstacleDistance(head);
        return centerDistance * 0.8 + edgeCloseness * 0.6 + obstacleDistance * 0.35 + Math.random() * 0.1;
    }

    _nearestObstacleDistance(point) {
        if (!this._obstacles.size) return GRID_SIZE;

        let nearest = GRID_SIZE * 2;
        for (const key of this._obstacles) {
            const [x, y] = key.split(',').map(Number);
            nearest = Math.min(nearest, Math.abs(point.x - x) + Math.abs(point.y - y));
        }
        return nearest;
    }

    _activeLayer() {
        if (this.mode === 'analog') return this.analogLayer;
        if (this.mode === 'alphabetical') return this.alphabeticalLayer;
        return this.digitalLayer;
    }

    _syncLayer() {
        const nextLayer = this._activeLayer();
        if (nextLayer !== this.boardEl) {
            nextLayer.replaceChildren(...this.boardEl.childNodes);
            this.boardEl = nextLayer;
        }

        for (const layer of [this.digitalLayer, this.analogLayer, this.alphabeticalLayer]) {
            layer.classList.toggle('active', this.active && layer === this.boardEl);
        }
    }
}
