export const TAVERN_RELEASE_CAPABILITIES = Object.freeze({
  // 剧情生图已由外部插件 dsh-tavern-image 接管（数据目录 data/tools/dsh-tavern-image）。
  // 设为 false 后 Tavern 不再实例化自己的生成器、不再注册生图路由，也不会向任何渠道发请求；
  // 已生成的插图仍由 lib/index.js 里的只读实例提供读取，旧存档不受影响。
  sceneImages: false
})