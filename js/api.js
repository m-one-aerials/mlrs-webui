const API = {

    get connected() {
        return Serial.connected;
    },

    async connectSerial(baudrate = 115200) {
        await Serial.connect(baudrate);
    },

    async disconnect() {
        await Serial.disconnect();
    },

    async getVersion() {
        const raw = await Serial.sendCommand('v');
        return Parser.parseVersion(raw);
    },

    async getParams(filter = null) {
        let cmd = 'pl';
        if (filter === 'common') cmd = 'pl c';
        else if (filter === 'tx') cmd = 'pl tx';
        else if (filter === 'rx') cmd = 'pl rx';

        const raw = await Serial.sendCommand(cmd, { timeout: 5000, silenceTimeout: 500 });
        return Parser.parseParameterList(raw);
    },

    async getParamOptions(name) {
        const cliName = Parser.paramNameToCli(name);
        const raw = await Serial.sendCommand(`p ${cliName} = ?`, { timeout: 3000 });

        if (raw.startsWith('err:')) {
            throw new Error(raw.trim());
        }

        return Parser.parseParameterOptions(raw);
    },

    async setParam(name, value) {
        const cliName = Parser.paramNameToCli(name);
        const raw = await Serial.sendCommand(`p ${cliName} = ${value}`);
        return Parser.parseSetParam(raw);
    },

    async store() {
        const raw = await Serial.sendCommand('pstore');
        return Parser.parseStore(raw);
    },

    async reload() {
        const raw = await Serial.sendCommand('reload');
        return Parser.parseReload(raw);
    },

    async bind() {
        const raw = await Serial.sendCommand('bind');
        return Parser.parseBind(raw);
    },

    async setConfigId(id) {
        const raw = await Serial.sendCommand(`setconfigid = ${parseInt(id)}`);
        return Parser.parseConfigId(raw);
    },

    async systemBoot() {
        const raw = await Serial.sendCommand('systemboot');
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { message: result.messages[0] || 'systemboot sent' };
    },

    async espGetPassword() {
        const raw = await Serial.sendCommand('esp get pswd', { timeout: 3000 });
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { value: result.messages[0] || '', message: 'ok' };
    },

    async espSetPassword(value) {
        const cmd = value ? `esp set pswd = ${value}` : 'esp set pswd =';
        const raw = await Serial.sendCommand(cmd, { timeout: 3000 });
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { value, message: result.messages[0] || 'ok' };
    },

    async espGetNetSSID() {
        const raw = await Serial.sendCommand('esp get netssid', { timeout: 3000 });
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { value: result.messages[0] || '', message: 'ok' };
    },

    async espSetNetSSID(value) {
        const cmd = value ? `esp set netssid = ${value}` : 'esp set netssid =';
        const raw = await Serial.sendCommand(cmd, { timeout: 3000 });
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { value, message: result.messages[0] || 'ok' };
    },

    async espPassthrough() {
        const raw = await Serial.sendCommand('esppt');
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { message: result.messages[0] || 'ESP passthrough entered' };
    },

    async espBoot() {
        const raw = await Serial.sendCommand('espboot');
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { message: result.messages[0] || 'ESP boot mode entered' };
    },

    async hc04GetPin() {
        const raw = await Serial.sendCommand('hc04 getpin', { timeout: 3000 });
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { pin: result.messages[0] || '', message: 'ok' };
    },

    async hc04SetPin(pin) {
        const raw = await Serial.sendCommand(`hc04 setpin = ${parseInt(pin)}`, { timeout: 3000 });
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { pin: String(pin), message: result.messages[0] || 'ok' };
    },

    async hc04Passthrough() {
        const raw = await Serial.sendCommand('hc04 pt');
        const result = Parser.parseGeneric(raw);
        if (result.errors.length > 0) return { error: result.errors[0] };
        return { message: result.messages[0] || 'HC04 passthrough entered' };
    },

    async sendRaw(command, timeout = 2.0) {
        const raw = await Serial.sendCommand(command, { timeout: timeout * 1000 });
        return { response: raw };
    },
};
