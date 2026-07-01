const plugin = requirePlugin("quecPlugin");

// 配网状态码对照
const STATUS_MAP = {
  '0x0010': '路由器扫描中',
  '0x0020': '路由器连接中',
  '0x0030': '云平台认证中',
  '0x0040': '云平台登录中',
  '0x0050': '云平台鉴权中',
  '0x0060': '绑定中',
  '0xfffe': '配网成功',
  '0xffff': '配网失败'
};

Page({
  data: {
    logs: [],
    scrollToLog: '',
    devices: [],
    selectedDevice: null,
    deviceId: '',
    serviceId: '',
    characteristicId: '',
    ssid: '',
    password: '',
    pk: '',
    dk: '',
    bindCode: '',
    // 状态
    bleOpened: false,
    scanning: false,
    connected: false,
    provisioning: false,
    bound: false,
    provisionStep: '',
    provisionProgress: 0,
    canProvision: false
  },

  onShow() {
    if (!plugin.config.getToken()) {
      wx.redirectTo({ url: '/pages/login/login' });
    }
  },

  // 添加日志
  addLog(msg) {
    const time = new Date().toLocaleTimeString();
    const logs = [...this.data.logs, `[${time}] ${msg}`].slice(-100);
    this.setData({ logs, scrollToLog: `log-${logs.length - 1}` });
  },

  // 清空日志
  clearLogs() {
    this.setData({ logs: [], scrollToLog: '' });
  },

  // 检查是否可以配网
  checkCanProvision() {
    const canProvision = !!(this.data.ssid && this.data.selectedDevice && !this.data.provisioning);
    this.setData({ canProvision });
  },

  // 获取当前WiFi
  getWifi() {
    this.addLog('正在获取当前WiFi...');
    plugin.quecBle.getCurentWifi({
      success: (res) => {
        this.setData({ ssid: res.ssid || '' });
        this.addLog(`当前WiFi: ${res.ssid}`);
        this.checkCanProvision();
      },
      fail: (err) => {
        this.addLog(`获取WiFi失败: ${JSON.stringify(err)}`);
      }
    });
  },

  // 开启蓝牙
  openBle() {
    if (this.data.bleOpened) return;
    this.addLog('正在开启蓝牙...');
    plugin.quecBle.openBleAndLoc({
      success: (res) => {
        this.setData({ bleOpened: true });
        this.addLog('蓝牙开启成功');
      },
      fail: (err) => {
        this.addLog(`蓝牙开启失败: ${JSON.stringify(err)}`);
      }
    });
  },

  // 切换扫描
  toggleScan() {
    if (!this.data.bleOpened) {
      this.addLog('请先开启蓝牙');
      return;
    }
    if (this.data.scanning) {
      this.stopScan();
    } else {
      this.startScan();
    }
  },

  // 开始扫描
  startScan() {
    this.setData({ devices: [], scanning: true, selectedDevice: null });
    this.checkCanProvision();
    this.addLog('开始扫描蓝牙设备...');
    try {
      plugin.quecBle.onBLEDeviceFoundV2((res) => {
        const newDevices = res.devices || [];
        const existIds = this.data.devices.map(d => d.deviceId);
        const added = newDevices.filter(d => !existIds.includes(d.deviceId));
        if (added.length > 0) {
          const devices = [...this.data.devices, ...added];
          this.setData({ devices });
          this.addLog(`发现 ${added.length} 个新设备，共 ${devices.length} 个`);
        }
      });
    } catch (e) {
      this.addLog(`扫描异常: ${e.message || JSON.stringify(e)}`);
      this.setData({ scanning: false });
    }
  },

  // 停止扫描
  stopScan() {
    plugin.quecBle.stopBleScan({
      success: () => {
        this.setData({ scanning: false });
        this.addLog('已停止扫描');
      }
    });
  },

  // 选择设备
  selectDevice(e) {
    const index = e.currentTarget.dataset.index;
    const device = this.data.devices[index];
    this.setData({ selectedDevice: device });
    this.addLog(`已选择: ${device.name || device.deviceId}`);
    this.checkCanProvision();
  },

  // ========== 一键配网流程 ==========
  startProvision() {
    if (!this.data.canProvision) return;
    if (this.data.provisioning) return;
    if (!this.data.ssid) {
      this.addLog('请输入WiFi名称');
      return;
    }
    if (!this.data.selectedDevice) {
      this.addLog('请选择设备');
      return;
    }

    // 停止扫描
    if (this.data.scanning) {
      plugin.quecBle.stopBleScan({});
      this.setData({ scanning: false });
    }

    this.setData({ provisioning: true, bound: false, provisionProgress: 0 });
    this.addLog('===== 开始一键配网 =====');
    this.doConnect();
  },

  // 步骤1：连接设备
  doConnect() {
    this.setData({ provisionStep: '正在连接设备...', provisionProgress: 10 });
    this.addLog(`连接设备: ${this.data.selectedDevice.name || this.data.selectedDevice.deviceId}`);
    plugin.quecBle.connectBLE({
      deviceId: this.data.selectedDevice.deviceId,
      openDeviceFound: false,
      timeout: 15000,
      success: (res) => {
        this.setData({
          connected: true,
          deviceId: res.deviceId,
          serviceId: res.serviceId,
          characteristicId: res.characteristicId
        });
        this.addLog('连接成功');
        this.doOpenNotify();
      },
      fail: (err) => {
        this.addLog(`连接失败: ${JSON.stringify(err)}`);
        this.provisionFail('设备连接失败');
      }
    });
  },

  // 步骤2：开启通知
  doOpenNotify() {
    this.setData({ provisionStep: '开启通知通道...', provisionProgress: 25 });
    plugin.quecBle.openNotifyBLE({
      deviceId: this.data.deviceId,
      serviceId: this.data.serviceId,
      characteristicId: this.data.characteristicId,
      state: true,
      type: 'indication',
      success: (res) => {
        this.addLog('Notify开启成功');
        this.doStartListen();
      },
      fail: (err) => {
        this.addLog(`Notify失败: ${JSON.stringify(err)}`);
        this.provisionFail('开启通知失败');
      }
    });
  },

  // 步骤3：监听 + 发送WiFi（紧接着发送，不等用户操作）
  doStartListen() {
    this.setData({ provisionStep: '监听配网状态...', provisionProgress: 40 });
    const isNew = !!(this.data.selectedDevice && this.data.selectedDevice.pk);
    plugin.quecBle.onBLECharacteristicValueChangeV2({
      isNew,
      success: (res) => {
        this.setData({
          pk: res.productKey,
          dk: res.deviceKey,
          bindCode: res.bindCode
        });
        this.addLog(`配网回调成功! PK:${res.productKey} DK:${res.deviceKey}`);
        // 自动绑定
        this.doBindDevice(res.productKey, res.deviceKey, res.bindCode);
      },
      status: (res) => {
        const statusText = STATUS_MAP[res.statusCode] || `未知(${res.statusCode})`;
        this.addLog(`状态: ${statusText}`);
        if (res.statusCode === '0xfffe' && res.bindCode) {
          this.setData({ pk: res.pk, dk: res.dk, bindCode: res.bindCode, provisionProgress: 70 });
          this.doBindDevice(res.pk, res.dk, res.bindCode);
        }
        if (res.statusCode === '0xffff') {
          this.addLog(`配网失败, 错误码: ${res.errorCode}`);
          this.provisionFail(`配网失败(${res.errorCode})`);
        }
      }
    });
    // 紧接着发送WiFi信息，不延迟
    this.doSendWifi();
  },

  // 步骤4：发送WiFi
  doSendWifi() {
    this.setData({ provisionStep: '发送WiFi信息...', provisionProgress: 50 });
    const device = this.data.selectedDevice || {};
    this.addLog(`发送WiFi: ${this.data.ssid}`);
    plugin.quecBle.writeBLECharacteristicValue({
      deviceId: this.data.deviceId,
      serviceId: this.data.serviceId,
      characteristicId: this.data.characteristicId,
      ssid: this.data.ssid,
      password: this.data.password,
      isNew: !!device.pk,
      domain: device.mccAddr || '',
      success: (res) => {
        this.addLog('WiFi信息发送成功，等待设备配网...');
        this.setData({ provisionStep: '设备配网中，请等待...', provisionProgress: 60 });
      },
      fail: (err) => {
        this.addLog(`WiFi发送失败: ${JSON.stringify(err)}`);
        this.provisionFail('WiFi信息发送失败');
      }
    });
  },

  // 步骤5：绑定设备（轮询60s）
  doBindDevice(pk, dk, bindCode) {
    if (this.data.bound) return;
    this.setData({ provisionStep: '绑定设备中...', provisionProgress: 80 });
    this.addLog('开始轮询绑定...');
    const maxDuration = 60000;
    const interval = 3000;
    const startTime = Date.now();
    const poll = () => {
      if (this.data.bound) return;
      if (Date.now() - startTime > maxDuration) {
        this.provisionFail('绑定超时(60s)');
        return;
      }
      plugin.quecManage.bindDeviceByWifi({
        pk: pk,
        dk: dk,
        bindingCode: bindCode,
        deviceName: '',
        success: (res) => {
          this.setData({ bound: true, provisioning: false, provisionStep: '配网完成!', provisionProgress: 100, canProvision: false });
          this.addLog('===== 绑定成功! =====');
        },
        fail: (err) => {
          this.addLog('绑定轮询中...');
          setTimeout(poll, interval);
        }
      });
    };
    poll();
  },

  // 配网失败
  provisionFail(reason) {
    this.setData({ provisioning: false, provisionStep: `失败: ${reason}` });
    this.addLog(`配网终止: ${reason}`);
    this.checkCanProvision();
  },

  // 断开连接
  disconnect() {
    plugin.quecBle.closeBLEConnection({
      deviceId: this.data.deviceId,
      success: () => {
        this.setData({ connected: false });
        this.addLog('蓝牙连接已断开');
      }
    });
  },

  // 关闭蓝牙
  closeBle() {
    plugin.quecBle.closeBle({
      success: () => {
        this.setData({ bleOpened: false, scanning: false, connected: false, devices: [], selectedDevice: null });
        this.addLog('蓝牙模块已关闭');
        this.checkCanProvision();
      }
    });
  },

  // 输入事件
  onSsidInput(e) {
    this.setData({ ssid: e.detail.value });
    this.checkCanProvision();
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  // 重置配网，可再次配网
  resetProvision() {
    // 先断开连接
    if (this.data.connected) {
      plugin.quecBle.closeBLEConnection({ deviceId: this.data.deviceId });
    }
    // 关闭蓝牙模块
    if (this.data.bleOpened) {
      plugin.quecBle.closeBle({});
    }
    this.setData({
      selectedDevice: null,
      deviceId: '',
      serviceId: '',
      characteristicId: '',
      pk: '',
      dk: '',
      bindCode: '',
      bleOpened: false,
      scanning: false,
      connected: false,
      provisioning: false,
      bound: false,
      provisionStep: '',
      provisionProgress: 0,
      canProvision: false,
      devices: []
    });
    this.addLog('===== 已重置，可再次配网 =====');
  }
});
