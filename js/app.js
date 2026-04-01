const App = {
    state: {
        connected: false,
        configId: 0,
        rxConnected: false,
        allParams: [],
        statsActive: false,
        paramsReady: false,
    },

    init() {
        this._checkWebSerial();
        this._bindConnectionPanel();
        this._bindTabs();
        this._bindActions();
        this._bindAdvanced();
        this._bindRawTerminal();
        Serial.onBeforeCommand = () => this._pauseStats();
    },

    _bindConnectionPanel() {
        const form = document.getElementById('connect-form');
        const disconnectBtn = document.getElementById('btn-disconnect');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = form.querySelector('button[type="submit"]');
            UI.setButtonLoading(btn, true);
            try {
                const selected = await Serial.requestPort();
                if (!selected) {
                    UI.setButtonLoading(btn, false);
                    return;
                }
                const baudrate = parseInt(document.getElementById('serial-baudrate').value);
                await API.connectSerial(baudrate);
                this.state.connected = true;
                this._updateConnectionUI(true);
                await this._loadDeviceInfo();
                await this._loadAllParams();
                await this._preloadAllOptions();
                UI.toast('Connected', 'success');
            } catch (e) {
                UI.toast(`Connection failed: ${e.message}`, 'error');
            } finally {
                UI.setButtonLoading(btn, false);
            }
        });

        disconnectBtn.addEventListener('click', async () => {
            try {
                await API.disconnect();
            } catch (e) {}
            this.state.connected = false;
            this._updateConnectionUI(false);
            this._clearDeviceInfo();
            UI.toast('Disconnected', 'info');
        });
    },

    _updateConnectionUI(connected) {
        const indicator = document.getElementById('connection-indicator');
        const disconnectBtn = document.getElementById('btn-disconnect');
        const devicePanel = document.getElementById('device-panel');
        const paramsPanel = document.getElementById('params-panel');
        const actionsPanel = document.getElementById('actions-panel');

        indicator.className = `indicator ${connected ? 'connected' : 'disconnected'}`;
        indicator.textContent = connected ? 'Connected' : 'Disconnected';
        disconnectBtn.classList.toggle('hidden', !connected);
        devicePanel.classList.toggle('hidden', !connected);
        paramsPanel.classList.toggle('hidden', !connected);
        actionsPanel.classList.toggle('hidden', !connected);
    },

    _checkWebSerial() {
        if (!('serial' in navigator)) {
            const msg = document.getElementById('webserial-unsupported');
            if (msg) {
                if (Serial.useQtBridge) {
                    msg.textContent = 'Using Qt serial bridge (/dev/ttyS0)';
                    msg.style.color = '#4fc3f7';
                    msg.classList.remove('hidden');
                } else {
                    msg.classList.remove('hidden');
                    const btn = document.querySelector('#connect-form button[type="submit"]');
                    if (btn) btn.disabled = true;
                }
            }
        }
    },

    async _loadDeviceInfo() {
        try {
            const version = await API.getVersion();
            this.state.rxConnected = version.rx_connected;
            UI.renderDeviceInfo(document.getElementById('device-info'), version);
        } catch (e) {
            UI.toast(`Failed to load device info: ${e.message}`, 'error');
        }
    },

    _clearDeviceInfo() {
        document.getElementById('device-info').innerHTML = '';
        document.getElementById('params-common').innerHTML = '';
        document.getElementById('params-tx').innerHTML = '';
        document.getElementById('params-rx').innerHTML = '';
        document.getElementById('params-failsafe').innerHTML = '';
        document.getElementById('config-id-display').textContent = '-';
        UI.clearOptionsCache();
    },

    async _loadAllParams() {
        try {
            const data = await API.getParams();
            this.state.configId = data.config_id;
            this.state.rxConnected = data.rx_connected;
            this.state.allParams = data.parameters;

            document.getElementById('config-id-display').textContent = data.config_id;
            document.getElementById('config-id-select').value = data.config_id;

            const common = [];
            const tx = [];
            const rx = [];
            const failsafe = [];

            for (const p of data.parameters) {
                if (p.name.startsWith('Rx FS ')) {
                    failsafe.push(p);
                } else if (p.name.startsWith('Tx ')) {
                    tx.push(p);
                } else if (p.name.startsWith('Rx ')) {
                    rx.push(p);
                } else {
                    common.push(p);
                }
            }

            const onChange = (name, value) => this._onParamChange(name, value);

            UI.renderParams(document.getElementById('params-common'), common, onChange);
            UI.renderParams(document.getElementById('params-tx'), tx, onChange);
            UI.renderParams(document.getElementById('params-rx'), rx, onChange);
            UI.renderParams(document.getElementById('params-failsafe'), failsafe, onChange);

            if (data.warnings.length > 0) {
                for (const w of data.warnings) {
                    UI.toast(w, 'warn');
                }
            }

            const rxTab = document.querySelector('[data-tab="rx"]');
            const fsTab = document.querySelector('[data-tab="failsafe"]');
            if (!data.rx_connected) {
                rxTab?.classList.add('tab-disabled');
                fsTab?.classList.add('tab-disabled');
            } else {
                rxTab?.classList.remove('tab-disabled');
                fsTab?.classList.remove('tab-disabled');
            }
        } catch (e) {
            UI.toast(`Failed to load parameters: ${e.message}`, 'error');
        }
    },

    async _preloadAllOptions() {
        this.state.paramsReady = false;
        const header = document.getElementById('stats-header');
        header?.classList.add('disabled');

        const listParams = this.state.allParams.filter(
            p => p.param_type === 'list' && !p.unavailable && !p.unchangeable
        );

        const total = listParams.length;
        const toast = UI.persistentToast(`Loading parameters... (0/${total})`, 'info');

        for (let i = 0; i < listParams.length; i++) {
            const p = listParams[i];
            toast.update(`Loading parameters... (${i + 1}/${total})`);
            try {
                const options = await API.getParamOptions(p.name);
                UI.populateSelect(p.name, options);
            } catch (e) {
                console.error('Failed to preload options for', p.name, e);
            }
        }

        toast.dismiss();
        this.state.paramsReady = true;
        header?.classList.remove('disabled');
    },

    async _onParamChange(name, value) {
        try {
            const result = await API.setParam(name, value);
            if (result.success) {
                const storeResult = await API.store();
                UI.toast(`${name} set & stored`, 'success');
                if (storeResult.warnings) {
                    for (const w of storeResult.warnings) UI.toast(w, 'warn');
                }
            } else if (result.error) {
                UI.toast(`Error: ${result.error}`, 'error');
            }
            if (result.warnings) {
                for (const w of result.warnings) {
                    UI.toast(w, 'warn');
                }
            }
        } catch (e) {
            UI.toast(`Failed to set ${name}: ${e.message}`, 'error');
        }
    },

    _bindTabs() {
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`tab-${target}`)?.classList.add('active');
            });
        });
    },

    _bindActions() {
        document.getElementById('btn-store').addEventListener('click', async () => {
            const btn = document.getElementById('btn-store');
            UI.setButtonLoading(btn, true);
            try {
                const result = await API.store();
                UI.toast(result.message || 'Parameters stored', 'success');
                if (result.warnings) {
                    for (const w of result.warnings) UI.toast(w, 'warn');
                }
            } catch (e) {
                UI.toast(`Store failed: ${e.message}`, 'error');
            } finally {
                UI.setButtonLoading(btn, false);
            }
        });

        document.getElementById('btn-reload').addEventListener('click', async () => {
            const btn = document.getElementById('btn-reload');
            UI.setButtonLoading(btn, true);
            try {
                const result = await API.reload();
                UI.toast(result.message || 'Parameters reloaded', 'success');
                UI.clearOptionsCache();
                await this._loadAllParams();
            } catch (e) {
                UI.toast(`Reload failed: ${e.message}`, 'error');
            } finally {
                UI.setButtonLoading(btn, false);
            }
        });

        document.getElementById('btn-bind').addEventListener('click', async () => {
            const btn = document.getElementById('btn-bind');
            UI.setButtonLoading(btn, true);
            try {
                const result = await API.bind();
                UI.toast(result.message || 'Binding started', 'success');
            } catch (e) {
                UI.toast(`Bind failed: ${e.message}`, 'error');
            } finally {
                UI.setButtonLoading(btn, false);
            }
        });

        document.getElementById('btn-config-id').addEventListener('click', async () => {
            const select = document.getElementById('config-id-select');
            const newId = parseInt(select.value);
            const btn = document.getElementById('btn-config-id');
            UI.setButtonLoading(btn, true);
            try {
                const result = await API.setConfigId(newId);
                if (result.error) {
                    UI.toast(`Error: ${result.error}`, 'error');
                } else {
                    UI.toast(result.message || `Config ID set to ${newId}`, 'success');
                    document.getElementById('config-id-display').textContent = newId;
                    UI.clearOptionsCache();
                    await this._loadAllParams();
                }
            } catch (e) {
                UI.toast(`Config ID change failed: ${e.message}`, 'error');
            } finally {
                UI.setButtonLoading(btn, false);
            }
        });

        this._bindStatsPanel();
    },

    _bindAdvanced() {
        document.getElementById('btn-esp-get-pswd').addEventListener('click', async () => {
            try {
                const result = await API.espGetPassword();
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                document.getElementById('esp-password').value = result.value || '';
                UI.toast('Password retrieved', 'success');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-esp-set-pswd').addEventListener('click', async () => {
            const val = document.getElementById('esp-password').value;
            if (val && (val.length < 8 || val.length > 24)) {
                UI.toast('Password must be 8-24 characters or empty to clear', 'error'); return;
            }
            try {
                const result = await API.espSetPassword(val);
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                UI.toast('Password set', 'success');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-esp-get-ssid').addEventListener('click', async () => {
            try {
                const result = await API.espGetNetSSID();
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                document.getElementById('esp-netssid').value = result.value || '';
                UI.toast('SSID retrieved', 'success');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-esp-set-ssid').addEventListener('click', async () => {
            const val = document.getElementById('esp-netssid').value;
            if (val && (val.length < 8 || val.length > 24)) {
                UI.toast('SSID must be 8-24 characters or empty to clear', 'error'); return;
            }
            try {
                const result = await API.espSetNetSSID(val);
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                UI.toast('SSID set', 'success');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-esp-passthrough').addEventListener('click', async () => {
            if (!confirm('Enter ESP passthrough mode? This can only be exited by power cycling the device.')) return;
            try {
                const result = await API.espPassthrough();
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                UI.toast(result.message || 'ESP passthrough entered', 'warn');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-esp-boot').addEventListener('click', async () => {
            if (!confirm('Reboot ESP into flash mode? This enters serial passthrough for flashing.')) return;
            try {
                const result = await API.espBoot();
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                UI.toast(result.message || 'ESP boot mode entered', 'warn');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-hc04-get-pin').addEventListener('click', async () => {
            try {
                const result = await API.hc04GetPin();
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                document.getElementById('hc04-pin').value = result.pin || '';
                UI.toast('Pin retrieved', 'success');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-hc04-set-pin').addEventListener('click', async () => {
            const val = parseInt(document.getElementById('hc04-pin').value);
            if (isNaN(val) || val < 1000 || val > 9999) {
                UI.toast('Pin must be 1000-9999', 'error'); return;
            }
            try {
                const result = await API.hc04SetPin(val);
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                UI.toast('Pin set', 'success');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-hc04-passthrough').addEventListener('click', async () => {
            if (!confirm('Enter HC04 passthrough mode? This can only be exited by power cycling the device.')) return;
            try {
                const result = await API.hc04Passthrough();
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                UI.toast(result.message || 'HC04 passthrough entered', 'warn');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });

        document.getElementById('btn-systemboot').addEventListener('click', async () => {
            if (!confirm('Enter system bootloader? This will reboot the device into bootloader mode.')) return;
            try {
                const result = await API.systemBoot();
                if (result.error) { UI.toast(`Error: ${result.error}`, 'error'); return; }
                UI.toast(result.message || 'System bootloader entered', 'warn');
            } catch (e) { UI.toast(`${e.message}`, 'error'); }
        });
    },

    _parseStatsLine(line) {
        try {
            if (!line.includes('(') || !line.includes(';')) return null;

            const nums = line.match(/-?\d+/g);
            if (!nums) return null;

            const hasSlash = line.includes('/');

            if (hasSlash && nums.length >= 10) {
                return {
                    lqSerial: parseInt(nums[0]),
                    lqFrames: parseInt(nums[1]),
                    lqRx: parseInt(nums[2]),
                    rssi1: parseInt(nums[3]),
                    rssi2: parseInt(nums[4]),
                    rssiRx: parseInt(nums[5]),
                    snr1: parseInt(nums[6]),
                    snr2: parseInt(nums[7]),
                    bytesTx: parseInt(nums[8]),
                    bytesRx: parseInt(nums[9]),
                };
            } else if (!hasSlash && nums.length >= 8) {
                return {
                    lqSerial: parseInt(nums[0]),
                    lqFrames: parseInt(nums[1]),
                    lqRx: parseInt(nums[2]),
                    rssi1: parseInt(nums[3]),
                    rssi2: -127,
                    rssiRx: parseInt(nums[4]),
                    snr1: parseInt(nums[5]),
                    snr2: -127,
                    bytesTx: parseInt(nums[6]),
                    bytesRx: parseInt(nums[7]),
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    _updateStatsDashboard(stats) {
        const setValue = (id, val, invalid) => {
            const el = document.getElementById(id);
            if (!el) return;
            const unit = el.querySelector('.stat-unit');
            const unitText = unit ? unit.outerHTML : '';
            if (invalid) {
                el.innerHTML = '--' + unitText;
                el.classList.add('stat-na');
            } else {
                el.innerHTML = val + unitText;
                el.classList.remove('stat-na');
            }
        };

        setValue('stat-lq-serial', stats.lqSerial, false);
        setValue('stat-lq-frames', stats.lqFrames, false);
        setValue('stat-lq-rx', stats.lqRx, false);
        setValue('stat-rssi1', stats.rssi1, stats.rssi1 === -127 || stats.rssi1 === 127);
        setValue('stat-rssi2', stats.rssi2, stats.rssi2 === -127 || stats.rssi2 === 127);
        setValue('stat-rssi-rx', stats.rssiRx, stats.rssiRx === -127 || stats.rssiRx === 127);
        setValue('stat-snr1', stats.snr1, stats.snr1 === -127 || stats.snr1 === 127);
        setValue('stat-snr2', stats.snr2, stats.snr2 === -127 || stats.snr2 === 127);
        setValue('stat-bytes-tx', stats.bytesTx, false);
        setValue('stat-bytes-rx', stats.bytesRx, false);

        this._colorCodeLQ('stat-lq-serial', stats.lqSerial);
        this._colorCodeLQ('stat-lq-frames', stats.lqFrames);
        this._colorCodeLQ('stat-lq-rx', stats.lqRx);
        this._colorCodeRSSI('stat-rssi1', stats.rssi1);
        this._colorCodeRSSI('stat-rssi2', stats.rssi2);
        this._colorCodeRSSI('stat-rssi-rx', stats.rssiRx);
    },

    _colorCodeLQ(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('stat-good', 'stat-ok', 'stat-bad');
        if (val >= 90) el.classList.add('stat-good');
        else if (val >= 50) el.classList.add('stat-ok');
        else el.classList.add('stat-bad');
    },

    _colorCodeRSSI(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('stat-good', 'stat-ok', 'stat-bad');
        if (val === -127 || val === 127) return;
        if (val >= -70) el.classList.add('stat-good');
        else if (val >= -100) el.classList.add('stat-ok');
        else el.classList.add('stat-bad');
    },

    _resetStatsDashboard() {
        const ids = [
            'stat-lq-serial', 'stat-lq-frames', 'stat-lq-rx',
            'stat-rssi1', 'stat-rssi2', 'stat-rssi-rx',
            'stat-snr1', 'stat-snr2',
            'stat-bytes-tx', 'stat-bytes-rx',
        ];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (!el) continue;
            const unit = el.querySelector('.stat-unit');
            const unitText = unit ? unit.outerHTML : '';
            el.innerHTML = '--' + unitText;
            el.classList.remove('stat-good', 'stat-ok', 'stat-bad', 'stat-na');
        }
    },

    _bindStatsPanel() {
        const header = document.getElementById('stats-header');
        const body = document.getElementById('stats-body');

        header.addEventListener('click', () => {
            if (!this.state.paramsReady || !this.state.connected) {
                UI.toast('Wait for parameters to finish loading', 'warn');
                return;
            }

            const wasCollapsed = header.classList.contains('collapsed');
            header.classList.toggle('collapsed');
            body.classList.toggle('hidden');

            if (wasCollapsed) {
                this._startStats();
            } else {
                this._stopStats();
            }
        });
    },

    _pauseStats() {
        if (!this.state.statsActive) return;
        this._stopStats();
        const header = document.getElementById('stats-header');
        const body = document.getElementById('stats-body');
        if (header && !header.classList.contains('collapsed')) {
            header.classList.add('collapsed');
            body.classList.add('hidden');
        }
        this._resetStatsDashboard();
    },

    async _startStats() {
        const rawOutput = document.getElementById('stats-output');
        rawOutput.textContent = '';
        this._resetStatsDashboard();
        this.state.statsActive = true;

        try {
            await Serial.startStatsStream(
                (line) => {
                    rawOutput.textContent += line + '\n';
                    rawOutput.scrollTop = rawOutput.scrollHeight;
                    const stats = this._parseStatsLine(line);
                    if (stats) {
                        this._updateStatsDashboard(stats);
                    }
                },
                (err) => {
                    UI.toast(`Stats error: ${err}`, 'error');
                    this.state.statsActive = false;
                }
            );
        } catch (e) {
            UI.toast(`Stats error: ${e.message}`, 'error');
            this.state.statsActive = false;
        }
    },

    async _stopStats() {
        if (this.state.statsActive) {
            this.state.statsActive = false;
            try {
                await Serial.stopStatsStream();
            } catch (e) {}
        }
    },

    _bindRawTerminal() {
        const form = document.getElementById('raw-form');
        const output = document.getElementById('raw-output');
        const input = document.getElementById('raw-input');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cmd = input.value.trim();
            if (!cmd) return;

            output.textContent += `> ${cmd}\n`;
            try {
                const result = await API.sendRaw(cmd);
                output.textContent += result.response + '\n';
            } catch (e) {
                output.textContent += `Error: ${e.message}\n`;
            }
            output.scrollTop = output.scrollHeight;
            input.value = '';
        });

        document.getElementById('btn-raw-clear').addEventListener('click', () => {
            output.textContent = '';
        });
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
