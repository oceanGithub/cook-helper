/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
    openid: string,
    loggedIn: boolean,
    loginPromise?: Promise<string>,
  }
}