# Desk Pull

**English** | [简体中文](README.zh-CN.md)

[Play on Qoder Sites](https://desk-pull-zvttmo3kjmf.qoder.zone/) · Game interface in Simplified Chinese

A yellow ball rests on the piece you need. Do you move the ball first, or slide the piece out from underneath and see if the ball stays on the desk?

Desk Pull is a browser physics puzzle built for the LifeHack track of the 2026 Qoder competition. Drag objects with your mouse or finger to collect the pieces that match the target color. Select **同桌再来** (“Retry this desk”) to restore the same layout and try a different move. Stars show how well you cleared the desk, and your score lets you compare attempts on that layout.

## Play locally

With Node.js installed, run this command from the project directory:

```sh
node server.mjs
```

Open <http://127.0.0.1:4173/> in your browser. The game and its physics engine are bundled in `web/`, so you can run it without installing npm packages.

## License

Desk Pull uses the [MIT License](LICENSE). The bundled [Matter.js](https://github.com/liabru/matter-js) physics engine includes its [own license](web/vendor/LICENSE-matter-js.txt).
