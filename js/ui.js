const UI = {
    optionsCache: {},

    createParamControl(param, onChange) {
        const row = document.createElement('div');
        row.className = 'param-row';
        row.dataset.paramName = param.name;

        const label = document.createElement('label');
        label.className = 'param-label';
        label.textContent = param.name;

        const controlWrap = document.createElement('div');
        controlWrap.className = 'param-control';

        if (param.unavailable) {
            row.classList.add('unavailable');
            const span = document.createElement('span');
            span.className = 'param-unavailable';
            span.textContent = '(unavailable)';
            controlWrap.appendChild(span);
        } else if (param.param_type === 'list') {
            const select = this._createListControl(param, onChange);
            controlWrap.appendChild(select);
        } else if (param.param_type === 'int8') {
            const { container } = this._createInt8Control(param, onChange);
            controlWrap.appendChild(container);
        } else if (param.param_type === 'str6') {
            const input = this._createStr6Control(param, onChange);
            controlWrap.appendChild(input);
        } else {
            const span = document.createElement('span');
            span.textContent = param.value;
            controlWrap.appendChild(span);
        }

        row.appendChild(label);
        row.appendChild(controlWrap);
        return row;
    },

    _createListControl(param, onChange) {
        const select = document.createElement('select');
        select.dataset.paramName = param.name;
        select.disabled = param.unchangeable;

        const opt = document.createElement('option');
        opt.value = param.raw_value || '0';
        opt.textContent = param.value;
        opt.selected = true;
        select.appendChild(opt);

        if (!param.unchangeable) {
            select.addEventListener('change', () => {
                onChange(param.name, select.value);
            });
        }

        return select;
    },

    populateSelect(paramName, options) {
        const cliName = paramName.replace(/ /g, '_').toUpperCase();
        const selects = document.querySelectorAll(`select[data-param-name="${paramName}"]`);
        for (const select of selects) {
            if (!options || !options.options || options.options.length === 0) continue;
            const currentVal = select.value;
            select.innerHTML = '';
            for (const o of options.options) {
                const opt = document.createElement('option');
                opt.value = String(o.index);
                opt.textContent = o.label;
                if (String(o.index) === currentVal) opt.selected = true;
                select.appendChild(opt);
            }
        }
    },

    _createInt8Control(param, onChange) {
        const container = document.createElement('div');
        container.className = 'int8-control';

        const range = document.createElement('input');
        range.type = 'range';
        range.dataset.paramName = param.name;
        range.value = param.raw_value || param.value || '0';
        range.min = '-120';
        range.max = '120';
        range.step = '1';

        const display = document.createElement('span');
        display.className = 'int8-display';
        display.textContent = `${range.value} ${param.unit}`;

        range.addEventListener('input', () => {
            display.textContent = `${range.value} ${param.unit}`;
        });

        let changeTimer = null;
        range.addEventListener('input', () => {
            clearTimeout(changeTimer);
            changeTimer = setTimeout(() => {
                onChange(param.name, range.value);
            }, 300);
        });

        (async () => {
            try {
                const options = await this._getOptions(param.name);
                if (options && options.min_value !== null) {
                    range.min = String(options.min_value);
                    range.max = String(options.max_value);
                }
            } catch (e) {
                console.error('Failed to load range for', param.name, e);
            }
        })();

        container.appendChild(range);
        container.appendChild(display);
        return { container };
    },

    _createStr6Control(param, onChange) {
        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.paramName = param.name;
        input.value = param.raw_value || param.value || '';
        input.maxLength = 6;
        input.pattern = '[a-z0-9#\\-._]{6}';
        input.placeholder = 'abcdef';
        input.className = 'str6-input';

        if (param.exception_suffix) {
            const wrapper = document.createElement('div');
            wrapper.className = 'str6-wrapper';
            wrapper.appendChild(input);
            const suffix = document.createElement('span');
            suffix.className = 'str6-suffix';
            suffix.textContent = param.exception_suffix;
            wrapper.appendChild(suffix);

            input.addEventListener('change', () => {
                if (input.value.length === 6 && /^[a-z0-9#\-._]{6}$/.test(input.value)) {
                    onChange(param.name, input.value);
                }
            });
            return wrapper;
        }

        input.addEventListener('change', () => {
            if (input.value.length === 6 && /^[a-z0-9#\-._]{6}$/.test(input.value)) {
                onChange(param.name, input.value);
            }
        });
        return input;
    },

    async _getOptions(paramName) {
        if (this.optionsCache[paramName]) {
            return this.optionsCache[paramName];
        }
        const options = await API.getParamOptions(paramName);
        this.optionsCache[paramName] = options;
        return options;
    },

    renderParams(container, params, onChange) {
        container.innerHTML = '';
        for (const param of params) {
            container.appendChild(this.createParamControl(param, onChange));
        }
    },

    updateParamValue(container, paramName, newValue, newRawValue) {
        const row = container.querySelector(`[data-param-name="${paramName}"]`);
        if (!row) return;

        const select = row.querySelector('select');
        if (select) {
            select.value = newRawValue || newValue;
            return;
        }

        const range = row.querySelector('input[type="range"]');
        if (range) {
            range.value = newRawValue || newValue;
            const display = row.querySelector('.int8-display');
            if (display) display.textContent = `${range.value}`;
            return;
        }

        const textInput = row.querySelector('input[type="text"]');
        if (textInput) {
            textInput.value = newRawValue || newValue;
            return;
        }
    },

    renderDeviceInfo(container, version) {
        container.innerHTML = '';

        const txInfo = document.createElement('div');
        txInfo.className = 'device-info-item';
        txInfo.innerHTML = `<strong>TX:</strong> ${this._esc(version.tx_device)} ${this._esc(version.tx_version)}`;
        if (version.tx_wireless) {
            txInfo.innerHTML += ` <span class="wireless">(${this._esc(version.tx_wireless)})</span>`;
        }
        container.appendChild(txInfo);

        const rxInfo = document.createElement('div');
        rxInfo.className = 'device-info-item';
        if (version.rx_connected) {
            rxInfo.innerHTML = `<strong>RX:</strong> ${this._esc(version.rx_device)} ${this._esc(version.rx_version)}`;
        } else {
            rxInfo.innerHTML = '<strong>RX:</strong> <span class="disconnected">not connected</span>';
        }
        container.appendChild(rxInfo);

        if (version.warnings && version.warnings.length > 0) {
            const warn = document.createElement('div');
            warn.className = 'device-warnings';
            warn.textContent = version.warnings.join(' | ');
            container.appendChild(warn);
        }
    },

    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    persistentToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return { update() {}, dismiss() {} };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);

        return {
            update(msg) { toast.textContent = msg; },
            dismiss() {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            },
        };
    },

    setButtonLoading(btn, loading) {
        if (loading) {
            btn.dataset.originalText = btn.textContent;
            btn.textContent = 'Loading...';
            btn.disabled = true;
        } else {
            btn.textContent = btn.dataset.originalText || btn.textContent;
            btn.disabled = false;
        }
    },

    _esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },

    clearOptionsCache() {
        this.optionsCache = {};
    },
};
