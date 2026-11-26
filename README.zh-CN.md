# 桌面抽物 · Desk Pull

[English](README.md) | **简体中文**

[在 Qoder Sites 上试玩](https://desk-pull-zvttmo3kjmf.qoder.zone/)

桌上那颗黄球压着你要拿的东西。你可以先把球搬走，也可以从底下直接抽，看看球还能不能留在桌上。

这是为 2026 Qoder 高校创造力大赛 LifeHack 赛道制作的浏览器物理小游戏。用鼠标或手指按住物件拖动，收齐本桌指定颜色的目标就能过关。想试另一种拿法，点「同桌再来」即可恢复原来的摆放。星星记录完成程度，分数可以用来比较同一桌的两次尝试。

## 本地试玩

安装 Node.js 后，在项目目录运行：

```sh
node server.mjs
```

用浏览器打开 <http://127.0.0.1:4173/>。游戏静态文件都在 `web/` 下，物理引擎已随项目附带，无需安装 npm 依赖。

## 许可证

游戏源码使用 [MIT 许可证](LICENSE)。物理引擎 [Matter.js](https://github.com/liabru/matter-js) 的许可见[随附文件](web/vendor/LICENSE-matter-js.txt)。
