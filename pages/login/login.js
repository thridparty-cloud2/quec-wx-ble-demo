const plugin = requirePlugin("quecPlugin");

Page({
  data: {
    account: '',
    password: '',
    loading: false
  },

  onLoad() {
    // 如果已有 token，直接跳转配网页
    if (plugin.config.getToken()) {
      wx.redirectTo({ url: '/pages/ble_demo/ble_demo' });
    }
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  login() {
    const { account, password } = this.data;
    if (!account || password.length < 6) return;

    this.setData({ loading: true });

    if (account.indexOf('@') >= 0) {
      // 邮箱登录
      plugin.quecUser.emailPwdLogin({
        email: account,
        pwd: password,
        success: (res) => {
          wx.showToast({ title: '登录成功', icon: 'success' });
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/ble_demo/ble_demo' });
          }, 1000);
        },
        fail: (err) => {
          wx.showToast({ title: err.msg || '登录失败', icon: 'none' });
        },
        complete: () => {
          this.setData({ loading: false });
        }
      });
    } else {
      // 手机号登录
      plugin.quecUser.phonePwdLogin({
        internationalCode: '86',
        phone: account,
        pwd: password,
        success: (res) => {
          wx.showToast({ title: '登录成功', icon: 'success' });
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/ble_demo/ble_demo' });
          }, 1000);
        },
        fail: (err) => {
          wx.showToast({ title: err.msg || '登录失败', icon: 'none' });
        },
        complete: () => {
          this.setData({ loading: false });
        }
      });
    }
  }
});
