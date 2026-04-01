class Mutex {
    constructor() {
        this._queue = Promise.resolve();
    }
    async acquire() {
        let release;
        const next = new Promise(resolve => { release = resolve; });
        const prev = this._queue;
        this._queue = next;
        await prev;
        return release;
    }
}

const _hasQtBridge = (typeof qt !== 'undefined' && typeof qt.webChannelTransport !== 'undefined');

const Serial = {
    _port: null,
    _reader: null,
    _connected: false,
    _statsStreaming: false,
    _statsStopped: true,
    _mutex: new Mutex(),
    _encoder: new TextEncoder(),
    _decoder: new TextDecoder(),
    _readBuffer: '',
    _readResolve: null,
    _bridge: null,
    _bridgeReady: null,
    onBeforeCommand: null,

    get connected() {
        return this._connected;
    },

    get useQtBridge() {
        return _hasQtBridge;
    },

    _initBridge() {
        if (!_hasQtBridge) {
            this._bridgeReady = Promise.resolve();
            return;
        }
        this._bridgeReady = new Promise((resolve) => {
            new QWebChannel(qt.webChannelTransport, (channel) => {
                this._bridge = channel.objects.serialBridge;

                this._bridge.dataReceived.connect((data) => {
                    this._readBuffer += data;
                    if (this._readResolve) {
                        this._readResolve();
                        this._readResolve = null;
                    }
                });

                this._bridge.closed.connect(() => {
                    this._connected = false;
                    this._statsStreaming = false;
                });

                resolve();
            });
        });
    },

    async requestPort() {
        if (_hasQtBridge) {
            await this._bridgeReady;
            return true;
        }
        try {
            this._port = await navigator.serial.requestPort();
            return true;
        } catch (e) {
            if (e.name === 'NotAllowedError') return false;
            throw e;
        }
    },

    async connect(baudrate = 115200) {
        if (_hasQtBridge) {
            return this._connectBridge(baudrate);
        }

        if (!this._port) throw new Error('No port selected');
        if (this._connected) await this.disconnect();

        await this._port.open({
            baudRate: baudrate,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            bufferSize: 4096,
        });

        this._connected = true;
        this._statsStreaming = false;
        this._statsStopped = true;
        this._readBuffer = '';

        this._startReadLoop();

        this._port.addEventListener('disconnect', () => {
            this._connected = false;
            this._statsStreaming = false;
        });

        await this._drainInitial();
    },

    async _connectBridge(baudrate) {
        if (this._connected) await this.disconnect();
        await this._bridgeReady;

        await new Promise((resolve, reject) => {
            const cleanup = () => {
                try { this._bridge.opened.disconnect(onOpened); } catch (e) {}
                try { this._bridge.errorOccurred.disconnect(onError); } catch (e) {}
            };
            const onOpened = () => { cleanup(); resolve(); };
            const onError = (msg) => { cleanup(); reject(new Error(msg)); };

            this._bridge.opened.connect(onOpened);
            this._bridge.errorOccurred.connect(onError);
            this._bridge.open(baudrate);
        });

        this._connected = true;
        this._statsStreaming = false;
        this._statsStopped = true;
        this._readBuffer = '';

        await this._drainInitial();
    },

    async disconnect() {
        if (this._statsStreaming) {
            await this.stopStatsStream();
        }

        this._connected = false;
        this._statsStreaming = false;

        if (_hasQtBridge) {
            if (this._bridge) {
                this._bridge.close();
            }
        } else {
            if (this._reader) {
                try { await this._reader.cancel(); } catch (e) {}
                try { this._reader.releaseLock(); } catch (e) {}
                this._reader = null;
            }

            if (this._port) {
                try { await this._port.close(); } catch (e) {}
            }
        }

        this._readBuffer = '';
    },

    async sendCommand(command, { timeout = 2000, silenceTimeout = 300 } = {}) {
        this._checkConnected();

        if (this._statsStreaming || !this._statsStopped) {
            await this._forceStopStats();
        }

        if (this.onBeforeCommand) {
            this.onBeforeCommand();
        }

        const release = await this._mutex.acquire();
        try {
            return await this._sendAndReceive(command, timeout, silenceTimeout);
        } finally {
            release();
        }
    },

    async sendRaw(command, timeout = 2000) {
        this._checkConnected();

        if (this._statsStreaming || !this._statsStopped) {
            await this._forceStopStats();
        }

        if (this.onBeforeCommand) {
            this.onBeforeCommand();
        }

        const release = await this._mutex.acquire();
        try {
            await this._drainPending();
            await this._write(command);
            const response = await this._readUntilSilence(timeout, 300);
            return response;
        } finally {
            release();
        }
    },

    async startStatsStream(onLine, onError) {
        this._checkConnected();

        const release = await this._mutex.acquire();
        try {
            await this._drainPending();
            await this._write('stats\n');
            this._statsStreaming = true;
            this._statsStopped = false;
            await this._sleep(500);
            this._readBuffer = '';
        } finally {
            release();
        }

        this._statsReadLoop(onLine, onError);
    },

    async stopStatsStream() {
        if (!this._statsStreaming) return;
        this._statsStreaming = false;

        try {
            await this._write('\n');
            await this._sleep(300);
            this._readBuffer = '';
        } catch (e) {}
    },

    _startReadLoop() {
        if (_hasQtBridge) return;

        this._reader = this._port.readable.getReader();

        (async () => {
            try {
                while (this._connected) {
                    const { value, done } = await this._reader.read();
                    if (done) break;
                    this._readBuffer += this._decoder.decode(value, { stream: true });
                    if (this._readResolve) {
                        this._readResolve();
                        this._readResolve = null;
                    }
                }
            } catch (e) {
                if (this._connected) {
                    this._connected = false;
                }
            }
        })();
    },

    async _write(text) {
        if (_hasQtBridge) {
            if (!this._bridge || !this._connected) {
                throw new Error('Not connected');
            }
            await new Promise((resolve) => {
                this._bridge.write(text, resolve);
            });
            return;
        }

        if (!this._port || !this._port.writable) {
            throw new Error('Port not writable');
        }
        const writer = this._port.writable.getWriter();
        try {
            await writer.write(this._encoder.encode(text));
        } finally {
            writer.releaseLock();
        }
    },

    _waitForData(timeoutMs) {
        if (this._readBuffer.length > 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._readResolve = null;
                reject(new Error('timeout'));
            }, timeoutMs);
            this._readResolve = () => {
                clearTimeout(timer);
                resolve();
            };
        });
    },

    _consumeBuffer() {
        const data = this._readBuffer;
        this._readBuffer = '';
        return data;
    },

    async _readUntilSilence(totalTimeout, silenceTimeout) {
        let response = '';
        const deadline = Date.now() + totalTimeout;

        while (true) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;

            const waitTime = Math.min(silenceTimeout, remaining);
            try {
                await this._waitForData(waitTime);
                response += this._consumeBuffer();
            } catch (e) {
                if (response) break;
                if (Date.now() >= deadline) break;
            }
        }

        if (this._readBuffer.length > 0) {
            response += this._consumeBuffer();
        }

        return response;
    },

    async _sendAndReceive(command, timeout, silenceTimeout) {
        await this._drainPending();
        await this._write(command + '\n');
        const response = await this._readUntilSilence(timeout, silenceTimeout);
        return this._stripEcho(command, response);
    },

    _stripEcho(command, rawResponse) {
        let text = rawResponse;

        const echoPrefix = command + '>\r\n';
        if (text.startsWith(echoPrefix)) {
            text = text.slice(echoPrefix.length);
        } else {
            const idx = text.indexOf('>\r\n');
            if (idx !== -1) {
                text = text.slice(idx + 3);
            }
        }

        return text.replace(/\r\n/g, '\n').trim();
    },

    async _drainInitial() {
        await this._sleep(500);
        this._readBuffer = '';
    },

    async _drainPending() {
        await this._sleep(50);
        this._readBuffer = '';
    },

    async _statsReadLoop(onLine, onError) {
        let buffer = '';
        try {
            while (this._statsStreaming && this._connected) {
                try {
                    await this._waitForData(1000);
                    buffer += this._consumeBuffer();

                    while (buffer.includes('\r\n')) {
                        const idx = buffer.indexOf('\r\n');
                        const line = buffer.slice(0, idx).trim();
                        buffer = buffer.slice(idx + 2);
                        if (line) {
                            onLine(line);
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
        } catch (e) {
            if (onError) onError(e.message || 'Stats stream error');
        } finally {
            this._statsStreaming = false;
            this._statsStopped = true;
        }
    },

    async _forceStopStats() {
        this._statsStreaming = false;

        try {
            await this._write('\n');
        } catch (e) {}

        const deadline = Date.now() + 3000;
        while (!this._statsStopped && Date.now() < deadline) {
            await this._sleep(50);
        }
        this._statsStopped = true;

        await this._sleep(100);
        this._readBuffer = '';
    },

    _checkConnected() {
        if (!this._connected || (_hasQtBridge ? !this._bridge : !this._port)) {
            throw new Error('Not connected');
        }
    },

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};

Serial._initBridge();
