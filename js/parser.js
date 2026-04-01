const Parser = {

    RE: {
        CONFIG_ID:              /^ConfigId:(\d)$/,
        WARNING:                /^warn:\s*(.+)$/,
        ERROR:                  /^err:\s*(.+)$/,
        LAYOUT_WARNING:         /^!!\s*.+\s*!!$/,
        PARAM_LIST_VALUE:       /^  (.+?) = (.+?) \[(\d+)\](\(unchangeable\))?$/,
        PARAM_UNAVAILABLE:      /^  (.+?) = - \(unavailable\)$/,
        PARAM_STR6_VALUE:       /^  (.+?) = ([a-z0-9#\-._]{1,6})( \/.*)?$/,
        PARAM_INT8_VALUE:       /^  (.+?) = (-?\d+) (.+)$/,
        OPTION_LIST:            /^  (\d+) = (.+)$/,
        OPTION_MIN:             /^  min: (-?\d+)$/,
        OPTION_MAX:             /^  max: (-?\d+)$/,
        OPTION_STR6:            /^  \[.*\]$/,
        VERSION_TX:             /^  Tx: (.+?), (v[\d.]+)(?:, (.+))?$/,
        VERSION_RX_CONNECTED:   /^  Rx: (.+?), (v[\d.]+)$/,
        VERSION_RX_DISCONNECTED:/^  Rx: receiver not connected$/,
        VERSION_RX_ERROR:       /^  Rx: - \(unexpected error\)$/,
    },

    parseParameterLine(line) {
        let m;

        m = this.RE.PARAM_LIST_VALUE.exec(line);
        if (m) {
            return {
                name: m[1],
                value: m[2],
                raw_value: m[3],
                param_type: 'list',
                unavailable: false,
                unchangeable: m[4] != null,
                unit: '',
                exception_suffix: '',
            };
        }

        m = this.RE.PARAM_UNAVAILABLE.exec(line);
        if (m) {
            return {
                name: m[1],
                value: '-',
                raw_value: null,
                param_type: 'unknown',
                unavailable: true,
                unchangeable: false,
                unit: '',
                exception_suffix: '',
            };
        }

        m = this.RE.PARAM_STR6_VALUE.exec(line);
        if (m) {
            return {
                name: m[1],
                value: m[2],
                raw_value: m[2],
                param_type: 'str6',
                unavailable: false,
                unchangeable: false,
                unit: '',
                exception_suffix: m[3] ? m[3].trim() : '',
            };
        }

        m = this.RE.PARAM_INT8_VALUE.exec(line);
        if (m) {
            return {
                name: m[1],
                value: m[2],
                raw_value: m[2],
                param_type: 'int8',
                unavailable: false,
                unchangeable: false,
                unit: m[3],
                exception_suffix: '',
            };
        }

        return null;
    },

    parseParameterList(text) {
        const result = {
            config_id: 0,
            parameters: [],
            warnings: [],
            rx_connected: true,
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            m = this.RE.CONFIG_ID.exec(line);
            if (m) { result.config_id = parseInt(m[1]); continue; }

            if (this.RE.LAYOUT_WARNING.test(line)) {
                result.warnings.push(line.replace(/^!+\s*/, '').replace(/\s*!+$/, ''));
                continue;
            }

            m = this.RE.WARNING.exec(line);
            if (m) {
                result.warnings.push(m[1]);
                if (m[1].includes('receiver not connected')) result.rx_connected = false;
                continue;
            }

            const param = this.parseParameterLine(line);
            if (param) result.parameters.push(param);
        }

        return result;
    },

    parseParameterOptions(text) {
        const result = {
            name: '',
            param_type: 'unknown',
            current: null,
            options: [],
            min_value: null,
            max_value: null,
            pattern: '',
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            if (this.RE.CONFIG_ID.test(line)) continue;
            if (this.RE.WARNING.test(line)) continue;
            if (this.RE.LAYOUT_WARNING.test(line)) continue;

            const param = this.parseParameterLine(line);
            if (param && result.current === null) {
                result.current = param;
                result.name = param.name;
                result.param_type = param.param_type;
                continue;
            }

            m = this.RE.OPTION_LIST.exec(line);
            if (m) {
                result.param_type = 'list';
                result.options.push({ index: parseInt(m[1]), label: m[2] });
                continue;
            }

            m = this.RE.OPTION_MIN.exec(line);
            if (m) {
                result.param_type = 'int8';
                result.min_value = parseInt(m[1]);
                continue;
            }

            m = this.RE.OPTION_MAX.exec(line);
            if (m) {
                result.param_type = 'int8';
                result.max_value = parseInt(m[1]);
                continue;
            }

            if (this.RE.OPTION_STR6.test(line)) {
                result.param_type = 'str6';
                result.pattern = line.trim();
                continue;
            }
        }

        return result;
    },

    parseVersion(text) {
        const result = {
            tx_device: '',
            tx_version: '',
            tx_wireless: '',
            rx_device: '',
            rx_version: '',
            rx_connected: true,
            rx_error: '',
            warnings: [],
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            if (this.RE.LAYOUT_WARNING.test(line)) {
                result.warnings.push(line.replace(/^!+\s*/, '').replace(/\s*!+$/, ''));
                continue;
            }

            m = this.RE.VERSION_TX.exec(line);
            if (m) {
                result.tx_device = m[1];
                result.tx_version = m[2];
                result.tx_wireless = m[3] || '';
                continue;
            }

            m = this.RE.VERSION_RX_CONNECTED.exec(line);
            if (m) {
                result.rx_device = m[1];
                result.rx_version = m[2];
                result.rx_connected = true;
                continue;
            }

            if (this.RE.VERSION_RX_DISCONNECTED.test(line)) {
                result.rx_connected = false;
                continue;
            }

            if (this.RE.VERSION_RX_ERROR.test(line)) {
                result.rx_connected = false;
                result.rx_error = 'unexpected error';
                continue;
            }
        }

        return result;
    },

    parseSetParam(text) {
        const result = {
            config_id: 0,
            success: false,
            parameter: null,
            error: '',
            warnings: [],
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            m = this.RE.CONFIG_ID.exec(line);
            if (m) { result.config_id = parseInt(m[1]); continue; }

            m = this.RE.ERROR.exec(line);
            if (m) { result.error = m[1]; continue; }

            m = this.RE.WARNING.exec(line);
            if (m) { result.warnings.push(m[1]); continue; }

            const param = this.parseParameterLine(line);
            if (param) {
                result.parameter = param;
                result.success = true;
            }
        }

        return result;
    },

    parseStore(text) {
        const result = {
            config_id: 0,
            message: '',
            rx_connected: true,
            warnings: [],
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            m = this.RE.CONFIG_ID.exec(line);
            if (m) { result.config_id = parseInt(m[1]); continue; }

            m = this.RE.WARNING.exec(line);
            if (m) {
                result.warnings.push(m[1]);
                if (m[1].includes('receiver not connected')) result.rx_connected = false;
                continue;
            }

            const stripped = line.trim();
            if (stripped && !this.RE.LAYOUT_WARNING.test(line)) {
                result.message = stripped;
            }
        }

        return result;
    },

    parseReload(text) {
        const result = {
            config_id: 0,
            message: '',
            rx_connected: true,
            warnings: [],
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            m = this.RE.CONFIG_ID.exec(line);
            if (m) { result.config_id = parseInt(m[1]); continue; }

            m = this.RE.WARNING.exec(line);
            if (m) {
                result.warnings.push(m[1]);
                if (m[1].includes('receiver not connected')) result.rx_connected = false;
                continue;
            }

            const stripped = line.trim();
            if (stripped && !this.RE.LAYOUT_WARNING.test(line)) {
                result.message = stripped;
            }
        }

        return result;
    },

    parseBind(text) {
        return { message: text.trim() };
    },

    parseConfigId(text) {
        const result = {
            config_id: 0,
            message: '',
            error: '',
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            m = this.RE.CONFIG_ID.exec(line);
            if (m) { result.config_id = parseInt(m[1]); continue; }

            m = this.RE.ERROR.exec(line);
            if (m) { result.error = m[1]; continue; }

            const stripped = line.trim();
            if (stripped) result.message = stripped;
        }

        return result;
    },

    parseGeneric(text) {
        const result = {
            raw_text: text,
            config_id: null,
            messages: [],
            warnings: [],
            errors: [],
        };

        for (const rawLine of text.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            let m;

            m = this.RE.CONFIG_ID.exec(line);
            if (m) { result.config_id = parseInt(m[1]); continue; }

            m = this.RE.ERROR.exec(line);
            if (m) { result.errors.push(m[1]); continue; }

            m = this.RE.WARNING.exec(line);
            if (m) { result.warnings.push(m[1]); continue; }

            if (this.RE.LAYOUT_WARNING.test(line)) {
                result.warnings.push(line.replace(/^!+\s*/, '').replace(/\s*!+$/, ''));
                continue;
            }

            const stripped = line.trim();
            if (stripped) result.messages.push(stripped);
        }

        return result;
    },

    paramNameToCli(name) {
        return name.replace(/ /g, '_').toUpperCase();
    },
};
